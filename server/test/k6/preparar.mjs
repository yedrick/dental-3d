// Prepara las sucursales de prueba para k6: las crea desde el panel, les crea un usuario y datos base,
// y guarda todo en datos.json (lo leen api.js y paginas.js).
//
// Uso:  OWNER_PASS=... node preparar.mjs <cantidad> <prefijo>
//   ej. OWNER_PASS=... node preparar.mjs 20 k6a      → k6a01 … k6a20
// Si una sucursal ya existe y está activa, la reutiliza (se puede correr de nuevo con el mismo prefijo).
//
// Variables: API (http://127.0.0.1:4000), DOMINIO_CENTRAL (localhost), OWNER_EMAIL, OWNER_PASS,
//            K6_USER_PASS (contraseña de los usuarios de prueba).
import http from "node:http";
import https from "node:https";
import { writeFileSync } from "node:fs";

const API = process.env.API ?? "http://127.0.0.1:4000";
const CENTRAL = process.env.DOMINIO_CENTRAL ?? "localhost";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@dental3d.local";
const OWNER_PASS = process.env.OWNER_PASS;
const USER_PASS = process.env.K6_USER_PASS ?? "Prueba#K6-2026";
const N = Number(process.argv[2] ?? 10);
const PREFIX = process.argv[3] ?? "k6a";
// tenancy-node 0.10 se bloquea si se crean a la vez tantas sucursales como conexiones tiene el
// pool central (TENANCY-NODE-REPORTE.md, punto 8). 5 a la vez queda muy por debajo de CENTRAL_POOL_MAX.
const A_LA_VEZ = 5;
if (!OWNER_PASS) throw new Error("Falta OWNER_PASS (contraseña del dueño del panel)");

const ids = Array.from({ length: N }, (_, i) => `${PREFIX}${String(i + 1).padStart(2, "0")}`);
const url = new URL(API);
const lib = url.protocol === "https:" ? https : http;
// IP distinta por llamada: el límite de intentos de login es por sucursal + IP (requiere TRUST_PROXY=1)
const ipAzar = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${1 + ((Math.random() * 250) | 0)}`;

function call(method, path, { body, host = CENTRAL, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Host: host, "X-Forwarded-For": ipAzar() };
    if (data) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = lib.request({ hostname: url.hostname, port: url.port, path, method, headers, timeout: 120_000 }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function enLotes(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

const t0 = Date.now();
const login = await call("POST", "/admin/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASS, mode: "token" } });
if (login.status !== 200) throw new Error(`Login del panel falló: ${login.status} ${JSON.stringify(login.body)}`);
const PT = login.body.token;

// 1. Sucursales (de 5 en 5)
async function estado(id) {
  const r = await call("GET", `/admin/api/tenants/${id}`, { token: PT });
  return r.status === 200 ? (r.body.tenant ?? r.body).status : null;
}
await enLotes(ids, A_LA_VEZ, async (id) => {
  if ((await estado(id)) === "active") return;
  const r = await call("POST", "/admin/api/tenants", { body: { id, name: `Sucursal ${id}`, plan: "clinica" }, token: PT }); // todos los módulos
  if (r.status !== 202) throw new Error(`No se pudo crear ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  for (let i = 0; i < 300; i++) {
    const s = await estado(id);
    if (s === "active") return;
    if (s === "failed") throw new Error(`${id} falló al aprovisionarse`);
    await esperar(1000);
  }
  throw new Error(`${id} no terminó de aprovisionarse en 5 minutos`);
});
console.log(`✔ ${N} sucursales activas (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// 2. Usuario de prueba (ADMIN) desde el panel, y datos base
async function preparar(id) {
  const host = `${id}.${CENTRAL}`;
  const email = `k6@${id}.prueba`;
  const u = await call("POST", `/admin/api/tenants/${id}/users`, {
    body: { name: `Prueba k6 ${id}`, email, role: "ADMIN", password: USER_PASS }, token: PT,
  });
  if (![200, 201, 409].includes(u.status)) throw new Error(`Usuario de ${id}: ${u.status} ${JSON.stringify(u.body)}`);
  const l = await call("POST", "/api/auth/login", { body: { login: email, password: USER_PASS }, host });
  if (l.status !== 200) throw new Error(`Login en ${id}: ${l.status} ${JSON.stringify(l.body)}`);
  const T = l.body.token;
  const get = async (path) => (await call("GET", path, { host, token: T })).body;
  const post = async (path, body) => {
    const r = await call("POST", path, { body, host, token: T });
    if (r.status !== 201 && r.status !== 200) throw new Error(`${id} POST ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  let doctors = await get("/api/doctors");
  if (doctors.length === 0) {
    for (let k = 1; k <= 3; k++) {
      await post("/api/doctors", { full_name: `Dr. ${id} ${k}`, use_percentage: k !== 3, default_commission_pct: 10, agreement_discount_pct: 0 });
    }
    for (const [name, con, sin] of [["Panorámica", 150, 100], ["Tomografía 3D", 450, 350], ["Periapical", 60, 40]]) {
      const s = await post("/api/studies", { name, fixed_commission: 20 });
      await post(`/api/studies/${s.id}/prices`, { price_with_report: con, price_without_report: sin, effective_date: "2026-01-01" });
    }
    doctors = await get("/api/doctors");
  }
  const studies = await get("/api/studies?active=true");
  let patients = (await get("/api/patients?limit=100")).data;
  for (let k = patients.length; k < 30; k++) {
    await post("/api/patients", { full_name: `Paciente ${id} ${k + 1}`, doctor_id: doctors[k % doctors.length].id });
  }
  patients = (await get("/api/patients?limit=100")).data;
  return {
    id, host, login: email,
    doctors: doctors.map((d) => d.id),
    doctor_names: doctors.map((d) => d.full_name),
    studies: studies.map((s) => s.id),
    patients: patients.map((p) => p.id),
  };
}
const tenants = await enLotes(ids, A_LA_VEZ, preparar);
writeFileSync(new URL("./datos.json", import.meta.url), JSON.stringify({ creado: new Date().toISOString(), central: CENTRAL, tenants }, null, 2));
console.log(`✔ usuarios y datos base listos → datos.json (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
