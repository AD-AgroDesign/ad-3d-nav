// Vistas del simulador en "Velocidad" (G2, F3): antes (apagado) / después (prendido) del mismo encuadre, más lluvia, Baja,
// relieve apagado, Agua natural (para ver el cambio del LIFT respecto de G1) y las medidas de rendimiento.
// Complementa runoff.mjs (que sigue siendo el de Agua natural / G1); reutiliza sus coordenadas de la confluencia principal.
// Uso: node velocidad.mjs [--base http://localhost:8080] [--wait 2500] [--size 1280x720] [--only alta,baja,lluvia,relieve,natural] --out out/velocidad
// Salida (mismo esquema de nombres que capture.mjs: sirve con sheet.mjs --pair y diff.mjs):
//   <out>/alta-antes|alta-despues/<esc>-<vista>.png      Alta, relieve prendido, simulador apagado / Velocidad (home, cenital, conf-obl, conf-cen, conf-ras)
//   <out>/alta-repeticion/<esc>-<vista>.png              segunda toma de Velocidad (mide si las estelas son deterministas entre tomas)
//   <out>/baja-antes|baja-despues/inicial-(home|conf-obl).png  página aparte con calidad=baja
//   <out>/lluvia10|lluvia100/<esc>-home.png              Velocidad con 10 y 100 mm/h (la de 50 es alta-despues)
//   <out>/natural/<esc>-(home|cenital).png               Agua natural de hoy (comparar con G1: runoff.mjs en la rama vieja)
//   <out>/sinrelieve-antes|sinrelieve-despues/<esc>-(home|conf-obl).png  relieve apagado
//   <out>/medidas.json, console.json
// Las estelas son animadas: el dt viene de los frames reales, así que freezeTime/seed NO las hacen deterministas;
// alta-repeticion existe para cuantificarlo (ruido propio de las estelas, no regresión).
import { parseArgs, launchHeadless, openViewer, hideUI, gpuRenderer, mkdirp, fs, path } from './lib.mjs';

const a = parseArgs(process.argv.slice(2), { base: 'http://localhost:8080', wait: '2500', size: '1280x720', out: './out/velocidad',
  only: 'alta,baja,lluvia,relieve,natural,fundido' });
const only = new Set(a.only.split(','));
const [W, H] = a.size.split('x').map(Number);
const CONF = [-59.26342964, -37.40855088];   // confluencia principal del campo SINTÉTICO (ver runoff.mjs)
const VERS = '20261123';                     // versión de caché de los imports relativos (para particleTiming)
const dir = n => mkdirp(path.join(a.out, n));
const medidas = { vistas: {}, fundido: null, lluvia: {}, particulas: {} };
const consola = {};

async function abrir(extra, etiqueta) {
  const browser = a._browser;
  const o = await openViewer(browser, { base: a.base, extra, viewport: { width: W, height: H } });
  const workers = []; o.page.on('worker', w => workers.push(w.url()));
  await hideUI(o.page);
  await o.page.evaluate(() => { window.__nav3d.freezeTime(12.5); window.__nav3d.seed(1); });
  const canon = await o.page.evaluate(() => window.__nav3d.views());
  o.V = { home: canon.home, cenital: canon.cenital,
    'conf-obl': { center: CONF, zoom: 17.2, pitch: 60, bearing: 30 },
    'conf-cen': { center: CONF, zoom: 17.2, pitch: 0, bearing: 0 },
    'conf-ras': { center: CONF, zoom: 17.6, pitch: 79, bearing: 90 } };
  o.workers = workers; o.etiqueta = etiqueta;
  return o;
}
const set = (page, m) => page.evaluate(async m => { const ok = await window.__nav3d.runoff.set(m); if (m !== 'off') await window.__nav3d.runoff.ready; return ok; }, m);

async function tomar(o, carpeta, esc, vista, extraKey) {
  await o.page.evaluate(v => window.__nav3d.setView(v), o.V[vista]);
  await o.page.waitForTimeout(+a.wait);
  await o.page.screenshot({ path: path.join(dir(carpeta), `${esc}-${vista}.png`) });
  const st = await o.page.evaluate(() => window.__nav3d.stats());
  const inst = st.instances?.[st.scenario] || {};
  const pt = await o.page.evaluate(async v => { const m = await import(`/js/render/systems/runoff.js?v=${v}`); return m.particleTiming(); }, VERS).catch(() => null);
  medidas.vistas[`${carpeta}:${esc}-${vista}`] = { drawCalls: st.drawCalls, triangles: st.triangles, textures: st.textures ?? null,
    runoffTris: inst.runoffTris ?? null, runoffParticles: inst.runoffParticles ?? null, runoffTexMB: inst.runoffTexMB ?? null, particleTickMs: pt };
  console.log(`${carpeta} ${esc}-${vista}: ${st.drawCalls} draws, ${st.triangles} tris, estelas ${inst.runoffParticles ?? '-'}, tickMs ${JSON.stringify(pt)}`);
}
async function juego(o, carpeta, modo, vistas, escs = ['inicial', 'multi']) {
  await set(o.page, modo);
  for (const esc of escs) {
    await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), esc);
    for (const v of vistas) await tomar(o, carpeta, esc, v);
  }
}

const browser = await launchHeadless(); a._browser = browser;
const TODAS = ['home', 'cenital', 'conf-obl', 'conf-cen', 'conf-ras'];

if (only.has('alta') || only.has('lluvia') || only.has('natural') || only.has('relieve') || only.has('fundido')) {
  const o = await abrir('&terreno=1&calidad=alta', 'alta');
  medidas.gpu = await gpuRenderer(o.page);
  medidas.workersAlInicio = o.workers.filter(u => /hydro\/worker/.test(u)).length;
  if (only.has('alta')) {
    await juego(o, 'alta-antes', 'off', TODAS);
    await juego(o, 'alta-despues', 'velocidad', TODAS);
    await juego(o, 'alta-repeticion', 'velocidad', ['home', 'cenital', 'conf-obl'], ['inicial']);   // 2.ª toma para medir el ruido de las estelas
  }
  if (only.has('fundido')) {
    // fundido de escenarios (inicial -> multi, animado): draw calls máximos durante ~3,5 s con el simulador apagado / natural / velocidad.
    // Lo justo es comparar contra el MISMO fundido apagado (durante el fundido el visor ya dibuja los dos escenarios).
    const fade = async modo => {
      await set(o.page, modo);
      await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), 'inicial');
      await o.page.evaluate(v => window.__nav3d.setView(v), o.V.home); await o.page.waitForTimeout(2000);
      const reposo = (await o.page.evaluate(() => window.__nav3d.stats())).drawCalls;
      const muestras = await o.page.evaluate(async () => {
        const out = []; const t0 = performance.now();
        window.__nav3d.setScenario('multi', { animate: true });   // sin await: se muestrea durante el fundido
        while (performance.now() - t0 < 3500) { const s = await window.__nav3d.stats(); out.push({ t: Math.round(performance.now() - t0), d: s.drawCalls, p: Object.values(s.instances || {}).reduce((q, i) => q + (i?.runoffParticles || 0), 0) }); await new Promise(r => setTimeout(r, 100)); }
        return out;
      });
      await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), 'inicial');
      return { reposoInicial: reposo, maxDuranteFundido: Math.max(...muestras.map(m => m.d)), muestras };
    };
    medidas.fundido = { apagado: await fade('off'), natural: await fade('natural'), velocidad: await fade('velocidad') };
    medidas.fundido.extraNatural = medidas.fundido.natural.maxDuranteFundido - medidas.fundido.apagado.maxDuranteFundido;
    medidas.fundido.extraVelocidad = medidas.fundido.velocidad.maxDuranteFundido - medidas.fundido.apagado.maxDuranteFundido;
    console.log('fundido: max apagado', medidas.fundido.apagado.maxDuranteFundido, 'natural', medidas.fundido.natural.maxDuranteFundido, 'velocidad', medidas.fundido.velocidad.maxDuranteFundido);
  }
  if (only.has('lluvia')) {
    await set(o.page, 'velocidad');
    for (const mm of [10, 100]) {
      const t = await o.page.evaluate(async mm => { const t0 = performance.now(); window.__nav3d.runoff.rain(mm); const r = await window.__nav3d.runoff.ready; return { totalMs: Math.round(performance.now() - t0), worker: r.stats.ms }; }, mm);
      medidas.lluvia[mm] = t;
      for (const esc of ['inicial', 'multi']) {
        await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), esc);
        await tomar(o, `lluvia${mm}`, esc, 'home');
      }
    }
    // tiempos de recálculo con el simulador ya cargado (ida y vuelta) y vuelta a 50
    for (const mm of [50, 10, 100, 50]) {
      medidas.lluvia[`ciclo${mm}`] = await o.page.evaluate(async mm => { const t0 = performance.now(); window.__nav3d.runoff.rain(mm); const r = await window.__nav3d.runoff.ready; return { totalMs: Math.round(performance.now() - t0), worker: r.stats.ms }; }, mm);
    }
    await o.page.waitForTimeout(500);
  }
  if (only.has('natural')) await juego(o, 'natural', 'natural', ['home', 'cenital']);
  if (only.has('alta')) {
    // CPU de las partículas en la home (media móvil de tick) con Velocidad y animación
    await set(o.page, 'velocidad');
    await o.page.evaluate(k => window.__nav3d.setScenario(k, { animate: false }), 'inicial');
    await o.page.evaluate(v => window.__nav3d.setView(v), o.V.home); await o.page.waitForTimeout(4000);
    medidas.particulas.home = [];
    for (let i = 0; i < 5; i++) { medidas.particulas.home.push(await o.page.evaluate(async v => (await import(`/js/render/systems/runoff.js?v=${v}`)).particleTiming(), VERS)); await o.page.waitForTimeout(800); }
    // fps relativos (referencia, SwiftShader): frames en 3 s con simulador apagado y con Velocidad
    const frames = async () => o.page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
    medidas.fpsRelativos = { velocidadHome: await frames() };
    await set(o.page, 'off'); await o.page.waitForTimeout(800);
    medidas.fpsRelativos.apagadoHome = await frames();
  }
  if (only.has('relieve')) {
    await o.page.evaluate(async v => { window.__r = await import(`/js/core/relief.js?v=${v}`); }, VERS);
    await o.page.evaluate(() => window.__r.setReliefSession(false));
    await o.page.waitForTimeout(5000);
    await juego(o, 'sinrelieve-antes', 'off', ['home', 'conf-obl']);
    await juego(o, 'sinrelieve-despues', 'velocidad', ['home', 'conf-obl']);
    await set(o.page, 'off');
  }
  // apagar de nuevo y verificar que las estelas devuelven la memoria
  await set(o.page, 'off'); await o.page.waitForTimeout(800);
  const st = await o.page.evaluate(() => window.__nav3d.stats());
  medidas.alApagar = { runoffParticles: Object.values(st.instances || {}).map(i => i?.runoffParticles ?? null) };
  medidas.worker = await o.page.evaluate(() => { const s = window.__nav3d.runoff.stats(); return s.result && s.result.stats; });
  medidas.workersCreados = o.workers.filter(u => /hydro\/worker/.test(u)).length;
  consola.alta = o.errors; await o.ctx.close();
}
if (only.has('baja')) {
  const o = await abrir('&terreno=1&calidad=baja', 'baja');
  await juego(o, 'baja-antes', 'off', ['home', 'conf-obl'], ['inicial']);
  await juego(o, 'baja-despues', 'velocidad', ['home', 'conf-obl'], ['inicial']);
  consola.baja = o.errors; await o.ctx.close();
}
fs.writeFileSync(path.join(mkdirp(a.out), 'medidas.json'), JSON.stringify(medidas, null, 2));
fs.writeFileSync(path.join(a.out, 'console.json'), JSON.stringify(consola, null, 2));
await browser.close();
const todos = Object.values(consola).flat();
console.log(todos.length ? `Consola con ${todos.length} mensajes:\n  ` + todos.slice(0, 12).join('\n  ') : 'Consola limpia');
