// Panel del simulador (G2, F3): Agua natural y Velocidad (leyenda turbo + deslizador de lluvia) y la marca "Ilustrativo" sobre el mapa,
// a 1440/830/500/375 px. Por ancho y estado saca el panel (recorte) y la vista completa con la marca.
// Uso: node panel_g2.mjs [--base http://localhost:8080] [--widths 1440,830,500,375] --out out/panel_g2 --sheet hoja_panel.jpg
// Salida: <out>/<ancho>-<natural|velocidad>-panel.png, <ancho>-<natural|velocidad>-mapa.png, overflow.json (desborde, marca vs. atribución/panel,
//   prueba del deslizador con teclado), console.json, hoja JPG.
import { parseArgs, launchHeadless, openViewer, mkdirp, path, fs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8080', widths: '1440,830,500,375', out: './out/panel_g2', h: '900', sheet: '', quality: '80' });
const dir = mkdirp(a.out), widths = a.widths.split(',').map(Number);
const browser = await launchHeadless();
const consola = {}, info = {};
for (const w of widths) {
  const { ctx, page, errors } = await openViewer(browser, { base: a.base, extra: '&terreno=1&calidad=alta', viewport: { width: w, height: +a.h } });
  await page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
  await page.waitForSelector('#runoff-section', { timeout: 30000 });
  for (const modo of ['natural', 'velocidad']) {
    await page.evaluate(async m => { await window.__nav3d.runoff.set(m); await window.__nav3d.runoff.ready; }, modo);
    await page.waitForTimeout(2500);
    const colapsado = () => page.evaluate(() => document.querySelector('#panel').classList.contains('collapsed'));
    // vista completa con el panel como lo deja el usuario al arrancar (en <= 500 px, colapsado): se ve la marca sobre el mapa
    if (!(await colapsado()) && w <= 830) { await page.click('#btn-panel'); await page.waitForTimeout(600); }   // <= 830 px: hoja inferior, se cierra para ver el mapa
    const marca = await page.evaluate(() => {
      const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), v: getComputedStyle(el).visibility !== 'hidden' && b.width > 0 }; };
      const m = r(document.querySelector('#runoff-marca')), at = r(document.querySelector('.maplibregl-ctrl-attrib')), p = r(document.querySelector('#panel')),
        sint = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /campo sint/i.test(e.textContent)).map(r)[0] || null;
      const cruza = (u, v) => !!(u && v && u.v && v.v && u.x < v.r && u.r > v.x && u.y < v.b && u.b > v.y);
      return { marca: m, texto: document.querySelector('#runoff-marca')?.textContent, atribucion: at, sintetico: sint, solapaAtribucion: cruza(m, at), solapaSintetico: cruza(m, sint), solapaPanel: cruza(m, p), scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    });
    await page.screenshot({ path: path.join(dir, `${w}-${modo}-mapa.png`) });
    // tira del pie del mapa (marca + atribución) a tamaño real para leerla
    await page.screenshot({ path: path.join(dir, `${w}-${modo}-marca.png`), clip: { x: 0, y: +a.h - 150, width: w, height: 150 } });
    // el panel: se abre si está colapsado y se lleva el bloque del simulador al centro
    if (await colapsado()) { await page.click('#btn-panel'); await page.waitForTimeout(800); }
    await page.evaluate(() => document.querySelector('#runoff-section').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    const desb = await page.evaluate(() => {
      const p = document.querySelector('#panel'), s = document.querySelector('#runoff-section'), pr = p.getBoundingClientRect(), out = [];
      for (const el of s.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (el.closest('.runoff-sr') || el.classList.contains('runoff-sr')) continue;
        if (r.width && (r.right > pr.right + 1 || r.left < pr.left - 1 || el.scrollWidth > el.clientWidth + 1)) out.push(el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 24)); }
      const mq = document.querySelector('.runoff-marcas'), mr = mq ? [...mq.children].map(c => Math.round(c.getBoundingClientRect().right)) : [];
      const sl = document.querySelector('#runoff-lluvia-in');
      return { panelW: Math.round(pr.width), panelRight: Math.round(pr.right), marcasMaxRight: mr.length ? Math.max(...mr) : null, desbordan: out.slice(0, 6), slider: sl ? { value: sl.value, min: sl.min, max: sl.max, aria: sl.getAttribute('aria-valuetext'), rotulo: (document.querySelector('#runoff-lluvia-val')?.textContent || '').trim() } : null,
        leyenda: (document.querySelector('#runoff-leyenda')?.innerText || '').replace(/\s+/g, ' ').slice(0, 220), pie: [...s.querySelectorAll('*')].map(e => e.children.length === 0 ? e.textContent.trim() : '').filter(t => /ilustrativo/i.test(t)).slice(0, 2) };
    });
    const box = await page.evaluate(() => { const r = document.querySelector('#panel').getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y);
      return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y }; });
    await page.screenshot({ path: path.join(dir, `${w}-${modo}-panel.png`), clip: box });
    info[`${w}-${modo}`] = { ...marca, ...desb };
    console.log(w, modo, JSON.stringify({ marca: marca.marca, solapa: [marca.solapaAtribucion, marca.solapaSintetico, marca.solapaPanel], desbordan: desb.desbordan, slider: desb.slider }));
    // cerrar el panel en móvil para que la próxima vista completa lo encuentre abierto/cerrado de forma consistente
    if (w <= 500 && !(await colapsado())) { await page.click('#btn-panel'); await page.waitForTimeout(500); }
  }
  // deslizador con teclado en Velocidad: dos pasos y vuelta
  await page.evaluate(() => document.querySelector('#runoff-lluvia-in')?.scrollIntoView({ block: 'center' }));
  if (await page.evaluate(() => document.querySelector('#panel').classList.contains('collapsed'))) { await page.click('#btn-panel'); await page.waitForTimeout(500); }
  await page.focus('#runoff-lluvia-in'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800);
  info[`${w}-teclado`] = await page.evaluate(async () => { await window.__nav3d.runoff.ready; return { slider: document.querySelector('#runoff-lluvia-in').value, rotulo: document.querySelector('#runoff-lluvia-val')?.textContent.trim(), estado: window.__nav3d.runoff.stats().rainMmH }; });
  consola[w] = errors; await ctx.close();
}
fs.writeFileSync(path.join(dir, 'overflow.json'), JSON.stringify(info, null, 2));
fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(consola, null, 2));
if (a.sheet) {
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const fig = (w, modo, tipo, cap) => `<figure style="margin:0"><img src="${b64(path.join(dir, `${w}-${modo}-${tipo}.png`))}" style="${tipo === 'panel' ? `max-height:${w >= 1000 ? 560 : 360}px;max-width:${w >= 1000 ? 330 : 480}px` : `max-height:${w >= 1000 ? 330 : 300}px;max-width:${w >= 1000 ? 560 : 440}px`};display:block;border:1px solid #444"><figcaption style="padding:3px 2px">${cap}</figcaption></figure>`;
  const rows = widths.map(w => `<div style="display:flex;gap:10px;align-items:flex-start;margin:8px 0">${fig(w, 'natural', 'panel', w + ' px · panel · Agua natural')}${fig(w, 'velocidad', 'panel', w + ' px · panel · Velocidad (leyenda + lluvia)')}<div>${fig(w, 'velocidad', 'mapa', w + ' px · mapa (panel cerrado en <= 830)')}${fig(w, 'velocidad', 'marca', w + ' px · pie del mapa: marca "Ilustrativo" y atribución')}</div></div>`).join('');
  const pg = await browser.newPage({ viewport: { width: 1500, height: 400 } });
  await pg.setContent(`<body style="margin:0;background:#111;font:14px sans-serif;color:#eee;padding:8px"><h3 style="margin:4px">G2 · Panel del simulador: Agua natural y Velocidad, y la marca sobre el mapa (campo sintético)</h3>${rows}</body>`);
  await pg.screenshot({ path: a.sheet, type: 'jpeg', quality: +a.quality, fullPage: true });
  console.log('hoja', a.sheet);
}
await browser.close();
