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
  tala:      { label: "Tala",      mix: 0.45, h: [6.25, 11.25], crownK: [0.42, 0.60], leaf: 0x436f31, bark: 0x6a5a48, cards: 44, proxyK: 0.95, proxyFlat: 1, proxyShade: 0.85 },
  algarrobo: { label: "Algarrobo", mix: 0.35, h: [7.5, 15], crownK: [0.50, 0.75], leaf: 0x6a8556, bark: 0x4a392b, cards: 60, proxyK: 0.92, proxyFlat: 1.7, proxyShade: 0.80 },
  chanar:    { label: "Chañar",    mix: 0.20, h: [3.75, 8.75], crownK: [0.42, 0.60], leaf: 0x9fac48, bark: 0x7a7552, cards: 34, proxyK: 0.85, proxyFlat: 1, proxyShade: 0.68 }
};
/* G2 (2026-11-11, decisión del dueño): alturas de las nativas ×1,25 (promedio ~7,2 → ~9,1 m; los árboles anteriores eran ~9,5 m),
   mismas proporciones (crownK) y misma variación por individuo (el rango se mapea desde la altura original 5-14 m).
   Boceto A de las tres especies (B y C descartados: eran solo para la revisión). */
export const TREE_ALPHA_TEST = 0.4;        // corte del alfa de las tarjetas (con MSAA se suaviza con alphaToCoverage)
export const TREE_LOD_BAND = 0.3;          // franja (fracción de treeCardDist) donde tarjetas e impostor se funden por dither
/* G2 · impostores: ya no son el elipsoide de 32 tris sino 3 quads cruzados (6 tris) con una textura horneada en el navegador
   desde el propio modelo de cada especie (treegen.buildImpostorAtlas). cardDistK agranda la distancia de las tarjetas
   (quality.treeCardDist × cardDistK; Baja sigue en 0 = solo impostor) porque el impostor nuevo es barato y se parece al árbol.
   shade = brillo del impostor para empalmar con el follaje cercano (el cercano usa normales esféricas y este normal +Y);
   alphaTest = corte del alfa horneado (bajo: los mipmaps adelgazan la silueta). */
export const TREE_IMPOSTOR = { cardDistK: 1.5, shade: 1, alphaTest: 0.32, alphaFar: [500, 2500], minSizeDist: 4000 };   // minSizeDist: desde esa distancia (m) el impostor crece ∝ d (tope ×3) para no desaparecer (1 px) en el home   // alphaFar = (m donde empieza, m donde llega) la baja del corte de alfa a 0,1 (los mipmaps adelgazan la silueta)
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
      if (o.TREE_IMPOSTOR) Object.assign(TREE_IMPOSTOR, o.TREE_IMPOSTOR);    // G2: ?a2={"TREE_IMPOSTOR":{"cardDistK":0.01}} = solo impostores
    } catch (e) { console.warn("a2: JSON inválido en ?a2"); }
  }
}
/* Viento en reposo (ajuste G3, 2026-11-11): con la cámara quieta, árboles y pasto siguen moviéndose si hay
   vegetación EN CUADRO a menos de WIND_IDLE_DIST m (distancia a la esfera de la celda). Rasante (~76 m) y de cerca: se
   mueve; vistas altas/cenitales (> ~250 m del follaje más cercano): no. Tope quality.idleFps (0 = apagado). */
export const WIND_IDLE_DIST = 250;
/* === A2: fin === */

/* === A1: inicio === */
/* Niebla / perspectiva atmosférica unificada (suelo MapLibre vía capa atmo-fog + objetos Three).
   El color es el horizon-color del `sky` de map/style.js: la niebla "entra" en el degradado
   del cielo sin costura. Si un preset de hora cambia uno, cambia los dos a la vez. */
export const A1_SKY = {
  skyColor: "#87b9e0",
  horizonColor: "#dfe9d8",
  fogColor: "#e6ecdc"      // `fog-color` del sky de MapLibre (solo se ve con terreno activo, A6)
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
/* ---- 3.1: modos de hora (A1) ----
   `mediodia` NO se define acá: sale de los diales de arriba (A1_SUN, A1_LIGHT, A1_SKY, A1_RASTER, A1_RENDER, A3_SHADOWS) para que
   siga siendo exactamente la escena aprobada. Los otros modos son valores absolutos (colores sRGB hex) y se interpolan 1,5 s.
     sunElev / sunAz  elevación (°) y desplazamiento del azimut respecto del medido por campo (T13: el tope es ±35°)
     sunColor, sunInt luz directa · hemiSky/hemiSkyInt cielo del hemisferio · gTint/gInt multiplicador del color de suelo del campo
     skyColor, horizonColor, fogColor  `sky` de MapLibre (horizonColor = color de la niebla Three y de la capa atmo-fog)
     fogK             escala del inicio de la niebla (< 1 = más densa)
     expK             multiplicador de la exposición del tone mapping
     tint             multiplicador de color del suelo (pasada multiplicativa de la capa atmo-fog; "#ffffff" = nada)
     rSat, rCon, rBMin, rBMax, rHue   ajuste del ráster satelital (raster-*)
     shStr, shTint    intensidad y tinte de las sombras de los árboles (A3) */
export const A1_HORAS = {
  duracionMs: 1500,
  dorada: {
    label: "Hora dorada", sunElev: 18, sunAz: -20, sunColor: "#ffa850", sunInt: 3.4,
    hemiSky: "#8fa0c8", hemiSkyInt: 0.4, gTint: "#ffbb78", gInt: 0.45,
    skyColor: "#79aedb", horizonColor: "#f0dcb8", fogColor: "#f1ddbd", fogK: 0.85, expK: 1.0,
    tint: "#ffdcae", rSat: 0.24, rCon: 0.16, rBMin: 0, rBMax: 0.96, rHue: -4,
    shStr: 0.85, shTint: [0.42, 0.46, 0.58]
  },
  atardecer: {
    label: "Atardecer", sunElev: 8, sunAz: -35, sunColor: "#ff8a45", sunInt: 3.2,
    hemiSky: "#a99bb4", hemiSkyInt: 0.5, gTint: "#ff9c6a", gInt: 0.4,
    skyColor: "#6e84b4", horizonColor: "#f2b690", fogColor: "#efb08c", fogK: 0.6, expK: 1.1,
    tint: "#ffc79f", rSat: 0.25, rCon: 0.14, rBMin: 0, rBMax: 0.9, rHue: -6,
    shStr: 0.9, shTint: [0.46, 0.44, 0.58]
  }
};
/* Ajuste fino en caliente (solo ?debug/?qa): ?a1={"A1_RENDER":{"exposure":1.2}} mezcla sobre los diales. */
{
  const q = new URLSearchParams(location.search);
  if ((q.has("debug") || q.has("qa")) && q.get("a1")) {
    try {
      const o = JSON.parse(q.get("a1"));
      const T = { A1_RENDER, A1_LIGHT, A1_SUN, A1_FOLIAGE, A1_RASTER, A1_FOG, A1_SKY, A1_CAMPOS, A1_HORAS };
      for (const k in o) if (T[k]) Object.assign(T[k], o[k]);
    } catch (e) { console.warn("a1: JSON inválido en ?a1"); }
  }
}
/* === A1: fin === */

/* === A4: inicio === */
/* Suelo por shader (I) y surcos de cultivo (J): render/systems/ground.js. Diales: handoffs/a4-suelo.md y a4-g2.md.
   Colores base = §4 (pardo del corredor herbáceo, verde de los parches): NO se cambian. `dry`/`green` son
   variantes de pasto seco/verde de la MISMA tonalidad (±6° de matiz) que se mezclan con ruido fbm.
   Crecimiento: G2 (2026-11-11) eligió "revelado" (el suelo aparece desde el eje del polígono hacia los bordes,
   máscara por distancia al borde + tiempo). La variante "extrusión" (losa con paredes) se retiró en a4-g2: queda en
   el historial (commit 9d7ed10 de realismo-a4-suelo). */
export const A4_GROUND = {
  enabled: true,
  yOff: 0.04,          // m sobre la altura del suelo (heightAt)
  maxEdgeFlat: 300,    // m · arista máx. de la malla SIN terreno (la profundidad del revelado va en textura horneada: ~10x menos triángulos)
  maxEdge: 40,         // m · arista máx. CON terreno (la altura se pide por vértice, hay que refinar)
  gain: 1.0,           // multiplicador de albedo (calibrado contra el suelo MapLibre anterior)
  noise: { fine: 0.10, mid: 0.13, coarse: 0.16 },   // amplitud de luminancia por escala (≈0,7 m / 4 m / 25 m)
  edgeAO: { width: 1.8, strength: 0.38 },           // m de la franja oscura hacia adentro y oscurecimiento máximo
  reveal: { soft: 0.10, jitter: 0.10 },             // suavidad del frente de revelado y ruido del frente
  classes: {
    "corr-herb":   { color: "#6b5d38", dry: "#75653a", green: "#655d38", alpha: 1.0,  tune: [0.54, 0.62, 1.02] },
    "parche-herb": { color: "#4d5c33", dry: "#565e34", green: "#485c34", alpha: 1.0,  tune: [0.61, 0.75, 1.06] },
    "bajo":        { color: "#6f8a72", dry: "#788a70", green: "#6b8a76", alpha: 1.0,  tune: [0.62, 0.75, 0.52] },
    "parche-le":   { color: "#2e5026", dry: "#34502a", green: "#2b5028", alpha: 0.45, tune: [1.0, 1.08, 1.28] },
    "corr-le":     { color: "#2e5026", dry: "#34502a", green: "#2b5028", alpha: 0.45, tune: [1.04, 1.10, 1.26] }
  }
};
export const A4_FURROWS = {
  enabled: true,                 // interruptor general (?surcos=0|1). Detalle inventado, no dato: decisión del dueño (D-3)
  spacing: 0.52,                 // m entre surcos (soja/maíz)
  rowAmp: 0.10,                  // modulación de luminancia (±) de los surcos
  bandAmp: 0.045,                // luminancia (±) de las bandas de 8 surcos que toman la posta a media distancia
  /* Antialias por derivadas: w = huella del píxel en períodos. El surco se funde (w en [lo,hi]) antes de acercarse al
     límite de Nyquist (w=0,5); las bandas (período ×8) igual con su propio w. Subir hi = surcos más lejos pero más moiré. */
  rowW: [0.10, 0.30], bandW: [0.05, 0.16],
  tramPeriod: 28, tramGauge: 2.8, tramWidth: 0.5, tramAmp: 0.16,   // huellas de pulverizadora
  rowFade: [350, 900],           // m · tope por distancia de los surcos (la frecuencia en pantalla suele apagarlos antes)
  tramFade: [700, 1500],         // m · huellas
  classes: ["agri", "zona1", "zona2", "zona3"]
};
/* Agua (M, Ola 3): render/systems/water.js. Base = #3f7fb5 (leyenda, §4): NO se cambia; somero/profundo son variantes
   de la misma tonalidad. Todo lo demás (ondulación, fresnel, destello, orilla) es textura de render, no dato. */
export const A4_WATER = {
  enabled: true,
  yOff: 0.03,                // m sobre la altura del suelo (heightAt); menor que A4_GROUND.yOff: con terreno el suelo leñoso queda encima
  shoreCell: 1.0,            // m · celda del mapa de distancia a la orilla (R8; sube sola si el agua se extiende > 2 km)
  maxEdge: 60,               // m · arista máx. de la malla (astillas del earcut de 3 km dan huecos de precisión en la GPU)
  maxEdgeRelief: 10,         // m · idem CON terreno (la altura se pide por vértice)
  color: "#3f7fb5",          // agua de profundidad media (leyenda)
  shallow: "#76a9bf",        // orilla: más clara y verdosa (se ve el fondo)
  deep: "#2c6290",           // centro del cauce
  rim: "#9ecbe8",            // reborde claro en la orilla (el mismo de la línea de MapLibre que reemplaza)
  alpha: [0.50, 0.86],       // opacidad somero → profundo (el satélite se transparenta en la orilla)
  shoreWidth: 3.2,           // m · de la orilla al "profundo"
  edgeSoft: 0.7,             // m · borde suave contra el suelo
  rimStrength: 0.30,         // intensidad del reborde claro
  waveScale: [8, 21],        // m · período de las dos capas de ondas (rotadas y con deriva distinta: sin repetición visible)
  drift: [0.030, 0.012, -0.016, 0.022],   // textura/s de cada capa (xy capa 1, xy capa 2)
  waveSlope: 0.22,           // pendiente máxima de las normales animadas
  waveFade: [220, 800],      // m · las ondas se aplanan con la distancia (sin parpadeo; el fresnel hace el resto)
  f0: 0.02,                  // reflectancia a incidencia normal (agua)
  gain: 0.82,                // calibración del cuerpo del agua (paridad de leyenda contra el agua anterior: ΔE de la media)
  reflection: 0.55,          // intensidad del cielo reflejado (cielo de MapLibre aproximado: zenit → horizonte/niebla)
  spec: [300, 0.8],          // brillo del destello del sol: exponente, intensidad
  lineOpacity: 0,            // opacidad de la línea `*-agua-line` de MapLibre cuando el shader está activo (0 = apagada)
  idleMaxDist: 1000          // m · más lejos que esto no hace falta animar en reposo (lazo acotado, T7)
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
    nikunihue: { terreno: true },   // G2 (Mike): forzado para que se vea el escarpe, donde el terreno esté activo por calidad (quality.terrain)
  },
  /* Sombreado de relieve (hillshade MapLibre), sutil y en TODOS los campos. La luz sale del azimut del sol de
     A1 (A1_CAMPOS[campo].sunAzimuth, o A1_SUN.defaultAzimuth). */
  hillshade: {
    enabled: true,
    maxzoom: 13, tileSize: 256,   // G2: fuente del hillshade (más barato con maxzoom menor / tileSize 512); ver handoffs/a6-calidad.md
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

/* === A3: inicio === */
/* Sombras reales de los árboles (render/systems/shadows.js). Diales y método: handoffs/a3-sombras.md.
   Pase propio de profundidad (cámara ortográfica ajustada a la zona útil, snapping al texel) +
   receptor multiplicativo sobre el suelo + blobs instanciados para lo lejano. */
export const A3_SHADOWS = {
  enabled: true,               // false = todo apagado (vuelven las manchas-sombra GeoJSON de MapLibre). También ?sombras=0
  hideMapLibre: true,          // apaga las capas *-tree-shadows (el dato GeoJSON no se toca)
  tint: [0.40, 0.48, 0.58],    // multiplicador RGB del color bajo sombra (en espacio de pantalla): azulado-verdoso
  strength: 0.80,              // 0..1 · cuánto del tinte se aplica en sombra plena (factor final ≈ 0,52/0,58/0,66 sobre lo que haya debajo)
  zoneK: 1.1,                  // lado de la zona útil = distancia cámara-objetivo × zoneK (~330 m en el rasante, ~1,4 km a z15)
  zoneMin: 160, zoneMax: 2400, // m · lado mínimo y máximo de la zona
  zoneStep: 1.25,              // el tamaño de la caja se cuantiza en pasos geométricos (evita que cambie de tamaño todo el tiempo)
  margin: 1.45,                // la caja del mapa de sombras = zona × margin: se recalcula solo cuando la cámara sale del margen
  edge: 0.06,                  // franja (fracción del mapa) donde la sombra real se funde con los blobs
  cardDist: 330,               // m · dentro de esta distancia al centro de la caja los árboles proyectan con tarjetas; más lejos, con el impostor
  cardMaxTexel: 0.6,           // m · si el texel del mapa es más grande que esto, todos proyectan con el impostor (las hojas no se resuelven)
  biasM: 0.12,                 // m · sesgo de profundidad del receptor (suelo plano: casi nada)
  soft: true,                  // 4 muestras de PCF por píxel en el suelo (false = 1 muestra)
  grass: "ultra",              // quién recibe sombra en las matas: "ultra" (solo Ultra) | "alta" (Ultra y Alta) | "off" (en este dato casi no se nota: ver handoff)
  blob: { strength: 0.80, centerK: 0.62, capOff: 3.2, capLen: 3.6 }   // intensidad, altura relativa del centro de copa, topes de desplazamiento (× altura) y largo (× radio)
};
/* Ajuste en caliente (solo ?debug/?qa): ?a3={"strength":0.5,"zoneK":0.9} se mezcla sobre A3_SHADOWS. */
{
  const q = new URLSearchParams(location.search);
  if ((q.has("debug") || q.has("qa")) && q.get("a3")) {
    try { Object.assign(A3_SHADOWS, JSON.parse(q.get("a3"))); } catch (e) { console.warn("a3: JSON inválido en ?a3"); }
  }
}
/* === A3: fin === */

/* === A5: inicio === */
/* Fauna (render/systems/fauna.js): aves en bandadas y polinizadores. Diales y método: handoffs/a5-fauna.md.
   Todo procedural (sin assets). Semilla fija: la misma fauna en cada carga (con ?qa y sin él). */
export const A5_FAUNA = {
  enabled: true,               // false = sin fauna. También ?fauna=0 (con ?qa/?debug)
  seed: 0xA5F0,                // semilla base (se suma 1 en inicial, 2 en multi)
  ratioInicial: 0.25,          // D-4: proporción inicial : multi = 1 : 4 (aves). Los polinizadores usan butterflyInicial
  birds: {
    treesPerBird: 25,          // el total de aves de multi sale de (árboles del escenario / esto), entre min y max
    min: 40, max: 130,
    flockSize: [8, 25],        // individuos por bandada
    anchorCell: 300,           // m · celda para buscar parches leñosos (centros de gravedad de los árboles)
    anchorMinTrees: 8,         // árboles mínimos en una celda para que sea un parche donde anidan
    corrNear: 350, corrBonus: 3,  // parches a < corrNear m de un corredor herbáceo valen ×corrBonus al elegir dónde van las bandadas (se ven desde el rasante)
    corrNear: 350, corrBonus: 3,  // parches a < corrNear m de un corredor herbáceo valen ×corrBonus al elegir dónde van las bandadas (se ven desde el rasante)
    anchorSep: 380,            // m · separación mínima entre recorridos de bandadas distintas
    orbit: [90, 190],          // m · radio del recorrido alrededor del parche (se suma la dispersión del parche)
    alt: [25, 56],             // m sobre el suelo · el piso se calcula también contra el árbol más alto (treeClear)
    treeClear: 7,              // m · colchón mínimo sobre la copa más alta de TREE_SPECIES (sin atravesar árboles)
    speed: [8, 13],            // m/s
    span: 3.4,                 // m · envergadura (escala estilizada, como GRASS_SCALE: de 100-300 m se tiene que leer)
    spanVar: 0.3,              // ± fracción
    flapHz: [2.0, 2.8],        // aleteo
    boostFrom: 180, farBoost: 2.2,   // desde boostFrom m el ave crece ∝ distancia (tope ×farBoost): a 400 m se sigue leyendo (≈ 20 px)
    maxDist: [900, 1400],     // m · se encogen a 0 entre estas distancias a la cámara (sub-píxel: no vale dibujarlas)
    palette: [[0x34373a, 0.58], [0x5d5249, 0.24], [0x85807a, 0.10], [0xe7e4da, 0.08]]   // [color sRGB, peso]
  },
  butterflies: {
    tuftsPerButterfly: { "corr-herb": 26, "parche-herb": 300 },   // 1 polinizador cada N matas (en multi)
    max: 16000,                // tope por escenario (solo se dibujan las celdas a < visDist de la cámara)
    inicial: 0,                // fracción de multi en el escenario inicial (casi ninguno: 0 = ninguno)
    cell: 320,                 // m · celda de instanciado (una InstancedMesh por celda)
    visDist: [290, 400],       // m · se achican a 0 entre estas distancias a la cámara (y solo se dibujan las celdas dentro)
    farBoost: 2.2,             // entre 60 y 260 m de la cámara crecen hasta ×2,2 (a 250 m una de 2,2 m mide ~20 px)
    span: 2.2,                 // m · envergadura (escala estilizada)
    alt: [2.4, 6.0],           // m · sobre el suelo: 0,5-2,5 m reales × GRASS_SCALE a medias (las matas miden 2-4,7 m: si vuelan más bajo quedan tapadas)
    wander: [7, 16],           // m · radio de vuelo errático alrededor de la mata
    palette: [[0xffd21f, 0.40], [0xff7d14, 0.35], [0xffffff, 0.25]]
  }
};
/* Ajuste en caliente (solo ?debug/?qa): ?a5={"ratioInicial":0.5} se mezcla (superficial) sobre A5_FAUNA. */
{
  const q = new URLSearchParams(location.search);
  if ((q.has("debug") || q.has("qa")) && q.get("a5")) {
    try {
      const o = JSON.parse(q.get("a5"));
      for (const k in o) { if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && A5_FAUNA[k]) Object.assign(A5_FAUNA[k], o[k]); else A5_FAUNA[k] = o[k]; }
    } catch (e) { console.warn("a5: JSON inválido en ?a5"); }
  }
  if ((q.has("debug") || q.has("qa")) && q.get("fauna") === "0") A5_FAUNA.enabled = false;
}
/* === A5: fin === */
