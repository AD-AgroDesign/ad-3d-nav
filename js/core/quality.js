/* ============ Niveles de calidad (§6.4) ============
   Ultra / Alta / Media / Baja. Se resuelven ANTES de crear el Map (T3: antialias y
   pixelRatio se fijan al crear el contexto WebGL; cambiarlos requiere recargar).
   Prioridad: ?calidad=<nivel> en la URL > localStorage ("ad_calidad") > detección.
   HOY NO TIENE EFECTOS VISIBLES: los parámetros están declarados pero nadie los consume
   todavía (A1: MSAA/pixelRatio; A2: LOD; A3: sombras; A4: suelo/agua; A5: fauna). */
import { IS_MOBILE } from "./config.js";
import { emit } from "./events.js";

export const LEVELS = ["ultra", "alta", "media", "baja"];
export const LABELS = { ultra: "Ultra", alta: "Alta", media: "Media", baja: "Baja" };

/* Tabla de §6.4. Qué haría cada parámetro cuando lo consuma su dueño:
     msaa            antialias del contexto WebGL (true/false; "gpu" = sí salvo GPU de gama baja)
     pixelRatioCap   tope de devicePixelRatio del mapa
     grassDensity    factor sobre GRASS_CLASSES (1 = actual; "movil" = presupuesto móvil actual)
     grassLodDist    distancia (m) de LOD del pasto
     treeCardDist    follaje en tarjetas hasta esa distancia; treeImpostorDist: impostor desde ahí
     shadows         tamaño del shadow map (0 = sombras blob actuales)
     soil / fauna / water   suelo por shader, fauna, agua por shader
     idleFps         tope del lazo de animación en reposo (0 = apagado) */
export const LEVEL_PARAMS = {
  ultra: { msaa: true,  pixelRatioCap: 2,    grassDensity: 1,       grassLodDist: 1400, treeCardDist: 900, treeImpostorDist: Infinity, shadows: 4096, soil: "completo",   fauna: 1,   water: "shader", idleFps: 30 },
  alta:  { msaa: "gpu", pixelRatioCap: 1.5,  grassDensity: 1,       grassLodDist: 1000, treeCardDist: 600, treeImpostorDist: Infinity, shadows: 2048, soil: "completo",   fauna: 1,   water: "shader", idleFps: 30 },
  media: { msaa: "gpu", pixelRatioCap: 1.25, grassDensity: "movil", grassLodDist: 600,  treeCardDist: 300, treeImpostorDist: 1500,     shadows: 1024, soil: "sin-surcos", fauna: 0.5, water: "shader", idleFps: 20 },
  baja:  { msaa: false, pixelRatioCap: 1,    grassDensity: 0.5,     grassLodDist: 400,  treeCardDist: 0,   treeImpostorDist: 0,        shadows: 0,    soil: "apagado",    fauna: 0,   water: "plano",  idleFps: 0 }
};

const LS_KEY = "ad_calidad";

function lsGet() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, v); } catch (e) { /* sin localStorage: no se recuerda */ } }

/* GPUs de gama baja conocidas (lista corta; ver §6.4). Se pregunta con un contexto
   descartable: no se toca el del mapa. Las Intel HD/UHD de notebook NO se consideran baja. */
const GPU_BAJA = /Mali-4|Mali-T|Adreno \(TM\) [23]\d\d|PowerVR|SwiftShader|llvmpipe|Basic Render|Software/i;

function gpuRenderer() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return String(r);
  } catch (e) { return ""; }
}

/* GPUs integradas de notebook (decisión de Mike, 2026-11-10): en la Intel HD 520 el MSAA cuesta
   ~1,8× el frame (El Carmen multi 54 → 30 fps). Con msaa "gpu" (Alta y Media) se apaga en estas y
   en las de gama baja; Ultra lo fuerza siempre. */
const GPU_INTEGRADA = /Intel.*(HD|UHD|Iris)|Radeon\(TM\) (Vega \d+ )?Graphics|AMD Radeon Graphics/i;
let _gpu = null;
const gpuName = () => (_gpu === null ? (_gpu = gpuRenderer()) : _gpu);

/* Resuelve el valor msaa de un nivel (true/false/"gpu") a un booleano. */
export function msaaEnabled(q) {
  if (q.msaa !== "gpu") return !!q.msaa;
  const g = gpuName();
  return !(GPU_BAJA.test(g) || GPU_INTEGRADA.test(g));
}

/* Detección inicial: IS_MOBILE, deviceMemory, hardwareConcurrency y GPU. */
export function detectLevel() {
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  if (GPU_BAJA.test(gpuName())) return "baja";
  if ((mem && mem <= 2) || (cores && cores <= 2)) return "baja";
  if (IS_MOBILE) return "media";
  if (mem && mem <= 4) return "media";
  return "alta";
}

/* Objeto único y mutable: los módulos guardan la referencia y ven los cambios. */
export const quality = { name: "alta", ...LEVEL_PARAMS.alta, source: "default" };

/* Resuelve el nivel inicial. Se llama una sola vez, antes de crear el Map (map/style.js). */
export function resolveQuality() {
  const q = new URLSearchParams(location.search).get("calidad");
  let name, source;
  if (q && LEVELS.includes(q.toLowerCase())) { name = q.toLowerCase(); source = "url"; }
  else if (LEVELS.includes(lsGet())) { name = lsGet(); source = "localStorage"; }
  else { name = detectLevel(); source = "deteccion"; }
  Object.assign(quality, { name, ...LEVEL_PARAMS[name], source });
  return quality;
}

/* Cuando A1 conecte antialias/pixelRatio al crear el Map, poner esto en true: entonces
   un cambio de nivel que modifique esos parámetros recarga la página (T3). Hoy no
   afectan nada visible, así que no hay motivo para recargar. */
export const CONTEXT_PARAMS_ACTIVE = true;   // A1 1.3: style.js ya conecta antialias/pixelRatio

/* Cambia el nivel en caliente. Devuelve false si el nombre no es válido.
   opts.persist (true): lo recuerda en localStorage; opts.reload (true): permite la
   recarga cuando CONTEXT_PARAMS_ACTIVE y cambian msaa/pixelRatioCap. */
export function setQuality(name, opts = {}) {
  name = String(name).toLowerCase();
  if (!LEVELS.includes(name)) return false;
  const prev = { ...quality };
  Object.assign(quality, { name, ...LEVEL_PARAMS[name], source: "usuario" });
  if (opts.persist !== false) lsSet(name);
  emit("quality", quality);
  const needsReload = CONTEXT_PARAMS_ACTIVE &&
    (prev.msaa !== quality.msaa || prev.pixelRatioCap !== quality.pixelRatioCap);
  if (needsReload && opts.reload !== false) location.reload();
  return true;
}
