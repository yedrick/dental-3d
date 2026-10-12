// Paciente sin doctor y carga masiva de estudios con Excel, en el navegador.
// Uso (después de test/api/pacientes_estudios.py <id>, que deja la sucursal con datos):
//   TENANT=<id> WEB=localhost:8080 node estudios-excel.mjs
// Usa el paquete xlsx del frontend (raíz del repo) para leer y escribir los Excel de prueba.
import { chromium } from "playwright-core";
import * as XLSX from "../../../node_modules/xlsx/xlsx.mjs";
import * as fs from "node:fs";
XLSX.set_fs(fs);
const S = process.env.SHOTS ?? "./capturas", T = process.env.TENANT ?? "excelapi";
const BASE = `http://${T}.${process.env.WEB ?? "localhost:8080"}`;
fs.mkdirSync(S, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
let ok = 0, fail = 0; const check = (n, c, i = "") => { c ? ok++ : fail++; console.log((c ? "OK   " : "FAIL ") + n + (c ? "" : "  -> " + String(i).slice(0, 300))); };
try {
  await page.goto(`${BASE}/auth`);
  await page.getByLabel("Email o usuario").fill(`admin@${T}.prueba`);
  await page.getByLabel("Contraseña", { exact: true }).fill("Excel#Prueba-2026");
  await page.getByRole("button", { name: /^ingresar|iniciar/i }).first().click();
  await page.waitForURL(/\/app/);

  // ---- Paciente sin doctor desde la pantalla ----
  await page.goto(`${BASE}/app/patients`);
  await page.getByRole("button", { name: /nuevo paciente/i }).click();
  const nombre = `Juana Sin Doctor ${Date.now().toString(36)}`;
  const dlg = page.getByRole("dialog");
  check("el formulario dice 'Doctor remitente (opcional)'", await dlg.getByText("Doctor remitente (opcional)").isVisible());
  await dlg.locator("input").first().fill(nombre);
  await dlg.getByRole("button", { name: /guardar|crear/i }).click();
  await page.getByText(nombre).waitFor({ timeout: 10000 });
  const row = page.locator("tr", { hasText: nombre });
  check("se creó sin doctor y la lista dice 'Sin doctor'", await row.getByText("Sin doctor", { exact: true }).isVisible());
  await page.screenshot({ path: `${S}/01-pacientes.png` });

  // ---- Atención con ese paciente ----
  await page.goto(`${BASE}/app/attention`);
  await page.getByPlaceholder(/nombre o celular/i).fill(nombre);
  await page.getByText(nombre).first().click();
  check("atención: avisa que va sin comisión", await page.getByText(/Sin doctor: se registra sin comisión/).isVisible());
  await page.screenshot({ path: `${S}/02-atencion.png` });

  // ---- Estudios: plantilla ----
  await page.goto(`${BASE}/app/studies`);
  await page.getByRole("button", { name: /carga masiva/i }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /descargar plantilla/i }).click()]);
  const tpl = `${S}/${dl.suggestedFilename()}`; await dl.saveAs(tpl);
  const wb = XLSX.readFile(tpl);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Estudios"], { header: 1 });
  check(`plantilla descargada (${dl.suggestedFilename()}) con hojas Estudios e Instrucciones`, wb.SheetNames.join() === "Estudios,Instrucciones", wb.SheetNames);
  const pano = rows.find((r) => r[0] === "Panorámica");
  check("la plantilla trae los estudios actuales con sus precios", rows.length >= 4 && typeof pano?.[2] === "number", JSON.stringify(rows));
  const sfx = Date.now().toString(36), nuevoCon = pano[2] + 10, nuevoSin = pano[3] + 10;

  // Editar: subir precio de Panorámica, agregar 2 estudios (uno con texto "1.250,50")
  const edited = rows.map((r) => (r[0] === "Panorámica" ? [r[0], r[1], nuevoCon, nuevoSin, r[4], r[5]] : r));
  edited.push([`Tomografía mandíbula ${sfx}`, "CBCT parcial", "1.250,50", "1.000", 60, "SI"], [`Cefalometría ${sfx}`, "", 90, 70, "", ""]);
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(edited), "Estudios");
  XLSX.writeFile(wb2, `${S}/editado.xlsx`);
  await page.locator('input[type="file"]').setInputFiles(`${S}/editado.xlsx`);
  await page.getByText(/a crear/).waitFor({ timeout: 15000 });
  const d = page.getByRole("dialog");
  check("vista previa: 2 a crear, 1 a actualizar", await d.getByText("2 a crear").isVisible() && await d.getByText("1 a actualizar").isVisible());
  check("vista previa muestra el cambio de tarifa de Panorámica", await d.getByText(`${pano[2]} → ${nuevoCon} con informe`, { exact: false }).isVisible());
  await page.screenshot({ path: `${S}/03-vista-previa.png` });
  await d.getByRole("button", { name: /aplicar 3 cambios/i }).click();
  await page.getByText(/Listo: 2 creados, 1 actualizados/).waitFor({ timeout: 15000 });
  check("aplicado: mensaje de éxito", true);
  await page.getByText(`Tomografía mandíbula ${sfx}`).first().waitFor();
  check("los estudios nuevos aparecen en la lista", await page.getByText(`Cefalometría ${sfx}`).first().isVisible());
  await page.screenshot({ path: `${S}/04-estudios.png`, fullPage: true });

  // ---- Archivo con errores ----
  const bad = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bad, XLSX.utils.aoa_to_sheet([
    ["Nombre del estudio", "Precio con informe (Bs)", "Precio sin informe (Bs)", "Activo (SI/NO)"],
    ["Nuevo A", 100, "", ""], ["Nuevo B", "cien", 50, ""], ["Nuevo C", 10, 5, "tal vez"],
  ]), "Hoja1");
  XLSX.writeFile(bad, `${S}/errores.xlsx`);
  await page.getByRole("button", { name: /carga masiva/i }).click();
  await page.locator('input[type="file"]').setInputFiles(`${S}/errores.xlsx`);
  await page.getByText(/errores/).first().waitFor({ timeout: 15000 });
  const d2 = page.getByRole("dialog");
  check("muestra los 3 errores con su fila", await d2.getByText(/Fila 2:/).isVisible() && await d2.getByText(/Fila 3: Precio con informe: Debe ser un número/).isVisible() && await d2.getByText(/Fila 4: Activo: escribe SI o NO/).isVisible());
  check("con errores el botón Aplicar está deshabilitado", await d2.getByRole("button", { name: /^aplicar/i }).isDisabled());
  await page.screenshot({ path: `${S}/05-errores.png` });

  // Archivo que no es la plantilla
  const other = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([["Cliente", "Monto"], ["x", 1]]), "Hoja1");
  XLSX.writeFile(other, `${S}/otro.xlsx`);
  await page.locator('input[type="file"]').setInputFiles(`${S}/otro.xlsx`);
  check("un Excel cualquiera avisa que use la plantilla", await page.getByText(/Usa la plantilla/).first().isVisible({ timeout: 5000 }).catch(() => false) || await page.getByText(/Usa la plantilla/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
} catch (e) { check("sin errores: " + e.message.split("\n")[0], false); await page.screenshot({ path: `${S}/zz-error.png` }); }
check("sin errores de JavaScript", errors.length === 0, errors);
console.log(`${ok}/${ok + fail} OK`);
process.exitCode = fail ? 1 : 0;
await b.close();
