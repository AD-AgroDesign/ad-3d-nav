# Harness de QA (herramienta de desarrollo)

Capturas deterministas del visor y diff de imágenes. No es parte del sitio (el workflow de staging no publica `dev/`).

## Instalación (una vez por entorno)
```bash
cd dev/qa
npm ci                                   # playwright fijado en 1.63.0 (package-lock.json)
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
Simulador (G1, desde F2):
```bash
node runoff.mjs --out out/runoff         # antes (apagado) / después (natural): home, cenital, general62 y 3 de cerca en la confluencia
                                         # principal (C1 x V1), inicial y multi, + relieve apagado; medidas.json (stats, worker, texturas)
node sheet.mjs --pair out/runoff/antes out/runoff/despues --cols 4 --cell 400 --out hoja_g1.jpg
node panel.mjs --out out/panel --sheet hoja_panel.jpg   # bloque del simulador apagado/prendido/deshabilitado a 1440/830/500/375
```
Simulador, Velocidad (G2, desde F3):
```bash
node velocidad.mjs --out out/velocidad   # Velocidad apagado/prendido (home, cenital, 3 de la confluencia, inicial y multi, Alta), Baja, lluvia 10/100,
                                         # relieve apagado, Agua natural, fundido de escenarios (draws), tick de estelas; medidas.json. Opción --only alta,baja,lluvia,relieve,natural,fundido
node panel_g2.mjs --out out/panel_g2 --sheet hoja_panel.jpg   # panel en Agua natural y Velocidad (leyenda, deslizador) y la marca "Ilustrativo" a 1440/830/500/375
node sheet.mjs --pair out/velocidad/alta-antes out/velocidad/alta-despues --cols 4 --cell 440 --out hoja_g2.jpg
```
Las estelas son animadas y su dt viene de los frames reales: no son deterministas entre tomas (3-11 % de píxeles distintos entre dos tomas
del mismo encuadre). Para ruido de las estelas, comparar contra `alta-repeticion`, no contra la línea base.

Opciones de `capture.mjs`: `--base`, `--query` (default `fixture=demo_relieve`), `--extra` (default
`&terreno=1&calidad=alta`), `--views all|lista`, `--scenario ini|multi|both`, `--hide-ui`, `--runoff modos`, `--wait ms`.

Hoja de contacto y anchos de pantalla:
```bash
node sheet.mjs baseline --out ../../docs/hidro/compuertas/G0/hoja_linea_base.jpg          # grilla vista · escenario
node sheet.mjs --pair baseline out/despues --out hoja_antes_despues.jpg                    # pares antes/después
node anchos.mjs --widths 1440,900,830,500,375 --out out/anchos                             # home con UI + desborde
```
Las capturas salen a 1280x720 (`--size`) para que la línea base commiteada pese ~13 MB.

## Notas
- Sin GPU, WebGL corre por SwiftShader (`QA_GPU=swiftshader`, default). Las imágenes sirven para comparar; los tiempos por
  frame no (los fps los mide el dueño en su equipo con `?fps`). En una máquina con GPU: `QA_GPU=gl` (Linux) o `QA_GPU=d3d11`
  (Windows). `QA_CHROME=<ruta>` usa un Chromium ya instalado en vez del que baja Playwright.
- Determinismo: `?qa` apaga el fundido de teselas y espera reposo; el script congela el tiempo (`freezeTime(12.5)`) y fija
  la semilla (`seed(1)`). Las teselas de satélite y DEM vienen de la red: si falta alguna, repetir.
- `diff.mjs` sale con 1 si algún par supera `--max-pct`. Métrica: delta YIQ tipo pixelmatch + ΔE76 medio global y por grilla.
- `capture.mjs` sale con 1 si la consola tuvo errores.

Simulador, Diferencia y pulido (G3, desde F4):
```bash
node difer.mjs --out out/g3                 # apagado / natural / velocidad / diferencia (home, cenital, general62, conf-obl, conf-cen, conf-ras; inicial y multi), Baja, relieve apagado,
                                            # fundido de escenarios (draws), tiempos del worker y recálculo por lluvia. --base/--vers para correrlo contra otra rama (p. ej. G2: --vers 20261123 --modes off,natural,velocidad)
node apertura.mjs --a http://localhost:8220 --b <base> --out out/apertura.json   # pedidos de red al abrir con el simulador apagado, nueva vs. base (la base debe tener ?qa: G0 en adelante)
node llano.mjs --out out/llano              # estado deshabilitado: ?terreno=0 (sin-dem) y llano forzado pisando terrain.stats
node movil.mjs --out out/movil              # estelas a la mitad con isMobile (375x812 y 500x900) en Alta/Media/Baja vs. escritorio
node panel_g3.mjs --base http://localhost:8220 --out out/panel_g3 --sheet hoja_panel.jpg   # panel en las tres vistas con métricas a 1440/830/500/375 (<= 500 con isMobile) y la marca
```
