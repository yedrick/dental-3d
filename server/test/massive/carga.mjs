// Prueba de carga: N peticiones con concurrencia C, repartidas al azar entre sucursales y rutas.
// Uso: node loadtest.mjs <state.json> <total> <concurrencia>
import http from "node:http";
import { readFileSync } from "node:fs";
const [stateFile, totalArg, concArg] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const TOTAL = Number(totalArg ?? 20000), CONC = Number(concArg ?? 100);
const agent = new http.Agent({ keepAlive: true, maxSockets: CONC });
const routes = [
  { path: "/api/public/site", auth: false, w: 3 },
  { path: "/tenancy/me", auth: false, w: 2 },
  { path: "/api/public/studies", auth: false, w: 1 },
  { path: "/api/doctors", auth: true, w: 2 },
  { path: "/api/attentions?limit=50", auth: true, w: 2 },
  { path: "/api/dashboard", auth: true, w: 1 },
  { path: "/api/cashbox/balance", auth: true, w: 1 },
  { path: "/api/reports/summary?from=2026-10-01&to=2026-10-31", auth: true, w: 1 },
];
const bag = routes.flatMap((r) => Array(r.w).fill(r));
const ids = state.ids;
const lat = []; const byRoute = {}; let errors = 0, done = 0, crossTenant = 0;
const statusCount = {};
function one() {
  return new Promise((resolve) => {
    const tenant = ids[Math.floor(Math.random() * ids.length)];
    const r = bag[Math.floor(Math.random() * bag.length)];
    const headers = { Host: `${tenant}.localhost` };
    if (r.auth) headers.Authorization = `Bearer ${state.tokens[tenant]}`;
    const t0 = performance.now();
    const req = http.request({ host: "127.0.0.1", port: 4000, path: r.path, headers, agent }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const ms = performance.now() - t0;
        lat.push(ms); (byRoute[r.path] ??= []).push(ms);
        statusCount[res.statusCode] = (statusCount[res.statusCode] ?? 0) + 1;
        if (res.statusCode >= 400) errors++;
        // Aislamiento bajo carga: /tenancy/me y /api/doctors deben ser de ESA sucursal
        if (res.statusCode === 200 && r.path === "/tenancy/me" && JSON.parse(body).id !== tenant) crossTenant++;
        if (res.statusCode === 200 && r.path === "/api/doctors" && !JSON.parse(body).every((d) => d.full_name === `Dr. ${tenant}`)) crossTenant++;
        done++; resolve();
      });
    });
    req.on("error", () => { errors++; done++; resolve(); });
    req.end();
  });
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const t0 = performance.now();
let launched = 0;
async function worker() { while (launched < TOTAL) { launched++; await one(); } }
await Promise.all(Array.from({ length: CONC }, worker));
const secs = (performance.now() - t0) / 1000;
const out = {
  total: done, seconds: +secs.toFixed(2), rps: Math.round(done / secs), errors, crossTenant, statusCount,
  p50: +pct(lat, 0.5).toFixed(1), p95: +pct(lat, 0.95).toFixed(1), p99: +pct(lat, 0.99).toFixed(1), max: +Math.max(...lat).toFixed(1),
  byRoute: Object.fromEntries(Object.entries(byRoute).map(([k, v]) => [k, { n: v.length, p50: +pct(v, 0.5).toFixed(1), p95: +pct(v, 0.95).toFixed(1) }])),
};
console.log(JSON.stringify(out, null, 2));
agent.destroy();
