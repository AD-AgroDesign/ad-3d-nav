// Panel del simulador (G1): bloque "Simulador de escorrentía" apagado, prendido y deshabilitado (?terreno=0) a 1440/830/500/375 px.
// Uso: node panel.mjs [--base http://localhost:8080] [--widths 1440,830,500,375] --out out/panel --sheet hoja_panel.jpg
// Salida: <out>/<ancho>-<apagado|prendido|deshabilitado>.png (el panel, desplazado hasta el bloque), overflow.json, console.json, hoja JPG.
import { parseArgs, launchHeadless, openViewer, mkdirp, path, fs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8080', widths: '1440,830,500,375', out: './out/panel', h: '900',
  sheet: '', quality: '80' });
const dir = mkdirp(a.out), widths = a.widths.split(',').map(Number);
const browser = await launchHeadless();
const consola = {}, overflow = {};
for (const w of widths) {
  for (const estado of ['apagado', 'prendido', 'deshabilitado']) {
    const extra = (estado === 'deshabilitado' ? '&terreno=0' : '&terreno=1') + '&calidad=alta';
    const { ctx, page, errors } = await openViewer(browser, { base: a.base, extra, viewport: { width: w, height: +a.h } });
    await page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
    await page.waitForSelector('#runoff-section', { timeout: 30000 });
    if (estado === 'prendido') {
      await page.evaluate(async () => { await window.__nav3d.runoff.set('natural'); await window.__nav3d.runoff.ready; });
      await page.waitForTimeout(1500);
    } else await page.waitForTimeout(2000);
    // en móvil (<= 500 px) el panel arranca colapsado: se abre con el botón ☰ como haría el usuario
    if (await page.evaluate(() => document.querySelector('#panel').classList.contains('collapsed'))) { await page.click('#btn-panel'); await page.waitForTimeout(800); }
    await page.evaluate(() => document.querySelector('#runoff-section').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    overflow[`${w}-${estado}`] = await page.evaluate(() => {
      const p = document.querySelector('#panel'), s = document.querySelector('#runoff-section'), pr = p.getBoundingClientRect(), out = [];
      for (const el of s.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > pr.right + 1 || r.left < pr.left - 1 || el.scrollWidth > el.clientWidth + 1)) out.push(el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 24)); }
      return { panelW: Math.round(pr.width), panelH: Math.round(pr.height), scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
               estado: { aria: document.querySelector('#runoff-section [role=switch]')?.getAttribute('aria-checked'), aDisabled: document.querySelector('#runoff-section [role=switch]')?.getAttribute('aria-disabled'),
                         texto: (document.querySelector('#runoff-estado')?.textContent || '').trim().slice(0, 100) }, desbordan: out.slice(0, 6) };
    });
    // recorte de pantalla sobre el rectángulo del panel (el screenshot del elemento sale en blanco cuando el panel es la hoja inferior)
    const box = await page.evaluate(() => { const r = document.querySelector('#panel').getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y);
      return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y }; });
    await page.screenshot({ path: path.join(dir, `${w}-${estado}.png`), clip: box });
    consola[`${w}-${estado}`] = errors; await ctx.close();
    console.log(w, estado, JSON.stringify(overflow[`${w}-${estado}`]));
  }
}
fs.writeFileSync(path.join(dir, 'overflow.json'), JSON.stringify(overflow, null, 2));
fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(consola, null, 2));
if (a.sheet) {
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const rows = widths.map(w => `<div style="display:flex;gap:10px;align-items:flex-start;margin:8px 0">${['apagado', 'prendido', 'deshabilitado'].map(e =>
    `<figure style="margin:0"><img src="${b64(path.join(dir, `${w}-${e}.png`))}" style="max-height:${w >= 1000 ? 520 : 330}px;max-width:${w >= 1000 ? 300 : 440}px;display:block;border:1px solid #444"><figcaption style="padding:3px 2px">${w} px · ${e === 'deshabilitado' ? 'deshabilitado (?terreno=0)' : e}</figcaption></figure>`).join('')}</div>`).join('');
  const page = await browser.newPage({ viewport: { width: 1400, height: 400 } });
  await page.setContent(`<body style="margin:0;background:#111;font:14px sans-serif;color:#eee;padding:8px"><h3 style="margin:4px">G1 · Panel: bloque "Simulador de escorrentía" (campo sintético)</h3>${rows}</body>`);
  await page.screenshot({ path: a.sheet, type: 'jpeg', quality: +a.quality, fullPage: true });
  console.log('hoja', a.sheet);
}
await browser.close();
