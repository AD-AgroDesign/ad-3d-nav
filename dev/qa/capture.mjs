// Capturas deterministas de las vistas canónicas del visor (y del simulador, cuando exista).
// Uso:
//   node capture.mjs [--base http://localhost:8080] [--query fixture=demo_relieve] [--extra "&terreno=1&calidad=alta"]
//                    [--views all|cenital,home,rasante,...] [--scenario ini|multi|both] [--hide-ui]
//                    [--runoff off,natural,velocidad,diferencia] [--wait 1500] [--size 1280x720] --out <dir>
// Salida: <out>/<inicial|multi>[-<modo>]-<vista>.png (--size, default 1280x720), views.json, stats.json, console.json
// --runoff usa window.__nav3d.runoff.set(modo) (existe desde F2); sin el flag, no lo toca.
import { parseArgs, launchHeadless, openViewer, hideUI, gpuRenderer, mkdirp, fs, path } from './lib.mjs';

const a = parseArgs(process.argv.slice(2), {
  base: 'http://localhost:8080', query: 'fixture=demo_relieve', extra: '&terreno=1&calidad=alta',
  views: 'all', scenario: 'both', out: './out', wait: '1500', size: '1280x720'
});
const scen = { ini: ['inicial'], inicial: ['inicial'], multi: ['multi'], both: ['inicial', 'multi'] }[a.scenario];
if (!scen) throw new Error('--scenario debe ser ini|multi|both');
const modes = a.runoff ? a.runoff.split(',') : [null];
const dir = mkdirp(a.out);

const browser = await launchHeadless();
const { ctx, page, errors, url } = await openViewer(browser, { base: a.base, query: a.query, extra: a.extra, viewport: { width: +a.size.split('x')[0], height: +a.size.split('x')[1] } });
console.log('abierto', url);
if (a['hide-ui']) await hideUI(page);
await page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });

const views = await page.evaluate(() => window.__nav3d.views());
const names = a.views === 'all' ? Object.keys(views) : a.views.split(',');
const stats = {};
for (const s of scen) {
  await page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), s);
  for (const mode of modes) {
    if (mode) {
      const ok = await page.evaluate(async m => {
        if (!window.__nav3d.runoff) return false;
        await window.__nav3d.runoff.set(m);
        await window.__nav3d.runoff.ready;
        return true;
      }, mode);
      if (!ok) { console.log('sin __nav3d.runoff: se omite --runoff'); break; }
    }
    for (const v of names) {
      if (!views[v]) { console.log(`sin vista ${v}`); continue; }
      await page.evaluate(view => window.__nav3d.setView(view), views[v]);
      await page.waitForTimeout(Number(a.wait));
      const name = `${s}${mode ? '-' + mode : ''}-${v}`;
      await page.screenshot({ path: path.join(dir, name + '.png') });
      stats[name] = await page.evaluate(() => window.__nav3d.stats());
      console.log(`${name}: ${stats[name].drawCalls} draws, ${stats[name].triangles} tris`);
    }
  }
}
fs.writeFileSync(path.join(dir, 'views.json'), JSON.stringify(views, null, 2));
fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify({ gpu: await gpuRenderer(page), url, stats }, null, 2));
fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(errors, null, 2));
await ctx.close(); await browser.close();
console.log(errors.length ? `Consola con ${errors.length} mensajes:\n  ` + errors.slice(0, 8).join('\n  ') : 'Consola limpia');
process.exit(errors.some(e => e.startsWith('[error]') || e.startsWith('[pageerror]')) ? 1 : 0);
