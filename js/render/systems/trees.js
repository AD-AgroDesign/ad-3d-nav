/* ============ Sistema de render: árboles (troncos + copas instanciados) ============
   Dueño en la Ola 1-2: A2. Código movido desde vegLayer.buildGroup() sin cambios de
   geometría, colores, semillas ni orden de construcción (§4). Contrato: §6.3. */
import * as THREE from "three";
import { CHUNK_CELL_TREES, CROWN_PALETTE, TRUNK_COLOR } from "../../core/config.js";
import { partitionCells } from "./chunks.js";

const built = {};   // scenarioKey → { trunkMat, crownMat, trunks, crowns }

export default {
  id: "trees",

  build(ctx, scenarioKey, data, veg) {
    const trees = veg.trees;
    const group = new THREE.Group();

    const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 5);
    trunkGeo.translate(0, 0.5, 0); // base del tronco en y=0
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);

    const trunkMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });
    const crownMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, transparent: true });

    /* Chunking (T2): una InstancedMesh de troncos y otra de copas por celda de CHUNK_CELL_TREES m.
       Cada una con su boundingSphere real (computeBoundingSphere de r170) → Three descarta por
       frustum las celdas fuera de cuadro. Mismas posiciones, colores y escalas que antes. */
    const withXZ = trees.map(t => ({ t, xz: ctx.toScene(t.lon, t.lat) }));
    const cells = partitionCells(withXZ, CHUNK_CELL_TREES, o => o.xz);
    const trunkMeshes = [], crownMeshes = [];
    let nTrunks = 0, nCrowns = 0;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const col = new THREE.Color();

    for (const cell of cells.values()) {
      const list = cell.items;
      const lobes = list.reduce((s, o) => s + (o.t.lobe ? 1 : 0), 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, list.length + lobes);
      let ci = 0;
      list.forEach(({ t, xz }, i) => {
        // posición exacta en Mercator -> metros de escena (X este, Z sur)
        const [x, z] = xz;
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
      trunks.computeBoundingSphere();
      crowns.computeBoundingSphere();
      trunkMeshes.push(trunks); crownMeshes.push(crowns);
      nTrunks += trunks.count; nCrowns += crowns.count;
    }

    group.add(...trunkMeshes, ...crownMeshes);
    built[scenarioKey] = { trunkMat, crownMat, nTrunks, nCrowns, chunks: trunkMeshes.length };
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
    return b ? { trunks: b.nTrunks, crowns: b.nCrowns, treeChunks: b.chunks } : { trunks: 0, crowns: 0, treeChunks: 0 };
  }
};
