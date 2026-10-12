// Doble clic: cada acción se envía UNA sola vez (botón que se bloquea solo + api.ts sin escrituras repetidas).
// Uso (después de test/api/pacientes_estudios.py <id>, que deja una atención con saldo):
//   TENANT=<id> WEB=localhost:8080 node doble-clic.mjs
import { chromium } from "playwright-core";
import * as fs from "node:fs";
const S = process.env.SHOTS ?? "./capturas", T = process.env.TENANT ?? "dobleclic";
const BASE = `http://${T}.${process.env.WEB ?? "localhost:8080"}`;
fs.mkdirSync(S, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
let ok = 0, fail = 0; const check = (n, c, i = "") => { c ? ok++ : fail++; console.log((c ? "OK   " : "FAIL ") + n + (c ? "" : "  -> " + i)); };
// Servidor lento SOLO para escrituras: el segundo clic llega mientras la primera sigue guardando
const writes = [];
await page.route("**/api/**", async (route) => {
  const m = route.request().method();
  if (m !== "GET") { writes.push(`${m} ${new URL(route.request().url()).pathname}`); await new Promise((r) => setTimeout(r, 1500)); }
  await route.continue();
});
const api = async (path) => page.evaluate(async (p) => (await fetch(p, { headers: { Authorization: "Bearer " + localStorage.getItem("dental3d.token") } })).json(), path);
const count = (re) => writes.filter((w) => re.test(w)).length;
// Doble clic "humano" (dos clics seguidos) y doble clic en el mismo instante (dos .click() en el mismo tick)
const dbl = (loc) => loc.dblclick();
const sfx = Date.now().toString(36); // nombres únicos: la prueba se puede repetir en la misma sucursal
const sameTick = (loc) => loc.evaluate((el) => { el.click(); el.click(); el.click(); });
try {
  await page.goto(`${BASE}/auth`);
  await page.getByLabel("Email o usuario").fill(`admin@${T}.prueba`);
  await page.getByLabel("Contraseña", { exact: true }).fill("Excel#Prueba-2026");
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/app/); writes.length = 0;

  // 1. Paciente: doble clic en Guardar
  await page.getByRole("link", { name: "Pacientes", exact: true }).click();
  await page.getByRole("button", { name: /nuevo paciente/i }).click();
  const d1 = page.getByRole("dialog"); await d1.locator("input").first().fill(`Doble Clic ${sfx}`);
  const save1 = d1.getByRole("button", { name: /guardar/i });
  await dbl(save1);
  await page.waitForTimeout(300);
  check("mientras guarda, el botón queda deshabilitado y con spinner", (await save1.isDisabled()) && (await save1.locator("svg.animate-spin").count()) === 1);
  await page.screenshot({ path: `${S}/01-guardando.png` });
  await page.getByText("Paciente registrado").first().waitFor({ timeout: 10000 });
  const pats = await api(`/api/patients?q=${encodeURIComponent("Doble Clic " + sfx)}&limit=50`);
  check("doble clic en Guardar paciente: se creó UNO", pats.total === 1 && count(/POST \/api\/patients$/) === 1, `total=${pats.total} posts=${count(/POST \/api\/patients$/)}`);

  // 2. Doctor: tres clics en el mismo instante
  await page.getByRole("link", { name: "Doctores", exact: true }).click();
  await page.getByRole("button", { name: /nuevo doctor/i }).click();
  const d2 = page.getByRole("dialog"); await d2.locator("input").first().fill(`Dr. Triple ${sfx}`);
  await sameTick(d2.getByRole("button", { name: /guardar/i }));
  await page.waitForTimeout(2500);
  const docs = await api("/api/doctors");
  check("3 clics en el mismo instante en Guardar doctor: se creó UNO", docs.filter((x) => x.full_name === `Dr. Triple ${sfx}`).length === 1 && count(/POST \/api\/doctors$/) === 1, `posts=${count(/POST \/api\/doctors$/)}`);

  // 3. Cobro parcial en Entregas y cobros
  await page.getByRole("link", { name: "Entregas y cobros", exact: true }).click();
  const row = page.locator("tr", { hasText: "Paciente Sin Doctor" }).first();
  await row.getByRole("button", { name: /cobrar/i }).click();
  const d3 = page.getByRole("dialog"); await d3.locator('input[type="number"]').fill("10");
  const before = (await api("/api/attentions?limit=100")).data.filter((a) => a.patient_name === "Paciente Sin Doctor").reduce((s, a) => s + Number(a.amount_paid), 0);
  await dbl(d3.getByRole("button", { name: /registrar cobro/i }));
  await page.getByText("Cobro registrado").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const after = (await api("/api/attentions?limit=100")).data.filter((a) => a.patient_name === "Paciente Sin Doctor").reduce((s, a) => s + Number(a.amount_paid), 0);
  check("doble clic en 'Registrar cobro' de 10 Bs: se cobró UNA vez", Math.abs(after - before - 10) < 0.001 && count(/\/charge$/) === 1, `antes=${before} después=${after} posts=${count(/\/charge$/)}`);

  // 4. Cita: doble clic en Guardar
  await page.getByRole("link", { name: "Agenda de citas", exact: true }).click();
  await page.getByRole("button", { name: "Nueva cita" }).first().click();
  const d4 = page.getByRole("dialog");
  await d4.locator("input").first().fill("Cita Doble Clic");
  await d4.locator('input[type="time"]').fill("10:30");
  await dbl(d4.getByRole("button", { name: /^guardar$/i }));
  await page.waitForTimeout(2500);
  check("doble clic en Guardar cita: se creó UNA", count(/POST \/api\/appointments$/) === 1, `posts=${count(/POST \/api\/appointments$/)}`);
  await page.screenshot({ path: `${S}/02-cita.png` });

  // 5. Después de guardar, el botón vuelve a funcionar (no queda bloqueado)
  await page.getByRole("link", { name: "Pacientes", exact: true }).click();
  await page.getByRole("button", { name: /nuevo paciente/i }).click();
  const d5 = page.getByRole("dialog"); await d5.locator("input").first().fill(`Segundo ${sfx}`);
  await d5.getByRole("button", { name: /guardar/i }).click();
  await page.getByText(`Segundo ${sfx}`).first().waitFor({ timeout: 10000 });
  check("después de guardar se puede seguir usando (no queda bloqueado)", true);

  // 6. Si falla, el botón se libera
  await page.getByRole("button", { name: /nuevo paciente/i }).click();
  const d6 = page.getByRole("dialog"); await d6.locator("input").first().fill("x".repeat(250)); // nombre > 200: la API lo rechaza
  const save6 = d6.getByRole("button", { name: /guardar/i });
  await save6.click();
  await page.waitForTimeout(2200);
  check("si la API rechaza, el botón se libera para corregir", !(await save6.isDisabled()));
} catch (e) { check("sin errores: " + e.message.split("\n")[0], false); await page.screenshot({ path: `${S}/zz-error.png` }); }
check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
console.log(`${ok}/${ok + fail} OK`, "\nescrituras enviadas:", writes.join(", "));
process.exitCode = fail ? 1 : 0;
await b.close();
