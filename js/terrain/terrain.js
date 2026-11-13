/* ============ Terreno 3D real + sombreado de relieve (A6-2) ============
   Dueño: A6. Contrato con el resto (§6.3):
     - `terrain.active`      ¿hay terreno 3D en este campo? (se decide UNA vez al cargar, no cambia en caliente)
     - `heightAt(lon, lat)`  altura del suelo en metros de escena (m·exageración); 0 con terreno apagado.
                             Es lo que expone el host como ctx.heightAt: TODA altura Three pasa por acá.
     - `initTerrain(...)`    carga el DEM, decide la activación, agrega la fuente raster-dem + el hillshade
                             y, si corresponde, map.setTerrain(). Se llama desde app.js antes de armar las capas.

   Cómo se alinean Three y la malla de MapLibre (spike A6-1, handoffs/a6-spike.md):
     la Y de escena es la altura ABSOLUTA × exageración y host.sceneMatrix() resta map.transform.elevation en
     cada frame (el centro de la vista cambia de elevación). heightAt coincide con la malla a ±0,05 m con el
     mismo zoom de DEM (A6_TERRAIN.demZoom) y la convención de píxel "esquina" (heightfield.js).

   Fuente y licencia: ver config.js (A6_TERRAIN) y handoffs/a6-terreno.md. */
import { A1_CAMPOS, A1_SUN, A6_TERRAIN as C } from "../core/config.js?v=20261113";
import { pointInPolygon, ringBBox } from "../core/geo.js?v=20261113";
import { params, state } from "../core/state.js?v=20261113";
import { quality, terrainEnabled } from "../core/quality.js?v=20261113";
import { chainShader } from "../render/systems/chunks.js?v=20261113";
import { loadHeightfield } from "./heightfield.js?v=20261113";

const DBG = params.has("debug") || params.has("qa");

/* Estado público. `info` queda para el handoff/QA (window.__terrain con ?debug/?qa). */
export const terrain = {
  active: false,      // terreno 3D encendido (heightAt real, malla MapLibre, matriz corregida)
  exag: 1,            // exageración vigente
  hf: null,           // Heightfield (null si no se pudo cargar el DEM)
  hillshade: false,   // capa de sombreado de relieve agregada
  reason: "",         // por qué quedó así (auto / config del campo / URL)
  stats: null,        // reliefStats() del campo (filtradas)
  loadMs: 0           // ms de carga del DEM (red + decodificación)
};
if (DBG) window.__terrain = terrain;

/* Altura del suelo (m de escena) en lon/lat. Sin terreno: 0 (los campos llanos quedan idénticos). */
export function heightAt(lon, lat) {
  return terrain.active && terrain.hf ? terrain.hf.heightAt(lon, lat) * terrain.exag : 0;
}

/* Nombre de la propiedad de opacidad de las capas "ex-extrusión" (herb-ext, woody-base): con terreno activo son
   `fill` drapeados (T14), sin terreno siguen siendo fill-extrusion. Lo usan layers.js y ground.js. */
export const extOpacityProp = () => (terrain.active ? "fill-opacity" : "fill-extrusion-opacity");

/* A6 · Crecimiento de escenario con terreno. Sin terreno el host escala el grupo del escenario en Y
   (group.scale.y = t): equivale a escalar sobre el suelo porque el suelo está en y = 0. Con terreno el
   suelo de cada instancia está a su altura (y = g) y escalar el grupo hundiría los árboles en las lomas
   durante los 1800 ms. Solución: con terreno el grupo NO se escala y cada material de instancias escala la
   altura LOCAL de su geometría por `uA6Grow` (transformed.y *= t, antes de la matriz de instancia, que ya
   lleva y = g). Resultado: y_mundo = g + t·(altura local), o sea crecer APOYADO en el suelo de cada instancia
   (sin terreno g = 0 y es idéntico al scale.y de antes). Los sistemas con vértices en coordenadas de mundo
   (suelo y surcos de A4) no lo usan: manejan su propio crecimiento (revelado / lift) en ground.js.
   Aproximación conocida: el impostor lejano (copa de 32 tris, centrado en la copa) se achata alrededor de su
   centro en vez de su base: dura 1,8 s y a más de 480 m (sub-píxel), lo cual no se ve. */
export const growthU = { inicial: { value: 1 }, multi: { value: 1 } };
export function patchGrowth(mat, key) {
  chainShader(mat, "a6grow", sh => {
    sh.uniforms.uA6Grow = growthU[key];
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uA6Grow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y *= uA6Grow;");
  });
}


/* ---------- decisión de activación ---------- */
function decidir(stats) {
  const campo = state.campo || {};
  const url = params.get("terreno");
  if (url === "1" || url === "0") return { on: url === "1", why: "URL ?terreno=" + url };
  if (!C.enabled) return { on: false, why: "A6_TERRAIN.enabled = false" };
  if (typeof campo.terreno === "boolean") return { on: campo.terreno, why: "campo.terreno = " + campo.terreno };
  const cfg = C.campos[campo.id];
  if (cfg && typeof cfg.terreno === "boolean") return { on: cfg.terreno, why: "config del campo (A6_TERRAIN.campos)" };
  const a = C.auto;
  const on = stats.desvioResidual > a.desvioResidual || stats.pendienteP95 > a.pendienteP95;
  return { on, why: `auto: desvío residual ${stats.desvioResidual.toFixed(2)} m (umbral ${a.desvioResidual}), pendiente p95 ${stats.pendienteP95.toFixed(2)} % (umbral ${a.pendienteP95})` };
}

/* Máscara "adentro de algún polígono del campo" (como en la calibración del spike). */
function maskDe(fc) {
  const polys = [];
  for (const f of fc.features) for (const poly of f.geometry.coordinates) polys.push({ bb: ringBBox(poly[0]), poly });
  return (lon, lat) => {
    const pt = [lon, lat];
    for (const p of polys) {
      const b = p.bb;
      if (lon < b[0] || lat < b[1] || lon > b[2] || lat > b[3]) continue;
      if (pointInPolygon(pt, p.poly)) return true;
    }
    return false;
  };
}

/* ---------- MapLibre: fuente raster-dem, hillshade y malla ---------- */
function agregarFuenteYHillshade(map) {
  const fuente = (attribution, over = {}) => ({ type: "raster-dem", tiles: [C.demUrl], encoding: "terrarium", tileSize: 256, maxzoom: C.demZoom, ...(attribution ? { attribution } : {}), ...over });
  // G2: el hillshade usa una fuente propia más gruesa (menos teselas y menos píxeles a sombrear por frame que con z13)
  const hsz = DBG && params.get("hsz") ? parseInt(params.get("hsz"), 10) : C.hillshade.maxzoom;
  const hsTs = DBG && params.get("hsts") ? parseInt(params.get("hsts"), 10) : C.hillshade.tileSize;
  // MapLibre avisa (warning en consola) si el hillshade y el terreno comparten fuente: van dos fuentes con las mismas teselas
  // (el navegador las sirve de su caché HTTP; la de relieve lleva la atribución).
  if (!map.getSource("dem")) map.addSource("dem", fuente(C.attribution));
  const hs = DBG ? params.get("hillshade") : null;   // ?hillshade=0|1: solo ?qa/?debug
  if ((hs === "1" || (hs !== "0" && C.hillshade.enabled)) && !map.getLayer("hillshade")) {
    if (!map.getSource("dem-hs")) map.addSource("dem-hs", fuente(null, { maxzoom: hsz, tileSize: hsTs }));
    const campoCfg = A1_CAMPOS[(state.campo || {}).id] || {};
    const h = C.hillshade;
    // justo arriba del satélite y debajo de todo lo demás (las capas de escenario se agregan después)
    map.addLayer({
      id: "hillshade", type: "hillshade", source: "dem-hs",
      paint: {
        "hillshade-illumination-direction": campoCfg.sunAzimuth ?? A1_SUN.defaultAzimuth,   // = azimut HACIA el sol de A1
        "hillshade-illumination-anchor": "map",
        "hillshade-exaggeration": DBG && params.get("hse") ? parseFloat(params.get("hse")) : h.exaggeration,   // ?hse= solo ?debug/?qa (calibración)
        "hillshade-shadow-color": h.shadow, "hillshade-highlight-color": h.highlight, "hillshade-accent-color": h.accent
      }
    });
    terrain.hillshade = true;
  }
}

/* Ola 4 · 4.2: palancas de costo de la malla/RTT de MapLibre 4.7.1 (campos internos de map.terrain; si cambian, se ignoran sin romper). */
function ajustarCosto(map) {
  try {
    const P = { ...C.perf };
    if (DBG && params.get("rtt")) P.rttQuality = params.get("rtt") === "auto" ? "auto" : parseFloat(params.get("rtt"));
    // "auto": 1 textura-px por px de pantalla (pixelRatio del mapa entre 1 y 2); MapLibre usa siempre 2 (4× los píxeles en pantallas 1×)
    if (P.rttQuality === "auto") P.rttQuality = Math.min(2, Math.max(1, map.getPixelRatio ? map.getPixelRatio() : (window.devicePixelRatio || 1)));
    if (DBG && params.get("mesh")) P.meshSize = parseInt(params.get("mesh"), 10);
    if (DBG && params.get("pool")) P.rttPool = parseInt(params.get("pool"), 10);
    const t = map.terrain, rtt = map.painter && map.painter.renderToTexture;
    if (!t || !rtt || !rtt.pool) return;
    if (DBG && params.has("scale")) P.scaleThrottleMs = parseInt(params.get("scale"), 10);
    limitarEscala(map, P.scaleThrottleMs);
    if (P.meshSize && !t._mesh) t.meshSize = P.meshSize;                       // la malla se crea en el primer frame
    if (P.rttPool) rtt.pool._size = P.rttPool;                                  // texturas de RTT cacheadas (MapLibre: 30)
    if (P.rttQuality && rtt.pool._objects.length === 0) {                       // el pool crea sus texturas a demanda
      t.qualityFactor = P.rttQuality;
      rtt.pool._tileSize = Math.round(t.sourceCache.tileSize * P.rttQuality);
    }
  } catch (e) { console.warn("A6: no se pudo ajustar el costo del terreno:", e.message || e); }
}

/* Ola 4 · 4.2: la ScaleControl de MapLibre llama 2 veces a map.unproject en CADA 'move' y, con terreno, cada unproject hace un
   readPixels síncrono sobre el framebuffer de coordenadas del terreno: la CPU espera a la GPU 2 veces por frame y se pierde el
   solapamiento CPU/GPU (en la HD 520 son ~46 ms/frame en órbita, perfil CDP). Se limita a una actualización cada `ms` ms (con la
   última 300 ms después de quedar quieta). La barra de escala se ve igual, solo se refresca menos durante el movimiento. */
function limitarEscala(map, ms) {
  const ctl = (map._controls || []).find(c => c && c._onMove && c._container && c._container.classList.contains("maplibregl-ctrl-scale"));
  if (!ctl || ctl._a6Throttled || !(ms > 0)) return;
  const orig = ctl._onMove;
  let last = 0, timer = 0;
  /* jumpTo/setBearing (órbita, tour) disparan move Y moveend en cada llamada: no sirve moveend. Se usa "reposo de 300 ms": mientras
     haya movimiento continuo solo se refresca cada `ms`; 300 ms después del último 'move' se refresca con el valor exacto. */
  const lim = () => {
    clearTimeout(timer);
    if (performance.now() - last >= ms) { last = performance.now(); orig(); }
    timer = setTimeout(() => { timer = 0; last = performance.now(); orig(); }, 300);
  };
  map.off("move", orig);
  ctl._onMove = lim; ctl._a6Throttled = true;
  map.on("move", lim);
}

/* Enciende/apaga la malla de terreno de MapLibre (null apaga). La exageración queda en terrain.exag. */
export function setTerrain(map, on, exag = terrain.exag) {
  terrain.exag = exag;
  if (on) map.setTerrain({ source: "dem", exaggeration: exag });
  else if (map.getTerrain && map.getTerrain()) map.setTerrain(null);
  terrain.active = !!on && !!terrain.hf;
  if (on) ajustarCosto(map);
  // niebla de MapLibre sobre la malla (la capa atmo-fog de A1 se apaga con terreno: render/atmo.js)
  if (terrain.active && map.getSky) map.setSky({ ...map.getSky(), "fog-ground-blend": C.sky.fogGroundBlend, "horizon-fog-blend": C.sky.horizonFogBlend });
}

/* Carga el DEM del campo, decide y deja todo listo ANTES de armar las capas de escenario y el host.
   bbox = state.bbox ([[oeste,sur],[este,norte]]); data = FeatureCollection del escenario inicial (máscara de las
   estadísticas). Si el DEM no carga (sin red, bloqueo), el campo sigue como siempre (terreno y hillshade apagados). */
export async function initTerrain(map, bbox, data) {
  const t0 = performance.now();
  /* ?terreno=0 apaga TODO lo de A6 (terreno, hillshade y hasta la descarga del DEM): el visor queda idéntico al de antes
     del terreno (sirve de interruptor de comparación). ?hillshade=0|1 fuerza solo el sombreado de relieve. */
  if (params.get("terreno") === "0") { terrain.reason = "URL ?terreno=0 (todo apagado)"; return terrain; }
  /* G2: según calidad (quality.terrain): en integradas y en Media/Baja NO se descarga el DEM ni hay hillshade ni terreno
     (visor idéntico al de antes de A6, heightAt = 0). ?terreno=1 en la URL lo fuerza igual. */
  if (params.get("terreno") !== "1" && !terrainEnabled(quality)) {
    terrain.reason = `calidad ${quality.name}: terreno apagado (GPU integrada o nivel bajo; ?terreno=1 lo fuerza)`; return terrain;
  }
  if (!C.enabled && !C.hillshade.enabled) return terrain;
  if (DBG && params.get("demz")) C.demZoom = parseInt(params.get("demz"), 10) || C.demZoom;   // ?demz=: zoom del DEM (fuente + heightAt), solo ?debug/?qa
  try {
    const m = 0.01;   // margen (°) para que el borde del campo no quede pegado al límite de la grilla
    terrain.hf = await loadHeightfield([bbox[0][0] - m, bbox[0][1] - m, bbox[1][0] + m, bbox[1][1] + m], { z: C.demZoom, url: C.demUrl });
    terrain.hf.bbox = [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]];
    terrain.stats = terrain.hf.reliefStats({ mask: maskDe(data), baselineM: C.auto.baselineM });
    const d = decidir(terrain.stats);
    terrain.reason = d.why;
    const campoCfg = C.campos[(state.campo || {}).id] || {};
    let exag = campoCfg.exag ?? C.exaggeration;
    if (DBG && params.get("exag")) exag = parseFloat(params.get("exag")) || exag;
    terrain.exag = exag;
    agregarFuenteYHillshade(map);
    setTerrain(map, d.on, exag);
  } catch (e) {
    console.warn("A6: no se pudo cargar el relieve (DEM); el campo queda sin terreno:", e.message || e);
    terrain.hf = null; terrain.active = false; terrain.reason = "error DEM: " + (e.message || e);
    if (map.getLayer("hillshade")) map.removeLayer("hillshade");
    if (map.getSource("dem")) map.removeSource("dem");
    if (map.getSource("dem-hs")) map.removeSource("dem-hs");
  }
  terrain.loadMs = Math.round(performance.now() - t0);
  return terrain;
}
