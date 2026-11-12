/* heightfield.js · A6 · Terreno (spike A6-1, pensado para pasar a app/js/terrain/ en la Ola 2)
 *
 * DEM terrarium (AWS) -> grilla de alturas del campo -> heightAt(lon,lat) bilineal + reliefStats().
 *
 * - Sin dependencias (ni Three ni MapLibre). Módulo ES.
 * - Terrarium: h = R*256 + G + B/256 - 32768 (metros sobre el nivel del mar, EGM96 aprox.).
 * - Fuente: Mapzen/Tilezen "Terrain Tiles" en el bucket público elevation-tiles-prod de AWS.
 *   Mezcla SRTM (1 arcseg, ~30 m), GMTED, ETOPO1. En esta zona (Argentina) sale de SRTM.
 *   Atribución exigida: ver ATTRIBUTION.
 *
 * Convención de píxel: el valor del píxel (i,j) se interpreta ubicado en (i+0.5, j+0.5) cuando
 * `pixelCenter` es true (centro del píxel) o en (i, j) cuando es false (DEFAULT: esquina superior izquierda,
 * que es lo que usa MapLibre en DEMData.getElevationAt). El spike midió cuál coincide con la malla.
 */

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const ATTRIBUTION =
  "Terrain Tiles: Mapzen/Tilezen sobre AWS Open Data. SRTM (NASA/USGS), GMTED2010 (USGS), ETOPO1 (NOAA). " +
  "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";

const TS = 256;                     // tamaño de tile terrarium
const D2R = Math.PI / 180;

/* lon/lat -> píxel global (flotante) a zoom z, tiles de 256 px, Web Mercator */
export function lonLatToPixel(lon, lat, z) {
  const n = TS * Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

async function decodeTile(url) {
  // timeout: un tile colgado no debe frenar el arranque del visor (initTerrain cae a "sin terreno" si algo falla)
  const res = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("terrarium " + res.status + " " + url);
  const blob = await res.blob();
  // sin conversión de color ni premultiplicado: los canales son datos, no color
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = (typeof OffscreenCanvas !== "undefined")
    ? new OffscreenCanvas(TS, TS)
    : Object.assign(document.createElement("canvas"), { width: TS, height: TS });
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, TS, TS).data;
  const out = new Float32Array(TS * TS);
  for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
  return out;
}

export class Heightfield {
  constructor(o) { Object.assign(this, o); }

  /* altura (m) en lon/lat, interpolación bilineal; fuera de la grilla cargada se clampa al borde */
  heightAt(lon, lat) {
    const p = lonLatToPixel(lon, lat, this.z);
    const off = this.pixelCenter ? 0.5 : 0;
    let fx = p.x - this.px0 - off, fy = p.y - this.py0 - off;
    fx = Math.min(Math.max(fx, 0), this.w - 1.0001);
    fy = Math.min(Math.max(fy, 0), this.h - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const g = this.data, w = this.w, k = j * w + i;
    const a = g[k], b = g[k + 1], c = g[k + w], d = g[k + w + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /* Estadísticos de relieve sobre el bbox (o sobre los puntos que acepte `mask(lon,lat)`).
   *
   * El DEM (SRTM) tiene ruido vertical de varios metros en llanura (copas de árboles, edificios,
   * picos aislados de +10 m): sin filtrar, una pampa plana da "pendiente p95 = 8%". Por eso:
   *   1. se muestrea cada `stepM` m (30 = resolución nativa de SRTM);
   *   2. `despeckle` (default true): mediana 3x3 sobre esa grilla, mata los picos aislados;
   *   3. la pendiente es la diferencia central sobre una línea de base de `baselineM` m
   *      (default 120): mide el relieve del terreno, no el ruido de píxel a píxel.
   * Devuelve metros y % (pendiente = tan(ángulo)*100). Con despeckle=false y baselineM=stepM
   * se obtiene la versión "cruda" (útil solo para ver cuánto ruido hay). */
  reliefStats({ stepM = 30, mask = null, despeckle = true, baselineM = 120 } = {}) {
    const [w, s, e, n] = this.bbox;
    const latC = (s + n) / 2;
    const dLat = stepM / 110574, dLon = stepM / (111320 * Math.cos(latC * D2R));
    const nx = Math.max(5, Math.floor((e - w) / dLon)), ny = Math.max(5, Math.floor((n - s) / dLat));
    let H = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = this.heightAt(w + i * dLon, n - j * dLat);
    if (despeckle) {
      const M = new Float32Array(H), buf = new Float32Array(9);
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        let c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) buf[c++] = H[(j + dj) * nx + i + di];
        buf.sort(); M[j * nx + i] = buf[4];
      }
      H = M;
    }
    const kb = Math.max(1, Math.round(baselineM / stepM));
    const hs = [], sl = [], pts = [];
    for (let j = kb; j < ny - kb; j++) for (let i = kb; i < nx - kb; i++) {
      if (mask && !mask(w + i * dLon, n - j * dLat)) continue;
      const k = j * nx + i;
      hs.push(H[k]); pts.push(i, j);
      const gx = (H[k + kb] - H[k - kb]) / (2 * kb * stepM), gy = (H[k + kb * nx] - H[k - kb * nx]) / (2 * kb * stepM);
      sl.push(Math.hypot(gx, gy) * 100);
    }
    const N = hs.length;
    if (!N) return { n: 0, rango: 0, desvio: 0, pendienteP95: 0 };
    const q = (arr, p) => { const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))]; };
    let sum = 0; for (const v of hs) sum += v;
    const mean = sum / N;
    let v2 = 0; for (const v of hs) v2 += (v - mean) * (v - mean);
    const min = q(hs, 0), max = q(hs, 1);
    // Residuo respecto del mejor plano (inclinación regional): lo que queda es el relieve local.
    // Mínimos cuadrados 3x3 sobre (i, j, 1), centrado.
    let mi = 0, mj = 0; for (let t = 0; t < N; t++) { mi += pts[2 * t]; mj += pts[2 * t + 1]; } mi /= N; mj /= N;
    let sii = 0, sjj = 0, sij = 0, sih = 0, sjh = 0;
    for (let t = 0; t < N; t++) { const a = pts[2 * t] - mi, b = pts[2 * t + 1] - mj, c = hs[t] - mean; sii += a * a; sjj += b * b; sij += a * b; sih += a * c; sjh += b * c; }
    const det = sii * sjj - sij * sij || 1, ca = (sih * sjj - sjh * sij) / det, cb = (sjh * sii - sih * sij) / det;
    const res = hs.map((v, t) => v - mean - ca * (pts[2 * t] - mi) - cb * (pts[2 * t + 1] - mj));
    let r2 = 0; for (const v of res) r2 += v * v;
    let sm = 0; for (const v of sl) sm += v;
    return {
      n: N, stepM, baselineM, despeckle,
      min, max, media: mean,
      rango: max - min,                       // máximo - mínimo (de la grilla filtrada)
      rangoP2P98: q(hs, 0.98) - q(hs, 0.02),  // robusto a picos/hoyos aislados
      desvio: Math.sqrt(v2 / N),
      inclinacionRegionalPct: Math.hypot(ca, cb) / stepM * 100,   // pendiente del plano de mejor ajuste
      desvioResidual: Math.sqrt(r2 / N),                          // desvío tras restar ese plano
      rangoResidualP2P98: q(res, 0.98) - q(res, 0.02),
      pendienteMedia: sm / N,
      pendienteP95: q(sl, 0.95),
      pendienteMax: q(sl, 1)
    };
  }
}

/* Carga los tiles que cubren bbox=[oeste,sur,este,norte] a zoom z y arma el mosaico.
 * opts: { z=13 (recomendado: ver handoff A6-1; z14 pesa 4x más y no aporta información), url=TERRARIUM_URL, pixelCenter=false } */
export async function loadHeightfield(bbox, opts = {}) {
  const z = opts.z ?? 13, url = opts.url ?? TERRARIUM_URL;
  const pixelCenter = opts.pixelCenter ?? false;   // medido: la esquina (false) coincide con MapLibre al 100%
  const [w, s, e, n] = bbox;
  const a = lonLatToPixel(w, n, z), b = lonLatToPixel(e, s, z);
  const x0 = Math.floor((a.x - 2) / TS), x1 = Math.floor((b.x + 2) / TS);
  const y0 = Math.floor((a.y - 2) / TS), y1 = Math.floor((b.y + 2) / TS);
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const W = tw * TS, Hh = th * TS;
  const data = new Float32Array(W * Hh);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    jobs.push(decodeTile(url.replace("{z}", z).replace("{x}", tx).replace("{y}", ty)).then(t => {
      const ox = (tx - x0) * TS, oy = (ty - y0) * TS;
      for (let r = 0; r < TS; r++) data.set(t.subarray(r * TS, (r + 1) * TS), (oy + r) * W + ox);
    }));
  }
  await Promise.all(jobs);
  return new Heightfield({ bbox, z, pixelCenter, data, w: W, h: Hh, px0: x0 * TS, py0: y0 * TS, tiles: tw * th });
}
