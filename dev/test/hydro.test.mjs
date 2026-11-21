#!/usr/bin/env node
/* Tests del motor del simulador de escorrentía (js/hydro/**). Sin dependencias: `node dev/test/hydro.test.mjs`.
   Variables de entorno:
     HIDRO_REF_DIR   carpeta con la salida de la referencia Python (default /tmp/hidro-ref). Se genera con
                       python3 docs/hidro/referencia/velocidad.py --geojson-dir fixtures/demo_relieve --out /tmp/hidro-ref --dump
                     Si no está grid.npz/meta_vel.json se SALTA la comparación (con aviso). El test convierte el .npz con
                     dev/test/ref_to_bin.py (necesita python3 + numpy).
     HIDRO_SIN_RED=1 no baja el DEM de AWS (se salta solo la comprobación de la mediana contra el DEM real; el resto usa la H de la referencia).
   Los módulos de js/hydro se importan SIN ?v= (son puros y sin estado: no hay riesgo de duplicarlos). */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// config.js toca window/location al importarse: se simulan para poder leer HIDRO en Node
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.location = { search: "", hostname: "localhost" };
const { paramsMotor } = await import("../../js/hydro/params.js");
const P = paramsMotor();
const { priorityFlood } = await import("../../js/hydro/fill.js");
const { mfdWeights, meanDirection, localSlope, box3, NB_DI, NB_DJ } = await import("../../js/hydro/flow.js");
const { gridMeta, cropDem, medianFilter, cellCenters, sceneToCell, lonLatToPx, pxToLonLat } = await import("../../js/hydro/grid.js");
const { rasterizarClases, tablaClases, coefEscurrimiento, lamina } = await import("../../js/hydro/classes.js");
const { acumular, salidaPorBordes, manning, suavizarLog } = await import("../../js/hydro/runoff.js");
const { prepararTerreno, prepararEscenario, correrTodo, resultadoDe } = await import("../../js/hydro/engine.js");
const { pointInPolygon } = await import("../../js/core/geo.js");

/* ---------- mini arnés ---------- */
let ok = 0, mal = 0, saltados = 0;
const t0 = Date.now();
function check(nombre, cond, detalle = "") {
  if (cond) { ok++; console.log("  ok   " + nombre + (detalle ? "  (" + detalle + ")" : "")); }
  else { mal++; console.log("  FALLA " + nombre + (detalle ? "  (" + detalle + ")" : "")); }
}
const seccion = t => console.log("\n" + t);
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/* ---------- helpers de grillas sintéticas ---------- */
const CELL = 15, AREA = CELL * CELL;
function metaSint(nx, ny) { return { nx, ny, cell: CELL, area: AREA }; }
function tablaUniforme(cn, n) { return { C: coefEscurrimiento(cn, P.pCn), n }; }
/* escenario uniforme (misma CN y n en toda la grilla), sin rasterizar */
function escUniforme(T, cn, n) {
  const N = T.meta.nx * T.meta.ny, C = coefEscurrimiento(cn, P.pCn);
  const peso = new Float64Array(N).fill(C * T.meta.area), nM = new Float64Array(N).fill(n);
  return { peso, nM, Ae: acumular(T.W, T.order, peso, T.meta.nx), C };
}
function terrenoDe(fn, nx, ny) {
  const H = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = fn(i, j);
  return prepararTerreno(H, metaSint(nx, ny), P);
}
const rainI = mm => mm / 1000 / 3600;

/* ---------- 1. plano inclinado ---------- */
seccion("1. Plano inclinado hacia el este (dirección y v analíticas)");
{
  const nx = 60, ny = 60, s = 0.02;
  const T = terrenoDe((i) => 100 - s * CELL * i, nx, ny);
  const cn = 78, n = 0.10, E = escUniforme(T, cn, n), rain = 50;
  const j = 30;   // fila central: a más de 30 columnas de los bordes N/S nada del borde llega (la dispersión es de 1 fila por columna)
  const id = (i) => j * nx + i;
  // F == H (no hay depresiones)
  let dF = 0; for (let k = 0; k < T.F.length; k++) dF = Math.max(dF, Math.abs(T.F[k] - T.H[k]));
  check("el relleno no toca un plano que ya drena", dF === 0, "max|F−H| = " + dF);
  // dirección: este puro, dirY ≈ 0 en la fila central
  check("dirección media = este (dirX≈1, dirY≈0)", T.dirX[id(30)] > 0.999 && Math.abs(T.dirY[id(30)]) < 1e-6, `dirX=${T.dirX[id(30)].toFixed(5)} dirY=${T.dirY[id(30)].toExponential(2)}`);
  // pendiente local = s (la caja de un plano lo deja igual)
  check("pendiente local = pendiente del plano", Math.abs(T.S[id(30)] - s) < 1e-9, `S=${T.S[id(30)]} s=${s}`);
  // Ae(i) = C·A·(i+1) en la fila central (cada columna aporta una celda por fila)
  let maxRel = 0; for (let i = 1; i < 30; i++) maxRel = Math.max(maxRel, rel(E.Ae[id(i)], E.C * AREA * (i + 1)));
  check("Ae crece C·A·(i+1) hacia el este", maxRel < 1e-9, "err rel máx " + maxRel.toExponential(2));
  // v analítica (sin suavizar): q = i·Ae/cell ; h = (q n/√S)^0.6 ; v = q/h
  const M = manning(E.Ae, T.S, E.nM, CELL, rain, P);
  let eV = 0;
  for (let i = 4; i < 29; i++) {   // desde la columna 4: las dos cajas de la pendiente sesgan el borde 3 celdas
    const q = rainI(rain) * E.C * AREA * (i + 1) / CELL, h = Math.pow(q * n / Math.sqrt(s), 0.6), v = q / h;
    eV = Math.max(eV, rel(M.vRaw[id(i)], v));
  }
  check("v de Manning = analítica", eV < 1e-9, "err rel máx " + eV.toExponential(2));
  // v suavizada en el interior = media geométrica de 3 columnas vecinas (log-caja 3×3, las 3 filas iguales)
  const Vs = suavizarLog(M.vRaw, nx, ny, P);
  const i0 = 15, g = Math.pow(10, (Math.log10(M.vRaw[id(i0 - 1)]) + Math.log10(M.vRaw[id(i0)]) + Math.log10(M.vRaw[id(i0 + 1)])) / 3);
  check("suavizado log = media geométrica 3×3", rel(Vs[id(i0)], g) < 1e-12);
  // conservación
  const sal = salidaPorBordes(E.Ae, T.W), ent = E.peso.reduce((a, b) => a + b, 0);
  check("conservación Σ C·A = salida por bordes (rel ≤ 1e-6)", rel(sal, ent) <= 1e-6, "rel " + rel(sal, ent).toExponential(2));
  // orden de magnitud sanidad de caso físico: q a 30 celdas (450 m) con 50 mm/h
  check("v en rango físico (0,01–5 m/s)", M.vRaw[id(29)] > 0.01 && M.vRaw[id(29)] < 5, "v=" + M.vRaw[id(29)].toFixed(3));
}

/* ---------- 2. V (valle) ---------- */
seccion("2. Valle en V (el agua se concentra en el eje)");
{
  const nx = 61, ny = 80, ic = 30, sx = 0.05, sy = 0.01;
  const T = terrenoDe((i, j) => 100 + sx * CELL * Math.abs(i - ic) + sy * CELL * (ny - 1 - j), nx, ny);
  const E = escUniforme(T, 78, 0.10);
  const j = 60;
  const eje = E.Ae[j * nx + ic], l2 = E.Ae[j * nx + ic - 2], l5 = E.Ae[j * nx + ic + 5];
  check("Ae en el eje ≫ a 2 celdas del eje", eje > 5 * l2, `eje ${(eje / AREA).toFixed(1)}·A · lado ${(l2 / AREA).toFixed(1)}·A`);
  check("Ae en el eje ≫ a 5 celdas del eje", eje > 10 * l5, `lado ${(l5 / AREA).toFixed(1)}·A`);
  check("Ae del eje crece aguas abajo", E.Ae[70 * nx + ic] > E.Ae[40 * nx + ic] && E.Ae[40 * nx + ic] > E.Ae[10 * nx + ic]);
  check("dirección sobre el eje = sur (dirY≈1)", T.dirY[j * nx + ic] > 0.99 && Math.abs(T.dirX[j * nx + ic]) < 0.05, `dirY=${T.dirY[j * nx + ic].toFixed(3)}`);
  check("dirección en la ladera apunta al eje", T.dirX[j * nx + ic - 8] > 0.3 && T.dirX[j * nx + ic + 8] < -0.3, `izq dirX=${T.dirX[j * nx + ic - 8].toFixed(2)} der dirX=${T.dirX[j * nx + ic + 8].toFixed(2)}`);
  const M = manning(E.Ae, T.S, E.nM, CELL, 50, P);
  check("h y v mayores en el eje que en la ladera", M.h[j * nx + ic] > 3 * M.h[j * nx + ic - 8] && M.vRaw[j * nx + ic] > M.vRaw[j * nx + ic - 8]);
  const sal = salidaPorBordes(E.Ae, T.W), ent = E.peso.reduce((a, b) => a + b, 0);
  check("conservación Σ C·A = salida por bordes", rel(sal, ent) <= 1e-6, "rel " + rel(sal, ent).toExponential(2));
}

/* ---------- 3. pozo ---------- */
seccion("3. Pozo en un plano (el relleno drena)");
{
  const nx = 50, ny = 50, s = 0.02, pi = 25, pj = 25;
  const hPlano = (i) => 100 - s * CELL * i;
  const pozo = (i, j) => hPlano(i) - 6 * Math.exp(-((i - pi) ** 2 + (j - pj) ** 2) / 18);
  const T = terrenoDe(pozo, nx, ny);
  // sin relleno el centro del pozo es un sumidero (todas las vecinas más altas); con el relleno no
  const id = pj * nx + pi;
  let sumideroH = true; for (let k = 0; k < 8; k++) if (T.H[id + NB_DJ[k] * nx + NB_DI[k]] <= T.H[id]) sumideroH = false;
  check("el DEM crudo tiene un sumidero en el pozo", sumideroH);
  check("el relleno sube el fondo del pozo", T.F[id] > T.H[id] + 1, `H=${T.H[id].toFixed(2)} F=${T.F[id].toFixed(2)}`);
  let nuncaBaja = true; for (let k = 0; k < T.F.length; k++) if (T.F[k] < T.H[k]) nuncaBaja = false;
  check("F ≥ H en toda la grilla", nuncaBaja);
  // toda celda interior tiene al menos una vecina más baja → no quedan sumideros interiores
  let sumideros = 0, sumInterior = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let tiene = false; for (let d = 0; d < 8; d++) if (T.W[8 * (j * nx + i) + d] > 0) tiene = true;
    if (!tiene) { sumideros++; if (i > 0 && j > 0 && i < nx - 1 && j < ny - 1) sumInterior++; }
  }
  check("no quedan sumideros interiores (solo salidas por el borde)", sumInterior === 0, `${sumideros} celdas sin salida, todas en el borde`);
  const E = escUniforme(T, 78, 0.10);
  const sal = salidaPorBordes(E.Ae, T.W), ent = E.peso.reduce((a, b) => a + b, 0);
  check("conservación con pozo Σ C·A = salida por bordes", rel(sal, ent) <= 1e-6, "rel " + rel(sal, ent).toExponential(2));
  check("el pozo deja pasar el agua: Ae aguas abajo ≥ Ae aguas arriba", E.Ae[pj * nx + pi + 5] >= E.Ae[pj * nx + pi - 5]);
  // terreno aleatorio con muchas depresiones
  let semilla = 12345; const rnd = () => (semilla = (semilla * 1664525 + 1013904223) >>> 0) / 4294967296;
  const R = terrenoDe((i, j) => 50 + 3 * rnd() + 0.01 * i, 70, 55);
  const ER = escUniforme(R, 78, 0.1);
  const sr = salidaPorBordes(ER.Ae, R.W), er = ER.peso.reduce((a, b) => a + b, 0);
  let sumR = 0; for (let j = 1; j < 54; j++) for (let i = 1; i < 69; i++) { let t = false; for (let d = 0; d < 8; d++) if (R.W[8 * (j * 70 + i) + d] > 0) t = true; if (!t) sumR++; }
  check("terreno ruidoso: sin sumideros interiores y conservación", sumR === 0 && rel(sr, er) <= 1e-6, "rel " + rel(sr, er).toExponential(2));
}

/* ---------- 4. piezas sueltas ---------- */
seccion("4. SCS-CN, cola de prioridad y rasterizado");
{
  // CN 78, P = 80 mm: S = 71,64 · Ia = 14,33 · Q = 65,67²/(80+57,31) = 31,41 mm  → C ≈ 0,393
  check("SCS-CN: Q(80 mm, CN 78) ≈ 31,41 mm", Math.abs(lamina(78, 80) - 31.41) < 0.01, lamina(78, 80).toFixed(3));
  check("SCS-CN: sin escurrimiento si P ≤ Ia", lamina(55, 20) === 0 && lamina(55, 80) > 0);
  check("C monótono con CN", coefEscurrimiento(55, 80) < coefEscurrimiento(78, 80) && coefEscurrimiento(78, 80) < coefEscurrimiento(98, 80));
  // relleno: 3 celdas de ancho con una laguna → orden de salida no decreciente en F
  const T = terrenoDe((i, j) => 100 + 0.3 * Math.sin(i * 1.7) * Math.cos(j * 1.3) + 0.01 * (i + j), 40, 30);
  let creciente = true; for (let t = 1; t < T.order.length; t++) if (T.F[T.order[t]] < T.F[T.order[t - 1]]) creciente = false;
  check("orden de la cola no decreciente en F (la acumulación lo recorre al revés)", creciente);
  // rasterizado: scanline == pointInPolygon de core/geo.js (con huecos)
  const meta = gridMeta([-59.26, -37.42, -59.24, -37.40], P);
  const centros = cellCenters(meta), tabla = tablaClases(P);
  const A = [[-59.255, -37.415], [-59.245, -37.4125], [-59.2475, -37.405], [-59.2565, -37.4085], [-59.255, -37.415]];
  const hueco = [[-59.2525, -37.4105], [-59.2495, -37.4105], [-59.2495, -37.4085], [-59.2525, -37.4085], [-59.2525, -37.4105]];
  const feats = [{ cls: "agri", type: "MultiPolygon", coordinates: [[A, hueco]] }, { cls: "corr-le", type: "Polygon", coordinates: [[[-59.2535, -37.4140], [-59.2515, -37.4140], [-59.2515, -37.4128], [-59.2535, -37.4128], [-59.2535, -37.4140]]] }];
  const r = rasterizarClases(feats, centros, tabla, P);
  let difs = 0, dentro = 0;
  for (let j = 0; j < meta.ny; j++) for (let i = 0; i < meta.nx; i++) {
    const pt = [centros.lon[i], centros.lat[j]];
    const e = pointInPolygon(pt, feats[1].coordinates) ? "corr-le" : pointInPolygon(pt, [A, hueco]) ? "agri" : P.claseFuera;
    if (pointInPolygon(pt, [A, hueco]) || pointInPolygon(pt, feats[1].coordinates)) dentro++;
    if (tabla.nombres[r.cls[j * meta.nx + i]] !== e) difs++;
  }
  check("rasterizado por filas = pointInPolygon (con hueco y último gana)", difs === 0 && dentro > 100, `${dentro} celdas dentro, ${difs} diferencias`);
  // conversión de coordenadas ida y vuelta
  const [x, y] = lonLatToPx(-59.25, -37.41, 13), [lo, la] = pxToLonLat(x, y, 13);
  check("lonLatToPx / pxToLonLat son inversas", Math.abs(lo + 59.25) < 1e-9 && Math.abs(la + 37.41) < 1e-9);
  // afín escena → celda (misma forma que uA6P): en el origen de la escena da el píxel del origen
  const ox = (-59.25 + 180) / 360, [oxp, oyp] = lonLatToPx(-59.25, -37.41, 13);
  const sc = 1e-8, aff = sceneToCell(meta, ox, oyp / (256 * 2 ** 13), sc);
  check("afín escena→celda: x=0 cae en el píxel del origen − gx0", Math.abs(aff[1] - (oxp - meta.gx0)) < 1e-6 && Math.abs(aff[3] - (oyp - meta.gy0)) < 1e-6);
  // rasterización de 2 escenarios del tamaño del campo sintético: costo (se mide de nuevo en la sección 5)
}

/* ---------- 5. referencia Python sobre el campo sintético ---------- */
seccion("5. Comparación con la referencia Python (fixtures/demo_relieve)");
const REF = process.env.HIDRO_REF_DIR || "/tmp/hidro-ref";
async function cargarReferencia() {
  if (!existsSync(join(REF, "meta_vel.json")) || !existsSync(join(REF, "grid.npz"))) return null;
  if (!existsSync(join(REF, "bin", "manifest.json"))) {
    try { execFileSync("python3", [join(RAIZ, "dev/test/ref_to_bin.py"), REF], { stdio: "pipe" }); }
    catch (e) { console.log("  AVISO: no pude convertir grid.npz (¿python3 + numpy?): " + (e.stderr || e.message)); return null; }
  }
  const man = JSON.parse(readFileSync(join(REF, "bin", "manifest.json"), "utf8")), a = {};
  for (const [k, f] of Object.entries(man.arrays)) { const b = readFileSync(join(REF, "bin", f)); a[k] = new Float64Array(b.buffer, b.byteOffset, b.length / 8); }
  return { meta: JSON.parse(readFileSync(join(REF, "meta_vel.json"), "utf8")), shape: man.shape, a };
}
const ref = await cargarReferencia();
if (!ref) {
  saltados++;
  console.log(`  AVISO: no encontré la referencia en ${REF} (meta_vel.json + grid.npz). SE SALTA la comparación con Python.`);
  console.log("         Generala con:  python3 docs/hidro/referencia/velocidad.py --geojson-dir fixtures/demo_relieve --out " + REF + " --dump");
} else {
  // classify() REAL de js/map/data.js (ese módulo importa MapLibre: se extrae el texto de la función, como hace el generador del fixture)
  const srcData = readFileSync(join(RAIZ, "js/map/data.js"), "utf8");
  const m = srcData.match(/export function classify\(props\) \{[\s\S]*?\n\}\n/);
  const classify = new Function(m[0].replace("export function classify", "return function classify") + "\n")();
  const leer = f => JSON.parse(readFileSync(join(RAIZ, "fixtures/demo_relieve", f), "utf8"));
  const gj = { inicial: leer("inicial.geojson"), multi: leer("multifuncional.geojson") };
  const feats = k => gj[k].features.filter(f => f.geometry).map(f => ({ cls: classify(f.properties), type: f.geometry.type, coordinates: f.geometry.coordinates }));
  const F = { inicial: feats("inicial"), multi: feats("multi") };
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of F.inicial) for (const poly of (f.type === "Polygon" ? [f.coordinates] : f.coordinates)) for (const p of poly[0]) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
  const meta = gridMeta([w, s, e, n], P), R = ref.meta.grilla;
  check("meta de la grilla = referencia (gx0, gy0, nx, ny, cell)", meta.gx0 === R.gx0 && meta.gy0 === R.gy0 && meta.nx === R.nx && meta.ny === R.ny && Math.abs(meta.cell - R.cell_m) < 1e-9,
    `${meta.nx}×${meta.ny} celdas de ${meta.cell.toFixed(3)} m`);
  check("forma del dump = forma de la grilla", ref.shape[0] === meta.ny && ref.shape[1] === meta.nx);
  const N = meta.nx * meta.ny, A = ref.a;

  // --- DEM real (red) → mediana: comparar con H de la referencia
  let raw = null;
  if (process.env.HIDRO_SIN_RED === "1") { saltados++; console.log("  AVISO: HIDRO_SIN_RED=1, no se prueba la mediana contra el DEM real"); }
  else {
    try {
      const { loadHeightfield } = await import("../../js/terrain/heightfield.js");
      const hf = await loadHeightfield(meta.bboxMargen, { z: P.zoom });
      raw = cropDem(hf.data, hf.w, hf.h, hf.px0, hf.py0, meta);
      const H = medianFilter(raw, meta.nx, meta.ny);
      let dmax = 0; for (let k = 0; k < N; k++) dmax = Math.max(dmax, Math.abs(H[k] - A.H[k]));
      check("DEM + mediana 3×3 = H de la referencia", dmax < 1e-6, "max|Δ| = " + dmax.toExponential(2) + " m");
    } catch (err) { saltados++; console.log("  AVISO: sin red al DEM de AWS (" + (err.message || err) + "): se salta la comprobación de la mediana"); }
  }
  // --- de acá en más: H de la referencia como entrada (aísla el resto del DEM y de la red)
  const T = prepararTerreno(Float64Array.from(A.H), meta, P);
  const centros = cellCenters(meta);
  const esc = { inicial: prepararEscenario(T, F.inicial, centros, P), multi: prepararEscenario(T, F.multi, centros, P) };
  // grilla COMPLETA (F2: la referencia ya promedia solo las vecinas que existen, igual que box3: no hay banda de borde excluida)
  const idxI = []; for (let k = 0; k < N; k++) idxI.push(k);
  const cuantil = (arr, q) => { const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };

  let nF = 0; for (let k = 0; k < N; k++) if (Math.abs(T.F[k] - A.F[k]) <= 1e-3) nF++;
  let dFmax = 0; for (let k = 0; k < N; k++) dFmax = Math.max(dFmax, Math.abs(T.F[k] - A.F[k]));
  check("F: |Δ| ≤ 1e-3 m en ≥ 99,9 % de las celdas", nF / N >= 0.999, `${(100 * nF / N).toFixed(3)} % · max|Δ| = ${dFmax.toExponential(2)} m`);
  const dS = idxI.map(k => rel(T.S[k], A.S[k]));
  check("S (pendiente local, grilla completa): rel p99 ≤ 1e-6", cuantil(dS, 0.99) <= 1e-6, "p99 " + cuantil(dS, 0.99).toExponential(2));
  const dDir = idxI.map(k => Math.hypot(T.dirX[k] - A.dirX[k], T.dirY[k] - A.dirY[k]));
  check("dirección media (grilla completa): |Δ| p99 ≤ 1e-5", cuantil(dDir, 0.99) <= 1e-5, "p99 " + cuantil(dDir, 0.99).toExponential(2));

  // inside: JS (scanline, centro de celda) vs shapely.contains_xy
  let dIn = 0; for (let k = 0; k < N; k++) if ((esc.inicial.cubierto[k] === 1) !== (A.inside[k] === 1)) dIn++;
  check("máscara del campo = shapely (≤ 0,05 % de celdas distintas)", dIn / N <= 5e-4, `${dIn} celdas de ${N}`);
  let dCn = 0; const tb = tablaClases(P);
  for (const key of ["inicial", "multi"]) for (let k = 0; k < N; k++) if (Math.abs(tb.cn[esc[key].cls[k]] - A[key + "_cn"][k]) > 1e-9) dCn++;
  check("CN por celda = referencia en ambos escenarios (≤ 0,05 % distintas, bordes de polígono)", dCn / (2 * N) <= 5e-4, `${dCn} celdas de ${2 * N}`);

  const stJs = {};
  for (const key of ["inicial", "multi"]) {
    const Ae = esc[key].Ae, Ar = A[key + "_Ae"];
    // Ae: error relativo ≤ 1 % donde Ae > 10·A
    let n10 = 0, malos = 0, maxe = 0;
    for (let k = 0; k < N; k++) if (Ar[k] > 10 * meta.area) { n10++; const r = rel(Ae[k], Ar[k]); if (r > 0.01) malos++; maxe = Math.max(maxe, r); }
    check(`Ae ${key}: rel ≤ 1 % donde Ae > 10·A`, malos === 0, `${n10} celdas · max rel ${maxe.toExponential(2)}`);
    // v / h
    const M = manning(Ae, T.S, esc[key].nM, meta.cell, ref.meta.parametros.rain_mmh, P);
    const v = suavizarLog(M.vRaw, meta.nx, meta.ny, P);
    stJs[key] = { v, M };
    const eV = idxI.map(k => rel(v[k], A[key + "_v"][k]));
    check(`v ${key} (grilla completa): mediana rel ≤ 2 % y p95 ≤ 5 %`, cuantil(eV, 0.5) <= 0.02 && cuantil(eV, 0.95) <= 0.05, `mediana ${(100 * cuantil(eV, 0.5)).toExponential(2)} % · p95 ${(100 * cuantil(eV, 0.95)).toExponential(2)} %`);
    const eH = idxI.filter(k => A[key + "_h"][k] > 1e-4).map(k => rel(M.h[k], A[key + "_h"][k]));
    check(`h ${key} (grilla completa): mediana rel ≤ 2 % y p95 ≤ 5 %`, cuantil(eH, 0.5) <= 0.02 && cuantil(eH, 0.95) <= 0.05, `mediana ${(100 * cuantil(eH, 0.5)).toExponential(2)} %`);
    // conservación sobre el campo real
    const sal = salidaPorBordes(Ae, T.W), ent = esc[key].peso.reduce((a, b) => a + b, 0);
    check(`conservación ${key}: Σ C·A = salida por bordes (rel ≤ 1e-6)`, rel(sal, ent) <= 1e-6, "rel " + rel(sal, ent).toExponential(2));
  }

  // --- pipeline completo (lo que corre el worker) y estadísticos del campo vs meta_vel.json
  const rainRef = ref.meta.parametros.rain_mmh;
  const entradaRaw = raw || Float32Array.from(A.H);   // sin red: mismo costo, otra H (no se compara)
  const tp = performance.now();
  const full = correrTodo(entradaRaw, meta, F, rainRef, P);
  const msPipe = performance.now() - tp;
  const r = full.resultado, st = r.stats, mj = ref.meta;
  const cmp = (nombre, js, py, tol) => check(`stats ${nombre}: JS ${js.toFixed(4)} vs Python ${py} (rel ≤ ${100 * tol} %)`, rel(js, py) <= tol, "rel " + (100 * rel(js, py)).toFixed(3) + " %");
  if (raw) {
    cmp("campo (ha)", st.campoHa, mj.campo_ha, 0.005);
    cmp("v media inicial", st.inicial.vMediaMs, mj.inicial.v_media_ms, 0.02);
    cmp("v media multi", st.multi.vMediaMs, mj.multi.v_media_ms, 0.02);
    cmp("v p95 inicial", st.inicial.vP95Ms, mj.inicial.v_p95_ms, 0.02);
    cmp("ha v > 0,3 inicial", st.inicial.haVMayor, mj.inicial.ha_v_mayor_0_3, 0.02);
    cmp("ha v > 0,3 multi", st.multi.haVMayor, mj.multi.ha_v_mayor_0_3, 0.02);
    cmp("Q pico máx inicial", st.inicial.qPicoMaxM3s, mj.inicial.Q_pico_max_campo_m3s, 0.01);
    cmp("Q pico máx multi", st.multi.qPicoMaxM3s, mj.multi.Q_pico_max_campo_m3s, 0.01);
    cmp("ha donde frena ≥ 16 %", st.frenaHa, mj.frena_ha, 0.02);
    cmp("reducción de v media (%)", st.reduccionVMediaPct, mj.reduccion_v_media_pct, 0.03);
  } else { saltados++; console.log("  AVISO: sin DEM de red, los estadísticos del campo se comparan con la H de la referencia más abajo, no con meta_vel.json"); }
  // dlog vs referencia (grilla completa)
  const eD = idxI.map(k => Math.abs(r.dlog[k] - A.dlog[k]));
  check("dlog = log2(v_multi/v_inicial) (grilla completa): |Δ| p99 ≤ 0,02", cuantil(eD, 0.99) <= 0.02, "p99 " + cuantil(eD, 0.99).toExponential(2));
  // el resultado transferible
  check("salidas son Float32Array/Uint8Array del tamaño de la grilla", r.inicial.v instanceof Float32Array && r.dlog instanceof Float32Array && r.inside instanceof Uint8Array && r.dirX.length === N && r.multi.h.length === N);
  { const iM = r.rainMmH / 3.6e6, AeM = full.cache.esc.multi.Ae, AeI = full.cache.esc.inicial.Ae;
    let mx = 0, dq = 0;
    for (let k = 0; k < N; k++) { if (r.inside[k]) mx = Math.max(mx, r.inicial.Q[k]);   // el pico de stats es solo dentro del campo
      dq = Math.max(dq, rel(r.multi.Q[k], iM * AeM[k]), rel(r.inicial.Q[k], iM * AeI[k])); }
    check("Q por celda: Float32Array del tamaño de la grilla en ambos escenarios", r.inicial.Q instanceof Float32Array && r.multi.Q instanceof Float32Array && r.inicial.Q.length === N && r.multi.Q.length === N);
    check("Q = i · Ae por celda (rel ≤ 1e-6) y máx dentro del campo = Q pico de stats", dq <= 1e-6 && rel(mx, r.stats.inicial.qPicoMaxM3s) <= 1e-6, `máx Q ${mx.toFixed(4)} m³/s · max rel ${dq.toExponential(2)}`); }
  // recálculo por lluvia: lineal en Ae y mucho más barato
  const t1 = performance.now(); const r2 = resultadoDe(full.cache, 100, P); const msRain = performance.now() - t1;
  check("lluvia ×2 → v y Q mayores (Q exactamente ×2)", r2.stats.inicial.vMediaMs > r.stats.inicial.vMediaMs && rel(r2.stats.inicial.qPicoMaxM3s, 2 * r.stats.inicial.qPicoMaxM3s) < 1e-12);

  // --- tiempos y estadísticos que pide el reporte
  seccion("Tiempos y estadísticos (campo sintético, " + meta.nx + "×" + meta.ny + " celdas, node " + process.version + ", " + process.platform + "/" + process.arch + ")");
  const mm = st.ms;
  console.log(`  pipeline completo (mediana + relleno + MFD + clases + acumulación ×2 + Manning ×2): ${msPipe.toFixed(0)} ms`);
  console.log(`    relleno ${mm.relleno.toFixed(0)} · pesos ${mm.pesos.toFixed(0)} · dir+pendiente ${mm.dirPendiente.toFixed(0)} · clases ×2 ${mm.clases.toFixed(0)} · acumulación ×2 ${mm.acumulacion.toFixed(0)} · evaluar ${mm.evaluar.toFixed(0)} ms`);
  console.log(`  recálculo por cambio de lluvia: ${msRain.toFixed(0)} ms`);
  check("pipeline < 1500 ms (objetivo PLAN §5)", msPipe < 1500, msPipe.toFixed(0) + " ms");
  const f = (x, d = 3) => x.toFixed(d);
  console.log("  tabla JS vs Python:");
  console.log("    estadístico                 JS          Python");
  const fila = (nom, js, py, d = 4) => console.log("    " + nom.padEnd(26) + f(js, d).padEnd(12) + py);
  fila("campo (ha)", st.campoHa, mj.campo_ha, 2);
  fila("v media inicial (m/s)", st.inicial.vMediaMs, mj.inicial.v_media_ms);
  fila("v media multi (m/s)", st.multi.vMediaMs, mj.multi.v_media_ms);
  fila("v p95 inicial (m/s)", st.inicial.vP95Ms, mj.inicial.v_p95_ms);
  fila("v p95 multi (m/s)", st.multi.vP95Ms, mj.multi.v_p95_ms);
  fila("ha v>0,3 inicial", st.inicial.haVMayor, mj.inicial.ha_v_mayor_0_3, 2);
  fila("ha v>0,3 multi", st.multi.haVMayor, mj.multi.ha_v_mayor_0_3, 2);
  fila("ha frena ≥16 %", st.frenaHa, mj.frena_ha, 2);
  fila("Q pico inicial (m³/s)", st.inicial.qPicoMaxM3s, mj.inicial.Q_pico_max_campo_m3s);
  fila("Q pico multi (m³/s)", st.multi.qPicoMaxM3s, mj.multi.Q_pico_max_campo_m3s);
  fila("reducción v media (%)", st.reduccionVMediaPct, mj.reduccion_v_media_pct, 2);
  // F, Ae, v resumen
  const maxAe = esc.inicial.Ae.reduce((a, b) => Math.max(a, b), 0), maxAeR = A.inicial_Ae.reduce((a, b) => Math.max(a, b), 0);
  console.log(`    max Ae inicial (ha)         ${(maxAe / 1e4).toFixed(2).padEnd(12)}${(maxAeR / 1e4).toFixed(2)}`);
  console.log(`    max|ΔF| (m)                 ${dFmax.toExponential(2)}`);
}

console.log(`\n${ok} ok · ${mal} con falla · ${saltados} avisos/saltados · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(mal ? 1 : 0);
