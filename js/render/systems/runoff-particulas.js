/* ============ Partículas de flujo del simulador de escorrentía (hidro-render, F3) ============
   Dueño: hidro-render. Plan: PLAN §4 F3. Diales: HIDRO.vis.particulas (+ estelaMinM/estelaMaxM/estelaSegundos en HIDRO.vis).

   Qué dibuja: estelas blancas finas que se mueven aguas abajo sobre el mapa de velocidad. Cada partícula es un punto que se
   advecta (RK2) con la dirección y la velocidad que entrega el motor (interpolación bilineal de dirX/dirY/v sobre la grilla de
   la cuenca), arrastrando una cola de NP puntos. La velocidad visual es v·exageracion (la v real, 0,02–1,5 m/s, se vería inmóvil).

   Todo el trabajo por frame es CPU sobre buffers PREASIGNADOS (cero asignación de memoria por frame):
     - posición/edad/vida por partícula en Float32Array;
     - la cola vive en una textura RGBA32F de solo lectura para el vertex shader (un texel por punto: x, y, z, w; en el
       texel de la cabeza w = envolvente de alfa por edad). WebGL2 sin extensiones de render a float, sirve en celulares.
   Un solo draw call: una malla instanciada (una instancia por partícula) de 2·NP vértices en tira. El vertex shader lee los
   puntos de la textura (texelFetch), los proyecta y EXPANDE LA CINTA EN PANTALLA con anchoPx píxeles (gl.lineWidth sirve solo 1 px).
   La cola se arma por DISTANCIA: cada vez que la cabeza se aleja `largo/(NP−1)` m del primer punto de historia, la historia
   se corre un lugar; con largo = clamp(v·estelaSegundos, estelaMinM, estelaMaxM): más veloz = más larga, acotada. Una partícula
   que nace trae su cola ya armada (se marcha aguas arriba por la misma grilla) y entra con un fundido corto.
   Altura: la grilla de vértices del agua ya trae y = heightAt + yOff; acá se interpola bilineal (misma superficie que el mapa
   de velocidad) + un margen, y el vertex shader resta la bajada viva a6Low (sin hundirse con el relieve apagándose).
   Baja: sin animación; `estaticasBaja` estelas precalculadas (mismo armado de cola, una sola subida de textura). */
import * as THREE from "three";
import { HIDRO } from "../../core/config.js?v=20261122";
import { GLSL_DECL, withReliefU } from "../../terrain/terrain.js?v=20261122";
import { GLSL_ADFOG, GLSL_FOG_UNIFORMS, scenarioFade } from "../shaderlib.js?v=20261122";

const VIS = HIDRO.vis, PV = VIS.particulas;
const NP = Math.max(2, PV.puntosEstela | 0);
const TEXW = 2048;                 // ancho de la textura de puntos (texels); alto = ceil(P·NP / TEXW)
const Y_EXTRA = 0.06;              // m · sobre la grilla del mapa de velocidad (que ya está sobre el suelo)   // → HIDRO
const OUTSIDE_W = 0.05;            // peso de reaparición de una celda FUERA del campo respecto de una de adentro   // → HIDRO
const SPEED_W = 2.0;               // extra de peso en celdas rápidas (cauces: angostos y las partículas salen enseguida)   // → HIDRO
const FADE_IN = 0.4, FADE_OUT = 0.6;   // s · envolvente de alfa al nacer / al morir   // → HIDRO
const DT_MAX = 0.1;                // s · tope del paso (volver de una pestaña dormida no tira las partículas al mar)
const FEATHER = 0.6;               // px · suavizado del borde de la cinta

const VS = GLSL_DECL +
  "const int NP = " + NP + ";\nconst int TW = " + TEXW + ";\n" +
  "uniform sampler2D tP;\nuniform vec2 uPx;\nuniform float uHalf;\n" +
  "varying vec3 vWp;\nvarying float vA;\nvarying float vSide;\n" +
  "vec4 pt(int p, int k) { int i = p * NP + k; return texelFetch(tP, ivec2(i % TW, i / TW), 0); }\n" +
  "uniform vec3 uCamPos;\nuniform float uLift;\n" +
  "vec4 clipOf(vec3 q, out vec3 wp) {\n  vec4 w = modelMatrix * vec4(q, 1.0);\n  w.y -= a6Low(w.xz);\n  w.y += uLift * length(uCamPos - w.xyz);\n  wp = w.xyz;\n  return projectionMatrix * viewMatrix * w;\n}\n" +
  "void main() {\n" +
  "  int p = gl_InstanceID, k = gl_VertexID >> 1;\n" +
  "  float side = float((gl_VertexID & 1) * 2 - 1);\n" +
  "  vec4 c0 = pt(p, k);\n  float env = pt(p, 0).w;\n" +
  "  vec3 wp, w1, w2;\n" +
  "  vec4 C = clipOf(c0.xyz, wp);\n" +
  "  vec4 A = clipOf(pt(p, max(k - 1, 0)).xyz, w1);\n" +
  "  vec4 B = clipOf(pt(p, min(k + 1, NP - 1)).xyz, w2);\n" +
  "  vWp = wp;\n" +
  "  if (C.w < 0.01 || A.w < 0.01 || B.w < 0.01 || env <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vSide = 0.0; return; }\n" +
  // tangente en píxeles (a través de los vecinos), perpendicular y desplazamiento en NDC
  "  vec2 d = (B.xy / B.w - A.xy / A.w) / uPx;\n  float len = length(d);\n" +
  "  vec2 n = len > 1e-4 ? vec2(-d.y, d.x) / len : vec2(0.0);\n" +
  "  gl_Position = C;\n  gl_Position.xy += n * side * uHalf * uPx * C.w;\n" +
  "  float s = float(k) / float(NP - 1);\n" +
  "  vA = env * pow(1.0 - s, 1.2);\n  vSide = side;\n}\n";

const FS =
  "precision highp float;\n" +
  "varying vec3 vWp;\nvarying float vA;\nvarying float vSide;\n" +
  "uniform vec3 uCamPos;\nuniform float uFade;\nuniform float uHalf;\nuniform float uCore;\nuniform float uAlfa;\nuniform float uOut;\n" +
  "uniform sampler2D tIn;\nuniform vec4 uG;\nuniform vec2 uN;\n" +
  GLSL_FOG_UNIFORMS + GLSL_ADFOG +
  "void main() {\n" +
  "  float dpx = abs(vSide) * uHalf;\n" +
  "  float cov = clamp(uCore + 0.5 - dpx, 0.0, 1.0);\n" +
  "  vec2 f = vec2(vWp.x * uG.x + uG.y, vWp.z * uG.z + uG.w);\n" +
  // fuera del campo se atenúa igual que el mapa de velocidad (HIDRO.vis.natural.outside)
  "  float a = cov * vA * uAlfa * uFade * mix(uOut, 1.0, texture2D(tIn, (f + 0.5) / uN).r);\n" +
  "  if (a < 0.004) discard;\n" +
  "  float dist = length(uCamPos - vWp);\n" +
  "  gl_FragColor = vec4(mix(vec3(1.0), uFogColor, adFog(dist)), a);\n" +
  "}\n";

/* Una instancia por escenario. `shared` trae los uniforms comunes de runoff.js (cámara y niebla). */
export function createParticles(ctx, key, shared, getCanvas) {
  const rnd = ctx.rng(0x7e1a + (key === "multi" ? 1 : 0));
  const geom = new THREE.InstancedBufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * NP * 3), 3));   // ficticio: three exige position; el shader usa gl_VertexID
  const idx = new Uint16Array((NP - 1) * 6);
  for (let k = 0; k < NP - 1; k++) { const a = 2 * k; idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], k * 6); }
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  geom.instanceCount = 0;

  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { ...shared, ...withReliefU({}), uFade: scenarioFade[key] || { value: 1 }, tP: { value: null },
      uPx: { value: new THREE.Vector2(0.002, 0.002) }, uHalf: { value: 1 }, uCore: { value: 1 }, uAlfa: { value: PV.alfaCabeza }, uOut: { value: VIS.natural.outside },
      tIn: { value: null }, uG: { value: new THREE.Vector4(1, 0, 1, 0) }, uN: { value: new THREE.Vector2(1, 1) } }
  });
  mat.side = THREE.DoubleSide; mat.depthTest = true; mat.depthWrite = false; mat.transparent = false;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -3; mat.polygonOffsetUnits = -6;   // sobre el mapa de velocidad (−2, −4)
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor;
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false; mesh.renderOrder = -9.4; mesh.name = "hidro-runoff-estelas-" + key; mesh.visible = false;

  /* ---- estado ---- */
  let cap = 0, want = 0, mode = "off";           // capacidad asignada · capacidad pedida por la calidad · "anim" | "static" | "off"
  let X = null, Z = null, AGE = null, LIFE = null;  // por partícula
  let tdata = null, tex = null;
  let dX = null, dY = null, vv = null, inside = null;   // grilla y campo vigentes (referencias; nada se copia)
  let cdf = null, cdfDirty = true, cdfTotal = 0;
  let ax = 1, bx = 0, az = 1, bz = 0, nx = 0, ny = 0, posArr = null;
  let ms = 0, filled = false;
  let _vx = 0, _vz = 0, _v = 0;

  const lenFor = v => Math.min(VIS.estelaMaxM, Math.max(VIS.estelaMinM, v * VIS.estelaSegundos));

  function sample(x, z) {   // bilineal de dirección y velocidad; devuelve false fuera de la grilla. Resultado en _vx/_vz (m/s reales) y _v.
    const fx = x * ax + bx, fz = z * az + bz;
    if (!(fx >= 0 && fz >= 0 && fx <= nx - 1 && fz <= ny - 1)) return false;
    let i = fx | 0, j = fz | 0;
    if (i > nx - 2) i = nx - 2; if (j > ny - 2) j = ny - 2;
    const tx = fx - i, tz = fz - j, q = j * nx + i;
    const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
    const ux = dX[q] * w00 + dX[q + 1] * w10 + dX[q + nx] * w01 + dX[q + nx + 1] * w11;
    const uz = dY[q] * w00 + dY[q + 1] * w10 + dY[q + nx] * w01 + dY[q + nx + 1] * w11;
    const v = vv[q] * w00 + vv[q + 1] * w10 + vv[q + nx] * w01 + vv[q + nx + 1] * w11;
    const l = Math.sqrt(ux * ux + uz * uz);
    _v = v;
    if (l < 1e-6) { _vx = 0; _vz = 0; } else { _vx = ux / l * v; _vz = uz / l * v; }
    return true;
  }
  function yAt(x, z) {   // altura de la grilla (heightAt + yOff) interpolada + margen
    let fx = x * ax + bx, fz = z * az + bz;
    if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0; else if (fz > ny - 1) fz = ny - 1;
    let i = fx | 0, j = fz | 0;
    if (i > nx - 2) i = nx - 2; if (j > ny - 2) j = ny - 2;
    const tx = fx - i, tz = fz - j, q = (j * nx + i) * 3 + 1, r = q + nx * 3;
    return (posArr[q] * (1 - tx) + posArr[q + 3] * tx) * (1 - tz) + (posArr[r] * (1 - tx) + posArr[r + 3] * tx) * tz + Y_EXTRA;
  }

  function buildCdf() {   // reaparición ponderada: dentro del campo (1) ≫ fuera (OUTSIDE_W), más peso donde corre más rápido
    const n = nx * ny;
    if (!cdf || cdf.length !== n) cdf = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const sp = vv[i] / 0.5;
      acc += (inside[i] ? 1 : OUTSIDE_W) * (1 + SPEED_W * (sp > 1 ? 1 : sp));
      cdf[i] = acc;
    }
    cdfTotal = acc; cdfDirty = false;
  }

  /* Arma la partícula p en (x, z): cabeza + cola marchada aguas arriba con el mismo largo que tendría andando. */
  function writeTrail(p, x, z, env) {
    const base = p * NP * 4;
    tdata[base] = x; tdata[base + 1] = yAt(x, z); tdata[base + 2] = z; tdata[base + 3] = env;
    let cx = x, cz = z, alive = sample(x, z) && _v > 0 && (_vx !== 0 || _vz !== 0);
    const sp = alive ? lenFor(_v) / (NP - 1) : 0;
    for (let k = 1; k < NP; k++) {
      if (alive) {
        sample(cx, cz);
        const l = Math.sqrt(_vx * _vx + _vz * _vz);
        if (l < 1e-6) alive = false;
        else {
          const ux = _vx / l, uz = _vz / l;
          if (sample(cx - ux * sp * 0.5, cz - uz * sp * 0.5)) {   // punto medio (RK2) aguas arriba
            const l2 = Math.sqrt(_vx * _vx + _vz * _vz);
            if (l2 > 1e-6) { cx -= _vx / l2 * sp; cz -= _vz / l2 * sp; } else cx -= ux * sp, cz -= uz * sp;
          } else alive = false;
        }
      }
      const o = base + k * 4;
      tdata[o] = cx; tdata[o + 1] = yAt(cx, cz); tdata[o + 2] = cz; tdata[o + 3] = 1;
    }
  }

  function respawn(p, staggered) {
    const t = rnd() * cdfTotal;
    let lo = 0, hi = nx * ny - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < t) lo = m + 1; else hi = m; }
    const i = lo % nx, j = (lo / nx) | 0;
    let fx = i + rnd() - 0.5, fz = j + rnd() - 0.5;
    if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0; else if (fz > ny - 1) fz = ny - 1;
    X[p] = (fx - bx) / ax; Z[p] = (fz - bz) / az;
    LIFE[p] = PV.vidaS[0] + rnd() * (PV.vidaS[1] - PV.vidaS[0]);
    AGE[p] = staggered ? rnd() * LIFE[p] : 0;
    writeTrail(p, X[p], Z[p], envOf(AGE[p], LIFE[p]));
  }
  function envOf(age, life) {
    const a = age / FADE_IN, b = (life - age) / FADE_OUT;
    return a < b ? (a < 1 ? a : 1) : (b < 1 ? (b > 0 ? b : 0) : 1);
  }

  function alloc(n) {
    if (tex) { tex.dispose(); tex = null; }
    cap = n; filled = false;
    if (!n) { X = Z = AGE = LIFE = tdata = null; geom.instanceCount = 0; return; }
    X = new Float32Array(n); Z = new Float32Array(n); AGE = new Float32Array(n); LIFE = new Float32Array(n);
    const texels = n * NP, h = Math.ceil(texels / TEXW);
    tdata = new Float32Array(TEXW * h * 4);
    tex = new THREE.DataTexture(tdata, TEXW, h, THREE.RGBAFormat, THREE.FloatType);
    tex.internalFormat = "RGBA32F"; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 4;
    mat.uniforms.tP.value = tex;
    geom.instanceCount = n;
  }

  function fill() {   // población inicial: edades escalonadas (animada) o estelas fijas (Baja)
    if (!cap || !dX) return;
    if (cdfDirty) buildCdf();
    for (let p = 0; p < cap; p++) {
      respawn(p, mode === "anim");
      if (mode === "static") tdata[p * NP * 4 + 3] = 1;   // sin envolvente: todas completas
    }
    tex.needsUpdate = true; filled = true;
  }

  const api = {
    mesh, mat,
    /** Presupuesto según la calidad: "anim" (partículas animadas), "static" (Baja) u "off". */
    configure(q) {
      const nAnim = (PV.presupuesto[q.name] | 0), nStat = q.name === "baja" ? (PV.estaticasBaja | 0) : 0;
      const m = nAnim > 0 ? "anim" : nStat > 0 ? "static" : "off", n = m === "anim" ? nAnim : m === "static" ? nStat : 0;
      if (m === mode && n === want) return;
      mode = m; want = n; alloc(0); mesh.visible = false;   // la memoria se pide recién al mostrar (simulador apagado = nada asignado)
    },
    /** Campo vigente (cada resultado, también al cambiar la lluvia): solo se cambian referencias; las estelas siguen. */
    setField(G, res, r) {
      if (G.nx !== nx || G.ny !== ny) filled = false;   // otra grilla: las estelas viejas no valen
      nx = G.nx; ny = G.ny; ax = G.aff.x; bx = G.aff.y; az = G.aff.z; bz = G.aff.w; posArr = G.pos.array;
      dX = res.dirX; dY = res.dirY; vv = r.v; inside = res.inside; cdfDirty = true;
      if (mode === "static" && filled) filled = false;   // Baja: se rehacen las fijas al volver a mostrar
    },
    /** ¿Hay algo que dibujar y tickear? */
    get ready() { return !!dX && want > 0 && mode !== "off"; },
    get animated() { return mode === "anim"; },
    /** Prepara (primera vez / campo nuevo) y muestra u oculta la malla. */
    show(on) {
      if (on && this.ready) {
        if (cap !== want) alloc(want);
        if (!filled) { if (cdfDirty) buildCdf(); fill(); }
        mesh.visible = true;
      } else mesh.visible = false;
    },
    /** Avanza dt segundos (ya acotado a ≥ 0 por quien llama). Solo modo animado. */
    tick(dt) {
      if (mode !== "anim" || !filled || !mesh.visible) return;
      const t0 = performance.now();
      if (cdfDirty) buildCdf();
      dt = dt > DT_MAX ? DT_MAX : dt;
      const ex = PV.exageracion, hdt = 0.5 * dt * ex, dte = dt * ex;
      for (let p = 0; p < cap; p++) {
        const age = AGE[p] + dt;
        if (age >= LIFE[p]) { respawn(p, false); continue; }
        AGE[p] = age;
        let x = X[p], z = Z[p];
        if (!sample(x, z)) { respawn(p, false); continue; }
        const v0 = _v, k1x = _vx, k1z = _vz;
        if (sample(x + k1x * hdt, z + k1z * hdt)) { x += _vx * dte; z += _vz * dte; } else { x += k1x * dte; z += k1z * dte; }
        X[p] = x; Z[p] = z;
        const base = p * NP * 4;
        // ¿la cabeza se alejó lo suficiente del primer punto de historia? → la historia se corre un lugar
        const dx = x - tdata[base + 4], dz = z - tdata[base + 6], sp = lenFor(v0) / (NP - 1);
        if (dx * dx + dz * dz >= sp * sp) {
          tdata.copyWithin(base + 8, base + 4, base + (NP - 1) * 4);
          tdata[base + 4] = tdata[base]; tdata[base + 5] = tdata[base + 1]; tdata[base + 6] = tdata[base + 2]; tdata[base + 7] = 1;
        }
        tdata[base] = x; tdata[base + 1] = yAt(x, z); tdata[base + 2] = z; tdata[base + 3] = envOf(age, LIFE[p]);
      }
      tex.needsUpdate = true;
      ms += (performance.now() - t0 - ms) * 0.1;
    },
    /** Ancho de la cinta en píxeles del lienzo (CSS · devicePixelRatio) y tamaño de un píxel en NDC; se llama cada frame visible. */
    setViewport() {
      const cv = getCanvas(); if (!cv) return;
      const w = cv.width || 1, h = cv.height || 1, rat = w / Math.max(1, cv.clientWidth || w);
      mat.uniforms.uPx.value.set(2 / w, 2 / h);
      const core = PV.anchoPx * rat * 0.5;
      mat.uniforms.uCore.value = core; mat.uniforms.uHalf.value = core + 0.5 + FEATHER;
    },
    /** Libera memoria (simulador apagado). */
    release() { mesh.visible = false; alloc(0); cdf = null; cdfDirty = true; },
    dispose() { api.release(); geom.dispose(); mat.dispose(); },
    get count() { return mesh.visible ? cap : 0; },
    get tris() { return mesh.visible ? cap * (NP - 1) * 2 : 0; },
    get texMB() { return tdata ? tdata.byteLength / 1048576 : 0; },
    get tickMs() { return ms; }
  };
  return api;
}
