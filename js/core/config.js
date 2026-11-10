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
/* G · Árboles nuevos (render/systems/trees.js + treegen.js). Decisión del dueño en G1 (2026-11-10):
   nativas del espinal (tala, algarrobo, chañar), sin eucalipto. La clase (parche-le / corr-le) no
   cambia la mezcla: el dato de árbol no la guarda y la ficha da la misma mezcla para las dos.
     mix        proporción (suma 1); la especie de cada árbol sale de un hash determinista de su dato
     h          rango de altura (m) al que se mapea la altura original (5-14 m) de cada árbol
     crownK     radio de copa / altura, según el radio original del árbol
     leaf/bark  colores en sRGB (como el resto de las paletas; el pipeline los pasa a lineal)
     cards      tarjetas de follaje por árbol (2 tris c/u); proxyK = tamaño del impostor (fracción
                del elipsoide de la copa); proxyFlat = factor de grosor vertical del impostor; proxyShade = oscurecimiento del impostor para empalmar con el follaje */
export const TREE_SPECIES = {
  tala:      { label: "Tala",      mix: 0.45, h: [5, 9],  crownK: [0.42, 0.60], leaf: 0x436f31, bark: 0x6a5a48, cards: 44, proxyK: 0.95, proxyFlat: 1, proxyShade: 0.80 },
  algarrobo: { label: "Algarrobo", mix: 0.35, h: [6, 12], crownK: [0.50, 0.75], leaf: 0x6a8556, bark: 0x4a392b, cards: 60, proxyK: 0.92, proxyFlat: 1.7, proxyShade: 0.66 },
  chanar:    { label: "Chañar",    mix: 0.20, h: [3, 7],  crownK: [0.42, 0.60], leaf: 0x9fac48, bark: 0x7a7552, cards: 34, proxyK: 0.85, proxyFlat: 1, proxyShade: 0.74 }
};
export const TREE_ALPHA_TEST = 0.4;        // corte del alfa de las tarjetas (con MSAA se suaviza con alphaToCoverage)
export const TREE_LOD_BAND = 0.2;          // franja (fracción de treeCardDist) donde tarjetas e impostor se funden por dither
export const TREE_IMPOSTOR_CULL = false;   // true = respeta quality.treeImpostorDist finito (Media 1500 m): en cenital/home desaparecen todos los árboles; el impostor cuesta ~32 tris, por eso por defecto nunca se omite
export const TREE_SWAY = 0.035;            // vaivén de la copa (fracción de la altura en la punta); ≤ 1/3 del pasto
export const TREE_BAKE = { interior: 0.18, bottom: 0.14, trunk: 0.22 };   // oclusión horneada en el color de vértice (valores sRGB)
/* Ajuste en caliente de las especies (solo ?debug/?qa; para bocetos y pruebas):
   ?a2={"TREE_SPECIES":{"tala":{"cards":54,"leaf":4223793}}} se mezcla sobre TREE_SPECIES antes de construir. */
{
  const q = new URLSearchParams(location.search);
  if ((q.has("debug") || q.has("qa")) && q.get("a2")) {
    try {
      const o = JSON.parse(q.get("a2"));
      for (const k in (o.TREE_SPECIES || {})) if (TREE_SPECIES[k]) Object.assign(TREE_SPECIES[k], o.TREE_SPECIES[k]);
    } catch (e) { console.warn("a2: JSON inválido en ?a2"); }
  }
}
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
export const A1_FOLIAGE = { wrap: 0.35, trans: 0.25, lumMin: 0.09, shadow: 0 };   // copas oscuras (G1): lumMin = piso de luminancia del albedo (lineal), shadow = levantado de la cara sin sol; 0 = nada
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

/* === A4: inicio === */
/* Suelo por shader (I) y surcos de cultivo (J): render/systems/ground.js. Diales: handoffs/a4-suelo.md.
   Colores base = §4 (pardo del corredor herbáceo, verde de los parches): NO se cambian. `dry`/`green` son
   variantes de pasto seco/verde de la MISMA tonalidad (±6° de matiz) que se mezclan con ruido fbm. */
export const A4_GROUND = {
  enabled: true,
  /* Crecimiento al cambiar de escenario (se elige en G2, D-3). También con ?crecimiento=extrusion|revelado.
       "revelado":  el suelo aparece desde el eje del polígono hacia los bordes (máscara por distancia al borde + tiempo)
       "extrusion": el suelo sube como antes (losa con paredes de `lift` metros, escalada por el host con scale.y) */
  growth: "revelado",
  yOff: 0.04,          // m sobre la altura del suelo (heightAt)
  maxEdge: 40,         // m · arista máxima de la malla (grilla donde se interpola la distancia al borde; 14 m = ~1M tris en El Carmen multi)
  gain: 1.0,           // multiplicador de albedo (calibrado contra el suelo MapLibre anterior)
  noise: { fine: 0.10, mid: 0.13, coarse: 0.16 },   // amplitud de luminancia por escala (≈0,7 m / 4 m / 25 m)
  edgeAO: { width: 1.8, strength: 0.38 },           // m de la franja oscura hacia adentro y oscurecimiento máximo
  reveal: { soft: 0.10, jitter: 0.10 },             // suavidad del frente de revelado y ruido del frente
  classes: {
    "corr-herb":   { color: "#6b5d38", dry: "#75653a", green: "#655d38", alpha: 1.0,  lift: 0.6, tune: [0.54, 0.62, 1.02] },
    "parche-herb": { color: "#4d5c33", dry: "#565e34", green: "#485c34", alpha: 1.0,  lift: 0.6, tune: [0.61, 0.75, 1.06] },
    "bajo":        { color: "#6f8a72", dry: "#788a70", green: "#6b8a76", alpha: 1.0,  lift: 0.6, tune: [0.62, 0.75, 0.52] },
    "parche-le":   { color: "#2e5026", dry: "#34502a", green: "#2b5028", alpha: 0.45, lift: 1.2, tune: [1.0, 1.08, 1.28] },
    "corr-le":     { color: "#2e5026", dry: "#34502a", green: "#2b5028", alpha: 0.45, lift: 1.2, tune: [1.04, 1.10, 1.26] }
  }
};
export const A4_FURROWS = {
  enabled: true,                 // interruptor general (?surcos=0|1). Detalle inventado, no dato: decisión del dueño (D-3)
  spacing: 0.52,                 // m entre surcos (soja/maíz)
  rowAmp: 0.10,                  // modulación de luminancia (±) de los surcos
  tramPeriod: 28, tramGauge: 2.8, tramWidth: 0.5, tramAmp: 0.16,   // huellas de pulverizadora
  rowFade: [350, 900],           // m · surcos: intensidad completa hasta [0], nula desde [1]
  tramFade: [700, 1500],         // m · huellas
  classes: ["agri", "zona1", "zona2", "zona3"]
};
/* === A4: fin === */

/* === A6: inicio === */
/* Terreno 3D real y sombreado de relieve: terrain/terrain.js + terrain/heightfield.js (A6-2).
   Diales y calibración: handoffs/a6-terreno.md. Fuente DEM: tiles "terrarium" de AWS (Mapzen/Tilezen
   Terrain Tiles, dataset abierto; en la zona sale de SRTM de 30 m). Autorizada por el dueño 2026-11-10. */
export const A6_TERRAIN = {
  enabled: true,            // interruptor general del terreno 3D (el hillshade tiene el suyo, abajo)
  demUrl: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  demZoom: 13,              // z13: ~0,5 MB por campo, error de malla ±0,05 m a zoom ≥ 15,6 (spike A6-1). Mismo valor en la fuente raster-dem y en heightAt
  exaggeration: 1.0,        // factor vertical del relieve (heightAt devuelve m·exag). 1 = fiel; también por campo (abajo) y con ?exag= (solo ?debug/?qa)
  /* Activación automática (calibrada con los 8 campos, spike A6-1): sobre una grilla de 30 m del DEM, con
     mediana 3×3 y pendiente con línea de base de `baselineM`, dentro de los polígonos del campo.
     Terreno ON si desvioResidual > X m (desvío tras restar el plano de mejor ajuste) o pendienteP95 > Y %. */
  auto: { desvioResidual: 2.7, pendienteP95: 2.5, baselineM: 240 },
  /* Override por campo (id de campo): { terreno: true|false, exag: n }. Tiene menos prioridad que el campo
     `terreno` de campos.local.json / la tabla `campos`, y que ?terreno=0|1 en la URL (la más fuerte). */
  campos: {
    // nikunihue: { terreno: true },   // ver pregunta 2 del handoff: la regla automática lo deja llano
  },
  /* Sombreado de relieve (hillshade MapLibre), sutil y en TODOS los campos. La luz sale del azimut del sol de
     A1 (A1_CAMPOS[campo].sunAzimuth, o A1_SUN.defaultAzimuth). */
  hillshade: {
    enabled: true,
    exaggeration: 0.4,      // 0..1: intensidad (0,5 es el default de MapLibre; 0,28 era imperceptible, dE<0,7; 0,6 ya moteaba el llano con el ruido del SRTM)
    shadow: "#26301a", highlight: "#fff6e0", accent: "#26301a"
  },
  /* Con terreno MapLibre aplica su PROPIA niebla sobre la malla (por profundidad real), así que la capa atmo-fog de A1
     (que supone suelo plano) se apaga en los campos con terreno y se ajusta la niebla de MapLibre para que se parezca
     (fog-ground-blend: 0 = la niebla arranca en el centro de la vista, 1 = recién en el horizonte). */
  sky: { fogGroundBlend: 0.3, horizonFogBlend: 0.5 },
  attribution: "Relieve: Terrain Tiles Mapzen/Tilezen en AWS (SRTM NASA/USGS, GMTED USGS)"
};
/* === A6: fin === */
