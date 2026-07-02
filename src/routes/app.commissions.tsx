import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList, formatDate, formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/app/commissions")({ component: CommissionsPage });

function CommissionsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const dmap = useMemo(() => new Map(doctors.map((d: any) => [d.id, d.full_name])), [doctors]);

  const { data: rows = [] } = useQuery({
    queryKey: ["commissions-detail", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commissions")
        .select("id,doctor_id,commission_amount,percentage,created_at,patient_study_id,patient_studies(id,price,has_report,with_invoice,patient_id,study_id,patients(full_name),studies(name))")
        .gte("created_at", from)
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const flat = useMemo(() => rows.map((r: any) => ({
    fecha: String(r.created_at).slice(0, 10),
    doctor: dmap.get(r.doctor_id) || "-",
    paciente: r.patient_studies?.patients?.full_name || "-",
    estudio: r.patient_studies?.studies?.name || "-",
    informe: r.patient_studies?.has_report ? "Sí" : "No",
    factura: r.patient_studies?.with_invoice ? "Sí" : "No",
    precio: Number(r.patient_studies?.price ?? 0),
    pct: Number(r.percentage ?? 0),
    monto: Number(r.commission_amount ?? 0),
  })), [rows, dmap]);

  const total = flat.reduce((s, r) => s + r.monto, 0);

  const exportExcel = () => {
    const wsData = [
      ["Fecha", "Doctor", "Paciente", "Estudio", "Informe", "Factura", "Precio (Bs)", "%", "Comisión (Bs)"],
      ...flat.map(r => [r.fecha, r.doctor, r.paciente, r.estudio, r.informe, r.factura, r.precio, r.pct, r.monto]),
      [],
      ["", "", "", "", "", "", "", "TOTAL", total],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comisiones");
    XLSX.writeFile(wb, `comisiones_${from}_${to}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Reporte de Comisiones", 14, 14);
    doc.setFontSize(10);
    doc.text(`Periodo: ${from} a ${to}`, 14, 21);
    doc.text(`Total: Bs ${total.toFixed(2)}`, 14, 27);
    autoTable(doc, {
      startY: 32,
      head: [["Fecha", "Doctor", "Paciente", "Estudio", "Inf.", "Fact.", "Precio", "%", "Comisión"]],
      body: flat.map(r => [r.fecha, r.doctor, r.paciente, r.estudio, r.informe, r.factura, r.precio.toFixed(2), r.pct + "%", r.monto.toFixed(2)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 64, 175] },
    });
    doc.save(`comisiones_${from}_${to}.pdf`);
  };

  return (
    <div>
      <PageHeader
        title="Comisiones"
        description={`Total acumulado en el periodo: ${formatMoney(total)}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel} disabled={flat.length === 0}>
              <FileSpreadsheet className="mr-1 h-4 w-4" />Excel
            </Button>
            <Button variant="outline" onClick={exportPdf} disabled={flat.length === 0}>
              <FileText className="mr-1 h-4 w-4" />PDF
            </Button>
          </div>
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Doctor</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Estudio</TableHead>
            <TableHead>Inf.</TableHead>
            <TableHead>Fact.</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Comisión</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{formatDate(r.fecha)}</TableCell>
                <TableCell>{r.doctor}</TableCell>
                <TableCell>{r.paciente}</TableCell>
                <TableCell>{r.estudio}</TableCell>
                <TableCell>{r.informe}</TableCell>
                <TableCell>{r.factura}</TableCell>
                <TableCell className="text-right">{formatMoney(r.precio)}</TableCell>
                <TableCell className="text-right">{r.pct}%</TableCell>
                <TableCell className="text-right font-medium">{formatMoney(r.monto)}</TableCell>
              </TableRow>
            ))}
            {flat.length === 0 && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Sin comisiones en el periodo.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
