import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/data";
import {
  Download, TrendingUp, TrendingDown, Users, Wallet, Landmark, Receipt, Activity,
  AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

export const Route = createFileRoute("/app/reports")({ component: ReportsPage });

const PRESETS = [
  { key: "7d", label: "7 días", days: 7 },
  { key: "30d", label: "30 días", days: 30 },
  { key: "90d", label: "90 días", days: 90 },
  { key: "ytd", label: "Este año", days: null },
];

function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const setPreset = (p: (typeof PRESETS)[number]) => {
    const now = new Date();
    setTo(now.toISOString().slice(0, 10));
    if (p.days) setFrom(new Date(Date.now() - p.days * 86400000).toISOString().slice(0, 10));
    else setFrom(`${now.getFullYear()}-01-01`);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const [ps, com, cash, tpp, dep, orphanPat, orphanPs, bad] = await Promise.all([
        supabase.from("patient_studies").select("id,price,invoice_surcharge,discount,amount_paid,created_at,payment_method,delivered_at,doctor_id").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("commissions").select("commission_amount,created_at,doctor_id").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("cashbox").select("income,expense,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("third_party_payments").select("amount,payment_date").gte("payment_date", from).lte("payment_date", to),
        supabase.from("bank_deposits").select("amount,deposit_date").gte("deposit_date", from).lte("deposit_date", to),
        supabase.from("patients").select("id,doctor_id").is("doctor_id", null),
        supabase.from("patient_studies").select("id,created_by").is("created_by", null),
        supabase.from("study_prices").select("id,price_with_report,price_without_report").or("price_with_report.lte.0,price_without_report.lte.0"),
      ]);

      const psRows = (ps.data ?? []) as any[];
      const totalStudies = psRows.reduce(
        (s, r) => s + Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0),
        0,
      );
      const paid = psRows.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
      const debt = Math.max(0, totalStudies - paid);
      const delivered = psRows.filter((r) => r.delivered_at).length;
      const pending = psRows.length - delivered;

      const commissions = ((com.data ?? []) as any[]).reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);
      const cashIn = ((cash.data ?? []) as any[]).reduce((s, r) => s + Number(r.income ?? 0), 0);
      const cashOut = ((cash.data ?? []) as any[]).reduce((s, r) => s + Number(r.expense ?? 0), 0);
      const tppTotal = ((tpp.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const depTotal = ((dep.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);

      const byDay: Record<string, { count: number; income: number }> = {};
      psRows.forEach((r) => {
        const d = String(r.created_at).slice(0, 10);
        byDay[d] = byDay[d] ?? { count: 0, income: 0 };
        byDay[d].count += 1;
        byDay[d].income += Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0);
      });

      const byMethod: Record<string, number> = {};
      psRows.forEach((r) => {
        const m = r.payment_method ?? "sin pago";
        byMethod[m] = (byMethod[m] ?? 0) + Number(r.amount_paid ?? 0);
      });

      const netFinancial = totalStudies - commissions - tppTotal;

      return {
        totalStudies, paid, debt, delivered, pending,
        studies: psRows.length,
        commissions, cashIn, cashOut, tppTotal, depTotal, netFinancial,
        byDay: Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)),
        byMethod: Object.entries(byMethod).sort((a, b) => b[1] - a[1]),
        orphanPatients: orphanPat.data?.length ?? 0,
        orphanPs: orphanPs.data?.length ?? 0,
        badPrices: bad.data?.length ?? 0,
      };
    },
  });

  const maxDay = useMemo(
    () => (data?.byDay ?? []).reduce((m, [, v]) => Math.max(m, v.income), 0),
    [data],
  );

  const exportPdf = () => window.print();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reportes"
        description="Panel financiero y operativo del centro radiológico."
        action={<Button variant="outline" onClick={exportPdf}><Download className="mr-1 h-4 w-4" />PDF</Button>}
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <div className="flex gap-1 ml-auto">
            {PRESETS.map((p) => (
              <Button key={p.key} variant="outline" size="sm" onClick={() => setPreset(p)}>{p.label}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Hero KPIs */}
      <div className="grid gap-3 md:grid-cols-4">
        <HeroCard
          title="Facturado"
          value={formatMoney(data?.totalStudies)}
          hint={`${data?.studies ?? 0} atenciones`}
          icon={<Receipt className="h-4 w-4" />}
          accent="from-indigo-500/20 to-indigo-500/5"
        />
        <HeroCard
          title="Cobrado"
          value={formatMoney(data?.paid)}
          hint={<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowUpRight className="h-3 w-3" />ingresado</span>}
          icon={<TrendingUp className="h-4 w-4" />}
          accent="from-emerald-500/20 to-emerald-500/5"
        />
        <HeroCard
          title="Por cobrar"
          value={formatMoney(data?.debt)}
          hint={<span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><ArrowDownRight className="h-3 w-3" />deuda pendiente</span>}
          icon={<TrendingDown className="h-4 w-4" />}
          accent="from-amber-500/20 to-amber-500/5"
        />
        <HeroCard
          title="Utilidad estimada"
          value={formatMoney(data?.netFinancial)}
          hint="Facturado − comisiones − terceros"
          icon={<Wallet className="h-4 w-4" />}
          accent="from-violet-500/20 to-violet-500/5"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MiniStat icon={<Activity className="h-3.5 w-3.5" />} label="Estudios entregados" value={data?.delivered ?? 0} tone="ok" />
        <MiniStat icon={<Activity className="h-3.5 w-3.5" />} label="Estudios pendientes" value={data?.pending ?? 0} tone={data?.pending ? "warn" : "muted"} />
        <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="Comisiones" value={formatMoney(data?.commissions)} />
        <MiniStat icon={<Landmark className="h-3.5 w-3.5" />} label="Depósitos" value={formatMoney(data?.depTotal)} />
        <MiniStat icon={<Wallet className="h-3.5 w-3.5" />} label="Caja ingresos" value={formatMoney(data?.cashIn)} tone="ok" />
        <MiniStat icon={<Wallet className="h-3.5 w-3.5" />} label="Caja gastos" value={formatMoney(data?.cashOut)} tone="warn" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Trend chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Atenciones por día</CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byDay ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {isLoading ? "Cargando…" : "Sin datos en el período."}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[360px] overflow-auto pr-1">
                {(data?.byDay ?? []).slice(0, 30).map(([d, v]) => {
                  const pct = maxDay > 0 ? (v.income / maxDay) * 100 : 0;
                  return (
                    <div key={d} className="grid grid-cols-[100px,1fr,90px] items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{formatDate(d)}</span>
                      <div className="h-6 rounded bg-muted overflow-hidden relative">
                        <div className="h-full bg-gradient-to-r from-primary to-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                        <span className="absolute inset-0 flex items-center px-2 font-medium">{v.count} atenc.</span>
                      </div>
                      <span className="text-right font-mono">{formatMoney(v.income)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment methods */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cobros por forma de pago</CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.byMethod ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Sin cobros.</div>
            ) : (
              <div className="space-y-2">
                {(data?.byMethod ?? []).map(([m, v]) => {
                  const total = (data?.byMethod ?? []).reduce((s, [, x]) => s + x, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  const label = m === "cash" ? "Efectivo" : m === "qr" ? "QR" : m === "card" ? "Tarjeta" : m;
                  return (
                    <div key={m}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize">{label}</span>
                        <span className="font-mono">{formatMoney(v)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Integrity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Control de integridad
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <IntegrityRow label="Pacientes sin doctor" v={data?.orphanPatients ?? 0} />
          <IntegrityRow label="Atenciones sin usuario" v={data?.orphanPs ?? 0} />
          <IntegrityRow label="Tarifas con precio ≤ 0" v={data?.badPrices ?? 0} />
        </CardContent>
      </Card>

      {/* Daily table (kept for printing) */}
      <Card className="hidden print:block">
        <CardHeader><CardTitle>Detalle diario</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Atenciones</TableHead><TableHead>Facturado</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.byDay ?? []).map(([d, v]) => (
                <TableRow key={d}><TableCell>{formatDate(d)}</TableCell><TableCell>{v.count}</TableCell><TableCell>{formatMoney(v.income)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function HeroCard({ title, value, hint, icon, accent }: { title: string; value: any; hint?: any; icon: any; accent: string }) {
  return (
    <Card className="overflow-hidden relative">
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} pointer-events-none`} />
      <CardContent className="pt-5 pb-4 relative">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{title}</span>
          <span className="p-1 rounded bg-background/60 border">{icon}</span>
        </div>
        <div className="text-2xl font-bold mt-2 tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: any; label: string; value: any; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}<span>{label}</span></div>
      <div className={`text-lg font-semibold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function IntegrityRow({ label, v }: { label: string; v: number }) {
  const bad = v > 0;
  return (
    <div className={`rounded-lg border p-3 flex items-center justify-between ${bad ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="flex items-center gap-2">
        {bad ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <span className="text-sm">{label}</span>
      </div>
      <span className={`text-xl font-bold tabular-nums ${bad ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{v}</span>
    </div>
  );
}
