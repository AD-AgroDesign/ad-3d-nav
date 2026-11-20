# Harness de QA (herramienta de desarrollo)

Capturas deterministas del visor y diff de imágenes. No es parte del sitio (el workflow de staging no publica `dev/`).

## Instalación (una vez por entorno)
```bash
cd dev/qa
npm install
npx playwright install chromium          # si faltan librerías del sistema: npx playwright install --with-deps chromium
```

## Uso
En otra terminal, servir la raíz del repo: `python3 -m http.server 8080` (desde la raíz).

```bash
# línea base de las vistas canónicas del campo sintético, sin UI
node capture.mjs --hide-ui --out baseline
# después de un cambio
node capture.mjs --hide-ui --out out/despues
node diff.mjs baseline out/despues --out out/diff --json out/diff.json --max-pct 0.5
# con el simulador (desde F2)
node capture.mjs --hide-ui --runoff natural,velocidad --views home,rasante --out out/sim
```
Opciones de `capture.mjs`: `--base`, `--query` (default `fixture=demo_relieve`), `--extra` (default
`&terreno=1&calidad=alta`), `--views all|lista`, `--scenario ini|multi|both`, `--hide-ui`, `--runoff modos`, `--wait ms`.

## Notas
- Sin GPU, WebGL corre por SwiftShader (`QA_GPU=swiftshader`, default). Las imágenes sirven para comparar; los tiempos por
  frame no (los fps los mide el dueño en su equipo con `?fps`). En una máquina con GPU: `QA_GPU=gl` (Linux) o `QA_GPU=d3d11`
  (Windows). `QA_CHROME=<ruta>` usa un Chromium ya instalado en vez del que baja Playwright.
- Determinismo: `?qa` apaga el fundido de teselas y espera reposo; el script congela el tiempo (`freezeTime(12.5)`) y fija
  la semilla (`seed(1)`). Las teselas de satélite y DEM vienen de la red: si falta alguna, repetir.
- `diff.mjs` sale con 1 si algún par supera `--max-pct`. Métrica: delta YIQ tipo pixelmatch + ΔE76 medio global y por grilla.
- `capture.mjs` sale con 1 si la consola tuvo errores.
