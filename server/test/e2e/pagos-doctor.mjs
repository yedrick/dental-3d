// Pagos, doctor no registrado y rol DOCTOR en el navegador.
// Uso (después de test/api/pagos_permisos.py <id>, que deja la sucursal con doctores, pacientes,
// atenciones con saldo y el usuario DOCTOR "ana"):
//   TENANT=<id> WEB=localhost:8080 node pagos-doctor.mjs
import { chromium } from "playwright-core";
import * as fs from "node:fs";

const S = process.env.SHOTS ?? "./capturas", T = process.env.TENANT ?? "pagos1";
const BASE = `http://${T}.${process.env.WEB ?? "localhost:8080"}`;
const PASS = "Pagos#Prueba-2026";
fs.mkdirSync(S, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
let ok = 0, fail = 0;
const check = (n, c, i = "") => { c ? ok++ : fail++; console.log((c ? "OK   " : "FAIL ") + n + (c ? "" : "  -> " + String(i).slice(0, 300))); };
const errors = [];

async function session(login) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/auth`);
  await page.getByLabel("Email o usuario").fill(login);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/app/);
  return page;
}
const api = (page, path) => page.evaluate(async (p) => (await fetch(p, { headers: { Authorization: "Bearer " + localStorage.getItem("dental3d.token") } })).json(), path);
const sfx = Date.now().toString(36);

try {
  const page = await session(`admin@${T}.prueba`);

  // ---- 1. Atención con doctor NO registrado, pagada por QR ----
  await page.getByRole("link", { name: "Atenciones", exact: true }).click();
  await page.getByPlaceholder(/nombre o celular/i).fill("Paciente sin doctor");
  await page.getByText("Paciente sin doctor").first().click();
  await page.getByRole("button", { name: /agregar/i }).first().click();
  await page.getByRole("combobox").filter({ hasText: /selecciona estudio/i }).click();
  await page.getByRole("option", { name: /panorámica/i }).click();
  await page.getByRole("combobox").filter({ hasText: /^sin doctor$/i }).click();
  await page.getByRole("option", { name: "Doctor no registrado…" }).click();
  await page.getByLabel("Nombre del doctor").fill(`Dr. Navegador ${sfx}`);
  await page.getByLabel("Porcentaje").fill("12");
  await page.getByLabel("Forma de pago").click();
  await page.getByRole("option", { name: "QR" }).click();
  await page.screenshot({ path: `${S}/01-doctor-no-registrado.png`, fullPage: true });
  await page.getByRole("button", { name: /^registrar$/i }).click();
  await page.getByText(/atención registrada/i).first().waitFor({ timeout: 10000 });
  const com = await api(page, "/api/commissions?limit=500");
  const ext = com.summary.by_doctor.find((d) => d.doctor_name === `Dr. Navegador ${sfx}`);
  check("doctor no registrado: su comisión (12 % de 150 = 18, sin informe) sale en Comisiones con su nombre", ext?.external === true && ext.total === 18, JSON.stringify(ext));
  const pays = await api(page, "/api/attentions/payments?limit=1000");
  check("el pago al registrar quedó como QR", pays.some((p) => p.method === "qr" && p.source === "registro" && Number(p.amount) === 150 && p.patient_name === "Paciente sin doctor"));

  // ---- 2. Cobro parcial con forma de pago (Tarjeta) ----
  await page.getByRole("link", { name: "Entregas y cobros", exact: true }).click();
  const row = page.locator("tr", { hasText: "Paciente de Beto" }).first();
  await row.getByRole("button", { name: /cobrar/i }).click();
  const d1 = page.getByRole("dialog");
  check("el diálogo de cobro pide la forma de pago", await d1.getByLabel("Forma de pago").isVisible());
  await d1.getByLabel("Monto a cobrar").fill("20");
  await d1.getByLabel("Forma de pago").click();
  await page.getByRole("option", { name: "Tarjeta" }).click();
  await page.screenshot({ path: `${S}/02-cobro-tarjeta.png` });
  await d1.getByRole("button", { name: /registrar cobro/i }).click();
  await page.getByText("Cobro registrado").first().waitFor({ timeout: 10000 });
  const pays2 = await api(page, "/api/attentions/payments?limit=1000");
  check("cobro parcial guardado como Tarjeta", pays2.some((p) => p.method === "card" && p.source === "cobro" && Number(p.amount) === 20 && p.patient_name === "Paciente de Beto"));

  // ---- 3. "Cobrar todo" pide confirmación ----
  const before = (await api(page, "/api/attentions?limit=100")).data.filter((a) => a.patient_name === "Paciente de Beto").reduce((s, a) => s + Number(a.amount_paid), 0);
  await page.getByRole("button", { name: /cobrar todo — paciente de beto/i }).click();
  const d2 = page.getByRole("dialog");
  check("'Cobrar todo' abre una confirmación con el monto", await d2.getByText("Monto a cobrar").isVisible() && await d2.getByText("Paciente de Beto").isVisible());
  await page.screenshot({ path: `${S}/03-confirmar-cobrar-todo.png` });
  await d2.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForTimeout(800);
  const afterCancel = (await api(page, "/api/attentions?limit=100")).data.filter((a) => a.patient_name === "Paciente de Beto").reduce((s, a) => s + Number(a.amount_paid), 0);
  check("al cancelar no se cobra nada", afterCancel === before, `${before} → ${afterCancel}`);
  await page.getByRole("button", { name: /cobrar todo — paciente de beto/i }).click();
  await d2.getByLabel("Forma de pago").click();
  await page.getByRole("option", { name: "QR" }).click();
  await d2.getByRole("button", { name: /^cobrar$/i }).click();
  await page.getByText(/cobrado saldo total/i).first().waitFor({ timeout: 10000 });
  const pays3 = await api(page, "/api/attentions/payments?limit=1000");
  check("al confirmar, se cobra todo con el método elegido (QR)", pays3.some((p) => p.method === "qr" && p.source === "cobrar_todo" && p.patient_name === "Paciente de Beto"));

  // ---- 4. Historial de pagos del paciente y "Cobrado hoy" ----
  const beto = (await api(page, "/api/patients?q=Paciente%20de%20Beto")).data[0];
  await page.goto(`${BASE}/app/patients/${beto.id}`);
  await page.getByRole("tab", { name: "Pagos" }).click();
  await page.getByText("Fecha del pago").waitFor();
  const tab = await page.locator("body").innerText();
  check("pestaña Pagos: cada cobro con su forma de pago", /Tarjeta/.test(tab) && /QR/.test(tab));
  check("pestaña Pagos: marca el saldo de una atención de otro día", /Atención del/.test(tab));
  await page.screenshot({ path: `${S}/04-historial-pagos.png`, fullPage: true });
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByText("Cobrado hoy").waitFor();
  check("dashboard: 'Cobrado hoy' indica lo que es de atenciones anteriores", await page.getByText(/de atenciones de días anteriores/).isVisible());
  await page.screenshot({ path: `${S}/05-dashboard.png` });

  // ---- 5. Usuarios: ficha de doctor ----
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  await page.locator("tr", { hasText: "ana@" }).getByRole("button", { name: /editar/i }).click();
  const d3 = page.getByRole("dialog");
  check("Usuarios: el DOCTOR muestra su ficha enlazada", (await d3.getByLabel("Ficha de doctor").innerText()).includes("Dra. Ana"));
  await page.screenshot({ path: `${S}/06-usuario-doctor.png` });

  // ---- 6. El DOCTOR ve solo lo suyo ----
  const doc = await session("ana");
  await doc.getByText("Mis pacientes").waitFor();
  check("DOCTOR: su dashboard (Mis pacientes, sin caja)", !(await doc.getByText("Saldo caja chica").isVisible()));
  const hidden = [];
  for (const n of ["Caja chica", "Reportes", "Usuarios", "Depósitos"]) if (await doc.getByRole("link", { name: n, exact: true }).count()) hidden.push(n);
  check("DOCTOR: el menú no tiene Caja chica, Reportes, Usuarios ni Depósitos", hidden.length === 0, hidden.join(", "));
  await doc.screenshot({ path: `${S}/07-doctor-dashboard.png` });
  await doc.getByRole("link", { name: "Pacientes", exact: true }).click();
  await doc.getByText("Paciente de Ana").first().waitFor();
  const plist = await doc.locator("table").innerText();
  check("DOCTOR: en Pacientes solo ve los suyos", plist.includes("Paciente de Ana") && !plist.includes("Paciente de Beto") && !plist.includes("Paciente sin doctor"), plist);
  await doc.screenshot({ path: `${S}/08-doctor-pacientes.png` });
} catch (e) {
  check("sin errores: " + e.message.split("\n")[0], false);
  for (const ctx of b.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: `${S}/zz-error-${ctx.pages().indexOf(pg)}.png` }).catch(() => {});
}
check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
console.log(`${ok}/${ok + fail} OK`);
process.exitCode = fail ? 1 : 0;
await b.close();
