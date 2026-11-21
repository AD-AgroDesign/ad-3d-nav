/* ============ Paleta turbo del simulador de escorrentía (hidro-render, F3) ============
   Aproximación polinómica de grado 5 de la paleta "turbo" de Google (Anton Mikhailov, 2019, licencia Apache 2.0).
   UNA sola fórmula, dos salidas: `turboCss(t)` para la leyenda de la UI y `GLSL_TURBO` para el shader del mapa de velocidad,
   así la leyenda y el mapa nunca se desfasan. t ∈ [0, 1] (0 = azul oscuro, 1 = rojo oscuro); el mapa usa
   t = (log10 v − log10 vMin) / (log10 vMax − log10 vMin). Salida en sRGB (lo que se ve en pantalla). */

const R = [0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943];
const G = [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604];
const B = [0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973];

const horner = (c, x) => c[0] + x * (c[1] + x * (c[2] + x * (c[3] + x * (c[4] + x * c[5]))));
const c8 = v => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Color turbo de t ∈ [0, 1] como string CSS "rgb(r, g, b)" (enteros 0–255). */
export function turboCss(t) {
  const x = Math.min(1, Math.max(0, +t || 0));
  return `rgb(${c8(horner(R, x))}, ${c8(horner(G, x))}, ${c8(horner(B, x))})`;
}

const hornerGlsl = (c) => `(${c[0].toFixed(8)} + x * (${c[1].toFixed(8)} + x * (${c[2].toFixed(8)} + x * (${c[3].toFixed(8)} + x * (${c[4].toFixed(8)} + x * ${c[5].toFixed(8)})))))`;

/** Función GLSL `vec3 turbo(float x)` (sRGB, clampa x a [0, 1]) con los mismos coeficientes que turboCss. */
export const GLSL_TURBO =
  "vec3 turbo(float x) {\n  x = clamp(x, 0.0, 1.0);\n  return clamp(vec3(" + hornerGlsl(R) + ", " + hornerGlsl(G) + ", " + hornerGlsl(B) + "), 0.0, 1.0);\n}\n";
