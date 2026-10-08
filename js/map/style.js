import { HOME_VIEW } from "../core/state.js";
import { resolveQuality } from "../core/quality.js";
import { A1_RASTER, A1_SKY } from "../core/config.js";   // A1: colores del cielo (también los usa la niebla)

/* A1 (1.3, D): ajuste de color del satélite (raster-*) para que ráster y 3D parezcan la misma foto.
   Valores base en config.js A1_RASTER (los presets de hora los interpolan en la Ola 3). */
export function rasterPaint(r = A1_RASTER) {
  return {
    "raster-saturation": r.saturation, "raster-contrast": r.contrast,
    "raster-brightness-min": r.brightnessMin, "raster-brightness-max": r.brightnessMax,
    "raster-hue-rotate": r.hueRotate
  };
}
/* map/data.js reconstruye la capa "satellite" (sin paint) cuando cambia el maxzoom del campo:
   se re-aplica el ajuste después (app.js lo llama tras loadCampos). */
export function applyRasterGrade(m, r = A1_RASTER) {
  if (!m.getLayer("satellite")) return;
  for (const [k, v] of Object.entries(rasterPaint(r))) m.setPaintProperty("satellite", k, v);
}

/* ---------- Estilo base del mapa (sin terreno: llanura, evita
   artefactos de extrusiones cortadas en pendientes) ---------- */
export const mapStyle = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      // maxzoom por defecto; se ajusta por campo en loadCampos() según hasta
      // qué nivel Esri tiene imagen nativa (z18 en Monte Hermoso, z17 en
      // Silesia/El Carmen). Más allá, Esri devuelve "Map data not yet available",
      // así que reescalamos el último tile real en vez de pedir los inexistentes.
      maxzoom: 17,
      attribution: "Imagen satelital © Esri, Maxar, Earthstar Geographics | AgroDesign"
    }
  },
  layers: [{ id: "satellite", type: "raster", source: "esri", paint: rasterPaint() }],
  sky: {
    "sky-color": A1_SKY.skyColor,
    "horizon-color": A1_SKY.horizonColor,   // = color de la niebla (config.js A1_FOG)
    "fog-color": "#e6ecdc",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.65,
    "fog-ground-blend": 0.85
  }
};

/* T3: el nivel de calidad se resuelve ANTES de crear el Map (antialias y pixelRatio se
   fijan al crear el contexto WebGL). Hoy no se consume ningún parámetro (sin cambios
   visibles); A1 conectará antialias/pixelRatio acá. */
export const QUALITY = resolveQuality();

export const map = new maplibregl.Map({
  container: "map",
  style: mapStyle,
  preserveDrawingBuffer: true,  // permite exportar la vista a PNG (botón capturar)
  center: HOME_VIEW.center,
  zoom: 11.4,
  pitch: 0,
  bearing: 0,
  maxPitch: 80,
  minZoom: 9.5,
  maxZoom: 17.8,
  attributionControl: { compact: true },
  /* A1 (1.3, A): antialias y pixelRatio según el nivel de calidad. Se fijan al crear el contexto
     (T3): cambiar de nivel recarga la página (quality.js CONTEXT_PARAMS_ACTIVE). msaa "gpu" (Media):
     sí, salvo que la GPU sea de gama baja, y esa ya resuelve el nivel Baja en detectLevel(). */
  antialias: !!QUALITY.msaa && new URLSearchParams(location.search).get("aa") !== "0",   // ?aa=0: solo para comparar capturas
  pixelRatio: Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatioCap)
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
map.touchZoomRotate.enableRotation();
