// Chequeo de anchos de pantalla: vista `home` CON la UI a distintos anchos (default 1440,830,500; también 900 y 375).
// Uso: node anchos.mjs [--widths 1440,830,500] [--view home] [--scenario inicial] --out <dir>
// Salida: <out>/ancho-<px>.png, consola.json, overflow.json (elementos del panel que se salen de la pantalla).
import { parseArgs, launchHeadless, openViewer, mkdirp, path, fs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8080', query: 'fixture=demo_relieve',
  extra: '&terreno=1&calidad=alta', widths: '1440,830,500', view: 'home', scenario: 'inicial', out: './out/anchos', h: '900' });
const dir = mkdirp(a.out);
const browser = await launchHeadless();
const resumen = {}, consola = {};
for (const w of a.widths.split(',').map(Number)) {
  const { ctx, page, errors } = await openViewer(browser, { base: a.base, query: a.query, extra: a.extra, viewport: { width: w, height: +a.h } });
  await page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
  await page.evaluate(s => window.__nav3d.setScenario(s, { animate: false }), a.scenario);
  const views = await page.evaluate(() => window.__nav3d.views());
  await page.evaluate(v => window.__nav3d.setView(v), views[a.view]);
  await page.waitForTimeout(2500);
  resumen[w] = await page.evaluate(() => {
    const W = innerWidth, fuera = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !r.width) continue;
      if (r.right > W + 1 && !el.closest('canvas')) fuera.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)}`);
    }
    return { innerWidth: W, scrollWidth: document.documentElement.scrollWidth, fueraDePantalla: fuera.slice(0, 10) };
  });
  await page.screenshot({ path: path.join(dir, `ancho-${w}.png`) });
  consola[w] = errors;
  await ctx.close();
  console.log(w, JSON.stringify(resumen[w]));
}
fs.writeFileSync(path.join(dir, 'overflow.json'), JSON.stringify(resumen, null, 2));
fs.writeFileSync(path.join(dir, 'consola.json'), JSON.stringify(consola, null, 2));
await browser.close();
