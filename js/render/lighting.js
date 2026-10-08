/* ============ Iluminación y uniforms globales compartidos ============
   Dueño desde la Ola 1: A1 (luz y atmósfera). Hoy es el mínimo de P-6:
   el reloj del viento y las luces actuales, con el valor de uniforms neutro
   para todo lo que todavía nadie consume (§6.3). Los materiales los toman por
   referencia (shaderlib.patch), así que cambiar `.value` los actualiza a todos. */
import * as THREE from "three";

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
  uFogColor:  { value: new THREE.Color(0xe6ecdc) },
  uFogNear:   { value: 1e9 },                      // neutro: niebla fuera de alcance
  uFogFar:    { value: 1e9 },
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
