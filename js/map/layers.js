import { CLASS_META, HERB_HEIGHT, HERB_LIKE_CLASSES, MISC_CLASSES, WOODY_BASE } from "../core/config.js";
import { state } from "../core/state.js";
import { setupInteractivity } from "./interact.js";
import { map } from "./style.js";
import { vegLayer } from "../render/host.js";

export const clsFilter = (...classes) => ["in", ["get", "_cls"], ["literal", classes]];

export function addScenarioLayers() {
  map.addSource("ini", { type: "geojson", data: state.data.inicial });
  map.addSource("multi", { type: "geojson", data: state.data.multi });
  map.addSource("ini-shadows", { type: "geojson", data: state.veg.inicial.shadows });
  map.addSource("multi-shadows", { type: "geojson", data: state.veg.multi.shadows });

  for (const p of ["ini", "multi"]) {
    const isMulti = p === "multi";
    const src = p;

    if (isMulti) {
      map.addLayer({
        id: "multi-zona-fill", type: "fill", source: src,
        filter: clsFilter("zona1", "zona2", "zona3"),
        paint: {
          "fill-color": ["match", ["get", "_cls"],
            "zona1", CLASS_META.zona1.legend,
            "zona2", CLASS_META.zona2.legend,
            CLASS_META.zona3.legend],
          "fill-opacity": 0
        }
      });
      map.addLayer({
        id: "multi-zona-line", type: "line", source: src,
        filter: clsFilter("zona1", "zona2", "zona3"),
        paint: {
          // contorno: tinte claro de la misma rampa de los macroambientes
          "line-color": ["match", ["get", "_cls"], "zona1", "#5cc97f", "zona2", "#93dd8b", "#c9ec9d"],
          "line-width": 1.6, "line-opacity": 0
        }
      });
    } else {
      map.addLayer({
        id: "ini-agri-line", type: "line", source: src,
        filter: clsFilter("agri"),
        paint: { "line-color": "#f3eecb", "line-width": 1.4, "line-opacity": 0 }
      });
    }

    map.addLayer({
      id: `${p}-otros-fill`, type: "fill", source: src,
      filter: clsFilter(...MISC_CLASSES),
      paint: {
        "fill-color": ["match", ["get", "_cls"],
          "ganaderia", CLASS_META.ganaderia.legend,
          "suelo-desnudo", CLASS_META["suelo-desnudo"].legend,
          "#c9c9b8"],
        "fill-opacity": 0
      }
    });
    map.addLayer({
      id: `${p}-otros-line`, type: "line", source: src,
      filter: clsFilter(...MISC_CLASSES),
      paint: { "line-color": "#e8e6d5", "line-width": 1.2, "line-opacity": 0, "line-dasharray": [2.5, 2] }
    });

    // Cursos de agua: fill drapeado (no extruido) con más presencia que el
    // resto de las clases de contexto — se leen como agua sobre el satélite
    map.addLayer({
      id: `${p}-agua-fill`, type: "fill", source: src,
      filter: clsFilter("agua"),
      paint: { "fill-color": "#3f7fb5", "fill-opacity": 0 }
    });
    map.addLayer({
      id: `${p}-agua-line`, type: "line", source: src,
      filter: clsFilter("agua"),
      paint: { "line-color": "#9ecbe8", "line-width": 1.3, "line-opacity": 0 }
    });

    // Pastizal: color base + textura uniforme de grano fino
    map.addLayer({
      id: `${p}-herb-ext`, type: "fill-extrusion", source: src,
      filter: clsFilter(...HERB_LIKE_CLASSES),
      paint: {
        "fill-extrusion-color": ["match", ["get", "_cls"], "corr-herb", "#6b5d38", "bajo", "#6f8a72", "parche-herb", "#4d5c33", "#6d8050"],
        "fill-extrusion-height": 0,
        "fill-extrusion-opacity": 0
      }
    });
    map.addLayer({
      id: `${p}-herb-pattern`, type: "fill-extrusion", source: src,
      filter: clsFilter(...HERB_LIKE_CLASSES),
      paint: {
        // corredores herbáceos en pardo (pasto seco) y parches herbáceos
        // en verde oscuro; el resto con el pastizal estándar
        "fill-extrusion-pattern": ["match", ["get", "_cls"],
          "corr-herb", "pastizal-pardo",
          "parche-herb", "pastizal-verde",
          "pastizal"],
        "fill-extrusion-height": 0,
        "fill-extrusion-opacity": 0
      }
    });

    map.addLayer({
      id: `${p}-woody-base`, type: "fill-extrusion", source: src,
      filter: clsFilter("parche-le", "corr-le"),
      paint: { "fill-extrusion-color": WOODY_BASE.color, "fill-extrusion-height": 0, "fill-extrusion-opacity": 0 }
    });
    map.addLayer({
      id: `${p}-tree-shadows`, type: "fill", source: `${p}-shadows`,
      paint: { "fill-color": "#0c1c08", "fill-opacity": 0 }
    });
  }

  map.addLayer(vegLayer);
  setupInteractivity();
}

export const SCENARIO_LAYERS = {
  inicial: [
    { id: "ini-agri-line", prop: "line-opacity", on: 0.55 },
    { id: "ini-otros-fill", prop: "fill-opacity", on: 0.06 },
    { id: "ini-otros-line", prop: "line-opacity", on: 0.5 },
    { id: "ini-agua-fill", prop: "fill-opacity", on: 0.38 },
    { id: "ini-agua-line", prop: "line-opacity", on: 0.7 },
    { id: "ini-herb-ext", prop: "fill-extrusion-opacity", on: 0.9 },
    { id: "ini-herb-pattern", prop: "fill-extrusion-opacity", on: 0.75 },
    { id: "ini-woody-base", prop: "fill-extrusion-opacity", on: WOODY_BASE.opacity },
    { id: "ini-tree-shadows", prop: "fill-opacity", on: 0.28 }
  ],
  multi: [
    { id: "multi-zona-fill", prop: "fill-opacity", on: 0.18 },
    { id: "multi-zona-line", prop: "line-opacity", on: 0.85 },
    { id: "multi-otros-fill", prop: "fill-opacity", on: 0.06 },
    { id: "multi-otros-line", prop: "line-opacity", on: 0.5 },
    { id: "multi-agua-fill", prop: "fill-opacity", on: 0.38 },
    { id: "multi-agua-line", prop: "line-opacity", on: 0.7 },
    { id: "multi-herb-ext", prop: "fill-extrusion-opacity", on: 0.9 },
    { id: "multi-herb-pattern", prop: "fill-extrusion-opacity", on: 0.75 },
    { id: "multi-woody-base", prop: "fill-extrusion-opacity", on: WOODY_BASE.opacity },
    { id: "multi-tree-shadows", prop: "fill-opacity", on: 0.28 }
  ]
};

export function applyGrowth(key, t) {
  state.growth[key] = t;
  const p = key === "inicial" ? "ini" : "multi";
  map.setPaintProperty(`${p}-woody-base`, "fill-extrusion-height", WOODY_BASE.height * t);
  map.setPaintProperty(`${p}-herb-ext`, "fill-extrusion-height", HERB_HEIGHT * t);
  map.setPaintProperty(`${p}-herb-pattern`, "fill-extrusion-height", (HERB_HEIGHT + 0.05) * t);
  vegLayer.setGrowth(key, t);
}

export function applyOpacity(key, t) {
  const f = t * state.designOpacity;
  for (const l of SCENARIO_LAYERS[key]) map.setPaintProperty(l.id, l.prop, l.on * f);
  vegLayer.setOpacity(key, f);
}
