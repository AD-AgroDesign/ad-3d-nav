import { CROWN_PALETTE, GRASS_CLASSES, GRASS_SCALE, TRUNK_COLOR } from "../core/config.js";
import { HOME_VIEW, state } from "../core/state.js";

/* Geometría unitaria de una mata: 4 hojas inclinadas hacia afuera
   (base y=0, puntas y≈1). Gradiente base → punta vía colores de vértice
   (se multiplican con el color por instancia). Sin `mid`: hoja de 1 quad
   (8 tris/mata). Con `mid` (fracción de altura) se agrega una fila
   intermedia con su color: el de punta queda confinado al tramo superior
   (hoja de 4 tris, 16 tris/mata). */
export function buildTuftGeometry(blades = 4, tip = [1.25, 1.15, 0.8], baseCol = [0.5, 0.47, 0.4], mid = null, midCol = null) {
  const pos = [], col = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.9;
    const dx = Math.cos(a), dz = Math.sin(a);
    const bw = 0.1;                                 // media base de la hoja
    const px = -dz * bw, pz = dx * bw;              // perpendicular a la hoja
    const r0 = 0.06, r2 = 0.34;                     // inclinación hacia afuera
    const h2 = 0.9 + ((b * 37) % 12) / 60;
    const v0 = pos.length / 3;
    pos.push(
      dx * r0 - px, 0, dz * r0 - pz, dx * r0 + px, 0, dz * r0 + pz
    );
    col.push(
      baseCol[0], baseCol[1], baseCol[2], baseCol[0], baseCol[1], baseCol[2]
    );
    if (mid) {
      const rm = r0 + (r2 - r0) * mid, hm = h2 * mid, wm = 1 - (1 - 0.22) * mid;
      pos.push(
        dx * rm - px * wm, hm, dz * rm - pz * wm, dx * rm + px * wm, hm, dz * rm + pz * wm
      );
      col.push(
        midCol[0], midCol[1], midCol[2], midCol[0], midCol[1], midCol[2]
      );
      idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
    }
    const t = pos.length / 3;
    pos.push(
      dx * r2 + px * 0.22, h2, dz * r2 + pz * 0.22, dx * r2 - px * 0.22, h2, dz * r2 - pz * 0.22
    );
    col.push(
      tip[0], tip[1], tip[2], tip[0], tip[1], tip[2]
    );
    // fila previa (base o intermedia) → punta; el orden de la punta está
    // espejado respecto a la fila inferior
    idx.push(t - 2, t - 1, t, t - 2, t, t + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- Capa custom Three.js: árboles low-poly instanciados ---------- */
export const vegLayer = {
  id: "veg-3d",
  type: "custom",
  renderingMode: "3d",
  groups: {},
  timeUniform: { value: 0 },   // reloj del viento (solo avanza cuando el mapa repinta)

  onAdd(mapInstance, gl) {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff3da, 0.85);
    sun.position.set(-0.5, 1, -0.7);  // sol NO (sombras GeoJSON al SE)
    this.scene.add(sun);

    const origin = maplibregl.MercatorCoordinate.fromLngLat(HOME_VIEW.center, 0);
    this.scale = origin.meterInMercatorCoordinateUnits();
    // escena en metros: X=este, Y=arriba, Z=sur
    this.l = new THREE.Matrix4()
      .makeTranslation(origin.x, origin.y, 0)
      .scale(new THREE.Vector3(this.scale, -this.scale, this.scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.origin = origin;

    for (const key of ["inicial", "multi"]) {
      const g = this.buildGroup(state.veg[key].trees, state.veg[key].grass);
      g.group.scale.y = state.growth[key] || 0.0001;
      this.setGroupOpacity(g, key === "inicial" ? 1 : 0);
      this.scene.add(g.group);
      this.groups[key] = g;
    }

    this.renderer = new THREE.WebGLRenderer({ canvas: mapInstance.getCanvas(), context: gl });
    this.renderer.autoClear = false;
  },

  buildGroup(trees, grass) {
    const group = new THREE.Group();
    const nLobes = trees.reduce((s, t) => s + (t.lobe ? 1 : 0), 0);

    const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 5);
    trunkGeo.translate(0, 0.5, 0); // base del tronco en y=0
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);

    const trunkMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });
    const crownMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length + nLobes);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const col = new THREE.Color();
    const origin = this.origin, s = this.scale;

    let ci = 0;
    trees.forEach((t, i) => {
      // posición exacta en Mercator -> metros de escena (X este, Z sur)
      const mc = maplibregl.MercatorCoordinate.fromLngLat([t.lon, t.lat], 0);
      const x = (mc.x - origin.x) / s;
      const z = (mc.y - origin.y) / s;
      const trunkH = t.h * 0.32;
      const trunkR = 0.12 + t.h * 0.035;

      m.compose(
        new THREE.Vector3(x, 0, z),
        q.identity(),
        new THREE.Vector3(trunkR, trunkH, trunkR)
      );
      trunks.setMatrixAt(i, m);
      col.setHex(TRUNK_COLOR).offsetHSL(0, 0, (t.j - 0.5) * 0.08);
      trunks.setColorAt(i, col);

      const sy = t.h * 0.42;
      const cy = trunkH + sy * 0.82;
      eul.set(0, t.j * Math.PI * 2, 0);
      m.compose(
        new THREE.Vector3(x, cy, z),
        q.setFromEuler(eul),
        new THREE.Vector3(t.r, sy, t.r * (0.9 + t.j * 0.2))
      );
      crowns.setMatrixAt(ci, m);
      col.setHex(CROWN_PALETTE[t.c]).offsetHSL(0, 0, (t.j - 0.5) * 0.07);
      crowns.setColorAt(ci, col);
      ci++;

      if (t.lobe) {
        const lr = t.r * 0.6;
        m.compose(
          new THREE.Vector3(x + (t.j - 0.5) * t.r * 1.4, cy + sy * 0.35, z + (((t.j * 7) % 1) - 0.5) * t.r * 1.4),
          q.identity(),
          new THREE.Vector3(lr, lr * 0.9, lr)
        );
        crowns.setMatrixAt(ci, m);
        col.setHex(CROWN_PALETTE[(t.c + 1) % CROWN_PALETTE.length]).offsetHSL(0, 0, (t.j - 0.5) * 0.07);
        crowns.setColorAt(ci, col);
        ci++;
      }
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

    group.add(trunks, crowns);

    /* Matas de pasto instanciadas: un mesh por clase (cada clase tiene su
       geometría con el color de punta propio); material compartido */
    let grassMat = null;
    if (grass && Object.values(grass).some(t => t.length)) {
      grassMat = new THREE.MeshPhongMaterial({
        color: 0xffffff, flatShading: true, shininess: 0,
        transparent: true, vertexColors: true, side: THREE.DoubleSide
      });
      // Viento: vaivén en shader según la fase por posición de instancia.
      // Solo anima cuando el mapa repinta (tour, órbita, navegación).
      const uTime = this.timeUniform;
      grassMat.onBeforeCompile = sh => {
        sh.uniforms.uTime = uTime;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <begin_vertex>",
            "#include <begin_vertex>\n" +
            "float ph = dot(instanceMatrix[3].xz, vec2(37.0, 73.0));\n" +
            "transformed.x += sin(uTime * 1.8 + ph) * 0.12 * position.y;\n" +
            "transformed.z += cos(uTime * 1.3 + ph * 1.7) * 0.08 * position.y;");
      };
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const col = new THREE.Color();
      const origin = this.origin, s = this.scale;
      for (const [cls, list] of Object.entries(grass)) {
        if (!list.length) continue;
        // Las matas marcadas como variante (sin flor) van en su propio
        // mesh con la geometría alternativa de la clase
        const batches = [[TUFT_GEOS[cls], list.filter(t => !t.v)]];
        if (TUFT_GEOS[cls + "/alt"]) batches.push([TUFT_GEOS[cls + "/alt"], list.filter(t => t.v)]);
        for (const [geo, sub] of batches) {
          if (!sub.length) continue;
          const tufts = new THREE.InstancedMesh(geo, grassMat, sub.length);
          sub.forEach((t, i) => {
            const mc = maplibregl.MercatorCoordinate.fromLngLat([t.lon, t.lat], 0);
            eul.set(0, t.j * Math.PI * 2, 0);
            m.compose(
              new THREE.Vector3((mc.x - origin.x) / s, 0, (mc.y - origin.y) / s),
              q.setFromEuler(eul),
              new THREE.Vector3(t.h * 0.9 * GRASS_SCALE, t.h * GRASS_SCALE, t.h * 0.9 * GRASS_SCALE)
            );
            tufts.setMatrixAt(i, m);
            col.setHex(t.c).offsetHSL(0, 0, (t.j - 0.5) * 0.09);
            tufts.setColorAt(i, col);
          });
          tufts.instanceMatrix.needsUpdate = true;
          if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
          group.add(tufts);
        }
      }
    }

    return { group, trunkMat, crownMat, grassMat };
  },

  setGroupOpacity(g, o) {
    g.trunkMat.opacity = o;
    g.crownMat.opacity = o;
    if (g.grassMat) g.grassMat.opacity = o;
    g.group.visible = o > 0.02;
  },

  setOpacity(key, o) {
    if (this.groups[key]) this.setGroupOpacity(this.groups[key], o);
  },

  setGrowth(key, t) {
    if (this.groups[key]) this.groups[key].group.scale.y = Math.max(t, 0.0001);
  },

  render(gl, matrix) {
    this.timeUniform.value = performance.now() / 1000;
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(this.l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
};

export const TUFT_GEOS = {};
for (const [cls, cfg] of Object.entries(GRASS_CLASSES)) {
  TUFT_GEOS[cls] = buildTuftGeometry(4, cfg.tip, cfg.base, cfg.mid, cfg.midCol);
  if (cfg.alt) TUFT_GEOS[cls + "/alt"] = buildTuftGeometry(4, cfg.alt.tip, cfg.alt.base, cfg.alt.mid, cfg.alt.midCol);
}
