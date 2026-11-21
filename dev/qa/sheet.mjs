// Hoja de contacto: grilla de capturas con rótulo "vista · escenario" (JPG), armada con el mismo Chromium del harness.
// Uso: node sheet.mjs <carpeta|archivos...> --out hoja.jpg [--cols 4] [--cell 480] [--title "texto"]
//      Pares antes/después: node sheet.mjs --pair <A> <B> --out hoja.jpg   (A arriba, B abajo, mismo nombre)
import { parseArgs, launchHeadless, fs, path } from './lib.mjs';

const a = parseArgs(process.argv.slice(2), { cols: '4', cell: '480', out: 'hoja.jpg', title: '' });
const pair = a.pair === 'true';
let items = [];
const list = d => fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter(f => f.endsWith('.png')).sort().map(f => path.join(d, f)) : [d];
if (pair) {
  const [A, B] = a._;
  for (const f of list(A)) { const g = path.join(B, path.basename(f)); if (fs.existsSync(g)) items.push([f, 'antes'], [g, 'después']); }
} else items = a._.flatMap(list).map(f => [f, '']);
// rótulo "vista · escenario" a partir de "<escenario>[-modo]-<vista>.png"
const label = (f, tag) => {
  const n = path.basename(f, '.png'), m = n.match(/^(inicial|multi)-(.*)$/);
  return (m ? `${m[2]} · ${m[1]}` : n) + (tag ? ` · ${tag}` : '');
};
const cols = pair ? 2 : +a.cols;
const html = `<body style="margin:0;background:#111;font:14px sans-serif;color:#eee">${a.title ? `<h3 style="margin:8px">${a.title}</h3>` : ''}
<div style="display:grid;grid-template-columns:repeat(${cols},${a.cell}px);gap:6px;padding:6px;width:max-content">
${items.map(([f, t]) => `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="width:${a.cell}px;display:block"><figcaption style="padding:2px 4px">${label(f, t)}</figcaption></figure>`).join('')}
</div></body>`;
const browser = await launchHeadless();
const page = await browser.newPage({ viewport: { width: cols * (+a.cell + 6) + 12, height: 400 } });
await page.setContent(html);
fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
await page.screenshot({ path: a.out, type: 'jpeg', quality: 82, fullPage: true });
await browser.close();
console.log('hoja', a.out, items.length, 'imágenes');
