#!/usr/bin/env python3
"""Convierte grid.npz (salida de velocidad.py --dump) a binarios planos que lee dev/test/hydro.test.mjs sin dependencias.
Uso: python3 dev/test/ref_to_bin.py <dir con grid.npz>   ->   <dir>/bin/<nombre>.f64 (Float64 little-endian) + bin/manifest.json
No se commitea nada de esto: vive fuera del repo (p. ej. /tmp/hidro-ref)."""
import json, sys
from pathlib import Path
import numpy as np

d = Path(sys.argv[1]); out = d / "bin"; out.mkdir(exist_ok=True)
z = np.load(d / "grid.npz")
man = {"shape": None, "arrays": {}}
for k in z.files:
    a = np.ascontiguousarray(z[k]).astype("<f8")
    man["shape"] = list(a.shape)
    (out / f"{k}.f64").write_bytes(a.tobytes())
    man["arrays"][k] = f"{k}.f64"
json.dump(man, open(out / "manifest.json", "w"))
print("ok", man["shape"], len(man["arrays"]), "arrays")
