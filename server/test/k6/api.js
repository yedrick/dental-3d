// Pruebas de carga y estrés de la API con k6, por sucursal y por endpoint.
//
//   PERFIL=humo|carga|estres|pico|resistencia|capacidad   (por defecto: humo)
//
// - personal:   usuarios de la clínica trabajando (panel, pacientes, atenciones, caja, reportes) con pausas.
// - visitantes: público en la portada de cada sucursal (2 por cada usuario del personal).
// - logins:     inicios de sesión por segundo (bcrypt: lo más pesado para la CPU).
// - capacidad:  sube las peticiones por segundo por escalones hasta encontrar el máximo que aguanta.
//
// Cada usuario virtual del personal queda fijo en una sucursal (se reparten parejo), y todas las
// peticiones llevan las etiquetas "sucursal" y "endpoint": el resumen muestra cada uno por separado.
import { sleep } from "k6";
import exec from "k6/execution";
import { TENANTS, pedir, login, tokensDeTodas, ipDe, azar, hoy, aislamientoFallas } from "./lib/comun.js";
import { resumen } from "./lib/resumen.js";

const PERFIL = __ENV.PERFIL || "humo";
const ESCALA = Number(__ENV.ESCALA || 1); // multiplica la cantidad de usuarios de cada perfil
const PAUSA = Number(__ENV.PAUSA ?? 2); // segundos promedio que un usuario "piensa" entre acciones

const u = (n) => Math.max(1, Math.round(n * ESCALA));
const ETAPAS = {
  humo: [{ duration: "30s", target: u(5) }],
  carga: [{ duration: "1m", target: u(100) }, { duration: "3m", target: u(100) }, { duration: "30s", target: 0 }],
  estres: [
    { duration: "2m", target: u(200) }, { duration: "2m", target: u(400) },
    { duration: "2m", target: u(800) }, { duration: "2m", target: u(1200) }, { duration: "1m", target: 0 },
  ],
  pico: [
    { duration: "30s", target: u(50) }, { duration: "10s", target: u(1000) }, { duration: "1m", target: u(1000) },
    { duration: "10s", target: u(50) }, { duration: "30s", target: u(50) },
  ],
  resistencia: [{ duration: "2m", target: u(150) }, { duration: __ENV.DURACION || "30m", target: u(150) }, { duration: "1m", target: 0 }],
};
// Etiqueta de cada etapa (p. ej. "3-400a800": tercera etapa, de 400 a 800 usuarios del personal)
const ETAPAS_INFO = (ETAPAS[PERFIL] || []).map((e, i, arr) => ({
  etiqueta: `${i + 1}-${i ? arr[i - 1].target : 0}a${e.target}`, desde: i ? arr[i - 1].target : 0, hasta: e.target, segundos: segundos(e.duration),
}));
function etapaDeUsuarios(inicio) {
  let s = (Date.now() - inicio) / 1000;
  for (const e of ETAPAS_INFO) { if (s < e.segundos) return e.etiqueta; s -= e.segundos; }
  return ETAPAS_INFO[ETAPAS_INFO.length - 1].etiqueta;
}

const LOGINS_POR_SEG = { humo: 1, carga: 2, estres: 5, pico: 5, resistencia: 1 }; // se cambia con LOGINS=n

// Capacidad: escalones de peticiones por segundo; cada uno sube en SUBIDA s y se mantiene MESETA s
const PASOS = (__ENV.PASOS || "100,250,500,750,1000,1500,2000,3000").split(",").map(Number);
const SUBIDA = 15;
const MESETA = Number(__ENV.MESETA || 45);

const ENDPOINTS = {
  // endpoint: p95 máximo aceptable (ms)
  auth_me: 300, dashboard: 500, pacientes_buscar: 500, estudios: 300, atencion_crear: 800, atenciones_lista: 500,
  caja_mover: 800, caja_saldo: 300, reporte: 1500, doctores: 300, agenda: 500, notif_pendientes: 300,
  tenancy_me: 200, tema_css: 200, web_publica: 300, estudios_publicos: 300, login: 1500,
};

function escenarios() {
  if (PERFIL === "capacidad") {
    return {
      capacidad: {
        executor: "ramping-arrival-rate", exec: "rafaga", startRate: 20, timeUnit: "1s",
        preAllocatedVUs: 200, maxVUs: Number(__ENV.MAX_VUS || 3000),
        stages: PASOS.flatMap((r) => [{ duration: `${SUBIDA}s`, target: r }, { duration: `${MESETA}s`, target: r }]),
      },
    };
  }
  const etapas = ETAPAS[PERFIL];
  if (!etapas) throw new Error(`PERFIL desconocido: ${PERFIL}`);
  const logins = Number(__ENV.LOGINS ?? LOGINS_POR_SEG[PERFIL]); // LOGINS=0 apaga el escenario
  return {
    personal: { executor: "ramping-vus", exec: "personal", startVUs: 0, stages: etapas, gracefulRampDown: "30s" },
    visitantes: {
      executor: "ramping-vus", exec: "visitante", startVUs: 0, gracefulRampDown: "10s",
      stages: etapas.map((e) => ({ ...e, target: e.target * 2 })),
    },
    ...(logins > 0 && {
      logins: {
        executor: "constant-arrival-rate", exec: "inicioSesion", rate: logins, timeUnit: "1s",
        duration: etapas.reduce((s, e) => s + segundos(e.duration), 0) + "s", preAllocatedVUs: 20, maxVUs: 200,
      },
    }),
  };
}
function segundos(d) {
  const m = /^(\d+)(s|m|h)$/.exec(d);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

function umbrales() {
  const th = {
    aislamiento_fallas: ["count==0"],
    checks: ["rate>0.99"],
  };
  if (PERFIL === "capacidad") {
    // No se corta por lentitud (se quiere ver dónde se rompe), solo si ya falla más del 20 %
    th.http_req_failed = [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "20s" }];
    for (const r of PASOS) {
      th[`http_req_duration{etapa:${r}}`] = ["p(95)<500"];
      th[`http_req_failed{etapa:${r}}`] = ["rate<0.01"];
      th[`http_reqs{etapa:${r}}`] = ["count>=0"];
    }
  } else {
    for (const e of ETAPAS_INFO) {
      // Solo para que el resumen muestre cada etapa (no son metas)
      th[`http_req_duration{etapa:${e.etiqueta}}`] = ["max>=0"];
      th[`http_req_failed{etapa:${e.etiqueta}}`] = ["rate>=0"];
      th[`http_reqs{etapa:${e.etiqueta}}`] = ["count>=0"];
    }
    th.http_req_failed = ["rate<0.01"];
    th["http_req_duration{tipo:app}"] = ["p(95)<500", "p(99)<1500"];
  }
  // Por endpoint y por sucursal (también hacen que el resumen los muestre por separado)
  for (const [e, ms] of Object.entries(ENDPOINTS)) {
    th[`http_req_duration{endpoint:${e}}`] = [`p(95)<${ms}`];
    th[`http_req_failed{endpoint:${e}}`] = ["rate<0.01"];
    th[`http_reqs{endpoint:${e}}`] = ["count>=0"];
  }
  for (const t of TENANTS) {
    th[`http_req_duration{sucursal:${t.id}}`] = ["p(95)<500"];
    th[`http_req_failed{sucursal:${t.id}}`] = ["rate<0.01"];
    th[`http_reqs{sucursal:${t.id}}`] = ["count>=0"];
  }
  return th;
}

export const options = {
  scenarios: escenarios(),
  thresholds: umbrales(),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  setupTimeout: "2m",
};

export function setup() {
  return { tokens: tokensDeTodas(), inicio: Date.now() };
}

const pausa = () => PAUSA > 0 && sleep(PAUSA * (0.5 + Math.random()));
const inicioDeMes = () => hoy().slice(0, 8) + "01";

/** Un usuario de la clínica: una "vuelta" de trabajo típica. */
export function personal(data) {
  exec.vu.metrics.tags.etapa = etapaDeUsuarios(data.inicio);
  const t = TENANTS[(exec.vu.idInTest - 1) % TENANTS.length];
  const token = data.tokens[t.id];
  const o = (endpoint, extra = {}) => ({ token, endpoint, ...extra });

  pedir("GET", t, "/api/auth/me", o("auth_me"));
  pedir("GET", t, "/api/dashboard", o("dashboard"));
  pedir("GET", t, "/api/notifications/unread-count", o("notif_pendientes", { esperado: [200, 304] }));
  pausa();
  pedir("GET", t, "/api/patients?q=Paciente&limit=20", o("pacientes_buscar"));
  pedir("GET", t, "/api/studies?active=true", o("estudios"));
  pedir("POST", t, "/api/attentions", o("atencion_crear", {
    esperado: [201],
    body: {
      patient_id: azar(t.patients), with_invoice: Math.random() < 0.5, payment_method: "cash",
      amount_paid: 0, items: [{ study_id: azar(t.studies), has_report: Math.random() < 0.7 }],
    },
  }));
  pausa();
  pedir("GET", t, "/api/attentions?limit=50", o("atenciones_lista"));
  pedir("GET", t, `/api/appointments?from=${hoy()}&to=${hoy()}`, o("agenda"));
  if (Math.random() < 0.3) {
    pedir("POST", t, "/api/cashbox", o("caja_mover", { esperado: [201], body: { description: "Prueba k6", income: 10 } }));
  }
  pedir("GET", t, "/api/cashbox/balance", o("caja_saldo"));
  if (Math.random() < 0.3) revisarDoctores(t, token);
  if (Math.random() < 0.15) pedir("GET", t, `/api/reports/summary?from=${inicioDeMes()}&to=${hoy()}`, o("reporte"));
  pausa();
}

/** Aislamiento bajo carga: los doctores que devuelve la API tienen que ser los de ESA sucursal. */
function revisarDoctores(t, token) {
  const r = pedir("GET", t, "/api/doctors", { token, endpoint: "doctores" });
  if (r.status === 200 && !r.json().every((d) => t.doctor_names.includes(d.full_name))) aislamientoFallas.add(1, { sucursal: t.id });
}

/** Alguien del público entrando a la portada de una sucursal. */
export function visitante(data) {
  exec.vu.metrics.tags.etapa = etapaDeUsuarios(data.inicio);
  const t = azar(TENANTS);
  const me = pedir("GET", t, "/tenancy/me", { endpoint: "tenancy_me" });
  if (me.status === 200 && me.json("id") !== t.id) aislamientoFallas.add(1, { sucursal: t.id });
  pedir("GET", t, "/tenancy/theme.css", { endpoint: "tema_css" });
  pedir("GET", t, "/api/public/site", { endpoint: "web_publica" });
  pedir("GET", t, "/api/public/studies", { endpoint: "estudios_publicos" });
  if (PAUSA > 0) sleep(2 + Math.random() * 3);
}

/** Inicios de sesión, cada uno desde una IP distinta (como usuarios reales en distintos lugares). */
export function inicioSesion(data) {
  exec.vu.metrics.tags.etapa = etapaDeUsuarios(data.inicio);
  const t = azar(TENANTS);
  login(t, ipDe(exec.scenario.iterationInTest + 1));
}

/** Capacidad: una petición al azar (con pesos parecidos al uso real), sin pausas. */
const MEZCLA = [
  ["GET", "/api/public/site", "web_publica", false, 3],
  ["GET", "/tenancy/me", "tenancy_me", false, 2],
  ["GET", "/api/public/studies", "estudios_publicos", false, 1],
  ["GET", "/api/dashboard", "dashboard", true, 2],
  ["GET", "/api/attentions?limit=50", "atenciones_lista", true, 2],
  ["GET", "/api/patients?q=Paciente&limit=20", "pacientes_buscar", true, 2],
  ["GET", "/api/cashbox/balance", "caja_saldo", true, 1],
  ["GET", "/api/doctors", "doctores", true, 1],
  ["POST", "/api/attentions", "atencion_crear", true, 1],
].flatMap((m) => Array(m[4]).fill(m));

function etapaActual(inicio) {
  const s = (Date.now() - inicio) / 1000;
  const i = Math.floor(s / (SUBIDA + MESETA));
  const dentro = s - i * (SUBIDA + MESETA);
  return i < PASOS.length && dentro >= SUBIDA ? String(PASOS[i]) : "rampa";
}

export function rafaga(data) {
  const t = azar(TENANTS);
  const [method, path, endpoint, auth] = azar(MEZCLA);
  const etapa = etapaActual(data.inicio);
  exec.vu.metrics.tags.etapa = etapa;
  if (endpoint === "atencion_crear") {
    pedir(method, t, path, {
      token: data.tokens[t.id], endpoint, esperado: [201],
      body: { patient_id: azar(t.patients), with_invoice: false, payment_method: "cash", amount_paid: 0, items: [{ study_id: azar(t.studies), has_report: true }] },
    });
  } else {
    pedir(method, t, path, { token: auth ? data.tokens[t.id] : undefined, endpoint });
  }
}

export function handleSummary(data) {
  return resumen(data, {
    perfil: PERFIL, endpoints: ENDPOINTS, tenants: Array.from(TENANTS, (t) => t.id), pasos: PERFIL === "capacidad" ? PASOS : null, meseta: MESETA,
    etapas: ETAPAS_INFO,
    personal: PERFIL === "capacidad" ? null : Math.max(...ETAPAS[PERFIL].map((e) => e.target)),
    logins: Number(__ENV.LOGINS ?? LOGINS_POR_SEG[PERFIL] ?? 0),
  });
}
