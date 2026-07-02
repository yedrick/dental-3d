import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList, formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/app/commissions")({ component: CommissionsPage });

const MONTHS_ES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

function CommissionsPage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1)); // "all" or 1-12
  const [doctorId, setDoctorId] = useState<string>("all");

  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const dmap = useMemo(() => new Map(doctors.map((d: any) => [d.id, d])), [doctors]);

  const range = useMemo(() => {
    const y = Number(year);
    if (month === "all") {
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    const m = Number(month);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }, [year, month]);

  const { data: rows = [] } = useQuery({
    queryKey: ["commissions-detail", range.from, range.to, doctorId],
    queryFn: async () => {
      let q = supabase
        .from("commissions")
        .select("id,doctor_id,commission_amount,percentage,created_at,patient_study_id,patient_studies(id,price,has_report,with_invoice,patient_id,study_id,patients(full_name),studies(name))")
        .gte("created_at", range.from)
        .lte("created_at", range.to + "T23:59:59")
        .order("created_at", { ascending: true });
      if (doctorId !== "all") q = q.eq("doctor_id", doctorId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group: month -> doctor -> rows
  const grouped = useMemo(() => {
    const g: Record<string, Record<string, any[]>> = {};
    for (const r of rows as any[]) {
      const d = new Date(r.created_at);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const doc = dmap.get(r.doctor_id);
      const dk = r.doctor_id;
      g[mk] ??= {};
      g[mk][dk] ??= [];
      g[mk][dk].push({
        fecha: d.toISOString().slice(0, 10),
        codigo: doc?.code || doc?.id?.slice(0, 8) || "-",
        doctor: doc?.full_name || "-",
        paciente: r.patient_studies?.patients?.full_name || "-",
        estudio: r.patient_studies?.studies?.name || "-",
        informe: r.patient_studies?.has_report ? "con informe" : "sin informe",
        factura: r.patient_studies?.with_invoice ? "Sí" : "No",
        precio: Number(r.patient_studies?.price ?? 0),
        pct: Number(r.percentage ?? 0),
        monto: Number(r.commission_amount ?? 0),
      });
    }
    return g;
  }, [rows, dmap]);

  const totalGeneral = (rows as any[]).reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const monthKeys = Object.keys(grouped).sort();
    for (const mk of monthKeys) {
      const [yy, mm] = mk.split("-").map(Number);
      const monthName = MONTHS_ES[mm - 1];
      const doctorGroups = grouped[mk];
      for (const [did, items] of Object.entries(doctorGroups)) {
        const doc = dmap.get(did);
        const sheetData: any[][] = [];
        sheetData.push([`COMISION - ${monthName} ${yy}`]);
        sheetData.push([`Dr. ${doc?.full_name || ""}`]);
        sheetData.push([]);
        sheetData.push(["Fecha", "Código Dr.", "Nombre Dr@", "Nombre Paciente", "Estudio Radiológico", "Informe", "Factura", "Precio", "%", "Comisión"]);
        let sub = 0;
        for (const r of items) {
          sheetData.push([r.fecha, r.codigo, r.doctor, r.paciente, r.estudio, r.informe, r.factura, r.precio, r.pct, r.monto]);
          sub += r.monto;
        }
        sheetData.push([]);
        sheetData.push(["", "", "", "", "", "", "", "", "TOTAL", sub]);
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 6 }, { wch: 12 }];
        const safeName = `${monthName.slice(0, 3)}${yy}_${(doc?.full_name || did).replace(/[^\w]/g, "").slice(0, 20)}`;
        XLSX.utils.book_append_sheet(wb, ws, safeName.slice(0, 31));
      }
    }
    if (monthKeys.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([["Sin datos"]]);
      XLSX.utils.book_append_sheet(wb, ws, "Vacío");
    }
    XLSX.writeFile(wb, `comisiones_${range.from}_${range.to}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const monthKeys = Object.keys(grouped).sort();
    let first = true;
    for (const mk of monthKeys) {
      const [yy, mm] = mk.split("-").map(Number);
      const monthName = MONTHS_ES[mm - 1];
      const doctorGroups = grouped[mk];
      for (const [did, items] of Object.entries(doctorGroups)) {
        if (!first) doc.addPage();
        first = false;
        const dr = dmap.get(did);
        doc.setFontSize(14);
        doc.text(`COMISION - ${monthName} ${yy}`, 148, 14, { align: "center" });
        doc.setFontSize(12);
        doc.text(`Dr. ${dr?.full_name || ""}`, 148, 21, { align: "center" });
        let sub = 0;
        const body = items.map(r => {
          sub += r.monto;
          return [r.fecha, r.codigo, r.doctor, r.paciente, r.estudio, r.informe, r.factura, r.precio.toFixed(2), r.pct + "%", r.monto.toFixed(2)];
        });
        autoTable(doc, {
          startY: 27,
          head: [["Fecha", "Cód. Dr.", "Nombre Dr@", "Paciente", "Estudio Radiológico", "Informe", "Fact.", "Precio", "%", "Comisión"]],
          body: [...body, ["", "", "", "", "", "", "", "", "TOTAL", sub.toFixed(2)]],
          styles: { fontSize: 8 },
          headStyles: { fillColor: [30, 64, 175] },
          foot: undefined,
        });
      }
    }
    if (monthKeys.length === 0) {
      doc.text("Sin datos en el periodo", 14, 20);
    }
    doc.save(`comisiones_${range.from}_${range.to}.pdf`);
  };

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1].map(String);
  }, [now]);

  return (
    <div>
      <PageHeader
        title="Comisiones"
        description={`Total del periodo: ${formatMoney(totalGeneral)}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel} disabled={(rows as any[]).length === 0}>
              <FileSpreadsheet className="mr-1 h-4 w-4" />Excel
            </Button>
            <Button variant="outline" onClick={exportPdf} disabled={(rows as any[]).length === 0}>
              <FileText className="mr-1 h-4 w-4" />PDF
            </Button>
          </div>
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label>Año</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mes</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el año</SelectItem>
                {MONTHS_ES.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los doctores</SelectItem>
                {doctors.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">
            Periodo: {range.from} → {range.to}
          </div>
        </CardContent>
      </Card>

      {Object.keys(grouped).sort().map(mk => {
        const [yy, mm] = mk.split("-").map(Number);
        const monthName = MONTHS_ES[mm - 1];
        const doctorGroups = grouped[mk];
        return (
          <div key={mk} className="mb-6">
            <h2 className="mb-2 text-lg font-bold uppercase tracking-wide">Comisión — {monthName} {yy}</h2>
            {Object.entries(doctorGroups).map(([did, items]) => {
              const dr = dmap.get(did);
              const sub = items.reduce((s, r) => s + r.monto, 0);
              return (
                <Card key={did} className="mb-3">
                  <CardContent className="pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-semibold">Dr. {dr?.full_name || "-"}</div>
                      <div className="text-sm font-medium">Subtotal: {formatMoney(sub)}</div>
                    </div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Paciente</TableHead>
                        <TableHead>Estudio</TableHead>
                        <TableHead>Informe</TableHead>
                        <TableHead>Fact.</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead className="text-right">Comisión</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {items.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell>{r.fecha}</TableCell>
                            <TableCell>{r.paciente}</TableCell>
                            <TableCell>{r.estudio}</TableCell>
                            <TableCell>{r.informe}</TableCell>
                            <TableCell>{r.factura}</TableCell>
                            <TableCell className="text-right">{formatMoney(r.precio)}</TableCell>
                            <TableCell className="text-right">{r.pct}%</TableCell>
                            <TableCell className="text-right font-medium">{formatMoney(r.monto)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })}
      {Object.keys(grouped).length === 0 && (
        <Card><CardContent className="pt-6 text-muted-foreground">Sin comisiones en el periodo seleccionado.</CardContent></Card>
      )}
    </div>
  );
}
