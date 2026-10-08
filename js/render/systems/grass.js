/* ============ Sistema de render: matas de pasto (corredores y parches herbáceos) ============
   Dueño en la Ola 1-2: A2. Código movido desde vegLayer.buildGroup() y buildTuftGeometry()
   sin cambios de geometría, colores, densidades, semillas ni orden de construcción (§4).
   Contrato: §6.3. */
import * as THREE from "three";
import { GRASS_CLASSES, GRASS_SCALE } from "../../core/config.js";
import { patch } from "../shaderlib.js";

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

export const TUFT_GEOS = {};
for (const [cls, cfg] of Object.entries(GRASS_CLASSES)) {
  TUFT_GEOS[cls] = buildTuftGeometry(4, cfg.tip, cfg.base, cfg.mid, cfg.midCol);
  if (cfg.alt) TUFT_GEOS[cls + "/alt"] = buildTuftGeometry(4, cfg.alt.tip, cfg.alt.base, cfg.alt.mid, cfg.alt.midCol);
}

const built = {};   // scenarioKey → { grassMat, meshes: [{ label, mesh }] }

export default {
  id: "grass",

  build(ctx, scenarioKey, data, veg) {
    const grass = veg.grass;
    const group = new THREE.Group();
    const meshes = [];

    /* Matas de pasto instanciadas: un mesh por clase (cada clase tiene su
       geometría con el color de punta propio); material compartido */
    let grassMat = null;
    if (grass && Object.values(grass).some(t => t.length)) {
      grassMat = new THREE.MeshPhongMaterial({
        color: 0xffffff, flatShading: true, shininess: 0,
        transparent: true, vertexColors: true, side: THREE.DoubleSide
      });
      patch(grassMat, { wind: true });   // viento: ver shaderlib.js
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const col = new THREE.Color();
      for (const [cls, list] of Object.entries(grass)) {
        if (!list.length) continue;
        // Las matas marcadas como variante (sin flor) van en su propio
        // mesh con la geometría alternativa de la clase
        const batches = [[cls, TUFT_GEOS[cls], list.filter(t => !t.v)]];
        if (TUFT_GEOS[cls + "/alt"]) batches.push([cls + "/alt", TUFT_GEOS[cls + "/alt"], list.filter(t => t.v)]);
        for (const [label, geo, sub] of batches) {
          if (!sub.length) continue;
          const tufts = new THREE.InstancedMesh(geo, grassMat, sub.length);
          tufts.frustumCulled = false;   // ver nota en systems/trees.js (paridad con r149)
          sub.forEach((t, i) => {
            const [x, z] = ctx.toScene(t.lon, t.lat);
            eul.set(0, t.j * Math.PI * 2, 0);
            m.compose(
              new THREE.Vector3(x, 0, z),
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
          meshes.push({ label, mesh: tufts });
        }
      }
    }

    built[scenarioKey] = { grassMat, meshes };
    return { object3d: group, materials: grassMat ? [grassMat] : [] };
  },

  setOpacity(scenarioKey, o) {
    const b = built[scenarioKey];
    if (b && b.grassMat) b.grassMat.opacity = o;
  },

  setGrowth() {},   // el crecimiento lo aplica el host con scale.y del grupo del escenario

  /* Instancias por clase (para __nav3d.stats); la variante sin flor va como "<clase>/alt" */
  stats(scenarioKey) {
    const b = built[scenarioKey];
    const grass = {};
    if (b) for (const { label, mesh } of b.meshes) grass[label] = mesh.count;
    return { grass, grassTotal: Object.values(grass).reduce((s, n) => s + n, 0) };
  }
};
