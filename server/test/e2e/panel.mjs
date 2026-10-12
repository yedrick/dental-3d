import { chromium } from "playwright-core";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@dental3d.local";
const OWNER_PASS = process.env.OWNER_PASS;
if (!OWNER_PASS) throw new Error("Falta OWNER_PASS (contraseña del dueño del panel)");
const SHOTS = process.env.SHOTS ?? "./capturas"; const T = process.env.TENANT ?? "webqa";
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:8081/admin/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Contraseña").fill(OWNER_PASS);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.getByText(/dashboard|tenants|sucursales/i).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/01-panel-dashboard.png` }); log("panel: login OK");

  await page.goto("http://localhost:8081/admin/tenants");
  await page.getByRole("button", { name: /nuevo tenant/i }).click();
  await page.getByLabel(/^id$/i).fill(T);
  await page.getByLabel(/^nombre$/i).fill("Sucursal Web QA");
  await page.screenshot({ path: `${SHOTS}/02-panel-nuevo.png` });
  await page.getByRole("button", { name: /^crear$/i }).click();
  await page.getByText(/quedó activ|activo/i).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: `${SHOTS}/03-panel-creado.png` }); log("panel: sucursal creada y activa");

  await page.goto(`http://localhost:8081/admin/tenants/${T}`);
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
