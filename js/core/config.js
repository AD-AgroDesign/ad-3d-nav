/* ---------- Configuración de clases de paisaje ---------- */
export const CLASS_META = {
  "agri":          { label: "Agrícola Secano",            legend: "#d9c98a" },
  // Macroambientes del diseño (antes "Agrícola Secano · Zona 1/2/3"): label y
  // rampa cromática según los .qml del equipo GIS. Las claves zona1/2/3 quedan
  // como identificador interno para no romper datos ni filtros existentes.
  "zona1":         { label: "Macroamb. mayor PP",         legend: "#1a9641" },
  "zona2":         { label: "Macroamb. PP intermedio",    legend: "#60b856" },
  "zona3":         { label: "Macroamb. menor PP",         legend: "#a6d96a" },
  "parche-le":     { label: "Parche Leñoso",              legend: "#1b4020" },
  "corr-le":       { label: "Corredor Leñoso",            legend: "#2f5d33" },
  "parche-herb":   { label: "Parche Herbáceo",            legend: "#6a7c48" },
  "corr-herb":     { label: "Corredor Herbáceo",          legend: "#947c4a" },
  "bajo":          { label: "Bajo en Recuperación",       legend: "#7c9a80" },
  "ganaderia":     { label: "Ganadería",                  legend: "#a8bd72" },
  "agua":          { label: "Curso de Agua",              legend: "#5b8fb9" },
  "suelo-desnudo": { label: "Suelo Desnudo",              legend: "#c3ab86" },
  "instalaciones": { label: "Instalaciones",              legend: "#b8b3a4" },
  "camino":        { label: "Caminos",                    legend: "#c9bd9e" },
  "otros":         { label: "Otros",                      legend: "#9e9e9e" }
};
/* Orden canónico para leyendas (se muestran solo las clases presentes) */
export const CLASS_ORDER = ["agri", "zona1", "zona2", "zona3", "parche-le", "parche-herb",
  "corr-le", "corr-herb", "bajo", "ganaderia", "agua", "suelo-desnudo",
  "instalaciones", "camino", "otros"];
export const NATURE_CLASSES = ["parche-le", "corr-le", "parche-herb", "corr-herb"];
export const WOODY_CLASSES = ["parche-le", "corr-le"];
export const HERB_LIKE_CLASSES = ["parche-herb", "corr-herb", "bajo"];
export const MISC_CLASSES = ["otros", "instalaciones", "camino", "ganaderia", "suelo-desnudo"];

/* Paleta de copas de monte de espinal */
export const CROWN_PALETTE = [0x2a4f22, 0x33602a, 0x3e6d2f, 0x4a7434, 0x567c38, 0x6a7f3e];
export const TRUNK_COLOR = 0x5b4632;
export const WOODY_BASE = { color: "#2e5026", height: 1.2, opacity: 0.45 };
export const HERB_HEIGHT = 0.6;

/* Matas de pasto: corredores herbáceos (pardo) y parches herbáceos
   (verde; el gradiente de vértices les da las puntas doradas).
   Presupuesto por clase: los corredores son los protagonistas y mantienen
   densidad plena; los parches, mucho más extensos, van con tope menor
   (midió 20 fps en el peor caso con tope pleno en ambos). */
export const IS_MOBILE = window.matchMedia("(max-width: 760px)").matches;
export const GRASS_CLASSES = {
  "corr-herb": {
    // verdes grisáceos con flores lila SOLO en la puntita (ref
    // img/Vista_sobre_corredor.jpg): fila intermedia de vértices a 2/3 de
    // altura, verde hasta ahí y de ahí al lila (hoja de 4 triángulos)
    palette: [0x5a6d48, 0x647952, 0x536a42, 0x6d7f57, 0x4c6240, 0x71835a],
    tip: [2.05, 1.4, 3.1],
    base: [0.62, 0.72, 0.5],
    mid: 0.66,
    midCol: [0.72, 0.82, 0.58],
    // ~la mitad de las matas sin flor: hoja verde de gradiente simple
    // (sin fila intermedia: 8 tris en vez de 16)
    alt: { share: 0.5, tip: [0.9, 1.05, 0.65], base: [0.62, 0.72, 0.5] },
    density: IS_MOBILE ? 1000 : 1500,
    max: IS_MOBILE ? 100000 : 180000
  },
  "parche-herb": {
    palette: [0x5f7a3a, 0x6b8a41, 0x548034, 0x71904a, 0x497029, 0x8a9448],
    tip: [1.25, 1.15, 0.8],   // puntas doradas
    density: IS_MOBILE ? 500 : 800,
    max: IS_MOBILE ? 60000 : 120000
  }
};
/* Escala estilizada: a altura de dron una mata real de 1 m no se lee;
   se exagera igual que el resto de la estética low-poly */
export const GRASS_SCALE = 3.6;

/* === A2: inicio === */
/* Chunking / LOD de vegetación (render/systems/chunks.js). Diales: ver handoffs/a2-chunks.md */
export const CHUNK_CELL_GRASS = 400;       // m, lado de la celda del pasto (una InstancedMesh por celda y clase)
export const CHUNK_CELL_TREES = 500;       // m, lado de la celda de árboles (pocas instancias: celda más gruesa = menos draws)
export const GRASS_LOD_NEAR_MULT = 0.6;    // LOD_NEAR = mult × quality.grassLodDist: hasta ahí, densidad completa
export const GRASS_LOD_FAR_MULT = 3.0;     // LOD_FAR = mult × quality.grassLodDist: desde ahí la celda se omite
export const GRASS_LOD_COMP_MAX = 2.2;     // tope del agrandado que compensa el raleo (conserva la masa de color a lo lejos)
export const GRASS_LOD_BAND = 0.15;        // franja de encogimiento progresivo por instancia (fracción del orden aleatorio)
/* E-AO: oclusión falsa por vértice (amount = oscurecimiento máx. en la base, 0..1; top = y local donde termina) */
export const GRASS_AO = { amount: 0.28, top: 0.4 };   // matas: solo el tramo bajo; puntas y flores (y>0.4) intactas
export const TREE_AO = { trunk: 0.35, crown: 0.28 };  // troncos: 30 % inferior; copas: mitad inferior
/* === A2: fin === */

/* === A1: inicio === */
/* Niebla / perspectiva atmosférica unificada (suelo MapLibre vía capa atmo-fog + objetos Three).
   El color es el horizon-color del `sky` de map/style.js: la niebla "entra" en el degradado
   del cielo sin costura. Si un preset de hora cambia uno, cambia los dos a la vez. */
export const A1_SKY = {
  skyColor: "#87b9e0",
  horizonColor: "#dfe9d8"
};
export const A1_FOG = {
  color: A1_SKY.horizonColor,
  near: 1200,       // m · inicio mínimo de la niebla
  nearK: 1.6,       // near >= nearK · (distancia cámara-centro): el entorno de la cámara queda nítido
  farFrac: 0.98,    // far = farFrac · distancia al suelo en la línea del sky (llega a 1 en el horizonte)
  nearMaxFrac: 0.6, // tope de near como fracción de far (garantiza rampa visible)
  max: 1.0,         // opacidad máxima de la niebla
  skyOverlapPx: 3   // la capa atmo se solapa ~3 px con la línea del sky (evita rendija oscura)
};
/* ---- 1.3: color, luz, sol, ráster (A1) ---- */
/* Render: tone mapping y exposición. Se elige con capturas (handoffs/a1-color.md).
   toneMapping: "none" | "aces" | "agx" | "neutral". */
export const A1_RENDER = { toneMapping: "agx", exposure: 1.75 };
/* Luz: hemisférica (cielo cálido / suelo = color medio del satélite del campo) + sol.
   Las intensidades están en unidades de r170 (Lambert/π ya compensado: ~1 = albedo pleno). */
export const A1_LIGHT = {
  hemiSky: "#cddbec", hemiSkyInt: 0.55,
  hemiGround: "#6d6a4c",       // default regional si el campo no tiene groundColor medido
  hemiGroundInt: 0.45,
  sunColor: "#fff1d6", sunInt: 2.2
};
/* Sol: elevación 50–55° por defecto; el azimut sale de las sombras horneadas del satélite
   (T13, método y valores en handoffs/a1-color.md). Brújula: 0 = N, 90 = E; es el azimut HACIA el sol. */
export const A1_SUN = { elevation: 52, defaultAzimuth: 40 };
/* Por campo: sunAzimuth (medido) y groundColor (color medio del satélite). */
export const A1_CAMPOS = {
  // sunAzimuth solo donde las sombras de las arboledas se midieron con confianza (a1_sun.mjs, ver handoff);
  // el resto usa A1_SUN.defaultAzimuth. groundColor = color medio del satélite crudo del campo (cenital del home).
  el_carmen: { sunAzimuth: 43, groundColor: "#6a5f45" },
  monte_hermoso: { groundColor: "#6b6247" },
  nikunihue: { groundColor: "#69604a" },
  chapa_i_iii_iv: { sunAzimuth: 19, groundColor: "#5d553e" },
  chapa_ii_v: { groundColor: "#5e5b41" },
  frente_planta_quinta_lima: { groundColor: "#55533a" },
  la_haydee: { sunAzimuth: 41, groundColor: "#5e5a3f" },
  silesia: { groundColor: "#635e42" },
};
/* Follaje: wrap lighting (cuánto "dobla" la luz del sol alrededor del volumen) y translucidez
   barata (luz que atraviesa el follaje desde atrás). 0 = Lambert puro. */
export const A1_FOLIAGE = { wrap: 0.35, trans: 0.25, floor: 0.25 };   // floor: levantado de sombras de copas (suma albedo·floor en la cara sin sol; 0 = nada)
/* Satélite (raster-*): lo lleva a la misma "foto" que el 3D. */
export const A1_RASTER = { saturation: 0.12, contrast: 0.06, brightnessMin: 0, brightnessMax: 1, hueRotate: 3 };
/* Ajuste fino en caliente (solo ?debug/?qa): ?a1={"A1_RENDER":{"exposure":1.2}} mezcla sobre los diales. */
{
  const q = new URLSearchParams(location.search);
  if ((q.has("debug") || q.has("qa")) && q.get("a1")) {
    try {
      const o = JSON.parse(q.get("a1"));
      const T = { A1_RENDER, A1_LIGHT, A1_SUN, A1_FOLIAGE, A1_RASTER, A1_FOG, A1_SKY, A1_CAMPOS };
      for (const k in o) if (T[k]) Object.assign(T[k], o[k]);
    } catch (e) { console.warn("a1: JSON inválido en ?a1"); }
  }
}
/* === A1: fin === */
