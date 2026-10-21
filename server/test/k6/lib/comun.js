// Utilidades compartidas por las pruebas k6.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

// SharedArray: los datos se cargan una sola vez para todos los usuarios virtuales (ahorra memoria)
export const TENANTS = new SharedArray("sucursales", () => JSON.parse(open(import.meta.resolve("../datos.json"))).tenants);
export const PASS = __ENV.K6_USER_PASS || "Prueba#K6-2026";

// Local: se llama directo a la API (puerto 4000) con el Host de cada sucursal, como lo hace nginx.
// En un servidor real: DOMINIO=dental3d.com → https://<sucursal>.dental3d.com (pasa por nginx).
const API = __ENV.API || "http://127.0.0.1:4000";
const DOMINIO = __ENV.DOMINIO || "";

export const aislamientoFallas = new Counter("aislamiento_fallas");

// IP fija por usuario virtual: el límite de intentos es por sucursal + IP (la API necesita TRUST_PROXY=1)
export function ipDe(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

function urlYHost(t, path) {
  if (DOMINIO) return { url: `https://${t.id}.${DOMINIO}${path}`, headers: {} };
  return { url: `${API}${path}`, headers: { Host: t.host } };
}

/** Petición a una sucursal, etiquetada por sucursal y endpoint (para ver resultados de cada uno). */
export function pedir(method, t, path, { token, body, endpoint, ip, esperado = [200] } = {}) {
  const { url, headers } = urlYHost(t, path);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers["X-Forwarded-For"] = ip;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = http.request(method, url, body === undefined ? null : JSON.stringify(body), {
    headers,
    // tipo: "login" va aparte (bcrypt tarda ~250 ms a propósito); "app" es todo lo demás
    tags: { sucursal: t.id, endpoint, name: endpoint, tipo: endpoint === "login" ? "login" : "app" },
    responseCallback: http.expectedStatuses(...esperado),
  });
  check(res, { [`${endpoint}: ${esperado.join("/")}`]: (r) => esperado.includes(r.status) }, { sucursal: t.id, endpoint });
  return res;
}

export function login(t, ip) {
  const r = pedir("POST", t, "/api/auth/login", { body: { login: t.login, password: PASS }, endpoint: "login", ip });
  return r.status === 200 ? r.json("token") : null;
}

/** Inicia sesión una vez en cada sucursal (en setup) y devuelve { sucursal: token }. */
export function tokensDeTodas() {
  const tokens = {};
  for (const t of TENANTS) {
    tokens[t.id] = login(t, ipDe(Math.floor(Math.random() * 16_000_000)));
    if (!tokens[t.id]) throw new Error(`No se pudo iniciar sesión en ${t.id}`);
  }
  return tokens;
}

export const azar = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const hoy = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10); // hora de Bolivia
