/* ============ Iluminación y uniforms globales compartidos ============
   Dueño desde la Ola 1: A1 (luz y atmósfera). Hoy es el mínimo de P-6:
   el reloj del viento y las luces actuales, con el valor de uniforms neutro
   para todo lo que todavía nadie consume (§6.3). Los materiales los toman por
   referencia (shaderlib.patch), así que cambiar `.value` los actualiza a todos. */
import * as THREE from "three";
import { A1_FOG } from "../core/config.js";
import { on } from "../core/events.js";
import { quality } from "../core/quality.js";

/* Paridad con r149 (P-5): r149 trataba los hex como valores directos y escribía el
   frame sin conversión de salida. En r170 eso se reproduce con ColorManagement apagado
   (Color.setHex no convierte sRGB→lineal) y outputColorSpace lineal (sin sRGB OETF; se fija
   en host.js al crear el renderer). El realce de color / tone mapping correcto es trabajo
   de A1, no de este paso. Va acá, antes de crear cualquier Color. */
THREE.ColorManagement.enabled = false;

/* Uniforms globales (§6.3). Solo uTime se usa hoy (viento del pasto); el resto está
   declarado con valores neutros para que A1/A2/A4/A5 los consuman sin tocar el host. */
export const uniforms = {
  uTime:      { value: 0 },                        // reloj del viento (solo avanza cuando el mapa repinta)
  uCamPos:    { value: new THREE.Vector3() },      // posición de cámara en metros de escena (core/camera.js, P-7)
  uSunDir:    { value: new THREE.Vector3(-0.5, 1, -0.7).normalize() },
  uSunColor:  { value: new THREE.Color(0xfff3da) },
  uHemiSky:   { value: new THREE.Color(0xffffff) },
  uHemiGround:{ value: new THREE.Color(0xffffff) },
  uFogColor:  { value: new THREE.Color(A1_FOG.color) },   // = horizon-color del sky (config.js A1_SKY)
  uFogNear:   { value: 1e9 },                      // se recalculan cada frame en updateFog(); 1e9 = sin niebla
  uFogFar:    { value: 1e9 },
  uFogMax:    { value: A1_FOG.max },               // opacidad máxima de la niebla (horizonte)
  uFade:      { value: 1 }                         // fade dither (A1): 1 = opaco
};

/* Luces actuales de la escena, tal cual estaban en vegLayer.onAdd. r155+ usa luces
   físicamente correctas (sin el ×π implícito del modo legacy de r149): se compensa
   multiplicando las intensidades por π para conservar el aspecto. */
export function createLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff3da, 0.85 * Math.PI);
  sun.position.set(-0.5, 1, -0.7);  // sol NO (sombras GeoJSON al SE)
  scene.add(sun);
  return { sun };
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
