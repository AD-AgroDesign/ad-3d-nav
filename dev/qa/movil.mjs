// Móvil (IS_MOBILE = max-width 760 px): estelas a la mitad. Mide runoffParticles de Velocidad en escritorio y en celular emulado
// (isMobile + hasTouch) a 375x812 y 500x900, en Alta, Media (la calidad por defecto en móvil) y Baja.
// Uso: node movil.mjs [--base http://localhost:8220] --out out/movil
import { parseArgs, launchHeadless, openViewer, hideUI, mkdirp, path, fs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8220', out: './out/movil' });
const dir = mkdirp(a.out), browser = await launchHeadless(), res = {};
const CONF = [-59.26342964, -37.40855088];
const casos = [['escritorio-1280-alta', 1280, 720, false, '&calidad=alta'], ['m500-alta', 500, 900, true, '&calidad=alta'], ['m375-alta', 375, 812, true, '&calidad=alta'],
  ['escritorio-1280-media', 1280, 720, false, '&calidad=media'], ['m375-media', 375, 812, true, '&calidad=media'],
  ['escritorio-1280-baja', 1280, 720, false, '&calidad=baja'], ['m375-baja', 375, 812, true, '&calidad=baja']];
for (const [n, w, h, mob, cal] of casos) {
  const o = await openViewer(browser, { base: a.base, extra: '&terreno=1' + cal, viewport: { width: w, height: h }, ctxOpts: mob ? { isMobile: true, hasTouch: true } : {} });
  await o.page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
  const isMobile = await o.page.evaluate(() => matchMedia('(max-width: 760px)').matches);
  const r = { isMobile, calidad: cal.slice(9) };
  await o.page.evaluate(async () => { await window.__nav3d.runoff.set('velocidad'); await window.__nav3d.runoff.ready; });
  const canon = await o.page.evaluate(() => window.__nav3d.views());
  for (const [vn, v] of [['home', canon.home], ['conf-obl', { center: CONF, zoom: 17.2, pitch: 60, bearing: 30 }]]) {
    await o.page.evaluate(v => window.__nav3d.setView(v), v); await o.page.waitForTimeout(2500);
    const st = await o.page.evaluate(() => window.__nav3d.stats());
    r[vn] = { drawCalls: st.drawCalls, estelas: Object.fromEntries(Object.entries(st.instances || {}).map(([k, i]) => [k, i?.runoffParticles ?? null])), runoffTris: st.instances?.inicial?.runoffTris };
  }
  r.errores = o.errors.filter(e => !/GPU stall/.test(e));
  if (n === 'm375-alta') await o.page.screenshot({ path: path.join(dir, 'm375-velocidad.png') });
  res[n] = r; console.log(n, JSON.stringify(r)); await o.ctx.close();
}
fs.writeFileSync(path.join(dir, 'movil.json'), JSON.stringify(res, null, 2));
await browser.close();
