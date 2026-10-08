/* ============ Sistema de render: árboles (troncos + copas instanciados) ============
   Dueño en la Ola 1-2: A2. Código movido desde vegLayer.buildGroup() sin cambios de
   geometría, colores, semillas ni orden de construcción (§4). Contrato: §6.3. */
import * as THREE from "three";
import { CROWN_PALETTE, TRUNK_COLOR } from "../../core/config.js";

const built = {};   // scenarioKey → { trunkMat, crownMat, trunks, crowns }

export default {
  id: "trees",

  build(ctx, scenarioKey, data, veg) {
    const trees = veg.trees;
    const group = new THREE.Group();
    const nLobes = trees.reduce((s, t) => s + (t.lobe ? 1 : 0), 0);

    const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 5);
    trunkGeo.translate(0, 0.5, 0); // base del tronco en y=0
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);

    const trunkMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });
    const crownMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length + nLobes);
    /* Paridad con r149 (T2/D9): en r149 el culling usaba la esfera de la geometría base
       (una mata/árbol) y en la práctica nunca descartaba la malla. r170 calcula la esfera
       real de las instancias y SÍ descarta mallas enteras fuera de cuadro (cambia stats(),
       no la imagen). Para este paso se mantiene "sin culling efectivo"; el culling por chunks
       y las esferas correctas son trabajo de A2 (InstancedMesh.computeBoundingSphere). */
    trunks.frustumCulled = false;
    crowns.frustumCulled = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const col = new THREE.Color();

    let ci = 0;
    trees.forEach((t, i) => {
      // posición exacta en Mercator -> metros de escena (X este, Z sur)
      const [x, z] = ctx.toScene(t.lon, t.lat);
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
    built[scenarioKey] = { trunkMat, crownMat, trunks, crowns };
    return { object3d: group, materials: [trunkMat, crownMat] };
  },

  setOpacity(scenarioKey, o) {
    const b = built[scenarioKey];
    if (!b) return;
    b.trunkMat.opacity = o;
    b.crownMat.opacity = o;
  },

  setGrowth() {},   // el crecimiento lo aplica el host con scale.y del grupo del escenario

  /* Instancias dibujables (para __nav3d.stats) */
  stats(scenarioKey) {
    const b = built[scenarioKey];
    return b ? { trunks: b.trunks.count, crowns: b.crowns.count } : { trunks: 0, crowns: 0 };
  }
};
