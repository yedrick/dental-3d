// Resumen en español al terminar cada prueba: general, por endpoint, por sucursal y (en el perfil
// "capacidad") por escalón. Se muestra en pantalla y se guarda en resultados/<perfil>-<fecha>.{txt,json}.

const ms = (v) => (v === undefined ? "-" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`);
const pct = (v) => (v === undefined ? "-" : `${(v * 100).toFixed(2)} %`);
const num = (v) => (v === undefined ? "-" : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "."));
const cumple = (...ms) => (ms.every((m) => Object.values(m?.thresholds ?? {}).every((t) => t.ok)) ? "✔" : "✘");

function tabla(titulo, cols, filas) {
  if (filas.length === 0) return "";
  const ancho = cols.map((c, i) => Math.max(c.length, ...filas.map((f) => String(f[i]).length)));
  const linea = (f) => "  " + f.map((v, i) => (i === 0 ? String(v).padEnd(ancho[i]) : String(v).padStart(ancho[i]))).join("  ");
  return `\n${titulo}\n${linea(cols)}\n  ${ancho.map((a) => "─".repeat(a)).join("  ")}\n${filas.map(linea).join("\n")}\n`;
}

export function resumen(data, { perfil, endpoints, tenants, pasos, meseta, personal, logins, etapas }) {
  const M = data.metrics;
  const dur = data.state.testRunDurationMs / 1000;
  const d = M.http_req_duration?.values ?? {};
  const app = M["http_req_duration{tipo:app}"]?.values ?? d;
  const fallidos = Object.entries(M).flatMap(([k, m]) =>
    Object.entries(m.thresholds ?? {}).filter(([, t]) => !t.ok).map(([th]) => `${k}: ${th}`));

  let txt = `\n══════ Dental-3D · k6 · perfil "${perfil}" · ${new Date().toISOString()} ══════\n`;
  txt += tabla("GENERAL", ["", "valor"], [
    ["Duración", `${dur.toFixed(0)} s`],
    ["Peticiones", num(M.http_reqs?.values.count)],
    ["Peticiones por segundo (promedio)", (M.http_reqs?.values.rate ?? 0).toFixed(1)],
    ["Usuarios virtuales a la vez (máximo)", num(M.vus?.values.max)],
    ["Respuesta de la app p50 / p95 / p99 (sin login)", `${ms(app.med)} / ${ms(app["p(95)"])} / ${ms(app["p(99)"])}`],
    ["Respuesta con login p50 / p95 / p99", `${ms(d.med)} / ${ms(d["p(95)"])} / ${ms(d["p(99)"])}`],
    ["Tiempo máximo", ms(d.max)],
    ["Errores", pct(M.http_req_failed?.values.rate)],
    ["Comprobaciones correctas", pct(M.checks?.values.rate)],
    ["Datos de otra sucursal (aislamiento)", num(M.aislamiento_fallas?.values.count ?? 0)],
    ["Iteraciones descartadas (k6 no llegó al ritmo)", num(M.dropped_iterations?.values.count ?? 0)],
  ]);

  const porEndpoint = Object.keys(endpoints)
    .map((e) => [e, M[`http_req_duration{endpoint:${e}}`], M[`http_req_failed{endpoint:${e}}`], M[`http_reqs{endpoint:${e}}`]])
    .filter(([, , , n]) => n?.values.count > 0)
    .map(([e, t, f, n]) => [e, num(n.values.count), n.values.rate.toFixed(1), ms(t.values.med), ms(t.values["p(95)"]), ms(t.values["p(99)"]), pct(f?.values.rate), `< ${endpoints[e]} ms`, cumple(t, f)]);
  txt += tabla("POR ENDPOINT", ["endpoint", "peticiones", "por seg", "p50", "p95", "p99", "errores", "meta p95", ""], porEndpoint);

  const porSucursal = tenants
    .map((s) => [s, M[`http_req_duration{sucursal:${s}}`], M[`http_req_failed{sucursal:${s}}`], M[`http_reqs{sucursal:${s}}`]])
    .filter(([, , , n]) => n?.values.count > 0)
    .map(([s, t, f, n]) => [s, num(n.values.count), ms(t.values.med), ms(t.values["p(95)"]), ms(t.values.max), pct(f?.values.rate), cumple(t, f)]);
  txt += tabla("POR SUCURSAL", ["sucursal", "peticiones", "p50", "p95", "máx", "errores", ""], porSucursal);

  if (!pasos && etapas?.length > 1) {
    const filas = etapas
      .map((e) => [e, M[`http_req_duration{etapa:${e.etiqueta}}`], M[`http_req_failed{etapa:${e.etiqueta}}`], M[`http_reqs{etapa:${e.etiqueta}}`]])
      .filter(([, , , n]) => n?.values.count > 0)
      .map(([e, t, f, n]) => {
        const bien = t.values["p(95)"] < 500 && (f?.values.rate ?? 0) < 0.01;
        return [`${e.desde} → ${e.hasta}`, (n.values.count / e.segundos).toFixed(0), ms(t.values.med), ms(t.values["p(95)"]), ms(t.values["p(99)"]), pct(f?.values.rate), bien ? "✔" : "✘"];
      });
    txt += tabla("POR ETAPA (usuarios del personal; los visitantes son el doble). ✔ = p95 < 500 ms y errores < 1 %",
      ["personal", "pet/s", "p50", "p95", "p99", "errores", ""], filas);
  }

  let conclusion = "";
  if (pasos) {
    const filas = [];
    let maximo = null;
    for (const r of pasos) {
      const t = M[`http_req_duration{etapa:${r}}`], f = M[`http_req_failed{etapa:${r}}`], n = M[`http_reqs{etapa:${r}}`];
      if (!n || n.values.count === 0) { filas.push([r, "no se llegó", "-", "-", "-", ""]); continue; }
      const logrado = n.values.count / meseta;
      const bien = t.values["p(95)"] < 500 && (f?.values.rate ?? 0) < 0.01 && logrado >= r * 0.95;
      if (bien) maximo = { r, logrado, p95: t.values["p(95)"] };
      filas.push([r, logrado.toFixed(0), ms(t.values.med), ms(t.values["p(95)"]), pct(f?.values.rate), bien ? "✔" : "✘"]);
    }
    txt += tabla("CAPACIDAD POR ESCALÓN (meta: p95 < 500 ms, errores < 1 % y lograr el ritmo pedido)",
      ["pedidas/s", "logradas/s", "p50", "p95", "errores", ""], filas);
    conclusion = maximo
      ? `Máximo sostenido: ~${maximo.logrado.toFixed(0)} peticiones por segundo con p95 de ${ms(maximo.p95)}.`
      : "Ningún escalón cumplió la meta: revisa el primero.";
  } else {
    const quienes = `${num(personal)} usuarios del personal trabajando y ${num(personal * 2)} visitantes en las portadas a la vez` +
      (logins ? `, más ${logins} logins por segundo` : "") + `, repartidos en ${tenants.length} sucursales`;
    conclusion = fallidos.length === 0
      ? `Cumple todas las metas con ${quienes} (p95 de la app: ${ms(app["p(95)"])}).`
      : `Con ${quienes} NO cumple todas las metas: ver la lista de abajo.`;
  }
  txt += `\nCONCLUSIÓN: ${conclusion}\n`;
  if (fallidos.length) txt += `\nMetas no cumplidas (${fallidos.length}):\n${fallidos.map((f) => `  ✘ ${f}`).join("\n")}\n`;

  const base = `resultados/${perfil}-${__ENV.FECHA || new Date().toISOString().replace(/[:.]/g, "-")}`;
  return { stdout: txt, [`${base}.txt`]: txt, [`${base}.json`]: JSON.stringify(data, null, 2) };
}
