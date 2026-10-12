import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { useBranding } from "@/lib/branding";
import { todayLocal } from "@/lib/data";
import { translateError } from "@/lib/translate-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Carga masiva de estudios y tarifas desde Excel (por sucursal).
 * 1. "Descargar plantilla": Excel con los estudios y tarifas actuales de ESTA sucursal + instrucciones.
 * 2. Se edita y se sube: el navegador lee el Excel y la API valida todo y muestra una vista previa.
 * 3. "Aplicar": la API hace todo en una sola transacción (si hay un error, no se guarda nada).
 */

const HEADERS = [
  "Nombre del estudio",
  "Descripción",
  "Precio con informe (Bs)",
  "Precio sin informe (Bs)",
  "Comisión fija (Bs)",
  "Activo (SI/NO)",
];
const MAX_BYTES = 5 * 1024 * 1024;
// En la vista previa, primero lo que cambia
const ORDER = { crear: 0, actualizar: 1, "sin cambios": 2 } as const;

type Fila = {
  fila: number;
  nombre: unknown;
  descripcion?: unknown;
  precio_con_informe?: unknown;
  precio_sin_informe?: unknown;
  comision_fija?: unknown;
  activo?: unknown;
};
type Report = {
  aplicado: boolean;
  resumen: {
    filas: number;
    crear: number;
    actualizar: number;
    nuevas_tarifas: number;
    sin_cambios: number;
    errores: number;
  };
  filas: {
    fila: number;
    nombre: string;
    accion: "crear" | "actualizar" | "sin cambios";
    cambios: string[];
    aviso?: string;
  }[];
  errores: { fila: number; mensaje: string }[];
};

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Qué columna es cada cosa, por el texto del encabezado (acepta variantes y sin tildes). */
function columnFor(header: unknown): keyof Omit<Fila, "fila"> | null {
  const h = norm(header);
  if (!h) return null;
  if (h.includes("con informe")) return "precio_con_informe";
  if (h.includes("sin informe")) return "precio_sin_informe";
  if (h.includes("comision")) return "comision_fija";
  if (h.includes("activo")) return "activo";
  if (h.includes("descrip")) return "descripcion";
  if (h.includes("nombre") || h === "estudio") return "nombre";
  return null;
}

/** "1.250,50", "150,5", "Bs 80" → número. Si no se entiende, se manda tal cual y la API marca el error. */
function toMoney(v: unknown): unknown {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100; // Excel guarda 150.1 como 150.09999…
  let s = String(v).replace(/bs\.?/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : String(v);
}

function toBool(v: unknown): unknown {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = norm(v);
  if (["si", "s", "yes", "1", "true", "activo"].includes(s)) return true;
  if (["no", "n", "0", "false", "inactivo"].includes(s)) return false;
  return String(v);
}

const toText = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

async function readExcel(file: File): Promise<Fila[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets["Estudios"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("El archivo no tiene hojas");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const cols = (rows[0] ?? []).map(columnFor);
  if (!cols.includes("nombre"))
    throw new Error(
      'No encontré la columna "Nombre del estudio" en la primera fila. Usa la plantilla.',
    );
  const filas: Fila[] = [];
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => c == null || String(c).trim() === "")) return; // fila vacía
    const f: Fila = { fila: i + 2, nombre: null };
    cols.forEach((c, j) => {
      if (!c) return;
      const v = r[j];
      if (c === "nombre") f.nombre = toText(v) ?? "";
      else if (c === "descripcion") f.descripcion = toText(v);
      else if (c === "activo") f.activo = toBool(v);
      else f[c] = toMoney(v);
    });
    filas.push(f);
  });
  if (filas.length === 0) throw new Error("El archivo no tiene estudios (solo encabezados)");
  return filas;
}

type StudyRow = {
  name: string;
  description?: string | null;
  price_with_report?: number | string | null;
  price_without_report?: number | string | null;
  fixed_commission?: number | string | null;
  active: boolean;
};

export function StudiesImport({ studies }: { studies: StudyRow[] }) {
  const qc = useQueryClient();
  const branding = useBranding();
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(todayLocal());
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFilas(null);
    setReport(null);
    setFileName("");
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const data = [
      HEADERS,
      ...studies.map((s) => [
        s.name,
        s.description ?? "",
        s.price_with_report != null ? Number(s.price_with_report) : "",
        s.price_without_report != null ? Number(s.price_without_report) : "",
        Number(s.fixed_commission ?? 0),
        s.active ? "SI" : "NO",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 34 }, { wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Estudios");
    const help = XLSX.utils.aoa_to_sheet([
      ["Carga masiva de estudios y tarifas"],
      [`Sucursal: ${branding.name}. Lo que subas se aplica SOLO a esta sucursal.`],
      [],
      ["Cómo usarla"],
      [
        '1. Edita la hoja "Estudios": cambia precios, agrega filas nuevas o marca Activo = NO. No cambies los encabezados.',
      ],
      [
        "2. Guarda el archivo y súbelo en Estudios y tarifas → Carga masiva. Primero verás una vista previa; nada se guarda hasta que pulses Aplicar.",
      ],
      ["3. Si alguna fila tiene un error, no se guarda ninguna: corrige y vuelve a subir."],
      [],
      ["Columnas"],
      [
        "Nombre del estudio",
        "Obligatorio. Si ya existe (sin importar mayúsculas ni tildes), se actualiza; si no, se crea.",
      ],
      ["Descripción", "Opcional. Vacía = no se cambia."],
      [
        "Precio con informe (Bs)",
        "Con 'Precio sin informe': van los dos o ninguno. Si cambian, se crea una tarifa nueva y la anterior queda en el historial.",
      ],
      ["Precio sin informe (Bs)", "Números con hasta 2 decimales (150 · 150,50 · 1.250,00)."],
      [
        "Comisión fija (Bs)",
        "Para doctores SIN porcentaje. Vacía = 0 en estudios nuevos y sin cambio en los existentes.",
      ],
      ["Activo (SI/NO)", "Vacío = SI en estudios nuevos y sin cambio en los existentes."],
      [],
      ["Ejemplo de fila nueva"],
      ["Radiografía panorámica", "Rx panorámica digital", 150, 100, 20, "SI"],
    ]);
    help["!cols"] = [{ wch: 28 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, help, "Instrucciones");
    const slug = (branding.id ?? "sucursal").replace(/[^a-z0-9-]/gi, "");
    XLSX.writeFile(wb, `estudios_${slug}_${todayLocal()}.xlsx`);
  };

  const preview = async (rows: Fila[]) => {
    setBusy(true);
    try {
      setReport(
        await apiPost<Report>("/api/studies/import", {
          filas: rows,
          fecha_vigencia: fecha,
          aplicar: false,
        }),
      );
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) return toast.error("El archivo pesa más de 5 MB");
    setFileName(file.name);
    try {
      const rows = await readExcel(file);
      setFilas(rows);
      await preview(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo leer el archivo");
    }
  };

  const apply = async () => {
    if (!filas) return;
    setBusy(true);
    try {
      const r = await apiPost<Report>("/api/studies/import", {
        filas,
        fecha_vigencia: fecha,
        aplicar: true,
      });
      setReport(r);
      if (!r.aplicado) return toast.error("Hay errores: no se guardó nada");
      toast.success(
        `Listo: ${r.resumen.crear} creados, ${r.resumen.actualizar} actualizados, ${r.resumen.nuevas_tarifas} tarifas nuevas`,
      );
      qc.invalidateQueries({ queryKey: ["studies"] });
      qc.invalidateQueries({ queryKey: ["study_prices"] });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  const r = report?.resumen;
  const changes = r ? r.crear + r.actualizar : 0;
  const badge = (accion: string) =>
    accion === "crear" ? (
      <Badge className="whitespace-nowrap">Crear</Badge>
    ) : accion === "actualizar" ? (
      <Badge variant="secondary" className="whitespace-nowrap">
        Actualizar
      </Badge>
    ) : (
      <Badge variant="outline" className="whitespace-nowrap">
        Sin cambios
      </Badge>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-1 h-4 w-4" />
          Carga masiva (Excel)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Carga masiva de estudios y tarifas</DialogTitle>
          <DialogDescription>
            Solo para <b>{branding.name}</b>. Descarga la plantilla (trae tus estudios actuales),
            edítala en Excel y súbela. Verás qué cambia antes de guardar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download className="mr-1 h-4 w-4" />
            Descargar plantilla
          </Button>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Archivo (.xlsx, .xls o .csv)</span>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Vigencia de las tarifas nuevas</span>
            <Input
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                if (filas) preview(filas);
              }}
            />
          </label>
        </div>

        {busy && !report && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Revisando {fileName}…
          </p>
        )}

        {report && r && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge>{r.crear} a crear</Badge>
              <Badge variant="secondary">{r.actualizar} a actualizar</Badge>
              <Badge variant="secondary">{r.nuevas_tarifas} tarifas nuevas</Badge>
              <Badge variant="outline">{r.sin_cambios} sin cambios</Badge>
              {r.errores > 0 && <Badge variant="destructive">{r.errores} errores</Badge>}
            </div>

            {report.errores.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <p className="mb-1 font-medium text-destructive">
                  Corrige estas filas en el Excel y vuelve a subirlo (no se guardará nada mientras
                  haya errores):
                </p>
                <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
                  {report.errores.map((e, i) => (
                    <li key={i}>
                      Fila {e.fila}: {e.mensaje}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.filas.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Fila</TableHead>
                      <TableHead>Estudio</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Cambios</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...report.filas]
                      .sort((a, b) => ORDER[a.accion] - ORDER[b.accion] || a.fila - b.fila)
                      .map((f) => (
                        <TableRow key={f.fila}>
                          <TableCell className="text-muted-foreground">{f.fila}</TableCell>
                          <TableCell className="font-medium">{f.nombre}</TableCell>
                          <TableCell>{badge(f.accion)}</TableCell>
                          <TableCell className="text-xs">
                            {f.cambios.join(" · ") || "—"}
                            {f.aviso && <div className="text-amber-600">{f.aviso}</div>}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={apply}
            disabled={busy || !report || report.errores.length > 0 || changes === 0}
          >
            {busy && report ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            {changes > 0 ? `Aplicar ${changes} cambio${changes === 1 ? "" : "s"}` : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
