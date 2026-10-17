// tenancy-node 0.12: planes y marca de la plataforma editables en el panel, sin desplegar.
// - Precio y módulos de un plan editados en /admin → la web comercial y los permisos de las clínicas cambian.
// - Plataforma: nombre, WhatsApp, correo, logo y correo de ventas → web comercial y aviso de "Solicitar demo".
// Requisitos: sucursal en Básico (test/api/planes.py <id>), API con SMTP a Mailpit.
//   TENANT=<id> WEB=localhost:8080 API=http://127.0.0.1:4000 MAILPIT=http://127.0.0.1:8025 OWNER_EMAIL=... OWNER_PASS=... node panel-planes-plataforma.mjs
import { readFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright-core";

const T = process.env.TENANT ?? "planes1";
const WEB = process.env.WEB ?? "localhost:8080";
const API = process.env.API ?? "http://127.0.0.1:4000";
const MAILPIT = process.env.MAILPIT ?? "http://127.0.0.1:8025";
let ok = 0, fail = 0;
const check = (name, cond, info = "") => {
  cond ? ok++ : fail++;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond ? "" : `  -> ${String(info).slice(0, 300)}`}`);
};
const req = async (method, path, { body, host = "localhost", token, raw, type } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      Host: host,
      ...(raw ? { "Content-Type": type } : body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return [r.status, await r.json().catch(() => null)];
};
const [, login] = await req("POST", "/admin/api/auth/login", { body: { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASS, mode: "token" } });
const PT = login.token;
const panel = (method, path, opts = {}) => req(method, "/admin/api" + path, { ...opts, token: PT });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = Date.now().toString(36);

// API de la clínica con node:http (fetch de Node no deja cambiar el Host, y la sucursal sale del subdominio)
const tenantApi = (method, path, body, token) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request(API + path, {
    method,
    headers: { Host: `${T}.localhost`, ...(data ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }, (res) => {
    let raw = "";
    res.on("data", (c) => (raw += c));
    res.on("end", () => resolve([res.statusCode, raw ? JSON.parse(raw) : null]));
  });
  r.on("error", reject);
  if (data) r.write(data);
  r.end();
});
const [, tl] = await tenantApi("POST", "/api/auth/login", { login: `admin@${T}.prueba`, password: "Planes#Prueba-2026" });
const reports = () => tenantApi("GET", "/api/reports/summary?from=2026-01-01&to=2026-01-31", null, tl.token);

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await panel("PATCH", `/tenants/${T}`, { body: { plan: "basico", features: null } });

  // ---------- Planes editables ----------
  let [s, plan] = await panel("PATCH", "/plans/basico", { body: { price: { currency: "BOB", monthly: 150, yearly: 1500 }, description: "Para empezar a ordenar tu clínica" } });
  check("el panel guarda el precio del plan Básico", s === 200, JSON.stringify(plan));
  const [, pub] = await req("GET", "/tenancy/plans");
  const basico = pub.plans.find((p) => p.id === "basico");
  check("GET /tenancy/plans ya trae el precio (sin desplegar)", basico?.price?.monthly === 150 && basico?.price?.yearly === 1500, JSON.stringify(basico));

  await page.goto(`http://${WEB}/#planes`);
  await page.getByRole("heading", { name: "Básico", exact: true }).waitFor({ timeout: 20000 });
  const basicCard = page.locator("#planes article").filter({ has: page.getByRole("heading", { name: "Básico", exact: true }) });
  const monthly = await basicCard.innerText();
  check("la web comercial muestra Bs 150 / mes en Básico", /Bs\s?150/.test(monthly) && monthly.includes("/ mes") && monthly.includes("Para empezar a ordenar"), monthly.slice(0, 200));
  await page.getByRole("button", { name: "Anual", exact: true }).click();
  check("con 'Anual' muestra Bs 1.500 / año", /Bs\s?1\.500/.test(await basicCard.innerText()) && (await basicCard.innerText()).includes("/ año"));

  // Módulos del plan editados en el panel: la clínica en Básico gana Reportes
  [s] = await reports();
  check("antes: Básico no tiene Reportes (403)", s === 403, s);
  await panel("PATCH", "/plans/basico", { body: { features: ["agenda", "caja", "reportes"] } });
  let after = 0;
  for (let i = 0; i < 20 && after !== 200; i++) { [after] = await reports(); if (after !== 200) await wait(250); }
  check("después de editar el plan en el panel: Reportes permitido sin desplegar", after === 200, after);
  [s] = await panel("DELETE", "/plans/basico");
  let back = 0;
  for (let i = 0; i < 20 && back !== 403; i++) { [back] = await reports(); if (back !== 403) await wait(250); }
  check("'Restablecer' vuelve a los valores del código (sin Reportes ni precio)", s === 200 && back === 403, `${s} ${back}`);

  // ---------- Marca de la plataforma ----------
  [s] = await panel("PATCH", "/platform", { body: { contact: { whatsapp: "59171111111", email: `hola-${sfx}@ionix.prueba` }, salesNotifyTo: [`comercial-${sfx}@ionix.prueba`] } });
  const png = readFileSync(new URL("../../../src/assets/logo-3d.png", import.meta.url));
  const [ls, logo] = await panel("PUT", "/platform/logo", { raw: png, type: "image/png" });
  check("el panel guarda contacto y sube el logo de la plataforma", s === 200 && ls === 200, JSON.stringify(logo).slice(0, 200));
  const [, platform] = await req("GET", "/tenancy/platform");
  check("GET /tenancy/platform trae logo, WhatsApp y correo (sin el correo de ventas)",
    platform.logoUrl && platform.contact.whatsapp === "59171111111" && !JSON.stringify(platform).includes("comercial-"), JSON.stringify(platform));

  await page.goto(`http://${WEB}/`);
  const navLogo = page.locator("header img").first();
  await navLogo.waitFor({ timeout: 15000 });
  const loaded = await navLogo.evaluate((img) => img.complete && img.naturalWidth > 0);
  check("la web comercial muestra el logo subido en el panel", loaded && (await navLogo.getAttribute("src")) === platform.logoUrl, await navLogo.getAttribute("src"));
  check("el botón de WhatsApp usa el número del panel (no el del .env)", await page.locator('a[href^="https://wa.me/59171111111"]').count() >= 1);
  check("el correo del panel aparece en la web", await page.getByRole("link", { name: `hola-${sfx}@ionix.prueba` }).count() === 1);

  // Solicitud → aviso al correo de ventas del panel
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.getByLabel("Nombre *", { exact: true }).fill("Prueba Ventas");
  await page.getByLabel("Clínica o centro", { exact: true }).fill(`Clínica Ventas ${sfx}`);
  await page.getByLabel("WhatsApp", { exact: true }).fill("+591 72222222");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Solicitar mi demo" }).click();
  await page.getByText("¡Solicitud recibida!").waitFor({ timeout: 15000 });
  let mail;
  for (let i = 0; i < 20 && !mail; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"Clínica Ventas ${sfx}"`)}`)).json().catch(() => ({}));
    mail = r.messages?.[0];
    if (!mail) await wait(500);
  }
  check("el aviso llega al correo de ventas configurado en el panel", mail?.To?.[0]?.Address === `comercial-${sfx}@ionix.prueba`, JSON.stringify(mail?.To ?? mail ?? "").slice(0, 200));
  check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("sin errores inesperados", false, e.message);
} finally {
  await panel("DELETE", "/plans/basico");
  await panel("PATCH", "/platform", { body: { logo: null, contact: { whatsapp: null, email: null }, salesNotifyTo: [] } });
  await b.close();
}
console.log(`\n${ok}/${ok + fail} OK`);
process.exit(fail ? 1 : 0);
