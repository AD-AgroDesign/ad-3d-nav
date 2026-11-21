/* ============ UI del Simulador de escorrentía (HIDRO · F2) ============
   Bloque propio del panel, entre "Calidad" y el pie. La UI NO calcula ni decide: lee el estado de hydro/state.js (getState y el
   evento "runoff") y llama setMode. El relieve se prende por core/relief.js (setReliefUser), como el conmutador de relieve-ui.js.
   La disponibilidad depende de terrain.stats, que llega asíncrono: se re-evalúa al armar y en "runoff", "relief:state" y "scenario".
   Se arma solo al importarse (el #panel ya está en el HTML); también se exporta armarEscorrentia() por si hace falta llamarlo. */
import { on } from "../core/events.js?v=20261121";
import { relief, onRelief, setReliefUser } from "../core/relief.js?v=20261121";
import { getState, setMode } from "../hydro/state.js?v=20261121";

const MOTIVOS = {
  llano: "Campo llano: el modelo de terreno no alcanza para simular el escurrimiento",
  "sin-dem": "Sin modelo de terreno"
};
const VISTAS = [{ id: "natural", txt: "Agua natural", ok: true }, { id: "velocidad", txt: "Velocidad", ok: false, motivo: "Próximamente" }];
const LEYENDA_GRAD = "linear-gradient(90deg, #60a0c4, #1e5280)";   // somero → profundo (MODELO §6)

let sw, seg, estado, leyenda, rotulo, nota, bloque, pedidoUrl = null, avisoRelieve = false, modoUrl = "off";   // "off" de arranque: apagado no toca la URL (cero efecto)

export function armarEscorrentia() {
  const panel = document.getElementById("panel");
  if (!panel || document.getElementById("runoff-section")) return;
  bloque = document.createElement("div");
  bloque.className = "panel-section"; bloque.id = "runoff-section";

  const fila = document.createElement("div");
  fila.id = "runoff-fila";
  const lab = document.createElement("span");
  lab.className = "runoff-label"; lab.id = "runoff-label"; lab.textContent = "Simulador de escorrentía";
  sw = document.createElement("button");
  sw.type = "button"; sw.id = "runoff-sw"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-labelledby", "runoff-label");
  sw.setAttribute("aria-describedby", "runoff-estado"); sw.innerHTML = '<span class="runoff-knob"></span>';
  sw.addEventListener("click", alternar);
  fila.append(lab, sw);

  estado = document.createElement("p");
  estado.id = "runoff-estado"; estado.setAttribute("role", "status"); estado.hidden = true;

  seg = document.createElement("div");
  seg.id = "runoff-seg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Vista del simulador");
  for (const v of VISTAS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "runoff-btn"; b.dataset.vista = v.id; b.textContent = v.txt;
    if (!v.ok) { b.setAttribute("aria-disabled", "true"); b.title = v.motivo; b.innerHTML = v.txt + "<small>" + v.motivo.toLowerCase() + "</small>"; }
    else b.addEventListener("click", () => setMode(v.id));   // setMode devuelve false si no está disponible
    seg.appendChild(b);
  }

  leyenda = document.createElement("div");
  leyenda.id = "runoff-leyenda";
  leyenda.innerHTML = '<div class="runoff-barra" style="background:' + LEYENDA_GRAD + '" aria-hidden="true"></div>' +
    '<div class="runoff-escala"><span>Somero</span><span>Profundo</span></div>' +
    "<p>Agua natural: dónde se junta el agua en el pico de la lluvia. La lámina está exagerada a propósito para que se vea.</p>";

  rotulo = document.createElement("p");
  rotulo.id = "runoff-rotulo";

  nota = document.createElement("p");
  nota.id = "runoff-nota"; nota.setAttribute("role", "status"); nota.hidden = true;

  bloque.append(fila, estado, seg, leyenda, rotulo, nota);
  panel.insertBefore(bloque, panel.querySelector(".panel-footer"));

  // ?escorrentia=natural: se aplica en cuanto el campo admita el simulador
  const m = location.search.match(/[?&]escorrentia=([^&]*)/);
  if (m && m[1] === "natural") pedidoUrl = "natural";
  pintar();
}

function alternar() {
  if (sw.getAttribute("aria-disabled") === "true") return;
  pedidoUrl = null; avisoRelieve = false;
  if (getState().mode !== "off") { setMode("off"); return; }
  prender();
}

function prender() {
  if (!relief.active && relief.available !== false) { avisoRelieve = true; setReliefUser(true); }
  setMode("natural");
}

function url(mode) {
  // se edita el texto de la query a mano (como ?hora=): URLSearchParams reescribiría otros parámetros del visor
  let q = location.search.replace(/([?&])escorrentia=[^&]*(&|$)/, (m, a, z) => (z ? a : "")).replace(/[?&]$/, "");
  if (mode !== "off") q += (q.includes("?") ? "&" : "?") + "escorrentia=" + mode;
  history.replaceState(history.state, "", location.pathname + q + location.hash);
}

function pintar(s) {
  if (!sw) return;
  s = s && s.mode ? s : getState();
  if (pedidoUrl && s.available && s.mode === "off") { pedidoUrl = null; prender(); s = getState(); }
  const bloqueado = !s.available && s.mode === "off";
  const prendido = s.mode !== "off" && s.available;
  const motivo = s.error ? "No se pudo calcular el escurrimiento. Probá de nuevo más tarde."
    : (!s.available && s.reason !== "calculando" ? (MOTIVOS[s.reason] || MOTIVOS["sin-dem"]) : "");
  sw.setAttribute("aria-checked", String(prendido));
  if (bloqueado) sw.setAttribute("aria-disabled", "true"); else sw.removeAttribute("aria-disabled");
  bloque.classList.toggle("runoff-off", bloqueado);
  const calc = prendido && s.computing;
  estado.textContent = motivo || (calc ? "Calculando…" : "");
  estado.hidden = !estado.textContent;
  estado.classList.toggle("runoff-error", !!s.error);
  for (const b of seg.querySelectorAll(".runoff-btn")) b.setAttribute("aria-pressed", String(prendido && b.dataset.vista === s.mode));
  seg.hidden = leyenda.hidden = rotulo.hidden = !prendido;
  bloque.setAttribute("aria-busy", String(!!calc));
  rotulo.textContent = "Ilustrativo · pico de una lluvia de " + s.rainMmH + " mm/h · no es un estudio hidrológico";
  let n = "";
  if (prendido && !relief.active) n = "El relieve está apagado: el agua se ve mejor con el relieve del terreno prendido.";
  else if (prendido && avisoRelieve) n = "Prendimos el relieve del terreno: el agua lo necesita para verse.";
  nota.textContent = n; nota.hidden = !n;
  if (modoUrl !== s.mode && !(pedidoUrl && s.mode === "off")) { modoUrl = s.mode; url(s.mode); }
}

on("runoff", pintar);
on("scenario", () => pintar());
onRelief(() => pintar());
armarEscorrentia();
