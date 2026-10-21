// Revisión de los reportes de prueba: usuarios, auditoría en español, reportes (ventas con/sin factura
// y PDF), "Ver página" con sesión abierta y tema de la sucursal (fondo, texto, tipografía, bordes).
// Requisitos: sucursal creada con test/api/pagos_permisos.py (admin@<id>.prueba) y la web en WEB.
//   TENANT=<id> WEB=localhost:8080 API=http://127.0.0.1:4000 OWNER_EMAIL=... OWNER_PASS=... node revision.mjs
import { chromium } from "playwright-core";

const T = process.env.TENANT ?? "rev1";
const WEB = process.env.WEB ?? "localhost:8080";
const API = process.env.API ?? "http://127.0.0.1:4000";
const BASE = `http://${T}.${WEB}`;
let ok = 0, fail = 0;
const check = (name, cond, info = "") => {
  cond ? ok++ : fail++;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond ? "" : `  -> ${String(info).slice(0, 300)}`}`);
};

// Tema de prueba desde el panel de la plataforma
const panel = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: { Host: "localhost", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return [r.status, await r.json().catch(() => null)];
};
const [, login] = await panel("POST", "/admin/api/auth/login", { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASS, mode: "token" });
const THEME = { background: "#F0FDF4", text: "#14532D", font: "Poppins", radius: "none" };
const [themeStatus, themeBody] = await panel("PUT", `/admin/api/tenants/${T}/theme`, THEME, login.token);
check("el panel guarda el tema", themeStatus === 200, `${themeStatus} ${JSON.stringify(themeBody)}`);

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/auth`);
  await page.getByLabel("Email o usuario").fill(`admin@${T}.prueba`);
  await page.getByLabel("Contraseña", { exact: true }).fill("Pagos#Prueba-2026");
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/app/);

  // Sesión guardada con la clave de antes de IONIX ("dental3d.token"): sigue abierta y pasa a "ionix.token"
  await page.evaluate(() => {
    localStorage.setItem("dental3d.token", localStorage.getItem("ionix.token"));
    localStorage.removeItem("ionix.token");
  });
  await page.goto(`${BASE}/app`);
  await page.getByRole("link", { name: "Pacientes", exact: true }).waitFor({ timeout: 15000 });
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check("la sesión de antes del cambio de nombre sigue abierta", keys.includes("ionix.token") && !keys.includes("dental3d.token"), keys);

  // Tema aplicado
  await page.waitForFunction(() => !!document.getElementById("tenant-theme"));
  const css = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      background: root.getPropertyValue("--background").trim(),
      foreground: root.getPropertyValue("--foreground").trim(),
      radius: root.getPropertyValue("--radius").trim(),
      font: getComputedStyle(document.body).fontFamily,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      fontLink: !!document.getElementById("tenant-font"),
    };
  });
  check("fondo de la sucursal", css.background.toLowerCase() === THEME.background.toLowerCase() && css.bodyBg === "rgb(240, 253, 244)", JSON.stringify(css));
  check("color de texto de la sucursal", css.foreground.toLowerCase() === THEME.text.toLowerCase(), css.foreground);
  check("bordes rectos", css.radius === "0rem", css.radius);
  check("tipografía Poppins (descargada de Google Fonts)", css.font.includes("Poppins") && css.fontLink, css.font);

  // Usuarios: la lista carga (antes "Error interno del servidor" en MariaDB)
  await page.goto(`${BASE}/app/users`);
  await page.getByText(`admin@${T}.prueba`).first().waitFor({ timeout: 15000 });
  check("Usuarios muestra la lista", await page.getByText("Error interno").count() === 0);

  // Auditoría en español
  await page.goto(`${BASE}/app/audit`);
  await page.getByRole("table").waitFor();
  const auditText = await page.locator("main").innerText();
  check("auditoría sin nombres de tablas en inglés", !/\b(patient_studies|study_prices|users|cashbox)\b/.test(auditText), auditText.slice(0, 300));
  check("auditoría con acciones en español", !/\b(ACCOUNT_SETUP|USER_CREATE_PLATFORM|IMPERSONATE_PLATFORM)\b/.test(auditText));

  // Reportes: abre en "Hoy"; Ventas por día de registro y Cobrado por día de pago; con y sin factura; PDF
  const summary = (from, to) => page.evaluate(async ([f, t]) => (await fetch(`/api/reports/summary?from=${f}&to=${t}`, {
    headers: { Authorization: "Bearer " + localStorage.getItem("ionix.token") },
  })).json(), [from, to]);
  const money = (n) => new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(n);
  await page.goto(`${BASE}/app/reports`);
  await page.getByText("Con factura:").waitFor({ timeout: 15000 });
  const fromValue = await page.getByLabel("Desde").inputValue();
  const toValue = await page.getByLabel("Hasta").inputValue();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  check("Reportes abre en Hoy", fromValue === today && toValue === today, `${fromValue} ${toValue}`);
  check("Reportes separa ventas con y sin factura", await page.getByText("Sin factura:").count() === 1 && await page.getByText("Facturado", { exact: true }).count() === 0);
  const hoy = await summary(today, today);
  const cards = await page.locator("main").innerText();
  check("Hoy: Ventas = atenciones registradas hoy", cards.includes(`${hoy.operational.attentions} atenciones registradas`) && cards.includes(money(hoy.financial.billed)), JSON.stringify(hoy.financial));
  check("Hoy: Cobrado = pagos recibidos hoy (incluye los de atenciones de días anteriores)",
    cards.includes(money(hoy.financial.collected)) && hoy.financial.collected_previous > 0 && cards.includes(`incluye ${money(hoy.financial.collected_previous)}`), JSON.stringify(hoy.financial));
  await page.getByRole("button", { name: "Ayer", exact: true }).click();
  const ayerDate = await page.getByLabel("Desde").inputValue();
  const ayer = await summary(ayerDate, ayerDate);
  await page.getByText(`${ayer.operational.attentions} atenciones registradas`).waitFor({ timeout: 15000 });
  check("Ayer: la atención registrada ayer suma en Ventas de ayer", ayer.operational.attentions >= 1 && (await page.locator("main").innerText()).includes(money(ayer.financial.billed)), JSON.stringify(ayer.financial));
  check("Ayer: sin pagos a terceros ni cobros de otros días", ayer.financial.third_party === 0, JSON.stringify(ayer.financial));
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  await page.getByText(`${hoy.operational.attentions} atenciones registradas`).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.getByRole("button", { name: /descargar pdf/i }).click(),
  ]);
  const path = await download.path();
  const head = (await import("node:fs")).readFileSync(path).subarray(0, 5).toString();
  check("Descargar PDF baja un archivo PDF", download.suggestedFilename().endsWith(".pdf") && head === "%PDF-", `${download.suggestedFilename()} ${head}`);

  // Página web: "Ver página" abre la portada aunque haya sesión
  await page.goto(`${BASE}/app/site`);
  const [landing] = await Promise.all([
    ctx.waitForEvent("page"),
    page.getByRole("link", { name: /ver página/i }).click(),
  ]);
  await landing.waitForLoadState();
  await landing.getByRole("link", { name: "Ir al sistema" }).waitFor({ timeout: 15000 });
  check("Ver página muestra la portada (no salta a /app)", !/\/app/.test(landing.url()), landing.url());
} catch (e) {
  check("sin errores inesperados", false, e.message);
} finally {
  await panel("DELETE", `/admin/api/tenants/${T}/theme`, null, login.token);
  await b.close();
}
console.log(`\n${ok}/${ok + fail} OK`);
process.exit(fail ? 1 : 0);
