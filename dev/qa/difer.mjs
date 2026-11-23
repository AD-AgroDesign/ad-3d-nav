// Vistas y medidas del simulador en G3 (F4): apagado / Agua natural / Velocidad / Diferencia, mismo encuadre, inicial y multi.
// Sirve también contra la rama vieja (G2) con --base http://localhost:<otro puerto> --modes off,natural,velocidad para comparar Natural y Velocidad.
// Uso: node difer.mjs [--base http://localhost:8220] [--modes off,natural,velocidad,diferencia] [--only alta,baja,relieve,fundido,tiempos]
//        [--wait 2500] [--size 1280x720] [--repite velocidad] --out out/g3
// Salida: <out>/<modo>/<esc>-<vista>.png (Alta, relieve prendido), <out>/<modo>-repeticion/ (2.ª toma del modo --repite, ruido de estelas),
//   <out>/baja-<modo>/inicial-(home|conf-obl).png, <out>/sinrelieve-<modo>/<esc>-(home|conf-obl).png, medidas.json, console.json
// Confluencia principal del campo SINTÉTICO (C1 x V1), la misma que runoff.mjs. Las estelas no son deterministas (ver velocidad.mjs).
import { parseArgs, launchHeadless, openViewer, hideUI, gpuRenderer, mkdirp, fs, path } from './lib.mjs';

const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8220', wait: '2500', size: '1280x720', out: './out/g3',
  modes: 'off,natural,velocidad,diferencia', only: 'alta,baja,relieve,fundido,tiempos', repite: 'velocidad', vers: '' });
const only = new Set(a.only.split(',')), modes = a.modes.split(',');
const [W, H] = a.size.split('x').map(Number);
const CONF = [-59.26342964, -37.40855088];
const VERS = a.vers || '20261124';   // versión de caché de los imports relativos (G2 usa 20261123: --vers 20261123)
const dir = n => mkdirp(path.join(a.out, n));
const medidas = { base: a.base, vistas: {}, fundido: null, tiempos: {} };
const consola = {};
const TODAS = ['home', 'cenital', 'general62', 'conf-obl', 'conf-cen', 'conf-ras'];

async function abrir(extra) {
  const o = await openViewer(a._browser, { base: a.base, extra, viewport: { width: W, height: H } });
  const workers = []; o.page.on('worker', w => workers.push(w.url()));
  await hideUI(o.page);
  await o.page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
  const canon = await o.page.evaluate(() => window.__nav3d.views());
  o.V = { home: canon.home, cenital: canon.cenital, general62: { ...canon.home, pitch: 62 },
    'conf-obl': { center: CONF, zoom: 17.2, pitch: 60, bearing: 30 },
    'conf-cen': { center: CONF, zoom: 17.2, pitch: 0, bearing: 0 },
    'conf-ras': { center: CONF, zoom: 17.6, pitch: 79, bearing: 90 } };
  o.workers = workers;
  return o;
}
const set = (page, m) => page.evaluate(async m => { const ok = await window.__nav3d.runoff.set(m); if (m !== 'off') await window.__nav3d.runoff.ready; return ok; }, m);
async function tomar(o, carpeta, esc, vista) {
  await o.page.evaluate(v => window.__nav3d.setView(v), o.V[vista]);
  await o.page.waitForTimeout(+a.wait);
  await o.page.screenshot({ path: path.join(dir(carpeta), `${esc}-${vista}.png`) });
  const st = await o.page.evaluate(() => window.__nav3d.stats());
  const inst = st.instances?.[st.scenario] || {};
  medidas.vistas[`${carpeta}:${esc}-${vista}`] = { drawCalls: st.drawCalls, triangles: st.triangles, textures: st.textures ?? null,
    runoffTris: inst.runoffTris ?? null, runoffParticles: inst.runoffParticles ?? null, runoffTexMB: inst.runoffTexMB ?? null,
    instancias: Object.fromEntries(Object.entries(st.instances || {}).map(([k, v]) => [k, { tris: v?.runoffTris ?? null, texMB: v?.runoffTexMB ?? null, estelas: v?.runoffParticles ?? null }])) };
  console.log(`${carpeta} ${esc}-${vista}: ${st.drawCalls} draws, ${st.triangles} tris, runoffTris ${inst.runoffTris ?? '-'}, texMB ${inst.runoffTexMB ?? '-'}, estelas ${inst.runoffParticles ?? '-'}`);
}
async function juego(o, carpeta, modo, vistas, escs = ['inicial', 'multi']) {
  await set(o.page, modo);
  for (const esc of escs) {
    await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), esc);
    for (const v of vistas) await tomar(o, carpeta, esc, v);
  }
}

a._browser = await launchHeadless();
if (only.has('alta') || only.has('fundido') || only.has('tiempos')) {
  const o = await abrir('&terreno=1&calidad=alta');
  medidas.gpu = await gpuRenderer(o.page);
  medidas.workersAlInicio = o.workers.filter(u => /hydro\/worker/.test(u)).length;
  if (only.has('tiempos')) {
    // primer prendido (frío): pared hasta ready y tiempos internos del worker; después recálculo por lluvia
    const m0 = modes.find(m => m !== 'off');
    medidas.tiempos.primero = await o.page.evaluate(async m => { const t0 = performance.now(); await window.__nav3d.runoff.set(m); const r = await window.__nav3d.runoff.ready; return { modo: m, paredMs: Math.round(performance.now() - t0), workerMs: r?.stats?.ms ?? null }; }, m0);
    medidas.tiempos.lluvia = {};
    for (const mm of [10, 100, 50]) medidas.tiempos.lluvia[mm] = await o.page.evaluate(async mm => { const t0 = performance.now(); window.__nav3d.runoff.rain(mm); const r = await window.__nav3d.runoff.ready; return { paredMs: Math.round(performance.now() - t0), workerMs: r.stats.ms }; }, mm);
    medidas.tiempos.workerStats = await o.page.evaluate(() => { const s = window.__nav3d.runoff.stats(); return s.result && s.result.stats; });
    medidas.tiempos.estadoStats = await o.page.evaluate(() => { const s = window.__nav3d.runoff.stats(); return { mode: s.mode, rainMmH: s.rainMmH, available: s.available, reason: s.reason, claves: Object.keys(s) }; });
    await set(o.page, 'off');
  }
  if (only.has('alta')) {
    for (const m of modes) await juego(o, m, m, TODAS);
    if (a.repite && modes.includes(a.repite)) await juego(o, `${a.repite}-repeticion`, a.repite, ['home', 'cenital', 'conf-obl'], ['inicial']);
  }
  if (only.has('fundido')) {
    const fade = async modo => {
      await set(o.page, modo);
      await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), 'inicial');
      await o.page.evaluate(v => window.__nav3d.setView(v), o.V.home); await o.page.waitForTimeout(2000);
      const reposo = (await o.page.evaluate(() => window.__nav3d.stats())).drawCalls;
      const muestras = await o.page.evaluate(async () => {
        const out = []; const t0 = performance.now();
        window.__nav3d.setScenario('multi', { animate: true });
        while (performance.now() - t0 < 3500) { const s = await window.__nav3d.stats(); out.push({ t: Math.round(performance.now() - t0), d: s.drawCalls }); await new Promise(r => setTimeout(r, 100)); }
        return out;
      });
      await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), 'inicial');
      return { reposoInicial: reposo, maxDuranteFundido: Math.max(...muestras.map(m => m.d)) };
    };
    medidas.fundido = {};
    for (const m of modes) medidas.fundido[m] = await fade(m);
    console.log('fundido', JSON.stringify(medidas.fundido));
  }
  await set(o.page, 'off'); await o.page.waitForTimeout(800);
  const st = await o.page.evaluate(() => window.__nav3d.stats());
  medidas.alApagar = { runoffParticles: Object.values(st.instances || {}).map(i => i?.runoffParticles ?? null), runoffTris: Object.values(st.instances || {}).map(i => i?.runoffTris ?? null) };
  medidas.workersCreados = o.workers.filter(u => /hydro\/worker/.test(u)).length;
  consola.alta = o.errors; await o.ctx.close();
}
if (only.has('baja')) {
  const o = await abrir('&terreno=1&calidad=baja');
  for (const m of modes) await juego(o, `baja-${m}`, m, ['home', 'conf-obl'], ['inicial', 'multi']);
  consola.baja = o.errors; await o.ctx.close();
}
if (only.has('relieve')) {
  const o = await abrir('&terreno=1&calidad=alta');
  await o.page.evaluate(async v => { window.__r = await import(`/js/core/relief.js?v=${v}`); }, VERS);
  await o.page.evaluate(() => window.__r.setReliefSession(false));
  await o.page.waitForTimeout(5000);
  for (const m of modes) await juego(o, `sinrelieve-${m}`, m, ['home', 'conf-obl']);
  consola.relieve = o.errors; await o.ctx.close();
}
fs.writeFileSync(path.join(mkdirp(a.out), 'medidas.json'), JSON.stringify(medidas, null, 2));
fs.writeFileSync(path.join(a.out, 'console.json'), JSON.stringify(consola, null, 2));
await a._browser.close();
const todos = Object.values(consola).flat();
console.log(todos.length ? `Consola con ${todos.length} mensajes:\n  ` + [...new Set(todos)].slice(0, 12).join('\n  ') : 'Consola limpia');
