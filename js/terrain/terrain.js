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
import { A1_CAMPOS, A1_SUN, A6_TERRAIN as C } from "../core/config.js";
import { pointInPolygon, ringBBox } from "../core/geo.js";
import { params, state } from "../core/state.js";
import { loadHeightfield } from "./heightfield.js";

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
  const fuente = attribution => ({ type: "raster-dem", tiles: [C.demUrl], encoding: "terrarium", tileSize: 256, maxzoom: C.demZoom, ...(attribution ? { attribution } : {}) });
  // MapLibre avisa (warning en consola) si el hillshade y el terreno comparten fuente: van dos fuentes con las mismas teselas
  // (el navegador las sirve de su caché HTTP; la de relieve lleva la atribución).
  if (!map.getSource("dem")) map.addSource("dem", fuente(C.attribution));
  const hs = params.get("hillshade");
  if ((hs === "1" || (hs !== "0" && C.hillshade.enabled)) && !map.getLayer("hillshade")) {
    if (!map.getSource("dem-hs")) map.addSource("dem-hs", fuente());
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

/* Enciende/apaga la malla de terreno de MapLibre (null apaga). La exageración queda en terrain.exag. */
export function setTerrain(map, on, exag = terrain.exag) {
  terrain.exag = exag;
  if (on) map.setTerrain({ source: "dem", exaggeration: exag });
  else if (map.getTerrain && map.getTerrain()) map.setTerrain(null);
  terrain.active = !!on && !!terrain.hf;
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
  if (!C.enabled && !C.hillshade.enabled) return terrain;
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
