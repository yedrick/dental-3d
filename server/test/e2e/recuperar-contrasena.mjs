// "¿Olvidaste tu contraseña?" en el navegador, leyendo el código del correo en Mailpit.
// Uso (después de test/api/recuperar_contrasena.py <id>, que deja el usuario ana@<id>.prueba):
//   TENANT=<id> WEB=localhost:8080 node recuperar-contrasena.mjs
import { chromium } from "playwright-core";
import * as fs from "node:fs";

const S = process.env.SHOTS ?? "./capturas", T = process.env.TENANT ?? "reset1";
const BASE = `http://${T}.${process.env.WEB ?? "localhost:8080"}`;
const MAILPIT = process.env.MAILPIT ?? "http://127.0.0.1:8025";
const EMAIL = `ana@${T}.prueba`, NEWPASS = `Web#Clave-${Date.now().toString(36)}A1`;
fs.mkdirSync(S, { recursive: true });
let ok = 0, fail = 0;
const check = (n, c, i = "") => { c ? ok++ : fail++; console.log((c ? "OK   " : "FAIL ") + n + (c ? "" : "  -> " + String(i).slice(0, 300))); };
const mails = async () => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}`)).json()).messages ?? [];

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const page = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  const before = (await mails()).length;
  await page.goto(`${BASE}/auth`);
  await page.getByText(/olvidaste tu contraseña/i).click();
  await page.waitForURL(/reset-password/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.screenshot({ path: `${S}/01-pedir-codigo.png` });
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Código").waitFor({ timeout: 10000 }).catch(async (e) => {
    throw new Error(`no pasó al paso del código: ${await page.locator("[data-sonner-toast]").allInnerTexts()} · ${e.message.split("\n")[0]}`);
  });
  let list = [];
  for (let i = 0; i < 40 && list.length <= before; i++) { await page.waitForTimeout(250); list = await mails(); }
  check("llegó el correo con el código", list.length === before + 1, `${before} → ${list.length}`);
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list[0].ID}`)).json();
  const code = /\b(\d{6})\b/.exec(msg.Text)?.[1];
  // Cómo se ve el correo
  const mailPage = await (await b.newContext({ viewport: { width: 640, height: 720 } })).newPage();
  await mailPage.setContent(msg.HTML);
  await mailPage.screenshot({ path: `${S}/02-correo.png`, fullPage: true });
  await page.getByLabel("Código").fill(code);
  await page.getByLabel("Contraseña nueva").fill(NEWPASS);
  await page.getByLabel("Repetir contraseña").fill(NEWPASS);
  await page.screenshot({ path: `${S}/03-codigo-y-clave.png` });
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await page.waitForURL(/\/app/, { timeout: 15000 });
  check("con el código queda dentro del sistema", true);
  await page.screenshot({ path: `${S}/04-dentro.png` });
  // Desde la página (mismo origen: la sucursal sale del subdominio)
  const status = await page.evaluate(async ([login, password]) =>
    (await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password }) })).status,
  [EMAIL, NEWPASS]);
  check("la contraseña nueva sirve para iniciar sesión", status === 200, status);
} catch (e) {
  check("sin errores: " + e.message.split("\n")[0], false);
  await page.screenshot({ path: `${S}/zz-error.png` }).catch(() => {});
}
check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
console.log(`${ok}/${ok + fail} OK`);
process.exitCode = fail ? 1 : 0;
await b.close();
