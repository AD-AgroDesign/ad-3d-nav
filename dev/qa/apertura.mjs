// Pedidos de red al abrir el visor con el simulador APAGADO: compara dos servidores (rama nueva vs. una base) y lista las diferencias.
// Uso: node apertura.mjs --a http://localhost:8220 --b http://localhost:8222 [--espera 8000] --out out/apertura.json
// Normaliza: sin origen ni ?v=. Separa código propio (js/css/html del mismo origen) de datos y recursos externos (teselas, fixtures, fuentes).
import { parseArgs, launchHeadless, mkdirp, fs, path } from './lib.mjs';
const a = parseArgs(process.argv.slice(2), { a: 'http://localhost:8220', b: 'http://localhost:8222', espera: '8000', out: './out/apertura.json' });
const browser = await launchHeadless();
async function abrir(base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage();
  const urls = [], workers = [];
  page.on('request', r => urls.push(r.url()));
  page.on('worker', w => workers.push(w.url()));
  await page.goto(`${base}/?fixture=demo_relieve&qa&terreno=1&calidad=alta`, { timeout: 120000 });
  await page.waitForFunction(() => window.__nav3d, null, { timeout: 120000 });
  await page.evaluate(() => window.__nav3d.ready);
  await page.waitForTimeout(+a.espera);
  const modo = await page.evaluate(() => window.__nav3d.runoff?.stats().mode ?? 'sin-api');
  await ctx.close();
  const norm = u => { const x = new URL(u); const own = u.startsWith(base); return (own ? '' : x.origin) + x.pathname + (own ? '' : ''); };
  return { workers, modo, total: urls.length, set: new Set(urls.map(norm)) };
}
const A = await abrir(a.a), B = await abrir(a.b);
const tipo = u => /^https?:/.test(u) ? 'externo' : /\.(js|mjs|css|html)$/.test(u) || u === '/' ? 'código' : 'dato local';
const soloA = [...A.set].filter(u => !B.set.has(u)), soloB = [...B.set].filter(u => !A.set.has(u));
const out = { a: a.a, b: a.b, pedidosA: A.total, pedidosB: B.total, unicosA: A.set.size, unicosB: B.set.size, workersA: A.workers, workersB: B.workers, modoA: A.modo, modoB: B.modo,
  soloEnA: soloA.map(u => ({ u, tipo: tipo(u) })), soloEnB: soloB.map(u => ({ u, tipo: tipo(u) })) };
fs.writeFileSync(a.out, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, soloEnA: out.soloEnA.length + ' (ver json)', soloEnB: out.soloEnB.length }, null, 1));
for (const t of ['externo', 'dato local', 'código']) console.log(t, 'solo A:', out.soloEnA.filter(x => x.tipo === t).length, 'solo B:', out.soloEnB.filter(x => x.tipo === t).length);
await browser.close();
