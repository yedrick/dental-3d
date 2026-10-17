// Planes en el navegador: el menú muestra solo los módulos del plan, un enlace directo a un módulo
// que no está en el plan muestra "no está en tu plan", y al mejorar el plan aparece.
// Requisitos: sucursal creada con test/api/planes.py <id> (queda en Básico, admin@<id>.prueba).
//   TENANT=<id> WEB=localhost:8080 API=http://127.0.0.1:4000 OWNER_EMAIL=... OWNER_PASS=... node planes.mjs
import { chromium } from "playwright-core";

const T = process.env.TENANT ?? "planes1";
const WEB = process.env.WEB ?? "localhost:8080";
const API = process.env.API ?? "http://127.0.0.1:4000";
const BASE = `http://${T}.${WEB}`;
let ok = 0, fail = 0;
const check = (name, cond, info = "") => {
  cond ? ok++ : fail++;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond ? "" : `  -> ${String(info).slice(0, 300)}`}`);
};
const panel = async (method, path, body, token) => {
  const r = await fetch(API + "/admin/api" + path, {
    method,
    headers: { Host: "localhost", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return [r.status, await r.json().catch(() => null)];
};
const [, login] = await panel("POST", "/auth/login", { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASS, mode: "token" });
await panel("PATCH", `/tenants/${T}`, { plan: "basico", features: null }, login.token);

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const page = await b.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const menu = async () => (await page.locator("[data-sidebar=content]").innerText()).split("\n").map((s) => s.trim());
try {
  await page.goto(`${BASE}/auth`);
  await page.getByLabel("Email o usuario").fill(`admin@${T}.prueba`);
  await page.getByLabel("Contraseña", { exact: true }).fill("Planes#Prueba-2026");
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/app/);
  await page.getByRole("link", { name: "Pacientes", exact: true }).waitFor();

  let items = await menu();
  check("Básico: el menú tiene Agenda y Caja chica", items.includes("Agenda de citas") && items.includes("Caja chica"), items);
  const hidden = ["Reportes", "Comisiones", "Auditoría", "Depósitos", "Pagos a terceros", "Página web"].filter((x) => items.includes(x));
  check("Básico: el menú no muestra Reportes, Comisiones, Auditoría, Depósitos, Terceros ni Página web", hidden.length === 0, hidden);

  await page.goto(`${BASE}/app/reports`);
  await page.getByText("Reportes no está en tu plan").waitFor({ timeout: 15000 });
  check("enlace directo a Reportes: aviso 'no está en tu plan' con el plan Básico", await page.getByText("Básico", { exact: true }).count() >= 1);
  check("el aviso tiene el botón Ver planes", await page.getByRole("link", { name: /ver planes/i }).count() === 1);

  await page.goto(`${BASE}/app/studies`);
  await page.getByRole("heading", { name: /estudios/i }).first().waitFor();
  check("Básico: Estudios sin el botón de importar Excel", await page.getByRole("button", { name: /importar/i }).count() === 0);

  // Mejorar a Clínica desde el panel: al recargar aparece todo
  await panel("PATCH", `/tenants/${T}`, { plan: "clinica" }, login.token);
  await page.goto(`${BASE}/app/reports`);
  await page.getByText("Con factura:").waitFor({ timeout: 15000 });
  items = await menu();
  check("Clínica: Reportes abre y el menú muestra todos los módulos",
    ["Reportes", "Comisiones", "Auditoría", "Depósitos", "Pagos a terceros", "Página web"].every((x) => items.includes(x)), items);
  check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("sin errores inesperados", false, e.message);
} finally {
  await panel("PATCH", `/tenants/${T}`, { plan: "basico" }, login.token);
  await b.close();
}
console.log(`\n${ok}/${ok + fail} OK`);
process.exit(fail ? 1 : 0);
