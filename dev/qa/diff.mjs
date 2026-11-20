// Diferencia de píxeles entre dos PNG o dos carpetas de capturas (sin dependencias: PNG con zlib de Node).
// Uso: node diff.mjs <A> <B> [--out <dir>] [--threshold 0.1] [--grid 4] [--max-pct 0.5] [--json salida.json]
//   A y B: archivos .png o carpetas (se comparan los .png con el mismo nombre, recursivo).
// Métrica "pixeles distintos": delta de color YIQ de pixelmatch (sin antialiasing) > threshold.
//   threshold 0.1 por defecto (maxDelta = 35215 * t^2). Se informa también ΔE76 medio (global y por grilla NxN).
// DEUDA: el ΔE por máscara de clase (§10.1) no está; hace falta renderizar una máscara por clase GIS.
//   Mientras tanto se da ΔE global + por región de grilla.
// Código de salida 1 si alguna vista supera --max-pct.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib.mjs';

/* ---------- Decodificador PNG (8 bits, RGB/RGBA/gris, sin entrelazado) ---------- */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es PNG');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || il !== 0 || ![0, 2, 6].includes(ct)) throw new Error(`PNG no soportado (bd=${bd} ct=${ct} il=${il})`);
  const ch = { 0: 1, 2: 3, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 1) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = out[i * ch]; rgba[i * 4 + 1] = out[i * ch + 1]; rgba[i * 4 + 2] = out[i * ch + 2]; rgba[i * 4 + 3] = ch === 4 ? out[i * 4 + 3] : 255; }
  }
  return { w, h, data: rgba };
}

/* ---------- Codificador PNG RGBA (para la imagen de diferencias) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function encodePNG({ w, h, data }) {
  const chunk = (type, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- Métricas ---------- */
function yiq(r, g, b) { return [r * 0.29889531 + g * 0.58662247 + b * 0.11448223, r * 0.59597799 - g * 0.2741761 - b * 0.32180189, r * 0.21147017 - g * 0.52261711 + b * 0.31114694]; }
function srgbToLab(r, g, b) {
  const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = g2(X), fy = g2(Y), fz = g2(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function compare(A, B, { threshold = 0.1, grid = 4, outPath = null } = {}) {
  if (A.w !== B.w || A.h !== B.h) return { error: `tamaños distintos ${A.w}x${A.h} vs ${B.w}x${B.h}` };
  const maxD = 35215 * threshold * threshold;
  let diff = 0, sumE = 0;
  const gs = grid * grid, gd = new Array(gs).fill(0), ge = new Array(gs).fill(0), gn = new Array(gs).fill(0);
  const out = outPath ? Buffer.alloc(A.w * A.h * 4) : null;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    const i = (y * A.w + x) * 4;
    const [y1, i1, q1] = yiq(A.data[i], A.data[i + 1], A.data[i + 2]), [y2, i2, q2] = yiq(B.data[i], B.data[i + 1], B.data[i + 2]);
    const dy = y1 - y2, di = i1 - i2, dq = q1 - q2;
    const d = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
    const same = A.data[i] === B.data[i] && A.data[i + 1] === B.data[i + 1] && A.data[i + 2] === B.data[i + 2];
    let e = 0;
    if (!same) { const la = srgbToLab(A.data[i], A.data[i + 1], A.data[i + 2]), lb = srgbToLab(B.data[i], B.data[i + 1], B.data[i + 2]); e = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); }
    const g = Math.min(grid - 1, Math.floor(y / A.h * grid)) * grid + Math.min(grid - 1, Math.floor(x / A.w * grid));
    gn[g]++; ge[g] += e; sumE += e;
    const bad = d > maxD;
    if (bad) { diff++; gd[g]++; }
    if (out) { if (bad) { out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255; } else { const l = Math.round(y1 * 0.35 + 150); out[i] = out[i + 1] = out[i + 2] = Math.min(255, l); out[i + 3] = 255; } }
  }
  if (out) fs.writeFileSync(outPath, encodePNG({ w: A.w, h: A.h, data: out }));
  const total = A.w * A.h;
  return {
    pctDiff: +(100 * diff / total).toFixed(4), pixelsDiff: diff, deltaE_mean: +(sumE / total).toFixed(4),
    regiones: gd.map((n, k) => ({ r: Math.floor(k / grid), c: k % grid, pctDiff: +(100 * n / gn[k]).toFixed(3), deltaE: +(ge[k] / gn[k]).toFixed(3) }))
  };
}

function listPngs(dir, base = dir) {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r.push(...listPngs(p, base)); else if (e.name.endsWith('.png')) r.push(path.relative(base, p));
  }
  return r.sort();
}

// ¿Se ejecutó directo (no importado)? pathToFileURL funciona igual en Linux y en Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const a = parseArgs(process.argv.slice(2), { threshold: '0.1', grid: '4', 'max-pct': '0.5' });
  if (a._.length < 2) { console.log('Uso: node diff.mjs <A> <B> [--out dir] [--threshold 0.1] [--grid 4] [--max-pct 0.5] [--json f.json]'); process.exit(2); }
  const [pa, pb] = a._;
  const pairs = fs.statSync(pa).isDirectory()
    ? listPngs(pa).filter(f => fs.existsSync(path.join(pb, f))).map(f => [f, path.join(pa, f), path.join(pb, f)])
    : [[path.basename(pa), pa, pb]];
  if (a.out) fs.mkdirSync(a.out, { recursive: true });
  const results = {}; let worst = 0, fails = 0;
  for (const [name, fa, fb] of pairs) {
    const outPath = a.out ? path.join(a.out, name.replace(/[\\/]/g, '__').replace('.png', '.diff.png')) : null;
    const r = compare(decodePNG(fs.readFileSync(fa)), decodePNG(fs.readFileSync(fb)), { threshold: +a.threshold, grid: +a.grid, outPath });
    results[name] = r;
    if (r.error) { console.log(`${name}: ${r.error}`); fails++; continue; }
    worst = Math.max(worst, r.pctDiff);
    const flag = r.pctDiff > +a['max-pct'] ? '  <-- SUPERA' : '';
    if (flag) fails++;
    console.log(`${name.padEnd(46)} ${String(r.pctDiff).padStart(8)} %  (${r.pixelsDiff} px)  dE=${r.deltaE_mean}${flag}`);
  }
  console.log(`\n${pairs.length} pares; peor = ${worst} %; límite ${a['max-pct']} % -> ${fails ? fails + ' fuera de límite' : 'OK'}`);
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(results, null, 2));
  process.exit(fails ? 1 : 0);
}
