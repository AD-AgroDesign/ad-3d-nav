/* ============ Niveles de calidad (§6.4) ============
   Ultra / Alta / Media / Baja. Se resuelven ANTES de crear el Map (T3: antialias y
   pixelRatio se fijan al crear el contexto WebGL; cambiarlos requiere recargar).
   Prioridad: ?calidad=<nivel> en la URL > localStorage ("ad_calidad") > detección.
   Consumidores: A1 (MSAA/pixelRatio), A2 (LOD), A3 (sombras), A4 (suelo/agua), A5 (fauna), A6 (terreno), idleDriver (render/idle.js). */
import { IS_MOBILE } from "./config.js?v=20261113";
import { emit, on } from "./events.js?v=20261113";

export const LEVELS = ["ultra", "alta", "media", "baja"];

/* Tabla de §6.4. Qué haría cada parámetro cuando lo consuma su dueño:
     msaa            antialias del contexto WebGL (true/false; "gpu" = sí salvo GPU de gama baja)
     pixelRatioCap   tope de devicePixelRatio del mapa
     grassDensity    factor sobre GRASS_CLASSES (1 = actual; "movil" = presupuesto móvil actual)
     grassLodDist    distancia (m) de LOD del pasto
     treeCardDist    follaje en tarjetas hasta esa distancia; treeImpostorDist: impostor desde ahí
     shadows         tamaño del shadow map (0 = sombras blob actuales)
     soil / fauna / water   suelo por shader, fauna, agua por shader
     terrain         terreno 3D + hillshade (A6; true/false; "gpu" = sí salvo GPU integrada o de gama baja)
     idleFps         tope del lazo de animación en reposo (0 = apagado) */
export const LEVEL_PARAMS = {
  ultra: { msaa: true,  pixelRatioCap: 2,    grassDensity: 1,       grassLodDist: 1400, treeCardDist: 900, treeImpostorDist: Infinity, shadows: 4096, soil: "completo",   fauna: 1,   water: "shader", idleFps: 30, terrain: "gpu" },   // Ola 4 4.2: terreno solo con GPU dedicada, igual que Alta (Mike 2026-11-12)
  alta:  { msaa: "gpu", pixelRatioCap: 1.5,  grassDensity: 1,       grassLodDist: 1000, treeCardDist: 600, treeImpostorDist: Infinity, shadows: 2048, soil: "completo",   fauna: 1,   water: "shader", idleFps: 30, terrain: "gpu" },
  media: { msaa: "gpu", pixelRatioCap: 1.25, grassDensity: "movil", grassLodDist: 600,  treeCardDist: 300, treeImpostorDist: 1500,     shadows: 1024, soil: "sin-surcos", fauna: 0.5, water: "shader", idleFps: 20, terrain: false },
  baja:  { msaa: false, pixelRatioCap: 1,    grassDensity: 0.5,     grassLodDist: 400,  treeCardDist: 0,   treeImpostorDist: 0,        shadows: 0,    soil: "apagado",    fauna: 0,   water: "plano",  idleFps: 0, terrain: false }
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

/* A6 (G2, decisión de Mike 2026-11-11; Ola 4 4.2: también Ultra): terreno 3D + hillshade solo con GPU dedicada en Ultra y Alta.
   En la Intel HD 520 el terreno MapLibre costaba +10 a +85 ms por frame (a7 G2). Override solo de QA:
   ?gpu=integrada|dedicada (con ?qa) simula el tipo de GPU del headless (SwiftShader no es ninguno de los dos). */
export function terrainEnabled(q) {
  if (q.terrain !== "gpu") return !!q.terrain;
  const sim = new URLSearchParams(location.search);
  if (sim.has("qa") && sim.get("gpu") === "dedicada") return true;
  if (sim.has("qa") && sim.get("gpu") === "integrada") return false;
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
  const prev = { ...quality }, terrPrev = terrainEnabled(quality);
  Object.assign(quality, { name, ...LEVEL_PARAMS[name], source: "usuario" });
  if (opts.persist !== false) lsSet(name);
  emit("quality", quality);
  const needsReload = CONTEXT_PARAMS_ACTIVE &&
    (prev.msaa !== quality.msaa || prev.pixelRatioCap !== quality.pixelRatioCap ||
     terrPrev !== terrainEnabled(quality));   // A6: el terreno se decide al cargar el campo
  if (needsReload && opts.reload !== false) location.reload();
  return true;
}

/* ============ Ola 4 4.2: Ultra se degrada sola a Alta si la máquina no aguanta ============
   Mide el p50 del tiempo de frame SOLO con la cámara en movimiento (tour, órbita, arrastre), sin contar la carga ni el
   reposo: descarta los primeros 10 s de la página, los primeros 6 s de movimiento acumulado (teselas, compilación de shaders)
   y los frames de más de 250 ms (pestaña oculta, pausas). Ventana deslizante de 240 frames en movimiento, evaluada cada 60.
   Si el p50 de la ventana supera 33 ms (< 30 fps) y el usuario está en Ultra, baja a Alta:
     - en caliente: sombras (4096 → 2048), distancias de pasto y árboles, suelo, fauna (los sistemas escuchan "quality")
       y pixelRatio vía map.setPixelRatio (tope de Alta, 1,5);
     - para la próxima carga: el MSAA (se fija al crear el contexto, T3). Hasta recargar queda el del contexto actual.
   Nunca recarga la página. Persiste "alta" en localStorage (la próxima carga ya arranca en Alta, sin MSAA forzado ni pixelRatio 2)
   salvo que Ultra venga forzado por ?calidad= (esa URL no se persiste, igual que setQuality desde la URL).
   Una sola vez por sesión: si el usuario vuelve a elegir Ultra a mano, no se lo vuelve a degradar.
   Con ?qa NO corre, salvo ?autoq=1 (prueba). Solo con ?qa: ?autoqms=<ms> cambia el umbral y ?autoqfast=1 acorta las esperas. */
const _AQ = new URLSearchParams(location.search);
const AQ_QA = _AQ.has("qa");
const AQ_ON = !AQ_QA || _AQ.get("autoq") === "1";
const AQ_FAST = AQ_QA && _AQ.get("autoqfast") === "1";
const AQ_THR = (AQ_QA && Number(_AQ.get("autoqms"))) || 33;
const AQ_PAGE_MS = AQ_FAST ? 0 : 10000, AQ_WARM_MS = AQ_FAST ? 0 : 6000, AQ_WIN = AQ_FAST ? 60 : 240, AQ_STEP = AQ_FAST ? 20 : 60;
export const autoQ = { on: AQ_ON, degraded: false, optOut: false, samples: 0, lastP50: null, thr: AQ_THR };

const aq = { dts: [], moveMs: 0, since: 0, prev: null };

function aqAviso() {
  const sec = document.getElementById("quality-section");
  if (!sec) return;
  let el = document.getElementById("quality-aviso");
  if (!el) { el = document.createElement("p"); el.id = "quality-aviso"; el.setAttribute("role", "status"); sec.appendChild(el); }
  el.textContent = "Ultra no rinde en este equipo: pasamos a Alta.";
  const sel = document.getElementById("quality-select");
  if (sel) { sel.value = "alta"; sel.addEventListener("change", () => el.remove(), { once: true }); }
}

async function aqDegrade() {
  if (autoQ.degraded || autoQ.optOut || quality.name !== "ultra") return;
  autoQ.degraded = true;
  const persist = quality.source !== "url";
  setQuality("alta", { persist, reload: false });   // en caliente: sombras, pasto, árboles, suelo, fauna
  quality.source = "auto";
  try {   // pixelRatio en caliente (MapLibre 4.7.1 tiene map.setPixelRatio); el MSAA queda para la próxima carga
    const { map } = await import("../map/style.js?v=20261113");
    if (map.setPixelRatio) map.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
  } catch (e) { /* sin mapa: nada que ajustar */ }
  aqAviso();
  console.info("[calidad] Ultra → Alta automático (p50 " + (autoQ.lastP50 && autoQ.lastP50.toFixed(1)) + " ms > " + AQ_THR + " ms)");
}

function aqFrame(f) {
  if (quality.name !== "ultra" || autoQ.degraded || autoQ.optOut) return;
  /* Movimiento = cambió la matriz de vista del frame (cubre traslación, zoom, inclinación y giro; un repintado de
     reposo por animación de fauna/agua la deja idéntica). */
  const e = f.viewProj.elements, pm = aq.prev || (aq.prev = new Float64Array(16));
  let d = 0;
  for (let i = 0; i < 16; i++) { d += Math.abs(e[i] - pm[i]); pm[i] = e[i]; }
  const moved = d > 1e-9;
  if (!moved || document.hidden || !(f.dt > 0) || f.dt > 250 || f.now < AQ_PAGE_MS) return;
  if (aq.moveMs < AQ_WARM_MS) { aq.moveMs += f.dt; return; }
  aq.dts.push(f.dt);
  if (aq.dts.length > AQ_WIN) aq.dts.shift();
  autoQ.samples++;
  if (aq.dts.length < AQ_WIN || ++aq.since < AQ_STEP) return;
  aq.since = 0;
  const s = aq.dts.slice().sort((a, b) => a - b);
  autoQ.lastP50 = s[s.length >> 1];
  /* Fuera del frame: el cambio recrea el shadow map y no puede pasar en medio del render del host. */
  if (autoQ.lastP50 > AQ_THR) setTimeout(aqDegrade, 0);
}

if (AQ_ON) {
  on("frame", aqFrame);
  /* El usuario vuelve a elegir Ultra a mano tras una degradación: se respeta (no se lo vuelve a degradar). */
  on("quality", q => { if (q.name === "ultra" && autoQ.degraded) autoQ.optOut = true; });
}
