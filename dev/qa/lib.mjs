// Utilidades comunes del harness de QA (herramienta de desarrollo: no es parte de la app).
// Multiplataforma: usa el Chromium que instala Playwright (`npx playwright install chromium`).
// En la nube no hay GPU: WebGL corre por software (SwiftShader). Sirve para capturas y diffs, NO para medir fps.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv, defaults = {}) {
  const a = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}

// QA_GPU=d3d11 (Windows con GPU) | gl | swiftshader (default: sin GPU, determinista).
const GPU = process.env.QA_GPU || 'swiftshader';
export const GPU_ARGS = {
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  gl: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  d3d11: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
}[GPU] || [];

// QA_CHROME=<ruta> usa un Chromium ya instalado en vez del que baja Playwright (útil en una PC con otra versión).
export async function launchHeadless(extraArgs = []) {
  return chromium.launch({ headless: true, args: [...GPU_ARGS, ...extraArgs],
    ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
}

export function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); return d; }

// Abre el visor con ?qa y espera a que el escenario esté montado.
// `query` es la parte que elige el campo: por defecto el campo sintético (`fixture=demo_relieve`).
// SwiftShader es lento: los timeouts son generosos.
export async function openViewer(browser, { base = 'http://localhost:8080', query = 'fixture=demo_relieve', extra = '',
  viewport = { width: 1600, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  const url = `${base}/?${query}&qa${extra}`;
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => window.__nav3d, null, { timeout: 120000 });
  await page.evaluate(() => window.__nav3d.ready);
  return { ctx, page, errors, url };
}

// Oculta panel, header, controles y marcas: solo la escena (para comparar imágenes).
export async function hideUI(page) {
  await page.addStyleTag({ content:
    '#topbar,#panel,#flight-controls,#tour-banner,.maplibregl-control-container{display:none!important}' });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *'))
      if (el.children.length === 0 && /modo local|campo sint/i.test(el.textContent)) el.style.display = 'none';
    const m = window.__nav3d.map; m.resize();
    return window.__nav3d.setView({ center: m.getCenter().toArray(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() });
  });
  await page.waitForTimeout(500);
}

export async function gpuRenderer(page) {
  return page.evaluate(() => {
    const gl = window.__nav3d.map.getCanvas().getContext('webgl2') || window.__nav3d.map.getCanvas().getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) }
               : { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER) };
  });
}

export { path, fs };
