/* ============ Sistema de render: suelo por shader (I) y surcos de cultivo (J) ============
   Dueño: A4 (Ola 2). Contrato: §6.3. Ficha: PLAN §9.A4-I/J. Handoff: realismo/handoffs/a4-suelo.md

   I · SUELO. Los polígonos corr-herb / parche-herb / bajo (y parche-le / corr-le como base bajo
       los árboles) se triangulan en metros de escena con THREE.ShapeUtils (earcut; huecos respetados;
       la geometría GIS no se toca: los vértices son los del anillo). Sin terreno queda casi el
       triángulo crudo del earcut (maxEdgeFlat); con terreno se refina por puntos medios (maxEdge) para
       apoyar cada vértice en heightAt. La distancia al borde (revelado) va horneada en una textura.
       Shader: color base de §4 con variantes seco/verde por ruido en coordenadas de MUNDO a 3
       escalas (≈0,7 / 4 / 25 m), AO de borde (franja de 1–2 m, geometría aparte), niebla y fade de
       shaderlib, luz de A1 (MeshLambert + hemisferio + sol).
       a4-g2: el ruido sale de UNA textura 512² generada en runtime (value noise periódico, 3 canales
       = 3 escalas; mipmaps = antialias gratis, sin fwidth ni hash por fragmento): período ≥ 22 m en la
       octava fina, rotaciones distintas por escala, sin repetición visible.
       Crecimiento: SOLO "revelado" (decisión G2): desde el eje, máscara por profundidad = distancia al
       borde normalizada por polígono. La extrusión (losa con paredes) se retiró (commit 9d7ed10).
   J · SURCOS. Malla por lote agrícola dibujada SOBRE el satélite con blending multiplicativo:
       modula la luminancia, no el color. a4-g2: antialias analítico por derivadas (huella del píxel en
       períodos) con fundido anticipado y bandas de 8 surcos con fase deformada (sin moiré). Dirección = eje principal del lote (PCA área-ponderada de la
       malla triangulada, momento de segundo orden): es textura de render, NO dato GIS.

   T9: las capas MapLibre *-herb-ext y *-woody-base quedan con opacidad 0,001 (clic/popup);
       *-herb-pattern (no clicable, interact.js no la consulta) queda en 0 para ahorrar su pasada de
       profundidad. Eso se hace desde setOpacity() (corre después de applyOpacity de layers.js).
   Dibujo: sin prueba ni escritura de profundidad (las extrusiones MapLibre invisibles escriben
       profundidad hasta 0,6–1,2 m y taparían un suelo plano); en la lista opaca con renderOrder
       negativo (primero), así árboles y pasto, que van después, quedan encima.
   A6 (terreno 3D): con terreno activo las extrusiones MapLibre pasan a `fill` drapeado (layers.js, T14) y el
       suelo/surcos SÍ usan prueba de profundidad (la malla del terreno ya está en el depth buffer cuando
       dibuja esta capa) + polygonOffset, apoyados en heightAt, con normales del relieve para que reciban el sol
       como la ladera real. Sin terreno nada cambia. */
import * as THREE from "three";
import { A4_FURROWS, A4_GROUND, WOODY_BASE } from "../../core/config.js?v=20261113";
import { HOME_VIEW, params } from "../../core/state.js?v=20261113";
import { quality } from "../../core/quality.js?v=20261113";
import { map } from "../../map/style.js?v=20261113";
import { chainShader } from "./chunks.js?v=20261113";
import { extOpacityProp } from "../../terrain/terrain.js?v=20261113";   // A6: relieve

/* ---------- parámetros efectivos (config + URL) ---------- */
const DBG = params.has("qa") || params.has("debug");
const furrowsWanted = () => {
  const q = DBG ? params.get("surcos") : null;   // solo ?qa/?debug
  return q === "0" ? false : q === "1" ? true : A4_FURROWS.enabled;
};
const groundWanted = () => A4_GROUND.enabled && !(DBG && params.get("a4") === "off")   // ?a4=off: solo ?qa/?debug;

/* ---------- ruido: textura generada en runtime (a4-g2) ----------
   Value noise periódico (lattice NOISE_C×NOISE_C, interpolación smoothstep: la misma estadística que el hash
   por fragmento anterior) en NOISE_N² texels, un canal por escala (R fina, G media, B gruesa). Mipmaps +
   filtro trilineal reemplazan el fundido por fwidth: a distancia cada octava tiende sola a su media 0,5.
   Sin repetición visible: período real = NOISE_C × tamaño de celda (≥ 22 m en la fina, 100 m la media, 800 m la
   gruesa) y las tres escalas van rotadas distinto. Costo: ~25 ms una vez, 1 MB de GPU. */
const NOISE_N = 512, NOISE_C = 32;
let noiseTex = null;
function getNoiseTex() {
  if (noiseTex) return noiseTex;
  const N = NOISE_N, C = NOISE_C, data = new Uint8Array(N * N * 4);
  let seed = 0x1badb002;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const i0 = new Int32Array(N), i1 = new Int32Array(N), sw = new Float32Array(N);
  for (let x = 0; x < N; x++) { const u = x * C / N, i = Math.floor(u), f = u - i; i0[x] = i; i1[x] = (i + 1) % C; sw[x] = f * f * (3 - 2 * f); }
  for (let ch = 0; ch < 3; ch++) {
    const L = new Float32Array(C * C); for (let k = 0; k < L.length; k++) L[k] = rnd();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = L[i0[y] * C + i0[x]], b = L[i0[y] * C + i1[x]], c = L[i1[y] * C + i0[x]], d = L[i1[y] * C + i1[x]];
      const top = a + (b - a) * sw[x], bot = c + (d - c) * sw[x];
      data[(y * N + x) * 4 + ch] = Math.round((top + (bot - top) * sw[y]) * 255);
    }
  }
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return (noiseTex = t);
}
/* Muestreo en GLSL: u = metros / (tamaño de celda × NOISE_C). */
const GLSL_NOISE_TEX = "uniform sampler2D tNoise;\n";
const nu = cell => (1 / (cell * NOISE_C)).toFixed(7);

/* ---------- geometría ---------- */
const MAXC = 8;   // clases de suelo máximas en los uniform arrays
const CLASS_LIST = Object.keys(A4_GROUND.classes);

function dedupRing(ring, toScene) {
  const out = [];
  for (const c of ring) {
    const [x, z] = toScene(c[0], c[1]);
    const l = out[out.length - 1];
    if (l && Math.abs(l[0] - x) < 1e-3 && Math.abs(l[1] - z) < 1e-3) continue;
    out.push([x, z]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-3 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-3) out.pop();
  return out;
}

function ringArea2(r) {   // 2×área con signo (x,z)
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a;
}

/* Triangula un polígono (anillos en metros de escena). Devuelve { P, T, rings } o null. */
function triangulatePoly(rings) {
  if (rings.length === 0 || rings[0].length < 3) return null;
  if (Math.abs(ringArea2(rings[0])) < 2) return { tiny: true };   // < 1 m²: no vale la pena
  const v2 = r => r.map(p => new THREE.Vector2(p[0], p[1]));
  const contour = v2(rings[0]);
  const holes = rings.slice(1).filter(r => r.length >= 3).map(v2);
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return null; }
  if (!faces || !faces.length) return null;
  const P = [];
  for (const p of contour) P.push([p.x, p.y]);
  for (const h of holes) for (const p of h) P.push([p.x, p.y]);
  return { P, T: faces.map(f => [f[0], f[1], f[2]]) };
}

/* Refinamiento conforme por puntos medios: parte toda arista más larga que L (las dos caras que
   la comparten la parten igual, sin T-junctions). */
function refine(P, T, L) {
  const L2 = L * L;
  const long = (a, b) => { const dx = P[a][0] - P[b][0], dz = P[a][1] - P[b][1]; return dx * dx + dz * dz > L2; };
  for (let pass = 0; pass < 14; pass++) {
    const mid = new Map();
    const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    const mp = (a, b) => {
      const k = key(a, b); let m = mid.get(k);
      if (m === undefined) { m = P.length; P.push([(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2]); mid.set(k, m); }
      return m;
    };
    const out = []; let any = false;
    for (const [a, b, c] of T) {
      const lab = long(a, b), lbc = long(b, c), lca = long(c, a), n = lab + lbc + lca;
      if (!n) { out.push([a, b, c]); continue; }
      any = true;
      if (n === 3) {
        const ab = mp(a, b), bc = mp(b, c), ca = mp(c, a);
        out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      } else if (n === 1) {
        let [p, q, r] = lab ? [a, b, c] : lbc ? [b, c, a] : [c, a, b];   // (p,q) = arista larga
        const m = mp(p, q);
        out.push([p, m, r], [m, q, r]);
      } else {
        // dos aristas largas: la corta es (x,y) y z el vértice opuesto
        let [x, y, z] = !lab ? [a, b, c] : !lbc ? [b, c, a] : [c, a, b];
        const my = mp(y, z), mx = mp(z, x);
        out.push([z, mx, my], [x, y, my], [x, my, mx]);
      }
    }
    T = out;
    if (!any) break;
  }
  return T;
}

/* ---------- mapa de profundidad (a4-g2) ----------
   El revelado "desde el eje" necesita la distancia al borde de cada punto del polígono, normalizada por su máximo.
   Antes salía de la malla (grilla de 40 m): ~125 k triángulos en El Carmen, la mayoría sub-píxel a distancia, y eso
   (sobre-sombreado de quads) era casi todo el costo del suelo en la Intel. Ahora se hornea UNA vez por escenario en
   una textura R8 (transformada de distancia exacta por polígono sobre una grilla de ≥ DEPTH_CELL_MIN m) y la
   geometría queda con los triángulos del earcut (sin terreno) → ~10× menos triángulos. Con terreno la malla se
   sigue refinando (maxEdge) porque ahí la altura se pide por vértice. */
const DEPTH_CELL_MIN = 4, DEPTH_MAXTEX = 1024, INF = 1e12;

/* Transformada de distancia cuadrada 1D (Felzenszwalb–Huttenlocher), f en Float64Array. */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let sx;
    for (;;) { const p = v[k]; sx = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (sx <= z[k]) k--; else break; }
    k++; v[k] = q; z[k] = sx; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/* Hornea la profundidad normalizada de un polígono (anillos en metros de escena) en la textura global.
   Devuelve dmax (m) ≈ distancia máxima al borde. map = { data, W, H, x0, z0, c }. */
function bakeDepth(map, rings) {
  const { W, H, x0, z0, c, data } = map;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const p of rings[0]) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < minz) minz = p[1]; if (p[1] > maxz) maxz = p[1]; }
  const i0 = Math.max(0, Math.floor((minx - x0) / c) - 1), i1 = Math.min(W - 1, Math.ceil((maxx - x0) / c) + 1);
  const j0 = Math.max(0, Math.floor((minz - z0) / c) - 1), j1 = Math.min(H - 1, Math.ceil((maxz - z0) / c) + 1);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  if (w < 1 || h < 1) return 0.5;
  const g = new Float64Array(w * h);   // 0 = fuera; INF = dentro
  // relleno por scanline, regla par-impar (los huecos quedan fuera)
  const xs = [];
  for (let j = 0; j < h; j++) {
    const zc = z0 + (j0 + j + 0.5) * c; xs.length = 0;
    for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const za = r[b][1], zb = r[a][1];
      if ((za <= zc) !== (zb <= zc)) xs.push(r[b][0] + (zc - za) / (zb - za) * (r[a][0] - r[b][0]));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xs[k] - x0) / c - 0.5) - i0), ib = Math.min(w - 1, Math.ceil((xs[k + 1] - x0) / c - 0.5) - 1 - i0);
      for (let i = ia; i <= ib; i++) g[j * w + i] = INF;
    }
  }
  // distancia al texel "fuera" más cercano (dos pasadas)
  const n = Math.max(w, h), col = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w; i++) { for (let j = 0; j < h; j++) col[j] = g[j * w + i]; edt1d(col, h, out, v, z); for (let j = 0; j < h; j++) g[j * w + i] = out[j]; }
  for (let j = 0; j < h; j++) { for (let i = 0; i < w; i++) col[i] = g[j * w + i]; edt1d(col, w, out, v, z); for (let i = 0; i < w; i++) g[j * w + i] = out[i]; }
  let dm = 0;
  for (let k = 0; k < g.length; k++) if (g[k] > 0) { g[k] = Math.max(0.5, Math.sqrt(g[k]) - 0.5) * c; if (g[k] > dm) dm = g[k]; }
  if (dm <= 0) return 0.5;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const d = g[j * w + i]; if (d <= 0) continue;
    data[(j0 + j) * W + (i0 + i)] = Math.max(1, Math.round(255 * Math.min(1, d / dm)));
  }
  return dm;
}

/* ---------- construcción de la malla de suelo ---------- */
function buildGroundGeometry(ctx, data, toLngLat, hasH) {
  const P_ = [], I_ = { tops: [], ribbons: [] };   // P_: floats por vértice (5): x,y,z, cls,edge
  let nv = 0, polys = 0, failed = 0, tiny = 0;
  const yAt = (x, z) => (hasH ? ctx.heightAt(...toLngLat(x, z)) : 0) + A4_GROUND.yOff;
  /* A6: normal del relieve por vértice (diferencias centrales de heightAt a ±NRM_D m) */
  const N_ = [], NRM_D = 12;
  const nrmAt = (x, z) => {
    const [lo, la] = toLngLat(x, z);
    const dLon = NRM_D / (111320 * Math.cos(la * Math.PI / 180)), dLat = NRM_D / 110574;
    const hx = ctx.heightAt(lo + dLon, la) - ctx.heightAt(lo - dLon, la), hz = ctx.heightAt(lo, la - dLat) - ctx.heightAt(lo, la + dLat);   // +z de escena = sur
    const nx = -hx / (2 * NRM_D), nz = hz / (2 * NRM_D), l = Math.hypot(nx, 1, nz);
    N_.push(nx / l, 1 / l, nz / l);
  };
  const pushV = (x, y, z, cls, edge) => {
    P_.push(x, y, z, cls, edge);
    if (hasH) nrmAt(x, z);
    return nv++;
  };
  const W = A4_GROUND.edgeAO ? A4_GROUND.edgeAO.width : 1.8;

  // --- pasada 1: triangular y juntar cajas (para dimensionar el mapa de profundidad) ---
  const items = [];
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const f of data.features) {
    const cls = f.properties._cls, ci = CLASS_LIST.indexOf(cls);
    if (ci < 0) continue;
    for (const poly of f.geometry.coordinates) {
      const rings = poly.map(r => dedupRing(r, ctx.toScene)).filter(r => r.length >= 3);
      const tri = triangulatePoly(rings);
      if (!tri) { failed++; continue; }
      if (tri.tiny) { tiny++; continue; }
      polys++;
      for (const p of rings[0]) { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0]; if (p[1] < bz0) bz0 = p[1]; if (p[1] > bz1) bz1 = p[1]; }
      items.push({ ci, rings, tri });
    }
  }
  const dmap = { W: 1, H: 1, x0: 0, z0: 0, c: 1, data: new Uint8Array(1) };
  if (items.length) {
    const c = Math.max(DEPTH_CELL_MIN, Math.max(bx1 - bx0, bz1 - bz0) / DEPTH_MAXTEX);
    dmap.c = c; dmap.x0 = bx0 - c; dmap.z0 = bz0 - c;
    dmap.W = Math.ceil((bx1 - bx0) / c) + 3; dmap.H = Math.ceil((bz1 - bz0) / c) + 3;
    dmap.data = new Uint8Array(dmap.W * dmap.H);
  }

  // --- pasada 2: profundidad horneada + geometría ---
  for (const { ci, rings, tri } of items) {
    const dmax = Math.max(0.5, bakeDepth(dmap, rings));
    const T = refine(tri.P, tri.T, hasH ? A4_GROUND.maxEdge : A4_GROUND.maxEdgeFlat);
    const P = tri.P;
    // --- tapa (cara hacia arriba) ---
    const base = nv;
    for (let k = 0; k < P.length; k++) pushV(P[k][0], yAt(P[k][0], P[k][1]), P[k][1], ci, 0);
    for (const [a, b, c] of T) {
      const cr = (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]) - (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]);
      I_.tops.push(base + a, cr > 0 ? base + b : base + c, cr > 0 ? base + c : base + b);
    }
    // --- franja de AO por anillo (solo con los vértices originales del anillo) ---
    rings.forEach((r, ri) => {
      const A = ringArea2(r), isHole = ri > 0;
      const side = (A > 0 ? 1 : -1) * (isHole ? -1 : 1);   // hacia el interior del polígono respecto de la normal izquierda
      const w = Math.min(W, dmax * 0.8), m = r.length;
      const pIn = [], qIn = [];
      for (let i = 0; i < m; i++) {
        const p0 = r[(i + m - 1) % m], p1 = r[i], p2 = r[(i + 1) % m];
        let d0x = p1[0] - p0[0], d0z = p1[1] - p0[1], l0 = Math.hypot(d0x, d0z) || 1; d0x /= l0; d0z /= l0;
        let d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
        const n0x = -d0z * side, n0z = d0x * side, n1x = -d1z * side, n1z = d1x * side;
        let mx = n0x + n1x, mz = n0z + n1z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
        const k = Math.min(2, 1 / Math.max(mx * n0x + mz * n0z, 0.5));
        pIn.push(pushV(p1[0], yAt(p1[0], p1[1]), p1[1], ci, 1));
        qIn.push(pushV(p1[0] + mx * k * w, yAt(p1[0] + mx * k * w, p1[1] + mz * k * w), p1[1] + mz * k * w, ci, 0));
      }
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const a = pIn[i], b = pIn[j], c = qIn[j], e = qIn[i];
        // franja: sentido hacia arriba
        const pu = P_.slice(a * 5, a * 5 + 3), pv = P_.slice(b * 5, b * 5 + 3), pw = P_.slice(c * 5, c * 5 + 3);
        const cr = (pv[2] - pu[2]) * (pw[0] - pu[0]) - (pv[0] - pu[0]) * (pw[2] - pu[2]);
        if (cr > 0) I_.ribbons.push(a, b, c, a, c, e); else I_.ribbons.push(a, c, b, a, e, c);
      }
    });
  }
  const dTex = new THREE.DataTexture(dmap.data, dmap.W, dmap.H, THREE.RedFormat);
  dTex.unpackAlignment = 1; dTex.magFilter = dTex.minFilter = THREE.LinearFilter; dTex.generateMipmaps = false;
  dTex.wrapS = dTex.wrapT = THREE.ClampToEdgeWrapping; dTex.needsUpdate = true;
  const g = new THREE.BufferGeometry();
  const F = new Float32Array(P_);
  const buf = new THREE.InterleavedBuffer(F, 5);
  g.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute("aG", new THREE.InterleavedBufferAttribute(buf, 2, 3));   // cls, edge (1 en el borde de la franja de AO)
  if (hasH) g.setAttribute("aNrm", new THREE.Float32BufferAttribute(N_, 3));   // A6: normales del relieve
  const idx = [...I_.tops, ...I_.ribbons];   // orden de dibujo: tapa → franja (sin depth test)
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);   // se dibuja siempre (frustumCulled=false igual)
  return { geometry: g, dTex, dmap, verts: nv, tris: idx.length / 3, topTris: I_.tops.length / 3, ribTris: I_.ribbons.length / 3, polys, failed, tiny };
}

/* ---------- material de suelo (Lambert + chunks propios sobre patch de A1) ---------- */
function makeGroundMaterial(ctx, key, hasH, dTex, dmap) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.userData.foliage = false;
  m.side = THREE.FrontSide;
  m.depthTest = false; m.depthWrite = false; m.transparent = false;
  if (hasH) {   // A6: con terreno, prueba de profundidad contra la malla de MapLibre + polygonOffset (yOff 0,04 m solo no alcanza a ras de piso: ±0,05 m de error de malla)
    m.depthTest = true;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  }
  // mezcla alfa en la lista OPACA (CustomBlending no se anula con transparent:false)
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  ctx.shaderlib.patch(m, { fog: true, fade: key });

  const dry = [], grn = [], alp = [];
  for (let i = 0; i < MAXC; i++) {
    const c = A4_GROUND.classes[CLASS_LIST[i]];
    const tn = c && c.tune ? c.tune : [1, 1, 1];
    dry.push(new THREE.Color(c ? c.dry : "#000000").multiply(new THREE.Color(...tn))); grn.push(new THREE.Color(c ? c.green : "#000000").multiply(new THREE.Color(...tn)));
    alp.push(c ? c.alpha : 1);
  }
  const U = {
    uDry: { value: dry }, uGrn: { value: grn }, uAlp: { value: alp },
    uGrow: { value: 1 }, uGain: { value: A4_GROUND.gain }, tNoise: { value: getNoiseTex() },
    tDepth: { value: dTex }, uDMap: { value: new THREE.Vector4(dmap.x0, dmap.z0, 1 / (dmap.W * dmap.c), 1 / (dmap.H * dmap.c)) },
    uNoise: { value: new THREE.Vector3(A4_GROUND.noise.fine, A4_GROUND.noise.mid, A4_GROUND.noise.coarse) },
    uAO: { value: new THREE.Vector2(A4_GROUND.edgeAO.width, A4_GROUND.edgeAO.strength) },
    uSoft: { value: new THREE.Vector2(A4_GROUND.reveal.soft, A4_GROUND.reveal.jitter) }
  };
  m.userData.a4u = U;
  // Rotaciones por escala (R, R², R³ de 36,87°) para que las 3 octavas no compartan ejes.
  const SC = [nu(0.7), nu(4), nu(25)];
  chainShader(m, hasH ? "a4ground-n" : "a4ground", sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>",
        "#include <common>\nattribute vec2 aG;\n" + (hasH ? "attribute vec3 aNrm;\n" : "") + "uniform float uAlp[" + MAXC + "];\nuniform vec3 uDry[" + MAXC + "];\nuniform vec3 uGrn[" + MAXC + "];\n" +
        "varying vec3 vWp;\nflat varying vec3 vDry;\nflat varying vec3 vGrn;\nvarying vec2 vInf;")   // vInf: edge (franja AO), alfa de clase
      .replace("#include <beginnormal_vertex>", hasH ? "vec3 objectNormal = aNrm;" : "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")   // A6: con terreno, normal del relieve
      .replace("#include <begin_vertex>",
        "vec3 transformed = vec3(position);\n" +
        "int ci = int(aG.x + 0.5);\n" +
        "vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n" +
        "vDry = uDry[ci]; vGrn = uGrn[ci]; vInf = vec2(aG.y, uAlp[ci]);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vWp;\nflat varying vec3 vDry;\nflat varying vec3 vGrn;\nvarying vec2 vInf;\n" +
        "uniform sampler2D tDepth;\nuniform vec4 uDMap;\nuniform float uGrow;\nuniform float uGain;\nuniform vec3 uNoise;\nuniform vec2 uAO;\nuniform vec2 uSoft;\n" + GLSL_NOISE_TEX)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec2 adP = vWp.xz;\n" +
        "float n1 = texture2D(tNoise, mat2(0.80, -0.60, 0.60, 0.80) * adP * " + SC[0] + ").r;\n" +
        "float n2 = texture2D(tNoise, mat2(0.28, -0.96, 0.96, 0.28) * adP * " + SC[1] + " + vec2(0.37, 0.11)).g;\n" +
        "float n3 = texture2D(tNoise, mat2(-0.352, -0.936, 0.936, -0.352) * adP * " + SC[2] + " + vec2(0.71, 0.53)).b;\n" +
        "float gmix = smoothstep(0.30, 0.70, n3 * 0.65 + n2 * 0.35);\n" +   // parches de pasto seco ↔ verde
        "vec3 adCol = mix(vDry, vGrn, gmix);\n" +
        "adCol *= (1.0 + 2.0 * (uNoise.x * (n1 - 0.5) + uNoise.y * (n2 - 0.5) + uNoise.z * (n3 - 0.5))) * uGain;\n" +
        "adCol *= 1.0 - uAO.y * smoothstep(0.0, 1.0, vInf.x);\n" +               // AO de borde (franja)
        "float adM = 1.0;\n" +
        "if (uGrow < 0.999) {\n" +                                                 // revelado desde el eje
        "  float span = 1.0 + uSoft.x + uSoft.y;\n" +
        "  float lo = 1.0 - uGrow * span;\n" +
        "  float s = texture2D(tDepth, (vWp.xz - uDMap.xy) * uDMap.zw).r + (n3 - 0.5) * 2.0 * uSoft.y;\n" +   // profundidad horneada (a4-g2)
        "  adM = uGrow <= 0.001 ? 0.0 : smoothstep(lo, lo + uSoft.x, s);\n" +
        "}\n" +
        "vec4 diffuseColor = vec4(adCol, vInf.y * adM);");
  });
  return m;
}

/* ---------- surcos (J) ---------- */
function buildFurrowGeometry(ctx, data, toLngLat, hasH) {
  const pos = [], row = [], idx = [];
  let nv = 0, lots = 0, seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const f of data.features) {
    if (!A4_FURROWS.classes.includes(f.properties._cls)) continue;
    for (const poly of f.geometry.coordinates) {
      const rings = poly.map(r => dedupRing(r, ctx.toScene)).filter(r => r.length >= 3);
      const tri = triangulatePoly(rings);
      if (!tri || tri.tiny) continue;
      const { P, T } = tri;
      // momento de segundo orden área-ponderado de la malla → eje principal del lote
      const ox = P[0][0], oz = P[0][1];
      let A = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
      for (const [a, b, c] of T) {
        const x = [P[a][0] - ox, P[b][0] - ox, P[c][0] - ox], z = [P[a][1] - oz, P[b][1] - oz, P[c][1] - oz];
        const ar = Math.abs((x[1] - x[0]) * (z[2] - z[0]) - (x[2] - x[0]) * (z[1] - z[0])) / 2;
        const Sx = x[0] + x[1] + x[2], Sz = z[0] + z[1] + z[2];
        A += ar; sx += ar * Sx / 3; sz += ar * Sz / 3;
        sxx += ar / 12 * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2] + Sx * Sx);
        szz += ar / 12 * (z[0] * z[0] + z[1] * z[1] + z[2] * z[2] + Sz * Sz);
        sxz += ar / 12 * (x[0] * z[0] + x[1] * z[1] + x[2] * z[2] + Sx * Sz);
      }
      if (A < 4) continue;
      const mx = sx / A, mz = sz / A, cxx = sxx / A - mx * mx, czz = szz / A - mz * mz, cxz = sxz / A - mx * mz;
      const th = 0.5 * Math.atan2(2 * cxz, cxx - czz);       // ángulo del eje mayor
      const ax = Math.cos(th), az = Math.sin(th), nx = -az, nz = ax;
      const phase = rnd() * A4_FURROWS.spacing * 8;
      const cx = ox + mx, cz = oz + mz, base = nv;
      // A6: con terreno, malla fina (misma arista máxima que el suelo) y cada vértice a su altura (los surcos dibujan sobre la ladera)
      const T2 = hasH ? refine(P, T, A4_GROUND.maxEdge) : T;
      for (const p of P) {
        pos.push(p[0], (hasH ? ctx.heightAt(...toLngLat(p[0], p[1])) : 0) + A4_GROUND.yOff, p[1]);
        row.push((p[0] - cx) * nx + (p[1] - cz) * nz + phase, (p[0] - cx) * ax + (p[1] - cz) * az, 0);
        nv++;
      }
      for (const [a, b, c] of T2) idx.push(base + a, base + b, base + c);
      lots++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRow", new THREE.Float32BufferAttribute(row, 3));
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  return { geometry: g, verts: nv, tris: idx.length / 3, lots };
}

function makeFurrowMaterial(ctx, hasH) {
  const F = A4_FURROWS;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uCamPos: ctx.uniforms.uCamPos,
      uFadeS: { value: 1 },
      tNoise: { value: getNoiseTex() },
      uRow: { value: new THREE.Vector4(F.spacing, F.rowAmp, F.rowFade[0], F.rowFade[1]) },
      uW: { value: new THREE.Vector4(F.rowW[0], F.rowW[1], F.bandW[0], F.bandW[1]) },
      uBandAmp: { value: F.bandAmp },
      uTram: { value: new THREE.Vector4(F.tramPeriod, F.tramGauge, F.tramWidth, F.tramAmp) },
      uTramFade: { value: new THREE.Vector2(F.tramFade[0], F.tramFade[1]) }
    },
    vertexShader:
      "attribute vec3 aRow;\nvarying vec3 vRow;\nvarying vec3 vWp;\n" +
      "void main() {\n  vRow = aRow;\n  vWp = (modelMatrix * vec4(position, 1.0)).xyz;\n" +
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
    fragmentShader:
      "precision highp float;\nvarying vec3 vRow;\nvarying vec3 vWp;\nuniform vec3 uCamPos;\nuniform float uFadeS;\n" +
      "uniform vec4 uRow;\nuniform vec4 uW;\nuniform float uBandAmp;\nuniform vec4 uTram;\nuniform vec2 uTramFade;\n" + GLSL_NOISE_TEX +
      "void main() {\n" +
      "  float d = distance(vWp, uCamPos);\n" +
      "  float fD = (1.0 - smoothstep(uRow.z, uRow.w, d)) * uFadeS;\n" +
      "  float fTram = (1.0 - smoothstep(uTramFade.x, uTramFade.y, d)) * uFadeS;\n" +
      // Antialias analítico: wR = huella del píxel en períodos de surco (derivada del parámetro de fila).
      // El surco se funde entre rowW[0] y rowW[1] (período de 10 a 3 px): nunca se muestrea cerca de Nyquist → sin moiré.
      // Las bandas (8 surcos, período ×8) toman la posta (fundido cruzado) y se funden con su propio w.
      "  float fu = max(fwidth(vRow.x), 1e-4);\n" +
      "  float wR = fu / uRow.x;\n" +
      "  float inB = smoothstep(uW.x, uW.y, wR);\n" +
      "  float aRow = fD * (1.0 - inB);\n" +
      "  float aBand = fD * inB * (1.0 - smoothstep(uW.z, uW.w, wR * 0.125));\n" +
      "  if (aRow < 0.003 && aBand < 0.003 && fTram < 0.002) discard;\n" +
      "  vec2 p = vWp.xz;\n" +
      "  float patchy = 0.55 + 0.9 * texture2D(tNoise, p * " + nu(9) + " + vec2(0.13, 0.61)).b;\n" +   // rastrojo: manchones
      "  float warp = (texture2D(tNoise, p * " + nu(45) + " + vec2(0.52, 0.27)).g - 0.5) * 5.0;\n" +    // bandas onduladas: sin paralelismo perfecto
      "  float speck = (texture2D(tNoise, p * " + nu(0.35) + ").r - 0.5) * 0.10 * aRow;\n" +             // el mipmap lo funde solo
      "  float m = 1.0 + (aRow * uRow.y * sin(6.2831853 * vRow.x / uRow.x)\n" +
      "                 + aBand * uBandAmp * sin(6.2831853 * vRow.x / (uRow.x * 8.0) + 1.7 + warp)) * patchy + speck;\n" +
      // huellas de pulverizadora: dos líneas de ancho uTram.z separadas uTram.y, cada uTram.x m
      "  float q = mod(vRow.x, uTram.x) - uTram.x * 0.5;\n" +
      "  float dd = abs(abs(q) - uTram.y * 0.5);\n" +
      "  float hw = uTram.z * 0.5;\n" +
      "  float line = 1.0 - smoothstep(hw - fu * 0.75, hw + fu * 0.75, dd);\n" +
      "  line *= min(1.0, sqrt(hw / (fu * 1.5)));\n" +
      "  float broken = 0.6 + 0.8 * texture2D(tNoise, vec2(vRow.y * " + nu(40) + ", floor(vRow.x / uTram.x) * 0.137) + vec2(0.9, 0.3)).g;\n" +
      "  m -= uTram.w * fTram * line * min(broken, 1.0);\n" +
      // salida = factor/2: con blend (DST_COLOR, SRC_COLOR) el resultado es dst * factor
      "  gl_FragColor = vec4(vec3(0.5 * m), 0.5);\n}"
  });
  m.depthTest = false; m.depthWrite = false; m.transparent = false; m.toneMapped = false;
  if (hasH) { m.depthTest = true; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }   // A6: ver makeGroundMaterial
  m.side = THREE.DoubleSide;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.DstColorFactor; m.blendDst = THREE.SrcColorFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  return m;
}

/* ---------- el sistema ---------- */
const S = {};            // scenarioKey → { group, gMesh, fMesh, gMat, fMat, opacity, info }
const LAYER_OFF = { herbExt: 0.001, woody: 0.001, pattern: 0 };
let active = groundWanted() && quality.soil !== "apagado";
let furrowsOn = furrowsWanted() && quality.soil === "completo";

const pfx = key => (key === "inicial" ? "ini" : "multi");
const setPaint = (id, prop, v) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); };

/* Capas MapLibre de las clases reemplazadas: casi invisibles pero vivas (T9) cuando el suelo está activo;
   valores originales de layers.js cuando no (calidad Baja). */
function syncMapLayers(key) {
  const s = S[key]; if (!s) return;
  const o = s.opacity, p = pfx(key);
  if (active) {
    setPaint(`${p}-herb-ext`, extOpacityProp(), LAYER_OFF.herbExt * o);   // A6: extOpacityProp() = fill-opacity con terreno (T14), fill-extrusion-opacity sin terreno
    setPaint(`${p}-herb-pattern`, extOpacityProp(), LAYER_OFF.pattern * o);
    setPaint(`${p}-woody-base`, extOpacityProp(), LAYER_OFF.woody * o);
  } else {
    setPaint(`${p}-herb-ext`, extOpacityProp(), 0.9 * o);
    setPaint(`${p}-herb-pattern`, extOpacityProp(), 0.75 * o);
    setPaint(`${p}-woody-base`, extOpacityProp(), WOODY_BASE.opacity * o);
  }
}

function applyModes() {
  for (const k in S) {
    S[k].gMesh.visible = active;
    if (S[k].fMesh) S[k].fMesh.visible = active && furrowsOn;
    syncMapLayers(k);
  }
}

export default {
  id: "ground",

  build(ctx, key, data) {
    const t0 = performance.now();
    const group = new THREE.Group();
    group.name = "a4-ground";
    // ¿hay terreno? (heightAt devuelve 0 mientras A6 no lo active): si es todo 0 se evita el costo por vértice
    const o = (() => { const mc = maplibregl.MercatorCoordinate.fromLngLat(HOME_VIEW.center, 0); return { mc, s: mc.meterInMercatorCoordinateUnits() }; })();
    const toLngLat = (x, z) => { const ll = new maplibregl.MercatorCoordinate(o.mc.x + x * o.s, o.mc.y + z * o.s, 0).toLngLat(); return [ll.lng, ll.lat]; };
    const c = HOME_VIEW.center;
    const hasH = [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]].some(([a, b]) => ctx.heightAt(c[0] + a, c[1] + b) !== 0);

    const gg = buildGroundGeometry(ctx, data, toLngLat, hasH);
    const gMat = makeGroundMaterial(ctx, key, hasH, gg.dTex, gg.dmap);
    const gMesh = new THREE.Mesh(gg.geometry, gMat);
    gMesh.frustumCulled = false; gMesh.renderOrder = -10; gMesh.name = "a4-ground-" + key;
    group.add(gMesh);

    const fg = buildFurrowGeometry(ctx, data, toLngLat, hasH);   // A6: toLngLat/hasH para apoyar los surcos en el relieve
    const fMat = makeFurrowMaterial(ctx, hasH);
    const fMesh = new THREE.Mesh(fg.geometry, fMat);
    fMesh.frustumCulled = false; fMesh.renderOrder = -20; fMesh.name = "a4-furrows-" + key;
    group.add(fMesh);

    S[key] = { group, gMesh, fMesh, gMat, fMat, dTex: gg.dTex, opacity: key === "inicial" ? 1 : 0,
      info: { verts: gg.verts, tris: gg.tris, topTris: gg.topTris, ribTris: gg.ribTris, polys: gg.polys, failed: gg.failed, tiny: gg.tiny, furrowTris: fg.tris, lots: fg.lots, buildMs: Math.round(performance.now() - t0) } };
    applyModes();
    // materials vacío: el host no re-parcha (la niebla y el fade ya van en patch()); los surcos no usan niebla
    return { object3d: group, materials: [] };
  },

  setOpacity(key, o) {
    const s = S[key]; if (!s) return;
    s.opacity = o;
    s.fMat.uniforms.uFadeS.value = o;   // multiplicativo: se funde a "sin efecto" en vez de dither
    syncMapLayers(key);
  },

  setGrowth(key, t) {
    const s = S[key]; if (!s) return;
    s.gMat.userData.a4u.uGrow.value = t;   // revelado desde el eje (única variante desde a4-g2)
  },

  update(frame) {
    // surcos: más allá de ~1,5 km no se ven (curvas de intensidad): ahorro del draw
    const far = frame.camera && frame.camera.altitudeM > A4_FURROWS.tramFade[1];
    for (const k in S) if (S[k].fMesh) S[k].fMesh.visible = active && furrowsOn && !far;
    if (DBG && params.has("a4solo")) {   // solo QA: oculta árboles y pasto para medir el suelo solo
      for (const k in S) for (const ch of S[k].group.parent ? S[k].group.parent.children : []) if (ch !== S[k].group) ch.visible = false;
    }
  },

  onQuality(q) {
    active = groundWanted() && q.soil !== "apagado";
    furrowsOn = furrowsWanted() && q.soil === "completo";
    applyModes();
  },

  dispose() {
    for (const k in S) { S[k].gMesh.geometry.dispose(); S[k].gMat.dispose(); S[k].dTex.dispose(); S[k].fMesh.geometry.dispose(); S[k].fMat.dispose(); }
  },

  stats(key) { return S[key] ? { suelo: S[key].info } : {}; }
};

/* A4 (water.js reutiliza la triangulación del suelo) */
export { dedupRing, triangulatePoly };
