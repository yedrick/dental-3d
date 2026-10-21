import { chromium } from "playwright-core";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@dental3d.local";
const OWNER_PASS = process.env.OWNER_PASS;
// Dirección del frontend (dominio central) y otra sucursal existente para revisar el aislamiento
const WEB = process.env.WEB ?? "localhost:8081";
if (!OWNER_PASS) throw new Error("Falta OWNER_PASS (contraseña del dueño del panel)");
const SHOTS = process.env.SHOTS ?? "./capturas"; const T = process.env.TENANT ?? "webqa";
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://${WEB}/admin/`);
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Contraseña").fill(OWNER_PASS);
  // Esperar la respuesta del login: la pantalla de login ya dice "tenants" y no sirve para saber si entró
  const login = page.waitForResponse((r) => r.url().includes("/admin/api/auth/login"));
  await page.getByRole("button", { name: /entrar/i }).click();
  if ((await login).status() !== 200) throw new Error("login del panel rechazado");
  await page.getByLabel("Contraseña").waitFor({ state: "detached" });
  await page.screenshot({ path: `${SHOTS}/01-panel-dashboard.png` }); log("panel: login OK");

  await page.goto(`http://${WEB}/admin/tenants`);
  await page.getByRole("button", { name: /nuevo tenant/i }).click();
  await page.getByLabel(/^id$/i).fill(T);
  await page.getByLabel(/^nombre$/i).fill(process.env.NOMBRE ?? `Sucursal ${T}`);
  await page.screenshot({ path: `${SHOTS}/02-panel-nuevo.png` });
  // Esperar la respuesta de creación antes de consultar el estado: si no, la primera consulta puede
  // llegar antes que el POST y deja un "Tenant not found" en la pestaña Errores de la sucursal
  const creada = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/admin/api/tenants"));
  await page.getByRole("button", { name: /^crear$/i }).click();
  if ((await creada).status() !== 202) throw new Error("el panel no aceptó crear la sucursal");
  // Esperar el estado real (el texto "Activo" ya aparece por otras sucursales de la lista)
  for (let i = 0; ; i++) {
    const r = await page.request.get(`http://${WEB}/admin/api/tenants/${T}`);
    const status = r.ok() ? ((await r.json()).tenant ?? (await r.json())).status : null;
    if (status === "active") break;
    if (status === "failed" || i > 120) throw new Error(`la sucursal quedó en estado ${status}`);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${SHOTS}/03-panel-creado.png` }); log("panel: sucursal creada y activa");

  await page.goto(`http://${WEB}/admin/tenants/${T}`);
  await page.waitForTimeout(1500);
  const text = await page.locator("body").innerText();
  console.log("--- textos del detalle ---\n" + text.slice(0, 1500));
  await page.screenshot({ path: `${SHOTS}/04-panel-detalle.png`, fullPage: true });
  const tabs = await page.getByRole("tab").allInnerTexts(); console.log("pestañas:", tabs);
  const buttons = await page.getByRole("button").allInnerTexts(); console.log("botones:", buttons.filter(Boolean));
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/zz-error-panel.png`, fullPage: true });
  console.log("ERROR:", e.message.split("\n")[0]);
} finally {
  console.log("errores JS:", errors);
  await browser.close();
}
