// Prueba web de punta a punta: panel → "Entrar como" → activar cuenta → operar la sucursal → portada pública.
import { chromium } from "playwright-core";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@dental3d.local";
const OWNER_PASS = process.env.OWNER_PASS;
// Dirección del frontend (dominio central) y otra sucursal existente para revisar el aislamiento
const WEB = process.env.WEB ?? "localhost:8081";
const OTRA = process.env.OTRA ?? "sur";
// Título único por sucursal: así el aislamiento se comprueba aunque las dos sucursales se hayan probado antes
if (!OWNER_PASS) throw new Error("Falta OWNER_PASS (contraseña del dueño del panel)");
const SHOTS = process.env.SHOTS ?? "./capturas"; const T = process.env.TENANT ?? "webqa"; const BASE = `http://${T}.${WEB}`;
const TITULO = `Radiología ${T} ${Date.now().toString(36)}`;
const results = []; const errors = [];
const ok = (name, cond, info = "") => { results.push([name, !!cond]); console.log((cond ? "OK   " : "FAIL ") + name + (cond ? "" : `  -> ${info}`)); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
ctx.on("weberror", (e) => errors.push(e.error().message));
const shot = async (p, name) => { try { await p.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 10000 }); } catch {} };
let app;
try {
  // ---------- Panel ----------
  const panel = await ctx.newPage();
  await panel.goto(`http://${WEB}/admin/`);
  await panel.getByLabel("Email").fill(OWNER_EMAIL);
  await panel.getByLabel("Contraseña").fill(OWNER_PASS);
  const login = panel.waitForResponse((r) => r.url().includes("/admin/api/auth/login"));
  await panel.getByRole("button", { name: /entrar/i }).click();
  if ((await login).status() !== 200) throw new Error("login del panel rechazado");
  await panel.getByLabel("Contraseña").waitFor({ state: "detached" });
  await panel.getByText(/dashboard/i).first().waitFor();
  ok("panel: login", true);
  await panel.goto(`http://${WEB}/admin/tenants/${T}`);
  await panel.getByRole("tab", { name: "Tema" }).click();
  await panel.waitForTimeout(800);
  const primary = panel.getByLabel(/primario/i).first();
  const primaryVal = await primary.inputValue().catch(() => "");
  ok("panel: el tema parte del color de la app (#0F172A), no del azul del módulo", primaryVal.toUpperCase() === "#0F172A", primaryVal);
  await primary.fill("#0e7490");
  const guardado = panel.waitForResponse((r) => r.request().method() === "PUT" && /\/theme$/.test(r.url()));
  await panel.getByRole("button", { name: /guardar tema/i }).click();
  await guardado;
  await panel.waitForLoadState("networkidle"); // el panel recarga el tenant después de guardar
  await shot(panel, "07-panel-tema");
  await panel.getByRole("tab", { name: "Usuarios" }).click();
  await panel.getByRole("button", { name: /entrar como/i }).first().waitFor();
  const [popup] = await Promise.all([ctx.waitForEvent("page"), panel.getByRole("button", { name: /entrar como/i }).first().click()]);
  app = popup;
  await app.waitForURL(new RegExp(`${T}\\.${WEB}/(app|auth)`), { timeout: 20000 });
  await app.getByText(/activa la cuenta/i).waitFor({ timeout: 15000 });
  await shot(app, "08-sucursal-activar-cuenta");
  ok("\"Entrar como\" abre la sucursal con sesión y pide activar la cuenta", true);

  // ---------- Activar la cuenta ----------
  const inputs = app.locator("input");
  await app.getByLabel("Nombre completo").fill("Gerente Web QA");
  await app.getByLabel("Email").fill("gerente@webqa.local");
  await app.getByLabel("Contraseña", { exact: true }).fill("WebQa#2026-Admin");
  await app.getByLabel("Repetir contraseña").fill("WebQa#2026-Admin");
  await app.getByRole("button", { name: /activar cuenta/i }).click();
  await app.getByText(/dashboard/i).first().waitFor({ timeout: 15000 });
  await shot(app, "09-sucursal-dashboard");
  ok("cuenta activada → dashboard de la sucursal", true);
  const btnColor = await app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
  ok("el color elegido en el panel se aplica en la sucursal", btnColor.toUpperCase() === "#0E7490", btnColor);

  // ---------- Doctor ----------
  await app.goto(`${BASE}/app/doctors`);
  await app.getByRole("button", { name: /nuevo doctor/i }).click();
  const dlg = app.getByRole("dialog");
  await dlg.locator("input").first().fill("Dra. Web QA");
  await dlg.getByRole("button", { name: /guardar|registrar|crear/i }).last().click();
  await app.getByText("Dra. Web QA").first().waitFor({ timeout: 10000 });
  ok("crear doctor desde la pantalla", true);

  // ---------- Estudio + tarifa (vía la API con la sesión del navegador, para no depender del diseño) ----------
  const token = await app.evaluate(() => localStorage.getItem("ionix.token"));
  const api = async (method, path, body) => {
    const r = await app.request.fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, data: body });
    return r.json();
  };
  const study = await api("POST", "/api/studies", { name: "Panorámica Web", fixed_commission: 20 });
  await api("POST", `/api/studies/${study.id}/prices`, { price_with_report: 150, price_without_report: 100, effective_date: "2026-10-01" });
  const docs = await api("GET", "/api/doctors");
  await api("POST", "/api/patients", { full_name: "Paciente Web", doctor_id: docs[0].id, phone: "70099887" });
  ok("estudio, tarifa y paciente creados con la sesión del navegador", !!study.id);

  // ---------- Atención desde la pantalla ----------
  await app.goto(`${BASE}/app/attention`);
  await app.getByPlaceholder(/nombre o celular/i).fill("Paciente");
  await app.getByText("Paciente Web").first().click();
  await app.getByRole("button", { name: /agregar/i }).first().click();
  await app.getByRole("combobox").filter({ hasText: /selecciona estudio/i }).click();
  await app.getByRole("option", { name: /panorámica web/i }).click();
  await app.waitForTimeout(500);
  const summary = await app.locator("body").innerText();
  ok("la vista previa calcula el total (100 Bs sin informe)", /Bs\s*100,00/.test(summary), summary.slice(0, 200));
  await app.getByRole("button", { name: /^registrar$/i }).click();
  await app.getByText(/atención registrada/i).first().waitFor({ timeout: 10000 });
  await shot(app, "10-sucursal-atencion");
  ok("registrar atención desde la pantalla", true);

  // ---------- Caja ----------
  await app.goto(`${BASE}/app/cashbox`);
  await app.getByRole("button", { name: /nuevo movimiento/i }).click();
  const cdlg = app.getByRole("dialog");
  const cin = cdlg.locator("input");
  await cin.nth(0).fill("Fondo inicial web");
  await cin.nth(1).fill("250");
  await cdlg.getByRole("button", { name: /guardar|registrar/i }).last().click();
  await app.waitForTimeout(1200);
  const cashText = await app.locator("main").innerText();
  ok("movimiento de caja y saldo actualizado (250)", /Bs\s*250,00/.test(cashText), cashText.slice(0, 200));
  await shot(app, "11-sucursal-caja");

  // ---------- Página web ----------
  await app.goto(`${BASE}/app/site`);
  await app.getByLabel("Teléfono").fill("2-2445566");
  await app.getByLabel(/^título$/i).first().fill(TITULO);
  await app.getByRole("button", { name: /guardar página web/i }).click();
  await app.getByText(/página web actualizada/i).first().waitFor({ timeout: 10000 });
  ok("editar la página web", true);

  // ---------- Portada pública (sin sesión, otra ventana) ----------
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`${BASE}/`);
  await pub.getByText(TITULO).first().waitFor({ timeout: 15000 });
  const pubText = await pub.locator("body").innerText();
  ok("la portada pública muestra el título y el teléfono nuevos", pubText.includes("2-2445566"), pubText.slice(0, 200));
  ok("la portada lista el estudio del catálogo de la sucursal", pubText.includes("Panorámica Web"));
  await shot(pub, "12-portada-publica");

  // ---------- Aislamiento visto desde el navegador ----------
  const other = await (await browser.newContext()).newPage();
  await other.goto(`http://${OTRA}.${WEB}/`);
  await other.waitForTimeout(2500);
  const otherText = await other.locator("body").innerText();
  ok(`otra sucursal (${OTRA}) NO muestra el contenido de ${T}`, !otherText.includes(TITULO));
} catch (e) {
  ok("flujo sin errores", false, e.message.split("\n")[0]);
  if (app) await shot(app, "zz-error-flow");
} finally {
  ok("sin errores de JavaScript en las páginas", errors.length === 0, errors.slice(0, 3));
  const f = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - f}/${results.length} OK`);
  await browser.close();
  process.exit(f ? 1 : 0);
}
