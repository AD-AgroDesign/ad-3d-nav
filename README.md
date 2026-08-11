# AgroDesign · Navegador 3D

Escenario 3D georreferenciado y navegable estilo vuelo de dron sobre imagen satelital real,
que permite conmutar entre el **paisaje actual** del establecimiento y el **diseño de paisaje
multifuncional** propuesto por AgroDesign (corredores biológicos y parches de naturaleza).

El acceso es privado: cada cliente ve únicamente sus campos, con las mismas credenciales que
usa en el dashboard (`dashboard.agrodesign.site`).

## Uso

Sitio estático puro: no requiere build. Servir la carpeta con cualquier servidor HTTP
(p. ej. `python -m http.server`) o publicarla en GitHub Pages.

Los datos GIS **no** se sirven con el sitio: viven en el bucket privado `gis3d` de Supabase y
se descargan con URL firmada después del login. Por eso `data/` está en `.gitignore` — la
copia local es sólo la fuente para `tools/upload_gis.py`.

## Control de acceso

```
Supabase Auth  →  profiles (rol, cliente_id)  →  campos [RLS]  →  bucket gis3d [RLS]
```

- Las cuentas son las mismas del dashboard; no hay alta de usuarios acá.
- Quién ve qué lo decide Postgres, no el JavaScript: la policy `campos_select` filtra la lista
  de campos y `gis3d_read_by_role` filtra los archivos. Manipular el front no da acceso a nada.
- Un campo aparece en el visor sólo si tiene `campos.nav3d_slug` cargado.
- Los admin ven todos los campos publicados; un cliente, sólo los suyos.

## Estructura

- `index.html` — UI (acceso, splash, header, panel, controles de vuelo)
- `css/style.css` — tema AgroDesign, responsive
- `js/auth.js` — login, permisos, selector de campos, URLs firmadas
- `js/main.js` — mapa MapLibre GL, vegetación 3D procedural, tour de dron, conmutador de escenarios
- `vendor/` — MapLibre GL 4.7.1, Three.js 0.149.0, supabase-js 2.112.2 (sin CDN externos)
- `data/<campo>/*.geojson` — copia local de los datos, fuera de git

## Fuentes de datos

- Imagen satelital: Esri World Imagery (© Esri, Maxar, Earthstar Geographics)
- Capas de paisaje: equipo GIS de AgroDesign (WGS84 / EPSG:4326)

## Agregar otro campo

**Desde el 2026-08-11 esto es automático**: `python upload_cliente.py <carpeta> --apply` en
`D:\Claude\PBI_dashboards` publica el campo acá como último paso (`publish_nav3d.py`). Sube
los mismos dos GeoJSON al bucket, arma las rutas y escribe las columnas `nav3d_*`; respeta el
`nav3d_slug` que ya tenga el campo y no toca `nav3d_maxzoom` si ya está determinado. Para
publicar sin repetir toda la carga: `python publish_nav3d.py <carpeta> --apply`.

Ese camino **no usa `data/`**: sube directo desde `mapas/<carpeta>/` del dashboard. Las copias
locales sólo hacen falta para el procedimiento manual de abajo.

### A mano (si hace falta)

1. Que el campo exista en la tabla `campos` del dashboard, con su `cliente_id`.
2. Copiar los dos GeoJSON a `data/<slug>/inicial.geojson` y `data/<slug>/multifuncional.geojson`.
3. Marcarlo como publicado en el visor (ver el bloque 4 de `tools/supabase_setup.sql` como
   modelo):

   ```sql
   UPDATE campos
   SET nav3d_slug    = '<slug>',
       nav3d_maxzoom = 17,
       nav3d_inicial = cliente_id::text || '/<slug>/inicial.geojson',
       nav3d_multi   = cliente_id::text || '/<slug>/multifuncional.geojson'
   WHERE id = '<uuid del campo>';
   ```

4. `python tools/upload_gis.py --campo <slug>`

No hay que tocar `js/main.js`: el encuadre inicial y los límites de navegación se calculan
de la geometría, y `classify()` tolera los distintos esquemas de atributos (`UNIDAD`/`Unidad`
con nombres largos, o sólo códigos `RASTER`). Las geometrías `Polygon` y los registros sin
geometría se normalizan al cargar. Si el campo trae una clase nueva, sumarla a `CLASS_META`,
`CLASS_ORDER` y `classify()`.

El `maxzoom` de cada campo es hasta dónde Esri tiene imagen nativa en esa zona (más allá
devuelve "Map data not yet available"): se verifica pidiendo el tile del centro por nivel y
comparando el tamaño (el placeholder pesa siempre 2521 bytes).

Un campo se abre con `?campo=<slug>`, siempre que el usuario tenga permiso sobre él; si no,
se ignora el parámetro. Sin parámetro, el visor pide elegir campo después del login.

## Herramientas (`../tools/`)

| Script | Para qué |
|---|---|
| `inspect_db.sql` | Lectura del estado de la base antes de tocar nada |
| `supabase_setup.sql` | Columnas `nav3d_*`, bucket privado, policy de Storage, publicación de campos |
| `upload_gis.py` | Sube los GeoJSON al bucket (`SUPABASE_SERVICE_KEY`, `--dry-run` disponible) |
| `verify_access.py` | Prueba que un cliente no puede firmar los archivos de otro |
