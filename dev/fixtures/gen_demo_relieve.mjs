#!/usr/bin/env node
/* gen_demo_relieve.mjs · campo sintético "demo_relieve" para el Simulador de escorrentía (F0)
 *
 * Uso (desde la raíz del repo, node >= 20, sin dependencias; necesita red para bajar los tiles terrarium):
 *   node dev/fixtures/gen_demo_relieve.mjs
 * Escribe fixtures/demo_relieve/{inicial,multifuncional}.geojson, fixtures/demo_relieve/meta.json y fixtures/campos.fixture.json.
 * Es determinista: semilla fija (SEMILLA) y el DEM de AWS no cambia entre corridas; el mismo comando da los mismos bytes.
 *
 * TODO ES INVENTADO. Ningún dato real entró acá: el contorno del campo, los lotes, los montes, el casco, el camino y los
 * corredores salen de números aleatorios con semilla y de reglas geométricas. Lo único "real" es el relieve (SRTM vía
 * terrarium), que es el terreno público de la zona y no tiene ninguna relación con un cliente.
 *
 * CÓMO SE ELIGIÓ EL LUGAR
 *   El simulador sólo tiene sentido donde el DEM tiene relieve. Se evaluaron CANDIDATOS (rectángulos de 2,5 × 2,2 km sobre
 *   partidos agrícolas de Tandil, Balcarce y el pie de Sierra de la Ventana, elegidos al azar sobre una grilla gruesa y
 *   refinados) con EXACTAMENTE el mismo algoritmo que usa el visor: `Heightfield.reliefStats()` importado de
 *   js/terrain/heightfield.js (no depende del DOM: sólo fetch/DecompressionStream, que Node trae). Criterio de PLAN.md §4 F0:
 *   desvioResidual > 2,7 m  o  pendienteP95 > 2,5 %. Además se descartó lo que es sierra pura (rango p2-p98 > ~40 m,
 *   pendiente p95 > ~8 %: no sería plausible como campo de labranza). Entre los que pasan se tomó el de relieve ondulado
 *   franco pero cultivable (desvío ~4 m, p95 ~4 %, rango ~25 m): el candidato marcado `elegido`. La tabla completa se
 *   imprime al correr y queda en fixtures/demo_relieve/meta.json.
 *
 * CÓMO SE ARMA LA GEOMETRÍA (todo en metros locales, x este / y norte, y se pasa a lon/lat con la misma escala que
 * `ringAreaHa` de js/core/geo.js: 111320·cos(lat) m/° en x, 110574 m/° en y)
 *   1. Contorno: polígono CONVEXO de 9 vértices (~480 ha) con jitter y giro.
 *   2. Vaguadas: DEM a 30 m, mediana 3x3, relleno de depresiones (priority-flood) y D8 con acumulación de flujo. Las vaguadas
 *      principales son los cauces (acumulación >= UMBRAL_VAGUADA celdas) trazados aguas arriba desde cada salida por el
 *      afluente de mayor acumulación; se descartan los tramos cortos.
 *   3. Lotes: el contorno se corta con 2 líneas "norte-sur" y, en cada franja, 2 líneas "este-oeste" (9 lotes convexos).
 *   4. Camino (10 m), corredores (30-60 m) y montes/casco son figuras convexas. Los corredores son franjas rectas de borde a
 *      borde del campo; se ELIGEN buscando, por barrido de ángulo y posición, las que cruzan más vaguadas principales de
 *      forma transversal y con más acumulación (ver `elegirCorredor`). Qué vaguadas cruza cada uno queda en meta.json.
 *   5. Partición: la cobertura de cada escenario es una partición exacta del campo. Prioridad camino > corredores > lotes;
 *      los montes, el casco y los parches son huecos de un lote. Se verifica por área (Σ Sup = área del campo) y por
 *      muestreo (cada punto cae en exactamente una unidad).
 *   6. Macroambientes (z1/z2/z3): por terciles de la pendiente media de cada lote sobre el DEM (z1 = más llano).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHeightfield } from "../../js/terrain/heightfield.js";
import { mulberry32, pointInPolygon } from "../../js/core/geo.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMILLA = 20261121;
const rng = mulberry32(SEMILLA);
const R = (a, b) => a + (b - a) * rng();

/* ---------- 1. Candidatos de lugar ---------- */
const CAND_W = 2500, CAND_H = 2200;   // m, rectángulo de evaluación
const CANDIDATOS = [
  { id: "tandil-N",      zona: "Tandil",   lat: -37.410, lon: -59.250, elegido: true },
  { id: "tandil-NE",     zona: "Tandil",   lat: -37.410, lon: -59.170 },
  { id: "tandil-SE",     zona: "Tandil",   lat: -37.450, lon: -59.210 },
  { id: "tandil-llano",  zona: "Tandil",   lat: -37.210, lon: -59.210 },
  { id: "balcarce-SO",   zona: "Balcarce", lat: -38.040, lon: -58.470 },
  { id: "balcarce-N",    zona: "Balcarce", lat: -37.860, lon: -58.400 },
  { id: "balcarce-sierra", zona: "Balcarce", lat: -37.880, lon: -58.360 },
  { id: "ventana-O",     zona: "Ventana",  lat: -38.190, lon: -62.100 },
  { id: "ventana-E",     zona: "Ventana",  lat: -38.250, lon: -61.750 }
];
const kxy = lat => [111320 * Math.cos(lat * Math.PI / 180), 110574];

function bboxDe(lat, lon, w, h) {
  const [kx, ky] = kxy(lat);
  return [lon - w / 2 / kx, lat - h / 2 / ky, lon + w / 2 / kx, lat + h / 2 / ky];
}

const tablaCand = [];
for (const c of CANDIDATOS) {
  const hf = await loadHeightfield(bboxDe(c.lat, c.lon, CAND_W, CAND_H), { z: 13 });
  const r = hf.reliefStats();
  const fila = { ...c, desvioResidual: +r.desvioResidual.toFixed(2), pendienteP95: +r.pendienteP95.toFixed(2),
    rangoP2P98: +r.rangoP2P98.toFixed(1), media: +r.media.toFixed(0),
    cumple: r.desvioResidual > 2.7 || r.pendienteP95 > 2.5, esSierra: r.rangoP2P98 > 40 || r.pendienteP95 > 8 };
  tablaCand.push(fila);
  console.log(`candidato ${c.id.padEnd(16)} desvioResidual=${fila.desvioResidual} m  pendienteP95=${fila.pendienteP95} %  rangoP2P98=${fila.rangoP2P98} m  ${fila.cumple ? "cumple" : "NO cumple"}${fila.esSierra ? " (sierra)" : ""}${c.elegido ? "  <== elegido" : ""}`);
}
const ELEGIDO = tablaCand.find(c => c.elegido);
if (!ELEGIDO.cumple || ELEGIDO.esSierra) throw new Error("El candidato elegido no cumple el criterio de relieve");
const LAT0 = ELEGIDO.lat, LON0 = ELEGIDO.lon;
const [KX, KY] = kxy(LAT0);
const aLL = ([x, y]) => [+(LON0 + x / KX).toFixed(7), +(LAT0 + y / KY).toFixed(7)];
const deLL = ([lo, la]) => [(lo - LON0) * KX, (la - LAT0) * KY];

/* ---------- Geometría convexa (todo con semiplanos) ---------- */
const area = ring => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return a / 2; };
const ccw = ring => area(ring) < 0 ? [...ring].reverse() : ring;
/* semiplano: {nx, ny, d}: dentro si nx*x + ny*y - d >= 0. Recorta un anillo convexo (Sutherland-Hodgman). */
function recortar(ring, h) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const sa = h.nx * a[0] + h.ny * a[1] - h.d, sb = h.nx * b[0] + h.ny * b[1] - h.d;
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  return limpiar(out);
}
function limpiar(ring) {
  const o = [];
  for (const p of ring) { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) o.push(p); }
  while (o.length > 1 && Math.hypot(o[0][0] - o.at(-1)[0], o[0][1] - o.at(-1)[1]) <= 1e-6) o.pop();
  return o.length >= 3 && Math.abs(area(o)) > 1 ? o : [];   // < 1 m² no es una pieza
}
/* franja infinita de eje n·p = d y ancho w */
const franja = (ang, d, w) => {
  const nx = Math.cos(ang), ny = Math.sin(ang);
  return { nx, ny, d, w,
    izq: { nx: -nx, ny: -ny, d: -(d - w / 2) },      // n·p <= d - w/2
    der: { nx, ny, d: d + w / 2 },                    // n·p >= d + w/2
    ge: { nx, ny, d: d - w / 2 }, le: { nx: -nx, ny: -ny, d: -(d + w / 2) },
    dist: p => nx * p[0] + ny * p[1] - d };
};
/* pieza = { outer, holes[] }. Un hueco entero a un lado de la franja se queda con ese lado; si la cruza, es un error de diseño. */
function cortarPieza(pz, h) {
  const outer = recortar(pz.outer, h);
  if (!outer.length) return null;
  const holes = [];
  for (const hole of pz.holes) {
    const s = hole.map(p => h.nx * p[0] + h.ny * p[1] - h.d);
    if (s.every(v => v >= 0)) holes.push(hole);
    else if (s.some(v => v >= 0)) throw new Error("un hueco cruza un corte: reubicar monte/casco");
  }
  return { outer, holes };
}
const restarFranja = (pz, f) => [cortarPieza(pz, f.izq), cortarPieza(pz, f.der)].filter(Boolean);
const dentroFranja = (pz, f) => cortarPieza(pz, f.ge) && cortarPieza(cortarPieza(pz, f.ge), f.le);

/* ---------- 2. Contorno del campo (convexo, ~480 ha) ---------- */
const giro = R(-0.35, 0.35);                       // rad
const AX = 1420, AY = 1230;
const contorno = [];
for (let i = 0; i < 9; i++) {
  const t = (i + R(-0.18, 0.18)) / 9 * 2 * Math.PI;
  const k = R(0.93, 1.03);
  const x = Math.cos(t) * AX * k, y = Math.sin(t) * AY * k;
  contorno.push([x * Math.cos(giro) - y * Math.sin(giro), x * Math.sin(giro) + y * Math.cos(giro)]);
}
const CAMPO = ccw(contorno);
const campoHa = area(CAMPO) / 1e4;
console.log(`campo: ${campoHa.toFixed(1)} ha, giro ${(giro * 180 / Math.PI).toFixed(1)}°`);
if (campoHa < 400 || campoHa > 600) throw new Error("el campo queda fuera de 400-600 ha");
const campoLL = [...CAMPO.map(aLL)]; campoLL.push(campoLL[0]);
const xs = CAMPO.map(p => p[0]), ys = CAMPO.map(p => p[1]);
const BX = [Math.min(...xs), Math.max(...xs)], BY = [Math.min(...ys), Math.max(...ys)];
const enCampo = (x, y) => pointInPolygon([x, y], [CAMPO]);

/* ---------- 3. DEM, vaguadas ---------- */
const MARGEN = 400, STEP = 30;
const hf = await loadHeightfield([LON0 + (BX[0] - MARGEN) / KX, LAT0 + (BY[0] - MARGEN) / KY, LON0 + (BX[1] + MARGEN) / KX, LAT0 + (BY[1] + MARGEN) / KY], { z: 13 });
const heightXY = (x, y) => hf.heightAt(LON0 + x / KX, LAT0 + y / KY);
// stats de relieve sobre la grilla del campo (mismo algoritmo del visor, con máscara = contorno del campo)
const hfCampo = await loadHeightfield([LON0 + BX[0] / KX, LAT0 + BY[0] / KY, LON0 + BX[1] / KX, LAT0 + BY[1] / KY], { z: 13 });
const relieveCampo = hfCampo.reliefStats({ mask: (lo, la) => enCampo((lo - LON0) * KX, (la - LAT0) * KY) });
const relieveBBox = hfCampo.reliefStats();
console.log(`RELIEVE del campo (máscara): desvioResidual=${relieveCampo.desvioResidual.toFixed(2)} m, pendienteP95=${relieveCampo.pendienteP95.toFixed(2)} %, rangoP2P98=${relieveCampo.rangoP2P98.toFixed(1)} m, n=${relieveCampo.n}`);
console.log(`RELIEVE del bbox del campo: desvioResidual=${relieveBBox.desvioResidual.toFixed(2)} m, pendienteP95=${relieveBBox.pendienteP95.toFixed(2)} %`);

const gx0 = BX[0] - MARGEN, gy1 = BY[1] + MARGEN;
const nx = Math.ceil((BX[1] - BX[0] + 2 * MARGEN) / STEP), ny = Math.ceil((BY[1] - BY[0] + 2 * MARGEN) / STEP);
const celdaXY = (i, j) => [gx0 + i * STEP, gy1 - j * STEP];
let Hg = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const [x, y] = celdaXY(i, j); Hg[j * nx + i] = heightXY(x, y); }
{ // mediana 3x3 (como reliefStats)
  const M = new Float32Array(Hg), b = new Float32Array(9);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) b[c++] = Hg[(j + dj) * nx + i + di];
    b.sort(); M[j * nx + i] = b[4];
  }
  Hg = M;
}
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1], DD = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
// priority-flood con épsilon
const relleno = new Float64Array(nx * ny).fill(Infinity), visto = new Uint8Array(nx * ny), heap = [];
const hpush = k => { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (relleno[heap[p]] <= relleno[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
const hpop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, c = a + 1; let m = i; if (a < heap.length && relleno[heap[a]] < relleno[heap[m]]) m = a; if (c < heap.length && relleno[heap[c]] < relleno[heap[m]]) m = c; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { const k = j * nx + i; relleno[k] = Hg[k]; visto[k] = 1; hpush(k); }
while (heap.length) {
  const k = hpop(), i = k % nx, j = (k / nx) | 0;
  for (let d = 0; d < 8; d++) { const ii = i + DX[d], jj = j + DY[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const q = jj * nx + ii; if (visto[q]) continue; visto[q] = 1; relleno[q] = Math.max(Hg[q], relleno[k] + 1e-4); hpush(q); }
}
const dirD8 = new Int8Array(nx * ny).fill(-1);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  let best = 0, bd = -1;
  for (let d = 0; d < 8; d++) { const ii = i + DX[d], jj = j + DY[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const s = (relleno[j * nx + i] - relleno[jj * nx + ii]) / DD[d]; if (s > best) { best = s; bd = d; } }
  dirD8[j * nx + i] = bd;
}
const orden = Array.from({ length: nx * ny }, (_, k) => k).sort((a, b) => relleno[b] - relleno[a]);
const acc = new Float64Array(nx * ny).fill(1);
for (const k of orden) { const d = dirD8[k]; if (d < 0) continue; acc[(((k / nx) | 0) + DY[d]) * nx + (k % nx) + DX[d]] += acc[k]; }

const UMBRAL_VAGUADA = 100;      // celdas (= 9 ha de cuenca): cauce
const LARGO_MIN_VAGUADA = 500;   // m dentro del campo
const enCampoCelda = k => { const [x, y] = celdaXY(k % nx, (k / nx) | 0); return enCampo(x, y); };
// donantes de cada celda
const donantes = Array.from({ length: nx * ny }, () => []);
for (let k = 0; k < nx * ny; k++) { const d = dirD8[k]; if (d >= 0) donantes[(((k / nx) | 0) + DY[d]) * nx + (k % nx) + DX[d]].push(k); }
function trazarArriba(k) {   // aguas arriba por el donante de mayor acumulación; devuelve celdas en sentido del flujo
  const cel = [k];
  for (;;) {
    let mejor = -1, am = 0;
    for (const q of donantes[k]) if (acc[q] >= UMBRAL_VAGUADA && acc[q] > am) { am = acc[q]; mejor = q; }
    if (mejor < 0) break;
    cel.push(mejor); k = mejor;
  }
  return cel.reverse();
}
// salidas: celdas de cauce dentro del campo cuyo destino sale del campo (o no es cauce). Cada cauce propio = una vaguada.
const vaguadas = [];
const usadas = new Set();
const salidas = [];
for (let k = 0; k < nx * ny; k++) {
  if (acc[k] < UMBRAL_VAGUADA || !enCampoCelda(k)) continue;
  const d = dirD8[k]; if (d < 0) continue;
  const q = (((k / nx) | 0) + DY[d]) * nx + (k % nx) + DX[d];
  if (!enCampoCelda(q)) salidas.push(k);
}
salidas.sort((a, b) => acc[b] - acc[a]);
function agregarVaguada(inicio) {
  const cel = trazarArriba(inicio).filter(enCampoCelda);
  let largo = 0; for (let i = 1; i < cel.length; i++) { const a = celdaXY(cel[i - 1] % nx, (cel[i - 1] / nx) | 0), b = celdaXY(cel[i] % nx, (cel[i] / nx) | 0); largo += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  if (largo < LARGO_MIN_VAGUADA) return false;
  for (const c of cel) usadas.add(c);
  vaguadas.push({ cel, largo, accMax: Math.max(...cel.map(c => acc[c])), pts: cel.map(c => celdaXY(c % nx, (c / nx) | 0)) });
  return true;
}
for (const s of salidas) agregarVaguada(s);
// afluentes: desde cada confluencia con un donante de cauce que no pertenezca a una vaguada ya trazada, si es suficientemente largo
for (let pasada = 0; pasada < 3; pasada++) {
  const cand = [];
  for (const v of [...vaguadas]) for (const c of v.cel) for (const q of donantes[c]) if (!usadas.has(q) && acc[q] >= 2 * UMBRAL_VAGUADA && enCampoCelda(q)) cand.push(q);
  cand.sort((a, b) => acc[b] - acc[a]);
  for (const q of cand) if (!usadas.has(q)) agregarVaguada(q);
}
vaguadas.sort((a, b) => b.accMax - a.accMax);
vaguadas.forEach((v, i) => { v.id = "V" + (i + 1); v.accHa = +(v.accMax * STEP * STEP / 1e4).toFixed(1); });
const PRINCIPALES = vaguadas.filter(v => v.accHa >= 25).slice(0, 6);   // cuenca >= 25 ha
console.log(`vaguadas: ${vaguadas.length} tramos; principales: ` + PRINCIPALES.map(v => `${v.id}(${v.accHa} ha, ${v.largo.toFixed(0)} m)`).join(", "));
if (PRINCIPALES.length < 2) throw new Error("hay muy pocas vaguadas principales: probar otro lugar");

/* cruces de una recta (franja de eje n·p=d) con las vaguadas: cuenta transversales (>= 30°) */
function cruces(ang, d, vs = PRINCIPALES) {
  const nxv = Math.cos(ang), nyv = Math.sin(ang), tx = -nyv, ty = nxv, res = [];
  for (const v of vs) {
    const p = v.pts;
    for (let i = 3; i < p.length - 3; i++) {
      const s0 = nxv * p[i][0] + nyv * p[i][1] - d, s1 = nxv * p[i + 1][0] + nyv * p[i + 1][1] - d;
      if ((s0 >= 0) === (s1 >= 0)) continue;
      const vx = p[i + 3][0] - p[i - 3][0], vy = p[i + 3][1] - p[i - 3][1], vl = Math.hypot(vx, vy) || 1;
      const cosA = Math.abs(vx * tx + vy * ty) / vl;   // 1 = paralela a la franja
      const ang2 = Math.acos(Math.min(1, cosA)) * 180 / Math.PI;   // ángulo entre la vaguada y la franja
      if (ang2 < 30) continue;
      res.push({ id: v.id, ang: ang2, acc: acc[v.cel[i]], x: p[i][0], y: p[i][1] });
      break;   // una vez por vaguada
    }
  }
  return res;
}
/* barrido de ángulo y posición: más vaguadas distintas cruzadas (peso 1 + log10 de la acumulación), con separación mínima
   respecto de las franjas ya elegidas. `prefiere` (ids) suma bonus a las no cubiertas todavía. */
function elegirCorredor(w, previas, cubiertas) {
  let mejor = null;
  for (let a = 0; a < 180; a += 3) {
    const ang = a * Math.PI / 180;
    for (let d = -1100; d <= 1100; d += 20) {
      const cr = cruces(ang, d);
      if (!cr.length) continue;
      // el eje tiene que pasar por una parte ancha del campo (largo dentro >= 1400 m)
      let largo = 0; { const f = franja(ang, d, w); const p = recortar(CAMPO, f.ge); const q = recortar(p, f.le); if (q.length) { const pr = q.map(v => -f.ny * v[0] + f.nx * v[1]); largo = Math.max(...pr) - Math.min(...pr); } }
      if (largo < 1400) continue;
      // separación respecto de otras franjas: distancia entre ejes en el centro del campo >= 350 m si los ángulos son parecidos
      let ok = true;
      for (const p of previas) { const dAng = Math.abs(((ang - p.ang) * 180 / Math.PI + 540) % 360 - 180); const da = Math.min(dAng, 180 - dAng); if (da < 25 && Math.abs(d - p.d * Math.cos(ang - p.ang)) < 350) ok = false; }
      if (!ok) continue;
      const score = cr.reduce((s, c) => s + 1 + Math.log10(c.acc) + (cubiertas.has(c.id) ? 0 : 1.5) + c.ang / 180, 0);
      if (!mejor || score > mejor.score) mejor = { score, ang, d, cr };
    }
  }
  return mejor;
}
const CORR_DEF = [["corr-herb", 44], ["corr-le", 36], ["corr-herb", 56]];
const bandasCorr = [], cubiertas = new Set();
for (const [unidad, w] of CORR_DEF) {
  const e = elegirCorredor(w, bandasCorr, cubiertas);
  if (!e) throw new Error("no se pudo ubicar un corredor transversal a las vaguadas");
  e.cr.forEach(c => cubiertas.add(c.id));
  bandasCorr.push({ unidad, w, ang: e.ang, d: e.d, f: franja(e.ang, e.d, w), cruza: e.cr.map(c => ({ vaguada: c.id, anguloGrados: +c.ang.toFixed(0), cuencaHa: +(c.acc * STEP * STEP / 1e4).toFixed(1) })) });
}
for (const b of bandasCorr) console.log(`corredor ${b.unidad} (${b.w} m) rumbo ${(b.ang * 180 / Math.PI).toFixed(0)}° cruza: ` + b.cruza.map(c => `${c.vaguada}@${c.anguloGrados}°`).join(", "));

/* ---------- 4. Lotes, camino, casco, montes ---------- */
const angC = giro + Math.PI / 2;   // "norte-sur" del campo
const lotes = [];   // {id, outer}
{
  // dos cortes largos, dirección angC (normal = giro): franjas
  const nA = giro;   // la normal de los cortes "norte-sur" es este-oeste girada
  const ancho = BX[1] - BX[0];
  const offsA = [-ancho / 6 + R(-90, 90), ancho / 6 + R(-90, 90)].map(o => o * 1.0);
  const franjas = [
    recortar(CAMPO, { nx: -Math.cos(nA), ny: -Math.sin(nA), d: -offsA[0] }),
    recortar(recortar(CAMPO, { nx: Math.cos(nA), ny: Math.sin(nA), d: offsA[0] }), { nx: -Math.cos(nA), ny: -Math.sin(nA), d: -offsA[1] }),
    recortar(CAMPO, { nx: Math.cos(nA), ny: Math.sin(nA), d: offsA[1] })
  ];
  franjas.forEach((fr, s) => {
    const tilt = giro + Math.PI / 2 + R(-0.12, 0.12);
    const nB = tilt;   // normal de los cortes "este-oeste" de la franja
    const proy = fr.map(p => Math.cos(nB) * p[0] + Math.sin(nB) * p[1]);
    const lo = Math.min(...proy), hi = Math.max(...proy), L = hi - lo;
    const c1 = lo + L * (1 / 3) + R(-L / 14, L / 14), c2 = lo + L * (2 / 3) + R(-L / 14, L / 14);
    const trozos = [
      recortar(fr, { nx: -Math.cos(nB), ny: -Math.sin(nB), d: -c1 }),
      recortar(recortar(fr, { nx: Math.cos(nB), ny: Math.sin(nB), d: c1 }), { nx: -Math.cos(nB), ny: -Math.sin(nB), d: -c2 }),
      recortar(fr, { nx: Math.cos(nB), ny: Math.sin(nB), d: c2 })
    ];
    trozos.forEach((t, k) => lotes.push({ id: `L${s + 1}${"abc"[k]}`, outer: t }));
  });
}
const sumaLotes = lotes.reduce((s, l) => s + area(l.outer), 0);
if (Math.abs(sumaLotes - area(CAMPO)) > 1) throw new Error("los lotes no suman el campo");

// camino: franja de 10 m, rumbo largo del campo (+- unos grados), apartada de los corredores
const camino = (() => {
  for (let intento = 0; intento < 400; intento++) {
    const ang = giro + R(-0.15, 0.15), d = R(-500, 500), f = franja(ang, d, 10);
    // el eje no debe pisar a los corredores (distancia entre franjas > 60 m en el centro) ni ser casi paralelo a ellos a menos de 250 m
    let ok = true;
    for (const b of bandasCorr) { const dAng = Math.abs(((ang - b.ang) * 180 / Math.PI + 540) % 360 - 180); if (Math.min(dAng, 180 - dAng) < 20) ok = false; }
    if (ok) return f;
  }
  throw new Error("sin camino");
})();
const distAFranja = (p, f) => Math.abs(f.dist(p)) - f.w / 2;   // < 0 = adentro
const bandas = [camino, ...bandasCorr.map(b => b.f)];
const margenBandas = (p, m) => bandas.every(f => distAFranja(p, f) > m);
const dentroLoteConMargen = (ring, lote, m) => lote.outer.length && ring.every(p => {
  for (let i = 0; i < lote.outer.length; i++) { const a = lote.outer[i], b = lote.outer[(i + 1) % lote.outer.length]; const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey); if ((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / l < m) return false; }
  return true;
});
const loteDe = p => lotes.find(l => pointInPolygon(p, [l.outer]));
const rect = (cx, cy, w, h, ang) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]);
const blob = (cx, cy, r, n) => { const ph = R(0, 6.28); return Array.from({ length: n }, (_, i) => { const t = ph + i / n * 2 * Math.PI, k = r * R(0.8, 1.15); return [cx + Math.cos(t) * k, cy + Math.sin(t) * k]; }); };
const convexo = ring => { // verifica convexidad (giro siempre del mismo signo)
  let s = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length]; const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(z) < 1e-9) continue; if (s && Math.sign(z) !== s) return false; s = Math.sign(z); } return true; };
const colocados = [];   // {ring, tipo}
const distMin = (c, r) => colocados.every(o => Math.hypot(o.cx - c[0], o.cy - c[1]) > o.r + r + 150);
function colocar(tipo, r, puntaje, hacer) {
  let mejor = null;
  for (let i = 0; i < 600; i++) {
    const cx = R(BX[0], BX[1]), cy = R(BY[0], BY[1]);
    if (!enCampo(cx, cy) || !margenBandas([cx, cy], r + 30) || !distMin([cx, cy], r)) continue;
    const ring = ccw(hacer(cx, cy)); if (!convexo(ring)) continue;
    const lote = loteDe([cx, cy]); if (!lote || !dentroLoteConMargen(ring, lote, 45)) continue;
    if (!ring.every(p => bandas.every(f => distAFranja(p, f) > 25))) continue;
    const sc = puntaje(cx, cy); if (!mejor || sc > mejor.sc) mejor = { cx, cy, ring, sc, lote };
  }
  if (!mejor) throw new Error("no hay lugar para " + tipo);
  colocados.push({ ...mejor, r, tipo });
  return mejor;
}
const accEn = (x, y) => { const i = Math.round((x - gx0) / STEP), j = Math.round((gy1 - y) / STEP); return acc[j * nx + i]; };
// casco: cerca del camino (a ~40 m del borde), en un lugar alto
const angCasco = camino && Math.atan2(camino.ny, camino.nx) + Math.PI / 2;
const casco = colocar("instalaciones", 130, (x, y) => heightXY(x, y) - 0.5 * Math.abs(camino.dist([x, y])) * 0.02 - (Math.abs(camino.dist([x, y])) > 140 ? 99 : 0), (cx, cy) => rect(cx, cy, 210, 130, angCasco));
const montes = [0, 1, 2].map(() => colocar("parche-le", 90, (x, y) => heightXY(x, y) + R(0, 4), (cx, cy) => blob(cx, cy, R(75, 115), 8)));
const parchesHerb = [0, 1].map(() => colocar("parche-herb", 85, (x, y) => Math.log10(accEn(x, y)) * 8 + R(0, 2), (cx, cy) => blob(cx, cy, R(70, 100), 8)));

/* ---------- 5. Piezas por escenario ---------- */
const piezasLote = (lote, huecos, cortes) => {
  let ps = [{ outer: lote.outer, holes: huecos.filter(h => pointInPolygon(h.ring[0], [lote.outer])).map(h => [...h.ring].reverse()) }];
  for (const f of cortes) ps = ps.flatMap(p => restarFranja(p, f));   // inicial: sólo el camino; multi: camino y corredores
  return ps;
};
const polysDe = ps => ps.map(p => [p.outer, ...p.holes]);
function escenario(multi) {
  const feats = [];
  const huecosAg = [casco, ...montes, ...(multi ? parchesHerb : [])];
  // zonas por terciles de pendiente media (ver cabecera)
  for (const l of lotes) {
    const ps = piezasLote(l, huecosAg, multi ? bandas : [camino]);
    let unidad = "ag-secano";
    if (multi) unidad = "ag-secano-" + l.zona;
    feats.push({ unidad, polys: polysDe(ps), lote: l.id });
  }
  feats.push({ unidad: "instalaciones", polys: [[casco.ring]] });
  montes.forEach(m => feats.push({ unidad: "parche-le", polys: [[m.ring]] }));
  // camino: franja ∩ campo
  const cam = recortar(recortar(CAMPO, camino.ge), camino.le);
  feats.push({ unidad: "camino", polys: [[cam]] });
  if (multi) {
    parchesHerb.forEach(m => feats.push({ unidad: "parche-herb", polys: [[m.ring]] }));
    bandasCorr.forEach((b, i) => {
      let ps = [{ outer: recortar(recortar(CAMPO, b.f.ge), b.f.le), holes: [] }];
      for (const f of [camino, ...bandasCorr.slice(0, i).map(x => x.f)]) ps = ps.flatMap(p => restarFranja(p, f));
      feats.push({ unidad: b.unidad, polys: polysDe(ps), corredor: `C${i + 1}` });
    });
  }
  return feats;
}
// macroambientes: pendiente media del lote sobre el DEM
for (const l of lotes) {
  let s = 0, n = 0;
  for (let y = BY[0]; y <= BY[1]; y += 45) for (let x = BX[0]; x <= BX[1]; x += 45) if (pointInPolygon([x, y], [l.outer])) {
    const gxx = (heightXY(x + 60, y) - heightXY(x - 60, y)) / 120, gyy = (heightXY(x, y + 60) - heightXY(x, y - 60)) / 120; s += Math.hypot(gxx, gyy) * 100; n++;
  }
  l.pend = s / Math.max(1, n);
}
[...lotes].sort((a, b) => a.pend - b.pend).forEach((l, i) => { l.zona = "z" + (1 + Math.floor(i / (lotes.length / 3))); });

/* ---------- Salida GeoJSON + verificaciones ---------- */
const haPoly = poly => (Math.abs(area(poly[0])) - poly.slice(1).reduce((s, h) => s + Math.abs(area(h)), 0)) / 1e4;
function aGeoJSON(feats, nombre) {
  const out = { type: "FeatureCollection", name: nombre, features: [] };
  for (const f of feats) {
    const polys = f.polys.map(poly => poly.map((ring, k) => {
      const r = k === 0 ? ccw(ring) : [...ccw(ring)].reverse();   // exterior antihorario, huecos horarios
      const ll = r.map(aLL); ll.push(ll[0]); return ll;
    }));
    const sup = polys.reduce((s, poly) => s + haPoly(poly.map(r => r.slice(0, -1).map(deLL))), 0);
    out.features.push({ type: "Feature", properties: { UNIDAD: f.unidad, Sup: +sup.toFixed(4), ...(f.lote ? { Lote: f.lote } : {}), ...(f.corredor ? { Corredor: f.corredor } : {}) }, geometry: { type: "MultiPolygon", coordinates: polys } });
  }
  return out;
}
const segCruza = (p, q, r, s) => {   // cruce propio (no cuenta extremos compartidos)
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p, q, r), d2 = o(p, q, s), d3 = o(r, s, p), d4 = o(r, s, q);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
};
function anilloSimple(r) {   // r cerrado
  const n = r.length - 1;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segCruza(r[i], r[i + 1], r[j], r[j + 1])) return false; }
  return true;
}
function validar(fc, nombre, classify) {
  let sumaHa = 0; const polys = [];
  for (const f of fc.features) {
    if (f.geometry.type !== "MultiPolygon") throw new Error("no es MultiPolygon");
    const cls = classify(f.properties);
    f.properties._cls = cls;
    for (const poly of f.geometry.coordinates) {
      const m = poly.map(r => r.map(deLL));
      for (const r of m) { if (!anilloSimple(r)) throw new Error(`${nombre}: anillo con autointersección en ${f.properties.UNIDAD}`); }
      for (const h of m.slice(1)) if (!h.every(p => pointInPolygon(p, [m[0]]))) throw new Error(`${nombre}: hueco fuera del exterior en ${f.properties.UNIDAD}`);
      polys.push({ cls, u: f.properties.UNIDAD, m });
    }
    const supCalc = f.geometry.coordinates.reduce((s, poly) => s + haPoly(poly.map(r => r.slice(0, -1).map(deLL))), 0);
    if (Math.abs(supCalc - f.properties.Sup) > 1e-3) throw new Error("Sup no coincide");
    sumaHa += f.properties.Sup;
  }
  if (Math.abs(sumaHa - campoHa) > 0.02) throw new Error(`${nombre}: Σ Sup ${sumaHa.toFixed(3)} ≠ campo ${campoHa.toFixed(3)} ha`);
  // cada punto del campo cae en exactamente una unidad
  let malos = 0, total = 0;
  for (let y = BY[0] + 3.7; y < BY[1]; y += 9.3) for (let x = BX[0] + 2.9; x < BX[1]; x += 9.3) {
    if (!enCampo(x, y)) continue;
    total++;
    const n = polys.filter(p => pointInPolygon([x, y], p.m)).length;
    if (n !== 1) malos++;
  }
  if (malos > total * 2e-4) throw new Error(`${nombre}: ${malos}/${total} puntos con 0 o 2+ unidades`);
  return { sumaHa: +sumaHa.toFixed(2), puntosMuestreados: total, puntosAmbiguos: malos };
}
// classify() REAL de js/map/data.js (data.js importa MapLibre, así que se extrae el texto de la función y se evalúa)
const srcData = readFileSync(join(RAIZ, "js/map/data.js"), "utf8");
const m = srcData.match(/export function classify\(props\) \{[\s\S]*?\n\}\n/);
const classify = new Function(m[0].replace("export function classify", "return function classify") + "\n")();
const ESPERADA = { "ag-secano": "agri", "ag-secano-z1": "zona1", "ag-secano-z2": "zona2", "ag-secano-z3": "zona3", "corr-herb": "corr-herb", "corr-le": "corr-le", "parche-herb": "parche-herb", "parche-le": "parche-le", "instalaciones": "instalaciones", "camino": "camino" };

const ini = aGeoJSON(escenario(false), "demo_relieve_inicial");
const mul = aGeoJSON(escenario(true), "demo_relieve_multifuncional");
const vIni = validar(ini, "inicial", classify), vMul = validar(mul, "multifuncional", classify);
for (const fc of [ini, mul]) for (const f of fc.features) {
  if (ESPERADA[f.properties.UNIDAD] !== f.properties._cls) throw new Error(`classify(${f.properties.UNIDAD}) = ${f.properties._cls}`);
  delete f.properties._cls;
}
// los corredores deben cruzar las vaguadas que dicen cruzar (comprobado sobre la geometría final)
const corrMeta = bandasCorr.map((b, i) => {
  const f = mul.features.find(x => x.properties.Corredor === `C${i + 1}`);
  const polys = f.geometry.coordinates.map(p => p.map(r => r.map(deLL)));
  const toca = PRINCIPALES.filter(v => v.pts.some(p => polys.some(poly => pointInPolygon(p, poly)))).map(v => v.id);
  const declaradas = b.cruza.map(c => c.vaguada);
  if (!declaradas.every(id => toca.includes(id))) throw new Error(`corredor C${i + 1}: la geometría final no toca ${declaradas} (toca ${toca})`);
  return { id: `C${i + 1}`, UNIDAD: b.unidad, anchoM: b.w, rumboGrados: +(((b.ang * 180 / Math.PI) + 90) % 180).toFixed(0), cruza: b.cruza, supHa: f.properties.Sup };
});
if (corrMeta.length < 3 || new Set(corrMeta.flatMap(c => c.cruza.map(x => x.vaguada))).size < 2) throw new Error("los corredores no cubren al menos 2 vaguadas");

const dir = join(RAIZ, "fixtures", "demo_relieve");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "inicial.geojson"), JSON.stringify(ini) + "\n");
writeFileSync(join(dir, "multifuncional.geojson"), JSON.stringify(mul) + "\n");
const meta = {
  aviso: "Campo SINTÉTICO generado por dev/fixtures/gen_demo_relieve.mjs. Todo inventado salvo el relieve público (SRTM/terrarium).",
  semilla: SEMILLA,
  lugar: { zona: ELEGIDO.zona, centro: { lat: LAT0, lon: LON0 }, candidatoId: ELEGIDO.id },
  campoHa: +campoHa.toFixed(1),
  reliefStats: { mascaraCampo: pick(relieveCampo), bboxCampo: pick(relieveBBox) },
  candidatos: tablaCand,
  vaguadasPrincipales: PRINCIPALES.map(v => ({ id: v.id, cuencaMaxHa: v.accHa, largoEnCampoM: +v.largo.toFixed(0) })),
  corredores: corrMeta,
  macroambientes: lotes.map(l => ({ lote: l.id, zona: l.zona, pendienteMediaPct: +l.pend.toFixed(2) })),
  validacion: { inicial: vIni, multifuncional: vMul }
};
function pick(r) { return { n: r.n, desvioResidual: +r.desvioResidual.toFixed(2), pendienteP95: +r.pendienteP95.toFixed(2), rangoP2P98: +r.rangoP2P98.toFixed(1), media: +r.media.toFixed(1), inclinacionRegionalPct: +r.inclinacionRegionalPct.toFixed(2) }; }
writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
const campos = [{ id: "demo_relieve", nombre: "Campo sintético (relieve)", cliente: "Demo", maxzoom: 17, pathInicial: "demo_relieve/inicial.geojson", pathMulti: "demo_relieve/multifuncional.geojson" }];
writeFileSync(join(RAIZ, "fixtures", "campos.fixture.json"), JSON.stringify(campos, null, 2) + "\n");

const porU = fc => { const o = {}; for (const f of fc.features) o[f.properties.UNIDAD] = +((o[f.properties.UNIDAD] || 0) + f.properties.Sup).toFixed(1); return o; };
console.log("inicial (ha):", JSON.stringify(porU(ini)), vIni);
console.log("multifuncional (ha):", JSON.stringify(porU(mul)), vMul);
console.log("OK");
