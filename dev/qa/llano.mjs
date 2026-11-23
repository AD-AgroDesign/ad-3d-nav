// Estado deshabilitado del simulador (campo llano / sin modelo de terreno). No hay fixture llano: se simula SIN tocar la app.
//   caso sin-dem : ?terreno=0 (la app declara "sin modelo de terreno")
//   caso llano   : tras cargar, se pisa terrain.stats (objeto exportado de js/terrain/terrain.js) con relieve nulo antes de prender
// Uso: node llano.mjs [--base http://localhost:8220] [--vers 20261124] --out out/llano
// Salida: <out>/<caso>.png (panel), <out>/llano.json (estado, motivo, UI, worker, pedidos de red tras intentar prender).
import { parseArgs, launchHeadless, openViewer, mkdirp, path, fs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8220', vers: '20261124', out: './out/llano', w: '1440' });
const dir = mkdirp(a.out), browser = await launchHeadless(), res = {};
async function caso(nombre, extra, forzarLlano) {
  const o = await openViewer(browser, { base: a.base, extra, viewport: { width: +a.w, height: 900 } });
  const workers = [], reqs = []; o.page.on('worker', w => workers.push(w.url())); o.page.on('request', r => reqs.push(r.url()));
  await o.page.waitForTimeout(3000);
  if (forzarLlano) await o.page.evaluate(async v => { const t = await import(`/js/terrain/terrain.js?v=${v}`); window.__t0 = { ...t.terrain.stats };
    t.terrain.stats = { ...t.terrain.stats, desvioResidual: 0, pendienteP95: 0 };
    window.__nav3d.setScenario('multi', { animate: false }); window.__nav3d.setScenario('inicial', { animate: false }); }, a.vers);   // el cambio de escenario re-evalúa la UI
  await o.page.waitForTimeout(1500);
  const antes = await o.page.evaluate(() => { const s = window.__nav3d.runoff.stats(); return { mode: s.mode, available: s.available, reason: s.reason }; });
  const n0 = reqs.length;
  const intento = await o.page.evaluate(async () => { const r = await window.__nav3d.runoff.set('natural'); await new Promise(r => setTimeout(r, 1500)); const s = window.__nav3d.runoff.stats(); return { devuelve: r, mode: s.mode, available: s.available, reason: s.reason, computing: s.computing, result: !!s.result }; });
  const ui = await o.page.evaluate(() => {
    const s = document.querySelector('#runoff-section'); if (!s) return { seccion: false };
    const sw = s.querySelector('input[type=checkbox], [role=switch]');
    return { seccion: true, texto: s.innerText.replace(/\s+/g, ' ').trim().slice(0, 300), interruptorDeshabilitado: sw ? (sw.disabled || sw.getAttribute('aria-disabled') === 'true') : null,
      botones: [...s.querySelectorAll('button, input')].map(b => ({ id: b.id, txt: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' })),
      marca: document.querySelector('#runoff-marca')?.getBoundingClientRect().width > 0 };
  });
  await o.page.evaluate(() => document.querySelector('#runoff-section')?.scrollIntoView({ block: 'center' })); await o.page.waitForTimeout(400);
  const box = await o.page.evaluate(() => { const r = document.querySelector('#panel').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(innerWidth, r.width), height: Math.min(innerHeight, r.height) }; });
  await o.page.screenshot({ path: path.join(dir, nombre + '.png'), clip: box });
  res[nombre] = { antes, intento, ui, workers: workers.filter(u => /hydro\/worker/.test(u)).length, pedidosDespuesDeIntentar: reqs.length - n0, errores: o.errors.filter(e => !/GPU stall/.test(e)) };
  console.log(nombre, JSON.stringify(res[nombre]));
  await o.ctx.close();
}
await caso('sin-dem', '&terreno=0', false);
await caso('llano-forzado', '&terreno=1&calidad=alta', true);
await caso('control-con-relieve', '&terreno=1&calidad=alta', false);
fs.writeFileSync(path.join(dir, 'llano.json'), JSON.stringify(res, null, 2));
await browser.close();
