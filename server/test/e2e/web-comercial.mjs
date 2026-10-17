// Web comercial de IONIX (dominio principal) y portadas de las clínicas.
// - Dominio principal: planes desde la configuración y "Solicitar demo" → panel (Solicitudes) + correo a ventas.
// - Clínica sin el módulo "Página web": portada simple. Subdominio que no existe: aviso.
// Requisitos: API con SALES_NOTIFY_TO y SMTP a Mailpit; sucursal en Básico (test/api/planes.py <id>).
//   TENANT=<id> WEB=localhost:8080 API=http://127.0.0.1:4000 MAILPIT=http://127.0.0.1:8025 OWNER_EMAIL=... OWNER_PASS=... node web-comercial.mjs
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
const panel = async (method, path, body, token) => {
  const r = await fetch(API + "/admin/api" + path, {
    method,
    headers: { Host: "localhost", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return [r.status, await r.json().catch(() => null)];
};
const [, login] = await panel("POST", "/auth/login", { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASS, mode: "token" });
const sfx = Date.now().toString(36);
const company = `Clínica Demo ${sfx}`;

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  // ---------- Dominio principal ----------
  await page.goto(`http://${WEB}/`);
  await page.getByRole("heading", { level: 1 }).filter({ hasText: "bajo control" }).waitFor({ timeout: 20000 });
  check("el dominio principal muestra la web comercial de IONIX", (await page.title()).startsWith("IONIX"), await page.title());

  await page.locator("#planes").scrollIntoViewIfNeeded();
  await page.getByRole("heading", { name: "Profesional", exact: true }).waitFor({ timeout: 15000 });
  const plans = await page.locator("#planes h3").allInnerTexts();
  check("los planes salen de la configuración (Básico, Profesional, Clínica)", ["Básico", "Profesional", "Clínica"].every((p) => plans.includes(p)), plans);
  check("Profesional aparece como 'Más elegido'", await page.getByText("Más elegido").count() === 1);
  check("sin precio configurado dice 'A consultar'", await page.getByText("A consultar").count() === 3);

  // Elegir un plan lleva al formulario con ese plan
  await page.getByRole("button", { name: "Solicitar demo con Profesional" }).click();
  await page.waitForTimeout(800);
  const selected = await page.locator("#demo select").inputValue();
  check("'Solicitar demo con Profesional' llena el plan del formulario", selected === "profesional", selected);

  // Validación en español
  await page.getByRole("button", { name: "Solicitar mi demo" }).click();
  check("sin datos: pide nombre, contacto y permiso", await page.getByText("Escribe tu nombre.").isVisible() && await page.getByText("Déjanos tu WhatsApp o tu correo").isVisible() && await page.getByText("Necesitamos tu permiso").isVisible());

  await page.getByLabel("Nombre *", { exact: true }).fill("Ana Prueba");
  await page.getByLabel("Clínica o centro", { exact: true }).fill(company);
  await page.getByLabel("WhatsApp", { exact: true }).fill("+591 70000000");
  await page.getByLabel("Correo", { exact: true }).fill(`ana-${sfx}@prueba.ionix`);
  await page.getByLabel("Ciudad", { exact: true }).fill("La Paz");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Solicitar mi demo" }).click();
  await page.getByText("¡Solicitud recibida!").waitFor({ timeout: 15000 });
  check("al enviar: '¡Solicitud recibida!'", true);

  const [, leads] = await panel("GET", "/leads?search=" + encodeURIComponent(sfx), null, login.token);
  const lead = (leads?.items ?? leads ?? []).find?.((l) => l.company === company);
  check("la solicitud llega al panel (Solicitudes) con el plan Profesional", lead && lead.plan === "profesional" && lead.status === "new", JSON.stringify(leads).slice(0, 300));

  let mail;
  for (let i = 0; i < 20 && !mail; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${company}"`)}`)).json().catch(() => ({}));
    mail = r.messages?.[0];
    if (!mail) await new Promise((res) => setTimeout(res, 500));
  }
  check("llega el aviso por correo a ventas", mail && mail.To?.[0]?.Address === "ventas@ionix.prueba", JSON.stringify(mail ?? "").slice(0, 200));

  // ---------- Clínica sin "Página web" (plan Básico) ----------
  await panel("PATCH", `/tenants/${T}`, { plan: "basico", features: null }, login.token);
  await page.goto(`http://${T}.${WEB}/`);
  await page.getByRole("link", { name: /ingresar al sistema/i }).waitFor({ timeout: 15000 });
  check("clínica en Básico: portada simple con su nombre y acceso al sistema", await page.getByRole("heading", { level: 1 }).innerText() === `Clínica ${T}`);
  check("portada simple sin WhatsApp de otra clínica", await page.locator('a[href*="wa.me"]').count() === 0);

  // ---------- Subdominio que no existe ----------
  await page.goto(`http://noexiste-${sfx}.${WEB}/`);
  await page.getByText("Esta clínica no existe").waitFor({ timeout: 15000 });
  check("subdominio inexistente: aviso 'Esta clínica no existe'", true);

  // ---------- Privacidad ----------
  await page.goto(`http://${WEB}/privacidad`);
  check("la página de privacidad abre", await page.getByRole("heading", { name: "Privacidad" }).isVisible());
  check("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("sin errores inesperados", false, e.message);
} finally {
  await b.close();
}
console.log(`\n${ok}/${ok + fail} OK`);
process.exit(fail ? 1 : 0);
