// Capturas antes/después del simulador de escorrentía (G1): la misma vista con el simulador apagado ("antes") y en
// "natural" ("después"), campo sintético, inicial y multi, más el relieve apagado en una general.
// Uso: node runoff.mjs [--base http://localhost:8080] [--mode natural] [--wait 2500] [--size 1280x720] --out out/runoff
// Salida: <out>/antes|despues/<escenario>-<vista>.png (+ <escenario>-sinrelieve-<vista>.png), medidas.json, console.json
//   (mismo esquema de nombres que capture.mjs: sirve con sheet.mjs --pair y diff.mjs).
// Confluencia principal: celda de mayor caudal (Q, escenario inicial) dentro del corredor C1 del campo sintético; es el cruce
//   de la vaguada V1 (494 ha de cuenca) con C1. Coordenadas del campo SINTÉTICO (ver fixtures/demo_relieve/meta.json).
import { parseArgs, launchHeadless, openViewer, hideUI, gpuRenderer, mkdirp, fs, path } from './lib.mjs';

const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8080', query: 'fixture=demo_relieve',
  extra: '&terreno=1&calidad=alta', mode: 'natural', wait: '2500', size: '1280x720', out: './out/runoff' });
const CONF = [-59.26342964, -37.40855088];
const [W, H] = a.size.split('x').map(Number);
const dirA = mkdirp(path.join(a.out, 'antes')), dirD = mkdirp(path.join(a.out, 'despues'));

const browser = await launchHeadless();
const { ctx, page, errors, url } = await openViewer(browser, { base: a.base, query: a.query, extra: a.extra, viewport: { width: W, height: H } });
console.log('abierto', url);
const workersHidro = [];
page.on('worker', w => workersHidro.push(w.url()));
const workersAlInicio = workersHidro.filter(u => /hydro\/worker/.test(u)).length;   // 0 con el simulador apagado
await hideUI(page);
await page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
const canon = await page.evaluate(() => window.__nav3d.views());
const V = {
  home: canon.home, cenital: canon.cenital,
  general62: { ...canon.home, pitch: 62 },
  'conf-obl': { center: CONF, zoom: 17.2, pitch: 60, bearing: 30 },
  'conf-cen': { center: CONF, zoom: 17.2, pitch: 0, bearing: 0 },
  'conf-ras': { center: CONF, zoom: 17.6, pitch: 79, bearing: 90 }
};
const set = (m) => page.evaluate(async m => { const ok = await window.__nav3d.runoff.set(m); if (m !== 'off') await window.__nav3d.runoff.ready; return ok; }, m);
const medidas = { gpu: await gpuRenderer(page), url, workersAlInicio, vistas: {} };

async function tomar(dir, esc, nombre, view, modo) {
  await page.evaluate(v => window.__nav3d.setView(v), view);
  await page.waitForTimeout(+a.wait);
  await page.screenshot({ path: path.join(dir, `${esc}-${nombre}.png`) });
  const st = await page.evaluate(() => window.__nav3d.stats());
  const inst = st.instances && Object.values(st.instances).find(i => i && i.runoffTexMB != null);
  medidas.vistas[`${modo}:${esc}-${nombre}`] = { drawCalls: st.drawCalls, triangles: st.triangles, textures: st.textures ?? st.memory?.textures ?? null,
    runoff: st.instances ? Object.fromEntries(Object.entries(st.instances).filter(([, v]) => v && v.runoffTexMB != null).map(([k, v]) => [k, v])) : null };
  console.log(`${modo} ${esc}-${nombre}: ${st.drawCalls} draws, ${st.triangles} tris`);
}
async function fase(modo, sinRelieve) {
  const dir = modo === 'antes' ? dirA : dirD;
  await set(modo === 'antes' ? 'off' : a.mode);
  for (const esc of ['inicial', 'multi']) {
    await page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), esc);
    for (const n of sinRelieve ? ['sinrelieve-general62', 'sinrelieve-conf-obl'] : Object.keys(V))
      await tomar(dir, esc, n, V[n.replace('sinrelieve-', '')], modo);
    if (sinRelieve && esc === 'inicial') { /* en multi también: es barato */ }
  }
}
await fase('antes'); await fase('despues');
// relieve apagado solo para esta visita (setReliefSession); el simulador ya sabe mostrarse con k = 0
await page.evaluate(async () => { const r = await import('/js/core/relief.js?v=' + (document.querySelector('script[type=module]')?.src.match(/v=(\d+)/)?.[1] || '')); window.__r = r; });
await page.evaluate(() => window.__r.setReliefSession(false));
await page.waitForTimeout(5000);
await fase('despues', true);   // con el simulador prendido y el relieve apagado
await set('off'); await page.waitForTimeout(500);
await fase('antes', true);     // el mismo punto de vista con el simulador apagado
medidas.worker = await page.evaluate(() => { const s = window.__nav3d.runoff.stats(); return s.result && s.result.stats; });
// tiempos del worker: el primer cálculo (medidas.worker.ms.total, ambos escenarios) y los recálculos por lluvia (solo evaluar) con 10 / 50 / 100 mm/h; SwiftShader no afecta al worker pero sí es una sola máquina
medidas.workerMsPorLluvia = {};
for (const mm of [10, 100, 50]) {
  medidas.workerMsPorLluvia[mm] = await page.evaluate(async mm => { window.__nav3d.runoff.rain(mm); const r = await window.__nav3d.runoff.ready; return r.stats.ms; }, mm);   // recálculo: solo "evaluar" (el terreno ya está en caché del worker)
}
medidas.workersCreados = workersHidro.filter(u => /hydro\/worker/.test(u)).length;
medidas.workersTodos = workersHidro.map(u => u.slice(0, 60));
fs.writeFileSync(path.join(a.out, 'medidas.json'), JSON.stringify(medidas, null, 2));
fs.writeFileSync(path.join(a.out, 'console.json'), JSON.stringify(errors, null, 2));
await ctx.close(); await browser.close();
console.log(errors.length ? `Consola con ${errors.length} mensajes:\n  ` + errors.slice(0, 12).join('\n  ') : 'Consola limpia');
