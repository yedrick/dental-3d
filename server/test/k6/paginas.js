// Velocidad de las páginas en un navegador real (Chromium de k6), sucursal por sucursal.
//
// Mide en cada página:
//   - lista:  desde que se pide la página hasta que se ve su contenido principal (lo que siente el usuario)
//   - ttfb:   primera respuesta del servidor
//   - dom:    HTML procesado (DOMContentLoaded)
// y además las Web Vitals que k6 registra solo: LCP, FCP, CLS, TTFB, INP.
//
// Se puede correr sola o AL MISMO TIEMPO que api.js (para ver qué siente un usuario con el servidor cargado).
// Variables: WEB (http://{sucursal}.localhost:8088), VUS (1), VUELTAS (una por sucursal).
import { browser } from "k6/browser";
import { check } from "k6";
import exec from "k6/execution";
import { Trend } from "k6/metrics";
import { TENANTS, tokensDeTodas } from "./lib/comun.js";

const WEB = __ENV.WEB || "http://{sucursal}.localhost:8088";
const PAGINAS = [
  // [nombre, ruta, lo que tiene que verse, requiere sesión]
  ["portada", "/", "h1", false],
  ["login", "/auth", 'input[autocomplete="username"]', false],
  ["panel", "/app", '//*[contains(text(), "Saldo caja chica")]', true],
  ["pacientes", "/app/patients", '//*[contains(text(), "Paciente {sucursal}")]', true],
  ["caja", "/app/cashbox", '//*[contains(text(), "Saldo actual")]', true],
];

const lista = new Trend("pagina_lista", true);
const ttfb = new Trend("pagina_ttfb", true);
const dom = new Trend("pagina_dom", true);

const umbrales = {
  checks: ["rate>0.95"],
  browser_web_vital_lcp: ["p(75)<2500"],
  browser_web_vital_fcp: ["p(75)<1800"],
  browser_web_vital_cls: ["p(75)<0.1"],
  pagina_lista: ["p(95)<3000"],
};
for (const [p] of PAGINAS) {
  umbrales[`pagina_lista{pagina:${p}}`] = ["p(95)<3000"];
  umbrales[`pagina_ttfb{pagina:${p}}`] = ["p(95)<800"];
  umbrales[`pagina_dom{pagina:${p}}`] = ["p(95)<2000"];
}

export const options = {
  scenarios: {
    paginas: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.VUELTAS || TENANTS.length),
      maxDuration: "30m",
      options: { browser: { type: "chromium" } },
    },
  },
  thresholds: umbrales,
  summaryTrendStats: ["avg", "min", "med", "p(75)", "p(95)", "max"],
};

export function setup() {
  return { tokens: tokensDeTodas() };
}

export default async function (data) {
  const t = TENANTS[exec.scenario.iterationInTest % TENANTS.length];
  const base = WEB.replace("{sucursal}", t.id);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const [nombre, ruta, selector, sesion] of PAGINAS) {
      if (sesion) {
        // La sesión se pone directo (el login tiene límite de intentos por IP; aquí se mide la página, no bcrypt)
        await page.evaluate((tk) => localStorage.setItem("ionix.token", tk), data.tokens[t.id]);
      }
      const tags = { pagina: nombre, sucursal: t.id };
      const t0 = Date.now();
      await page.goto(base + ruta, { waitUntil: "domcontentloaded" });
      let visible = false;
      try {
        await page.locator(selector.replace("{sucursal}", t.id)).first().waitFor({ state: "visible", timeout: 15000 });
        visible = true;
      } catch (_) { /* se registra en el check */ }
      if (visible) lista.add(Date.now() - t0, tags);
      else await page.screenshot({ path: `resultados/fallo-${nombre}-${t.id}.png` }); // para ver qué mostró
      check(page, { [`${nombre}: se ve el contenido`]: () => visible }, tags);
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return n ? { ttfb: n.responseStart - n.requestStart, dom: n.domContentLoadedEventEnd - n.startTime } : null;
      });
      if (nav) { ttfb.add(nav.ttfb, tags); dom.add(nav.dom, tags); }
    }
  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  const M = data.metrics;
  const ms = (v) => (v === undefined ? "-" : `${Math.round(v)} ms`);
  const filas = PAGINAS.map(([p]) => {
    const l = M[`pagina_lista{pagina:${p}}`]?.values, tt = M[`pagina_ttfb{pagina:${p}}`]?.values, d = M[`pagina_dom{pagina:${p}}`]?.values;
    return `  ${p.padEnd(10)} ${ms(l?.med).padStart(8)} ${ms(l?.["p(95)"]).padStart(8)} ${ms(tt?.med).padStart(8)} ${ms(d?.med).padStart(8)}`;
  });
  const v = (k) => M[k]?.values;
  const fallidos = Object.entries(M).flatMap(([k, m]) => Object.entries(m.thresholds ?? {}).filter(([, t]) => !t.ok).map(([th]) => `  ✘ ${k}: ${th}`));
  const txt = `
══════ Dental-3D · k6 · velocidad de páginas · ${new Date().toISOString()} ══════
Vueltas: ${v("iterations")?.count ?? 0} · comprobaciones correctas: ${((v("checks")?.rate ?? 0) * 100).toFixed(1)} %

PÁGINA       lista p50  lista p95  ttfb p50   dom p50
${filas.join("\n")}

WEB VITALS (p75; metas de Google: LCP < 2500 ms, FCP < 1800 ms, CLS < 0,1)
  LCP ${ms(v("browser_web_vital_lcp")?.["p(75)"])} · FCP ${ms(v("browser_web_vital_fcp")?.["p(75)"])} · TTFB ${ms(v("browser_web_vital_ttfb")?.["p(75)"])} · CLS ${(v("browser_web_vital_cls")?.["p(75)"] ?? 0).toFixed(3)}
${!M.pagina_lista ? "\n✘ Sin datos: el navegador no llegó a medir ninguna página.\n" : fallidos.length ? `\nMetas no cumplidas:\n${fallidos.join("\n")}\n` : "\nTodas las metas cumplidas ✔\n"}`;
  const base = `resultados/paginas-${__ENV.FECHA || new Date().toISOString().replace(/[:.]/g, "-")}`;
  return { stdout: txt, [`${base}.txt`]: txt, [`${base}.json`]: JSON.stringify(data, null, 2) };
}
