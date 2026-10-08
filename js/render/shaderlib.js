/* ============ Biblioteca de shaders compartida ============
   Dueño desde la Ola 1: A1 (niebla, hemisferio, AO, fade dither, ruido). Hoy es un
   esqueleto: patch() solo inyecta lo que ya existía, el viento del pasto, igual que
   cuando estaba dentro de buildGroup(). Los chunks GLSL nuevos se agregan acá y se
   activan con una opción de `opts`. */
import { uniforms } from "./lighting.js";

/* patch(material, opts): engancha los chunks pedidos en `onBeforeCompile`.
     opts.wind  → vaivén del pasto en el vertex shader (uTime compartido) */
export function patch(material, opts = {}) {
  if (opts.wind) {
    // Viento: vaivén en shader según la fase por posición de instancia.
    // Solo anima cuando el mapa repinta (tour, órbita, navegación).
    const uTime = uniforms.uTime;
    material.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>",
          "#include <begin_vertex>\n" +
          "float ph = dot(instanceMatrix[3].xz, vec2(37.0, 73.0));\n" +
          "transformed.x += sin(uTime * 1.8 + ph) * 0.12 * position.y;\n" +
          "transformed.z += cos(uTime * 1.3 + ph * 1.7) * 0.08 * position.y;");
    };
  }
  return material;
}
