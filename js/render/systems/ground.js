/* ============ Sistema de render: suelo por shader (I) y surcos de cultivo (J) ============
   Dueño: A4 (Ola 2). Contrato: §6.3. Ficha: PLAN §9.A4-I/J. Handoff: realismo/handoffs/a4-suelo.md

   I · SUELO. Los polígonos corr-herb / parche-herb / bajo (y parche-le / corr-le como base bajo
       los árboles) se triangulan en metros de escena con THREE.ShapeUtils (earcut; huecos respetados;
       la geometría GIS no se toca: los vértices son los del anillo) y se refinan con puntos medios
       (aristas ≤ A4_GROUND.maxEdge) para tener una grilla donde interpolar la distancia al borde.
       Shader: color base de §4 con variantes seco/verde por ruido fbm en coordenadas de MUNDO a 3
       escalas (≈0,7 / 4 / 25 m, sin repetición), AO de borde (franja de 1–2 m, geometría aparte),
       niebla y fade de shaderlib, luz de A1 (MeshLambert + hemisferio + sol).
       Crecimiento (dial A4_GROUND.growth / ?crecimiento=): "revelado" (desde el eje, máscara por
       profundidad = distancia al borde normalizada por polígono) o "extrusion" (losa con paredes que
       sube por el scale.y del grupo, como la extrusión MapLibre anterior).
   J · SURCOS. Malla por lote agrícola dibujada SOBRE el satélite con blending multiplicativo:
       modula la luminancia, no el color. Dirección = eje principal del lote (PCA área-ponderada de la
       malla triangulada, momento de segundo orden): es textura de render, NO dato GIS.

   T9: las capas MapLibre *-herb-ext y *-woody-base quedan con opacidad 0,001 (clic/popup);
       *-herb-pattern (no clicable, interact.js no la consulta) queda en 0 para ahorrar su pasada de
       profundidad. Eso se hace desde setOpacity() (corre después de applyOpacity de layers.js).
   Dibujo: sin prueba ni escritura de profundidad (las extrusiones MapLibre invisibles escriben
       profundidad hasta 0,6–1,2 m y taparían un suelo plano); en la lista opaca con renderOrder
       negativo (primero), así árboles y pasto, que van después, quedan encima. Con terreno 3D (A6)
       habrá que pasar a prueba de profundidad + polygonOffset (ver handoff). */
import * as THREE from "three";
import { A4_FURROWS, A4_GROUND, WOODY_BASE } from "../../core/config.js";
import { HOME_VIEW, params } from "../../core/state.js";
import { quality } from "../../core/quality.js";
import { map } from "../../map/style.js";
import { chainShader } from "./chunks.js";

/* ---------- parámetros efectivos (config + URL) ---------- */
const DBG = params.has("qa") || params.has("debug");
const growthMode = () => {
  const q = params.get("crecimiento");
  return q === "extrusion" || q === "revelado" ? q : A4_GROUND.growth;
};
const furrowsWanted = () => {
  const q = params.get("surcos");
  return q === "0" ? false : q === "1" ? true : A4_FURROWS.enabled;
};
const groundWanted = () => A4_GROUND.enabled && params.get("a4") !== "off";

/* ---------- GLSL común: hash entero + value noise (sin patrón repetitivo, estable a coordenadas grandes) ---------- */
const GLSL_NOISE =
  "float adH(vec2 i){ uvec2 q = uvec2(ivec2(i)); q = q*1664525u + 1013904223u; q.x += q.y*1664525u; q.y += q.x*1664525u;\n" +
  "  q ^= q >> 16u; q.x += q.y*1664525u; q.y += q.x*1664525u; q ^= q >> 16u; return float(q.x ^ q.y) * (1.0/4294967296.0); }\n" +
  "float adN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);\n" +
  "  return mix(mix(adH(i), adH(i+vec2(1.0,0.0)), f.x), mix(adH(i+vec2(0.0,1.0)), adH(i+vec2(1.0,1.0)), f.x), f.y); }\n";

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

/* Distancia mínima de cada punto de P (desde `from`) a los segmentos de los anillos. */
function distToRings(P, from, rings) {
  const segs = [];
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) segs.push(r[j][0], r[j][1], r[i][0], r[i][1]);
  const n = segs.length / 4, d = new Float32Array(P.length);
  for (let k = from; k < P.length; k++) {
    const px = P[k][0], pz = P[k][1];
    let best = Infinity;
    for (let s = 0; s < n; s++) {
      const ax = segs[4 * s], az = segs[4 * s + 1], bx = segs[4 * s + 2], bz = segs[4 * s + 3];
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + t * ex), dz = pz - (az + t * ez), dd = dx * dx + dz * dz;
      if (dd < best) best = dd;
    }
    d[k] = Math.sqrt(best);
  }
  return d;
}

/* ---------- construcción de la malla de suelo ---------- */
function buildGroundGeometry(ctx, data, toLngLat, hasH) {
  const P_ = [], I_ = { walls: [], tops: [], ribbons: [] };   // P_: floats por vértice (11): x,y,z, cls,depth,edge,top, kind
  let nv = 0, polys = 0, failed = 0, tiny = 0;
  const pushV = (x, y, z, cls, depth, edge, top, kind) => { P_.push(x, y, z, cls, depth, edge, top, kind); return nv++; };
  const yAt = (x, z) => (hasH ? ctx.heightAt(...toLngLat(x, z)) : 0) + A4_GROUND.yOff;
  const W = A4_GROUND.edgeAO ? A4_GROUND.edgeAO.width : 1.8;

  for (const f of data.features) {
    const cls = f.properties._cls, ci = CLASS_LIST.indexOf(cls);
    if (ci < 0) continue;
    for (const poly of f.geometry.coordinates) {
      const rings = poly.map(r => dedupRing(r, ctx.toScene)).filter(r => r.length >= 3);
      const tri = triangulatePoly(rings);
      if (!tri) { failed++; continue; }
      if (tri.tiny) { tiny++; continue; }
      polys++;
      const n0 = tri.P.length;
      const T = refine(tri.P, tri.T, A4_GROUND.maxEdge);
      const P = tri.P;
      const d = distToRings(P, 0, rings);
      let dmax = 0.5;
      for (let k = 0; k < d.length; k++) if (d[k] > dmax) dmax = d[k];
      // --- tapa (cara hacia arriba) ---
      const base = nv, ys = new Float32Array(P.length);
      for (let k = 0; k < P.length; k++) {
        ys[k] = yAt(P[k][0], P[k][1]);
        pushV(P[k][0], ys[k], P[k][1], ci, Math.min(1, d[k] / dmax), 0, 1, 0);
      }
      for (const [a, b, c] of T) {
        const cr = (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]) - (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]);
        I_.tops.push(base + a, cr > 0 ? base + b : base + c, cr > 0 ? base + c : base + b);
      }
      // --- paredes y franja de AO por anillo (solo con los vértices originales del anillo) ---
      rings.forEach((r, ri) => {
        const A = ringArea2(r), isHole = ri > 0;
        const side = (A > 0 ? 1 : -1) * (isHole ? -1 : 1);   // hacia el interior del polígono respecto de la normal izquierda
        const w = Math.min(W, dmax * 0.8), m = r.length;
        const bot = [], top = [], pIn = [], qIn = [];
        for (let i = 0; i < m; i++) {
          const p0 = r[(i + m - 1) % m], p1 = r[i], p2 = r[(i + 1) % m];
          let d0x = p1[0] - p0[0], d0z = p1[1] - p0[1], l0 = Math.hypot(d0x, d0z) || 1; d0x /= l0; d0z /= l0;
          let d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
          const n0x = -d0z * side, n0z = d0x * side, n1x = -d1z * side, n1z = d1x * side;
          let mx = n0x + n1x, mz = n0z + n1z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
          const k = Math.min(2, 1 / Math.max(mx * n0x + mz * n0z, 0.5));
          const y = yAt(p1[0], p1[1]);
          bot.push(pushV(p1[0], y, p1[1], ci, 0, 0, 0, 2));
          top.push(pushV(p1[0], y, p1[1], ci, 0, 0, 1, 2));
          pIn.push(pushV(p1[0], y, p1[1], ci, 0, 1, 1, 1));
          qIn.push(pushV(p1[0] + mx * k * w, yAt(p1[0] + mx * k * w, p1[1] + mz * k * w), p1[1] + mz * k * w, ci, 0, 0, 1, 1));
        }
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          // pared: ambos sentidos (se dibuja con culling de caras)
          I_.walls.push(bot[i], bot[j], top[j], bot[i], top[j], top[i], bot[i], top[j], bot[j], bot[i], top[i], top[j]);
          // franja: sentido hacia arriba
          const a = pIn[i], b = pIn[j], c = qIn[j], e = qIn[i];
          const quadUp = (u, v, w2, x2) => {
            const pu = P_.slice(u * 8, u * 8 + 3), pv = P_.slice(v * 8, v * 8 + 3), pw = P_.slice(w2 * 8, w2 * 8 + 3);
            const cr = (pv[2] - pu[2]) * (pw[0] - pu[0]) - (pv[0] - pu[0]) * (pw[2] - pu[2]);
            if (cr > 0) I_.ribbons.push(u, v, w2, u, w2, x2); else I_.ribbons.push(u, w2, v, u, x2, w2);
          };
          quadUp(a, b, c, e);
        }
      });
    }
  }
  const g = new THREE.BufferGeometry();
  const F = new Float32Array(P_);
  const buf = new THREE.InterleavedBuffer(F, 8);
  g.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute("aG", new THREE.InterleavedBufferAttribute(buf, 4, 3));   // cls, depth, edge, top
  g.setAttribute("aK", new THREE.InterleavedBufferAttribute(buf, 1, 7));   // 0 tapa, 1 franja AO, 2 pared
  const idx = [...I_.walls, ...I_.tops, ...I_.ribbons];   // orden de dibujo: paredes → tapa → franja (sin depth test)
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);   // se dibuja siempre (frustumCulled=false igual)
  return { geometry: g, verts: nv, tris: idx.length / 3, polys, failed, tiny };
}

/* ---------- material de suelo (Lambert + chunks propios sobre patch de A1) ---------- */
function makeGroundMaterial(ctx, key) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.userData.foliage = false;
  m.side = THREE.FrontSide;
  m.depthTest = false; m.depthWrite = false; m.transparent = false;
  // mezcla alfa en la lista OPACA (CustomBlending no se anula con transparent:false)
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  ctx.shaderlib.patch(m, { fog: true, fade: key });

  const dry = [], grn = [], cls = [];
  for (let i = 0; i < MAXC; i++) {
    const c = A4_GROUND.classes[CLASS_LIST[i]];
    const tn = c && c.tune ? c.tune : [1, 1, 1];
    dry.push(new THREE.Color(c ? c.dry : "#000000").multiply(new THREE.Color(...tn))); grn.push(new THREE.Color(c ? c.green : "#000000").multiply(new THREE.Color(...tn)));
    cls.push(new THREE.Vector4(c ? c.alpha : 1, c ? c.lift : 0, 0, 0));
  }
  const U = {
    uDry: { value: dry }, uGrn: { value: grn }, uCls: { value: cls },
    uLiftOn: { value: 0 }, uMask: { value: 1 }, uGrow: { value: 1 }, uGain: { value: A4_GROUND.gain },
    uNoise: { value: new THREE.Vector3(A4_GROUND.noise.fine, A4_GROUND.noise.mid, A4_GROUND.noise.coarse) },
    uAO: { value: new THREE.Vector2(A4_GROUND.edgeAO.width, A4_GROUND.edgeAO.strength) },
    uSoft: { value: new THREE.Vector2(A4_GROUND.reveal.soft, A4_GROUND.reveal.jitter) }
  };
  m.userData.a4u = U;
  chainShader(m, "a4ground", sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>",
        "#include <common>\nattribute vec4 aG;\nattribute float aK;\nuniform vec4 uCls[" + MAXC + "];\nuniform vec3 uDry[" + MAXC + "];\nuniform vec3 uGrn[" + MAXC + "];\n" +
        "uniform float uLiftOn;\nvarying vec3 vWp;\nvarying vec3 vDry;\nvarying vec3 vGrn;\nvarying vec4 vPar;\nvarying vec4 vInf;")
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
      .replace("#include <begin_vertex>",
        "vec3 transformed = vec3(position);\n" +
        "int ci = int(aG.x + 0.5);\n" +
        "transformed.y += aG.w * uCls[ci].y * uLiftOn;\n" +
        "vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n" +
        "vDry = uDry[ci]; vGrn = uGrn[ci]; vPar = uCls[ci]; vInf = vec4(aG.y, aG.z, aK, 0.0);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vWp;\nvarying vec3 vDry;\nvarying vec3 vGrn;\nvarying vec4 vPar;\nvarying vec4 vInf;\n" +
        "uniform float uMask;\nuniform float uGrow;\nuniform float uGain;\nuniform vec3 uNoise;\nuniform vec2 uAO;\nuniform vec2 uSoft;\n" + GLSL_NOISE)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec2 adP = vWp.xz + vec2(65536.0);\n" +
        "float adFw = length(fwidth(vWp.xz));\n" +
        "const mat2 adR = mat2(0.80, -0.60, 0.60, 0.80);\n" +
        "float n1 = adN(adR * adP / 0.7);\n" +
        "float n2 = adN(adR * adR * adP / 4.0 + 31.7);\n" +
        "float n3 = adN(adR * adR * adR * adP / 25.0 + 77.1);\n" +
        "float a1 = 1.0 - smoothstep(0.25, 0.7, adFw / 0.7);\n" +      // octava fina: se funde cuando el píxel la supera
        "float a2 = 1.0 - smoothstep(0.25, 0.7, adFw / 4.0);\n" +
        "float gmix = smoothstep(0.30, 0.70, n3 * 0.65 + n2 * 0.35);\n" +   // parches de pasto seco ↔ verde
        "vec3 adCol = mix(vDry, vGrn, gmix);\n" +
        "adCol *= (1.0 + 2.0 * (uNoise.x * (n1 - 0.5) * a1 + uNoise.y * (n2 - 0.5) * a2 + uNoise.z * (n3 - 0.5))) * uGain;\n" +
        "if (vInf.z > 1.5) adCol *= 0.62;\n" +                                   // pared de la losa
        "else if (vInf.z > 0.5) adCol *= 1.0 - uAO.y * smoothstep(0.0, 1.0, vInf.y);\n" +   // AO de borde
        "float adM = 1.0;\n" +
        "if (uMask > 0.5) {\n" +
        "  float span = 1.0 + uSoft.x + uSoft.y;\n" +
        "  float lo = 1.0 - uGrow * span;\n" +
        "  float s = vInf.x + (n3 - 0.5) * 2.0 * uSoft.y;\n" +
        "  adM = (uGrow >= 0.999) ? 1.0 : (uGrow <= 0.001 ? 0.0 : smoothstep(lo, lo + uSoft.x, s));\n" +
        "}\n" +
        "vec4 diffuseColor = vec4(adCol, vPar.x * adM);");
  });
  return m;
}

/* ---------- surcos (J) ---------- */
function buildFurrowGeometry(ctx, data) {
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
      for (const p of P) {
        pos.push(p[0], A4_GROUND.yOff, p[1]);
        row.push((p[0] - cx) * nx + (p[1] - cz) * nz + phase, (p[0] - cx) * ax + (p[1] - cz) * az, 0);
        nv++;
      }
      for (const [a, b, c] of T) idx.push(base + a, base + b, base + c);
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

function makeFurrowMaterial(ctx) {
  const F = A4_FURROWS;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uCamPos: ctx.uniforms.uCamPos,
      uFadeS: { value: 1 },
      uRow: { value: new THREE.Vector4(F.spacing, F.rowAmp, F.rowFade[0], F.rowFade[1]) },
      uTram: { value: new THREE.Vector4(F.tramPeriod, F.tramGauge, F.tramWidth, F.tramAmp) },
      uTramFade: { value: new THREE.Vector2(F.tramFade[0], F.tramFade[1]) }
    },
    vertexShader:
      "attribute vec3 aRow;\nvarying vec3 vRow;\nvarying vec3 vWp;\n" +
      "void main() {\n  vRow = aRow;\n  vWp = (modelMatrix * vec4(position, 1.0)).xyz;\n" +
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
    fragmentShader:
      "precision highp float;\nvarying vec3 vRow;\nvarying vec3 vWp;\nuniform vec3 uCamPos;\nuniform float uFadeS;\n" +
      "uniform vec4 uRow;\nuniform vec4 uTram;\nuniform vec2 uTramFade;\n" + GLSL_NOISE +
      "void main() {\n" +
      "  float d = distance(vWp, uCamPos);\n" +
      "  float fRow = (1.0 - smoothstep(uRow.z, uRow.w, d)) * uFadeS;\n" +
      "  float fTram = (1.0 - smoothstep(uTramFade.x, uTramFade.y, d)) * uFadeS;\n" +
      "  if (fRow < 0.002 && fTram < 0.002) discard;\n" +
      "  vec2 p = vWp.xz + vec2(65536.0);\n" +
      "  float fu = max(fwidth(vRow.x), 1e-4);\n" +
      // surcos: onda senoidal; la amplitud se funde a 0 (gris medio) cuando el período se acerca al píxel (sin moiré)
      "  float wRows = fu / uRow.x;\n" +
      "  float amp = uRow.y * fRow * (1.0 - smoothstep(0.40, 0.90, wRows));\n" +
      // 2.º nivel (8 surcos juntos = bandas de ~4 m): toma la posta cuando el surco real ya no se resuelve (textura, no dato)
      "  float wBand = fu / (uRow.x * 8.0);\n" +
      "  float ampB = uRow.y * 0.7 * fRow * smoothstep(0.30, 0.90, wRows) * (1.0 - smoothstep(0.40, 0.90, wBand));\n" +
      "  float patchy = 0.55 + 0.9 * adN(p / 9.0 + 12.3);\n" +          // rastrojo: irregularidad por manchones
      "  float speck = (adN(p / 0.35) - 0.5) * 0.10 * fRow * (1.0 - smoothstep(0.2, 0.6, fu / 0.35));\n" +
      "  float m = 1.0 + (amp * sin(6.2831853 * vRow.x / uRow.x) + ampB * sin(6.2831853 * vRow.x / (uRow.x * 8.0) + 1.7)) * patchy + speck;\n" +
      // huellas de pulverizadora: dos líneas de ancho uTram.z separadas uTram.y, cada uTram.x m
      "  float q = mod(vRow.x, uTram.x) - uTram.x * 0.5;\n" +
      "  float dd = abs(abs(q) - uTram.y * 0.5);\n" +
      "  float hw = uTram.z * 0.5;\n" +
      "  float line = 1.0 - smoothstep(hw - fu * 0.75, hw + fu * 0.75, dd);\n" +
      "  line *= min(1.0, sqrt(hw / (fu * 1.5)));\n" +
      "  float broken = 0.6 + 0.8 * adN(vec2(vRow.y / 40.0, floor(vRow.x / uTram.x)) + 5.1);\n" +
      "  m -= uTram.w * fTram * line * min(broken, 1.0);\n" +
      // salida = factor/2: con blend (DST_COLOR, SRC_COLOR) el resultado es dst * factor
      "  gl_FragColor = vec4(vec3(0.5 * m), 0.5);\n}"
  });
  m.depthTest = false; m.depthWrite = false; m.transparent = false; m.toneMapped = false;
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
    setPaint(`${p}-herb-ext`, "fill-extrusion-opacity", LAYER_OFF.herbExt * o);
    setPaint(`${p}-herb-pattern`, "fill-extrusion-opacity", LAYER_OFF.pattern * o);
    setPaint(`${p}-woody-base`, "fill-extrusion-opacity", LAYER_OFF.woody * o);
  } else {
    setPaint(`${p}-herb-ext`, "fill-extrusion-opacity", 0.9 * o);
    setPaint(`${p}-herb-pattern`, "fill-extrusion-opacity", 0.75 * o);
    setPaint(`${p}-woody-base`, "fill-extrusion-opacity", WOODY_BASE.opacity * o);
  }
}

function applyModes() {
  const mode = growthMode();
  for (const k in S) {
    const u = S[k].gMat.userData.a4u;
    u.uMask.value = mode === "revelado" ? 1 : 0;
    u.uLiftOn.value = mode === "extrusion" ? 1 : 0;
    if (mode === "extrusion") u.uGrow.value = 1;
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
    const gMat = makeGroundMaterial(ctx, key);
    const gMesh = new THREE.Mesh(gg.geometry, gMat);
    gMesh.frustumCulled = false; gMesh.renderOrder = -10; gMesh.name = "a4-ground-" + key;
    group.add(gMesh);

    const fg = buildFurrowGeometry(ctx, data);
    const fMat = makeFurrowMaterial(ctx);
    const fMesh = new THREE.Mesh(fg.geometry, fMat);
    fMesh.frustumCulled = false; fMesh.renderOrder = -20; fMesh.name = "a4-furrows-" + key;
    group.add(fMesh);

    S[key] = { group, gMesh, fMesh, gMat, fMat, opacity: key === "inicial" ? 1 : 0,
      info: { verts: gg.verts, tris: gg.tris, polys: gg.polys, failed: gg.failed, tiny: gg.tiny, furrowTris: fg.tris, lots: fg.lots, buildMs: Math.round(performance.now() - t0) } };
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
    s.gMat.userData.a4u.uGrow.value = growthMode() === "revelado" ? t : 1;
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
    for (const k in S) { S[k].gMesh.geometry.dispose(); S[k].gMat.dispose(); S[k].fMesh.geometry.dispose(); S[k].fMat.dispose(); }
  },

  stats(key) { return S[key] ? { suelo: S[key].info } : {}; }
};
