/* ============ Biblioteca de shaders compartida ============
   Dueño desde la Ola 1: A1 (niebla, hemisferio, AO, fade dither, ruido). Los chunks GLSL
   se agregan acá y se activan con una opción de `opts` en patch(). Un material que ya usaba
   onBeforeCompile se compone SIEMPRE dentro de patch() (no pisarlo desde afuera).

   patch(material, opts):
     opts.wind   vaivén del pasto en el vertex shader (uTime compartido)
     opts.fog    niebla por distancia real a la cámara (uCamPos, T1; curva adFog) con los
                 uniforms globales uFogColor/uFogNear/uFogFar/uFogMax de lighting.js
     opts.fade   fade dither (screen-door): descarta fragmentos por umbral Bayer 4x4 contra uFade,
                 así el material queda OPACO (transparent:false, depthWrite:true).
                   fade: "inicial" | "multi" → usa el uniforme COMPARTIDO del escenario
                                               (lo escribe host.setOpacity: nadie más lo toca)
                   fade: true               → uniforme propio del material (setFade(mat, v))
   El material debe ser MeshBasic/Lambert/Phong/Standard (necesitan <fog_fragment>). */
import { uniforms } from "./lighting.js";

/* ---------- GLSL ---------- */

/* Curva de niebla compartida con la capa atmo-fog del suelo (render/atmo.js): ambas deben
   dar el mismo valor para la misma distancia o el horizonte se parte en dos. */
export const GLSL_FOG_UNIFORMS = "uniform vec3 uFogColor;\nuniform float uFogNear;\nuniform float uFogFar;\nuniform float uFogMax;\n";
export const GLSL_ADFOG =
  "float adFog(float d) {\n" +
  "  float x = clamp((d - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);\n" +
  "  return x * x * (3.0 - 2.0 * x) * uFogMax;\n" +
  "}\n";

/* Umbral Bayer 4x4 en [0,1) por píxel de pantalla (ordenado: sin parpadeo entre frames). */
const GLSL_FADE =
  "uniform float uFade;\n" +
  "float adBayer4(vec2 p) {\n" +
  "  ivec2 q = ivec2(mod(p, 4.0));\n" +
  "  int i = q.x + q.y * 4;\n" +
  "  // matriz Bayer 4x4 (valores 0..15)\n" +
  "  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);\n" +
  "  return (float(m[i]) + 0.5) / 16.0;\n" +
  "}\n";

/* ---------- fade dither: uniformes por escenario y por material ---------- */

/* Un uniforme compartido por escenario: host.setOpacity(key, o) lo escribe una sola vez y
   todos los materiales parchados con fade:"<key>" lo ven. */
export const scenarioFade = { inicial: { value: 1 }, multi: { value: 1 } };

/* Fija el fade (0..1) de un material parchado con fade:true (uniforme propio). */
export function setFade(material, v) {
  const u = material.userData && material.userData.uFade;
  if (u) u.value = v;
}

/* Aplica los chunks pedidos a un shader de Three (vertex + fragment). */
function applyChunks(sh, o) {
  let vs = sh.vertexShader, fs = sh.fragmentShader;

  if (o.wind) {
    // Viento: vaivén en shader según la fase por posición de instancia.
    // Solo anima cuando el mapa repinta (tour, órbita, navegación).
    sh.uniforms.uTime = uniforms.uTime;
    vs = vs
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\n" +
        "float ph = dot(instanceMatrix[3].xz, vec2(37.0, 73.0));\n" +
        "transformed.x += sin(uTime * 1.8 + ph) * 0.12 * position.y;\n" +
        "transformed.z += cos(uTime * 1.3 + ph * 1.7) * 0.08 * position.y;");
  }

  if (o.fog) {
    // Posición de mundo (metros de escena) del vértice: ya con instancia y con el viento aplicado.
    sh.uniforms.uCamPos = uniforms.uCamPos;
    sh.uniforms.uFogColor = uniforms.uFogColor;
    sh.uniforms.uFogNear = uniforms.uFogNear;
    sh.uniforms.uFogFar = uniforms.uFogFar;
    sh.uniforms.uFogMax = uniforms.uFogMax;
    vs = vs
      .replace("#include <common>", "#include <common>\nvarying vec3 vAdWPos;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n" +
        "#ifdef USE_INSTANCING\n" +
        "  vAdWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n" +
        "#else\n" +
        "  vAdWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n" +
        "#endif");
    // Reemplaza <fog_fragment> (va después del tone mapping y de la conversión de color de
    // salida): la niebla se mezcla en el espacio de salida, igual que el horizon-color del sky.
    fs = fs
      .replace("#include <common>", "#include <common>\nvarying vec3 vAdWPos;\nuniform vec3 uCamPos;\n" + GLSL_FOG_UNIFORMS + GLSL_ADFOG)
      .replace("#include <fog_fragment>",
        "gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, adFog(distance(vAdWPos, uCamPos)));");
  }

  if (o.fadeU) {
    sh.uniforms.uFade = o.fadeU;
    // Va lo primero en main(): descarta antes de gastar en iluminación. uFade>=1 → nada se descarta.
    fs = fs
      .replace("#include <common>", "#include <common>\n" + GLSL_FADE)
      .replace("void main() {", "void main() {\n  if (uFade < 1.0 && uFade <= adBayer4(gl_FragCoord.xy)) discard;");
  }

  sh.vertexShader = vs;
  sh.fragmentShader = fs;
}

function resolveOpts(material, opts) {
  const fadeU = !opts.fade ? null
    : typeof opts.fade === "string" ? (scenarioFade[opts.fade] || (scenarioFade[opts.fade] = { value: 1 }))
    : (material.userData.uFade || (material.userData.uFade = { value: 1 }));
  return { wind: !!opts.wind, fog: !!opts.fog, fadeU };
}

/* Three cachea el programa por onBeforeCompile.toString() (igual para todos los patch):
   la clave tiene que distinguir las combinaciones de chunks. */
const keyOf = (o, prev) => (prev ? prev + "+" : "") + "ad:" + (o.wind ? "w" : "") + (o.fog ? "f" : "") + (o.fadeU ? "d" : "");

export function patch(material, opts = {}) {
  const o = resolveOpts(material, opts);
  material.onBeforeCompile = sh => applyChunks(sh, o);
  const key = keyOf(o);
  material.customProgramCacheKey = () => key;
  material.userData.adChunks = { wind: o.wind, fog: o.fog, fade: !!o.fadeU };
  return material;
}

/* patchExtra(material, opts): igual que patch() pero COMPONE con el onBeforeCompile que el
   material ya tenga (p. ej. el viento que puso un sistema) en vez de reemplazarlo. Es
   idempotente por chunk: si el material ya tiene `fog` (o `fade`) parchado, no lo repite.
   Lo usa el host para dar niebla a los materiales de TODOS los sistemas sin que cada uno
   tenga que acordarse; un sistema que llame patch(mat, { fog: true }) en su build queda igual. */
export function patchExtra(material, opts = {}) {
  const had = material.userData.adChunks || {};
  const want = { ...opts };
  if (had.fog) want.fog = false;
  if (had.fade) want.fade = false;
  const o = resolveOpts(material, want);
  if (!o.fog && !o.fadeU) return material;
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  const prevStr = material.userData.adChunks && prevKey ? prevKey.call(material) : "";   // sin patch previo: clave limpia
  material.onBeforeCompile = function (sh, renderer) { if (prev) prev.call(this, sh, renderer); applyChunks(sh, { fog: o.fog, fadeU: o.fadeU }); };
  const key = keyOf(o, prevStr);
  material.customProgramCacheKey = () => key;
  material.userData.adChunks = { wind: !!had.wind, fog: !!(had.fog || o.fog), fade: !!(had.fade || o.fadeU) };
  return material;
}
