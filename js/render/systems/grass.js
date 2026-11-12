/* ============ Sistema de render: matas de pasto (corredores y parches herbáceos) ============
   Dueño en la Ola 1-2: A2. Código movido desde vegLayer.buildGroup() y buildTuftGeometry()
   sin cambios de geometría, colores, densidades, semillas ni orden de construcción (§4).
   Contrato: §6.3. */
import * as THREE from "three";
import { CHUNK_CELL_GRASS, GRASS_CLASSES, GRASS_AO, GRASS_LOD_BAND, GRASS_LOD_COMP_MAX, GRASS_LOD_FAR_MULT, GRASS_LOD_NEAR_MULT, GRASS_SCALE, WIND_IDLE_DIST } from "../../core/config.js";
import { quality } from "../../core/quality.js";
import { patch } from "../shaderlib.js";
import { idleDriver } from "../idle.js";
import { ChunkLod, addRank, applyAO, applyLod, cellSeed, partitionCells, shuffleDet } from "./chunks.js";
import { map } from "../../map/style.js";
import { uniforms } from "../lighting.js";

const _fr = new THREE.Frustum(), _sp = new THREE.Sphere();

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

/* Sal estable por clase para la semilla del orden aleatorio de cada celda */
const labelSalt = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

const built = {};   // scenarioKey → { grassMat, group, lod: ChunkLod, meshes: [{ label, n, mesh }] }

/* Uniform de LOD compartido por todos los materiales de pasto: (near m, far m, band, compMax). */
const lodU = { value: new THREE.Vector4(600, 3000, GRASS_LOD_BAND, GRASS_LOD_COMP_MAX) };
function setLodFromQuality(q) {
  const d = q.grassLodDist === Infinity ? 1e9 : q.grassLodDist;
  lodU.value.set(d * GRASS_LOD_NEAR_MULT, d * GRASS_LOD_FAR_MULT, GRASS_LOD_BAND, GRASS_LOD_COMP_MAX);
}
setLodFromQuality(quality);

export default {
  id: "grass",

  build(ctx, scenarioKey, data, veg) {
    const grass = veg.grass;
    const group = new THREE.Group();
    const meshes = [];
    const lod = new ChunkLod();

    /* Matas de pasto instanciadas: por clase y por CELDA de CHUNK_CELL_GRASS m (una InstancedMesh
       por celda y clase; cada clase tiene su geometría con el color de punta propio); material
       compartido. El chunking solo reordena: las posiciones, colores y escalas por mata son las
       mismas de siempre (mismo `t.lon/lat/j/h/c`). */
    let grassMat = null;
    if (grass && Object.values(grass).some(t => t.length)) {
      grassMat = new THREE.MeshPhongMaterial({
        color: 0xffffff, flatShading: true, shininess: 0,
        vertexColors: true, side: THREE.DoubleSide
      });
      /* Cross-fade de escenario por fade dither (A1, shaderlib): material OPACO, una sola pasada
         (sin transparencias ni orden de dibujo). Niebla unificada por distancia real. */
      patch(grassMat, { wind: true, fog: true, fade: scenarioKey });
      applyLod(grassMat, ctx.uniforms.uCamPos, lodU);   // LOD: se encadena DESPUÉS de patch()
      applyAO(grassMat, GRASS_AO.amount, 0, GRASS_AO.top);   // E-AO: solo el tramo inferior
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const col = new THREE.Color();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      for (const [cls, list] of Object.entries(grass)) {
        if (!list.length) continue;
        // Las matas marcadas como variante (sin flor) van en su propio
        // mesh con la geometría alternativa de la clase
        const batches = [[cls, TUFT_GEOS[cls], list.filter(t => !t.v)]];
        if (TUFT_GEOS[cls + "/alt"]) batches.push([cls + "/alt", TUFT_GEOS[cls + "/alt"], list.filter(t => t.v)]);
        batches.forEach(([label, geo, sub]) => {
          if (!sub.length) return;
          const withXZ = sub.map(t => ({ t, xz: ctx.toScene(t.lon, t.lat), gy: ctx.heightAt(t.lon, t.lat) }));   // A6: gy = altura del suelo (0 sin terreno)
          const cells = partitionCells(withXZ, CHUNK_CELL_GRASS, o => o.xz);
          for (const cell of cells.values()) {
            shuffleDet(cell.items, cellSeed(cell.ix, cell.iz, labelSalt(label)));
            const n = cell.items.length;
            const cg = geo.clone();             // geometría propia de la celda (lleva aRank)
            addRank(cg, n);
            const tufts = new THREE.InstancedMesh(cg, grassMat, n);
            cell.items.forEach(({ t, xz, gy }, i) => {
              const [x, z] = xz;
              eul.set(0, t.j * Math.PI * 2, 0);
              m.compose(
                pos.set(x, gy, z),
                q.setFromEuler(eul),
                scl.set(t.h * 0.9 * GRASS_SCALE, t.h * GRASS_SCALE, t.h * 0.9 * GRASS_SCALE)
              );
              tufts.setMatrixAt(i, m);
              col.setHex(t.c).offsetHSL(0, 0, (t.j - 0.5) * 0.09);
              tufts.setColorAt(i, col);
            });
            tufts.instanceMatrix.needsUpdate = true;
            if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
            lod.add(tufts, n);
            tufts.boundingSphere.radius += 1.5;   // holgura por el vaivén del viento
            group.add(tufts);
            meshes.push({ label, n, mesh: tufts });
          }
        });
      }
    }

    built[scenarioKey] = { grassMat, group, lod, meshes };
    return { object3d: group, materials: grassMat ? [grassMat] : [] };
  },

  setOpacity() {},   // el fade lo hace el dither (shaderlib.scenarioFade, escrito por host.setOpacity)

  setGrowth() {},   // el crecimiento lo aplica el host con scale.y del grupo del escenario

  /* LOD por distancia a la cámara (uCamPos): ajusta visibilidad y cuenta de cada celda */
  update(frame) {
    const c = frame.camPosScene;
    const lod = lodU.value;
    _fr.setFromProjectionMatrix(frame.viewProj);
    let windNear = false;
    for (const b of Object.values(built)) {
      if (!b.group.visible) continue;
      b.visibleChunks = b.lod.update(c, lod.x, lod.y, lod.z);
      if (windNear) continue;
      for (const k of b.lod.chunks) {   // viento en reposo: ¿hay pasto en cuadro a menos de WIND_IDLE_DIST?
        if (!k.mesh.visible) continue;
        if (Math.hypot(c.x - k.cx, c.y - k.cy, c.z - k.cz) - k.r < WIND_IDLE_DIST && _fr.intersectsSphere(_sp.set(_sp.center.set(k.cx, k.cy, k.cz), k.r))) { windNear = true; break; }
      }
    }
    idleDriver.request("grass", windNear);
  },

  onQuality(q) { setLodFromQuality(q); },

  /* Instancias por clase (para __nav3d.stats); la variante sin flor va como "<clase>/alt".
     Son las instancias TOTALES construidas (no las dibujadas tras el LOD). */
  stats(scenarioKey) {
    const b = built[scenarioKey];
    const grass = {};
    if (b) for (const { label, n } of b.meshes) grass[label] = (grass[label] || 0) + n;
    return {
      grass, grassTotal: Object.values(grass).reduce((s, n) => s + n, 0),
      grassChunks: b ? b.meshes.length : 0, grassChunksVisibles: b ? (b.visibleChunks ?? b.meshes.length) : 0
    };
  }
};
