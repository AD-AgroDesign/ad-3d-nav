import { HOME_VIEW } from "../core/state.js";

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
  layers: [{ id: "satellite", type: "raster", source: "esri" }],
  sky: {
    "sky-color": "#87b9e0",
    "horizon-color": "#dfe9d8",
    "fog-color": "#e6ecdc",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.65,
    "fog-ground-blend": 0.85
  }
};

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
  attributionControl: { compact: true }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
map.touchZoomRotate.enableRotation();
