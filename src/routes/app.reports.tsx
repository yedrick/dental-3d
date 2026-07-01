import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/data";
import { Download } from "lucide-react";

export const Route = createFileRoute("/app/reports")({ component: ReportsPage });

function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const { data } = useQuery({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const [ps, com, cash, tpp, dep, orphanPat, orphanPs, bad] = await Promise.all([
        supabase.from("patient_studies").select("id,price,created_at,payment_method").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("commissions").select("commission_amount,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("cashbox").select("income,expense,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("third_party_payments").select("amount,payment_date").gte("payment_date", from).lte("payment_date", to),
        supabase.from("bank_deposits").select("amount,deposit_date").gte("deposit_date", from).lte("deposit_date", to),
        supabase.from("patients").select("id,doctor_id").is("doctor_id", null),
        supabase.from("patient_studies").select("id,created_by").is("created_by", null),
        supabase.from("study_prices").select("id,price_with_report,price_without_report").or("price_with_report.lte.0,price_without_report.lte.0"),
      ]);

      const psRows = (ps.data ?? []) as any[];
      const income = psRows.reduce((s, r) => s + Number(r.price ?? 0), 0);
      const commissions = ((com.data ?? []) as any[]).reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);
      const cashIn = ((cash.data ?? []) as any[]).reduce((s, r) => s + Number(r.income ?? 0), 0);
      const cashOut = ((cash.data ?? []) as any[]).reduce((s, r) => s + Number(r.expense ?? 0), 0);
      const tppTotal = ((tpp.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const depTotal = ((dep.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);

      // Pacientes por día
      const byDay: Record<string, number> = {};
      psRows.forEach((r) => {
        const d = String(r.created_at).slice(0, 10);
        byDay[d] = (byDay[d] ?? 0) + 1;
      });

      return {
        income, commissions, cashIn, cashOut, tppTotal, depTotal,
        studies: psRows.length,
        byDay: Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)),
        orphanPatients: orphanPat.data?.length ?? 0,
        orphanPs: orphanPs.data?.length ?? 0,
        badPrices: bad.data?.length ?? 0,
      };
    },
  });

  const exportPdf = () => window.print();

  return (
    <div>
      <PageHeader title="Reportes" description="Filtra por fechas y consulta métricas operativas, financieras y de control."
        action={<Button variant="outline" onClick={exportPdf}><Download className="mr-1 h-4 w-4" />Exportar PDF</Button>}
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Atenciones" value={data?.studies ?? 0} />
        <MetricCard title="Ingresos por estudios" value={formatMoney(data?.income)} />
        <MetricCard title="Comisiones" value={formatMoney(data?.commissions)} />
        <MetricCard title="Caja: ingresos" value={formatMoney(data?.cashIn)} />
        <MetricCard title="Caja: gastos" value={formatMoney(data?.cashOut)} />
        <MetricCard title="Depósitos bancarios" value={formatMoney(data?.depTotal)} />
        <MetricCard title="Pagos a terceros" value={formatMoney(data?.tppTotal)} />
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Pacientes por día</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Atenciones</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.byDay ?? []).map(([d, n]) => (
                <TableRow key={d}><TableCell>{formatDate(d)}</TableCell><TableCell>{n}</TableCell></TableRow>
              ))}
              {(data?.byDay ?? []).length === 0 && <TableRow><TableCell colSpan={2} className="text-muted-foreground">Sin datos.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>Control de integridad</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3">
          <ControlRow label="Pacientes sin doctor" v={data?.orphanPatients ?? 0} />
          <ControlRow label="Atenciones sin usuario" v={data?.orphanPs ?? 0} />
          <ControlRow label="Tarifas con precio <= 0" v={data?.badPrices ?? 0} />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: any }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
    </Card>
  );
}
function ControlRow({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${v > 0 ? "text-destructive" : ""}`}>{v}</div>
    </div>
  );
}
