/* ============ Iluminación y uniforms globales compartidos ============
   Dueño desde la Ola 1: A1 (luz y atmósfera). Hoy es el mínimo de P-6:
   el reloj del viento y las luces actuales, con el valor de uniforms neutro
   para todo lo que todavía nadie consume (§6.3). Los materiales los toman por
   referencia (shaderlib.patch), así que cambiar `.value` los actualiza a todos. */
import * as THREE from "three";
import { A1_CAMPOS, A1_FOG, A1_LIGHT, A1_RENDER, A1_SUN } from "../core/config.js";
import { on } from "../core/events.js";
import { quality } from "../core/quality.js";

/* Color (1.3): ColorManagement ENCENDIDO. Las paletas del proyecto están definidas "a ojo" en
   sRGB (hex); Three las convierte a lineal, ilumina en lineal y host.js saca sRGB + tone mapping
   (applyRenderSettings). El multiplicador de color de vértice del pasto (tip/base/midCol) se
   re-expresa en shaderlib (srgbVC) para que el producto con el color de instancia conserve el
   tono diseñado. Va acá, antes de crear cualquier Color. */
THREE.ColorManagement.enabled = true;

/* Color sRGB "crudo": no se convierte a lineal. La niebla se mezcla después del tone mapping y de
   la conversión de salida (shaderlib), igual que lo que MapLibre dibuja en el canvas. */
function rawColor(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
}

/* Uniforms globales (§6.3). Solo uTime se usa hoy (viento del pasto); el resto está
   declarado con valores neutros para que A1/A2/A4/A5 los consuman sin tocar el host. */
export const uniforms = {
  uTime:      { value: 0 },                        // reloj del viento (solo avanza cuando el mapa repinta)
  uCamPos:    { value: new THREE.Vector3() },      // posición de cámara en metros de escena (core/camera.js, P-7)
  uSunDir:    { value: new THREE.Vector3(-0.5, 1, -0.7).normalize() },
  uSunColor:  { value: new THREE.Color(0xfff3da) },
  uHemiSky:   { value: new THREE.Color(0xffffff) },
  uHemiGround:{ value: new THREE.Color(0xffffff) },
  uFogColor:  { value: rawColor(A1_FOG.color) },           // = horizon-color del sky; valor sRGB CRUDO (se mezcla ya en espacio de salida)
  uFogNear:   { value: 1e9 },                      // se recalculan cada frame en updateFog(); 1e9 = sin niebla
  uFogFar:    { value: 1e9 },
  uFogMax:    { value: A1_FOG.max },               // opacidad máxima de la niebla (horizonte)
  uFade:      { value: 1 }                         // fade dither (A1): 1 = opaco
};

/* ---------- Luces: hemisférica + sol (1.3) ----------
   Reemplazan Ambient 0.55π + Directional 0.85π (paridad de la Ola 0). Cielo cálido arriba,
   suelo = color medio del satélite del campo abajo. La dirección del sol sale de azimut y
   elevación (brújula: 0 = N, 90 = E; escena X este, Y arriba, Z sur). */
export const lights = {};
const TONE = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
const _tm = new URLSearchParams(location.search);

/* Color de salida + tone mapping del renderer (host.js lo llama al crearlo). Con ?debug/?qa se
   puede probar otro con ?tm=aces|agx|neutral|none&exp=1.2. */
export function applyRenderSettings(renderer) {
  const dbg = _tm.has("debug") || _tm.has("qa");
  const name = (dbg && _tm.get("tm")) || A1_RENDER.toneMapping;
  const exp = dbg && _tm.get("exp") ? parseFloat(_tm.get("exp")) : A1_RENDER.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE[name] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = exp;
}

export function setSun(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  const d = uniforms.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  if (lights.sun) lights.sun.position.copy(d).multiplyScalar(100);
  lights.azimuth = azimuthDeg; lights.elevation = elevationDeg;
}

/* Azimut y color de suelo del campo (config.js A1_CAMPOS; default regional si no se midió). */
export function applyCampoLighting(campoId) {
  const c = A1_CAMPOS[campoId] || {};
  setSun(c.sunAzimuth ?? A1_SUN.defaultAzimuth, A1_SUN.elevation);
  if (lights.hemi) lights.hemi.groundColor.set(c.groundColor || A1_LIGHT.hemiGround).multiplyScalar(A1_LIGHT.hemiGroundInt);
}

export function createLights(scene) {
  const hemi = lights.hemi = new THREE.HemisphereLight(A1_LIGHT.hemiSky, A1_LIGHT.hemiGround, 1);
  hemi.color.multiplyScalar(A1_LIGHT.hemiSkyInt);
  hemi.groundColor.multiplyScalar(A1_LIGHT.hemiGroundInt);
  const sun = lights.sun = new THREE.DirectionalLight(A1_LIGHT.sunColor, A1_LIGHT.sunInt);
  scene.add(hemi, sun);
  uniforms.uSunColor.value = sun.color; uniforms.uHemiSky.value = hemi.color; uniforms.uHemiGround.value = hemi.groundColor;
  setSun(A1_SUN.defaultAzimuth, A1_SUN.elevation);
  return { sun, hemi };
}

/* ---------- Niebla por distancia real a la cámara (1.2) ----------
   Rango RELATIVO a la geometría del frame (spike A1, trampa 1): un rango absoluto vela toda
   la imagen en zooms altos y deja recorte en el rasante, porque MapLibre dibuja el suelo solo
   hasta su plano lejano (3,7 km en el rasante, 10 km a z15.8, 140 km a z12).
     far  = farFrac · distancia al suelo sobre la línea del sky → la niebla llega a 1 justo ahí
     near = max(near mínimo, nearK · distancia cámara-centro), tope nearMaxFrac · far
   La usan por igual la capa atmo-fog (suelo) y los objetos Three (shaderlib `fog`).
   Baja calidad: sin niebla (como hoy). */
export const fog = { enabled: quality.name !== "baja", near: 1e9, far: 1e9, dHor: 0, hNdc: 0 };
on("quality", q => { fog.enabled = q.name !== "baja"; });

/* `cam` = resultado de core/camera.js updateCamera(...) con rays (se pasa `matrix`);
   H = alto del canvas en px CSS. Devuelve `fog` (objeto reutilizado). */
export function updateFog(cam, H) {
  const r = cam.rays;
  if (!fog.enabled || !r) {
    fog.near = fog.far = uniforms.uFogNear.value = uniforms.uFogFar.value = 1e9;
    return fog;
  }
  const hNdc = cam.horizonPx / (H / 2);
  // rayo (este, norte, arriba; m) de la línea del sky al centro horizontal de la pantalla
  const dx = r.d0[0] + hNdc * r.dy[0], dy = r.d0[1] + hNdc * r.dy[1], dz = r.d0[2] + hNdc * r.dy[2];
  const dHor = dz < -1e-6 ? (-cam.altitudeM / dz) * Math.hypot(dx, dy, dz) : 1e9;   // sin tope si el rayo no baja
  const far = dHor * A1_FOG.farFrac;
  const near = Math.min(Math.max(A1_FOG.near, A1_FOG.nearK * cam.ctdM), far * A1_FOG.nearMaxFrac);
  fog.near = near; fog.far = far; fog.dHor = dHor; fog.hNdc = hNdc;
  uniforms.uFogNear.value = near; uniforms.uFogFar.value = far;
  return fog;
}

/* Desplazamiento (m) de la sombra de un objeto de altura h: este y norte, opuesto al sol.
   Lo usará A3 (y cualquier sombra "blob") para que coincida con el sol de la escena y con las
   sombras horneadas del satélite (T13). */
export function shadowOffsetM(h) {
  const len = h / Math.tan(lights.elevation * Math.PI / 180), az = lights.azimuth * Math.PI / 180;
  return [-Math.sin(az) * len, -Math.cos(az) * len];
}
