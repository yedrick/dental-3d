import { createFileRoute } from "@tanstack/react-router";
import { translateError } from "@/lib/translate-error";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { methodLabel } from "@/lib/payments";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, todayLocal } from "@/lib/data";
import { LinesSkeleton } from "@/components/table-skeleton";
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

type ReportSummary = {
  period: { from: string; to: string };
  operational: {
    attentions: number;
    delivered: number;
    pending_delivery: number;
    new_patients: number;
    by_day: { day: string; count: number; income: number }[];
    by_study: { study: string; count: number; income: number }[];
  };
  financial: {
    billed: number;
    /** Cobrado en el período por la fecha de cada pago */
    collected: number;
    /** De lo cobrado, lo que es de atenciones de antes del período */
    collected_previous: number;
    debt: number;
    commissions: number;
    commissions_by_doctor: { doctor: string; count: number; total: number }[];
    cash_in: number;
    cash_out: number;
    third_party: number;
    deposits: number;
    net: number;
    by_method: { method: string; amount: number }[];
  };
  control: {
    patients_without_doctor: number;
    attentions_without_user: number;
    cashbox_without_user: number;
    date_errors: {
      delivered_before_created: number;
      payment_before_service: number;
      future_deposits: number;
      future_third_party: number;
    };
    price_errors: { active_price_zero: number; active_study_without_price: number };
    overpaid_attentions: number;
  };
};

/** Día local (YYYY-MM-DD) de hace `days` días. */
const daysAgoLocal = (days: number) => formatDate(new Date(Date.now() - days * 86400000).toISOString());

function ReportsPage() {
  const [from, setFrom] = useState(() => daysAgoLocal(30));
  const [to, setTo] = useState(() => todayLocal());

  const setPreset = (p: (typeof PRESETS)[number]) => {
    setTo(todayLocal());
    if (p.days) setFrom(daysAgoLocal(p.days));
    else setFrom(`${new Date().getFullYear()}-01-01`);
  };

  const validRange = !!from && !!to && from <= to;

  // Todo se suma en la API (MySQL); aquí solo se adapta a lo que muestra la pantalla
  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["reports", from, to],
    queryFn: () => apiGet<ReportSummary>("/api/reports/summary", { from, to }),
    staleTime: STALE.money,
    enabled: validRange,
  });

  const data = useMemo(() => {
    if (!raw) return undefined;
    const { operational: op, financial: fin, control: ctl } = raw;
    return {
      totalStudies: fin.billed,
      paid: fin.collected,
      paidPrevious: fin.collected_previous ?? 0,
      debt: fin.debt,
      delivered: op.delivered,
      pending: op.pending_delivery,
      studies: op.attentions,
      commissions: fin.commissions,
      cashIn: fin.cash_in,
      cashOut: fin.cash_out,
      tppTotal: fin.third_party,
      depTotal: fin.deposits,
      netFinancial: fin.net,
      byDay: op.by_day.map((d) => [d.day, { count: d.count, income: d.income }] as const),
      byMethod: fin.by_method.map((m) => [m.method, m.amount] as const),
      control: ctl,
    };
  }, [raw]);

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
          {!validRange && (
            <p className="text-xs text-destructive self-center">La fecha inicial debe ser anterior o igual a la final.</p>
          )}
          {validRange && error && (
            <p className="text-xs text-destructive self-center">{translateError(error)}</p>
          )}
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
          hint={
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight className="h-3 w-3" />
              {(data?.paidPrevious ?? 0) > 0
                ? `incluye ${formatMoney(data?.paidPrevious)} de atenciones anteriores`
                : "ingresado en el período"}
            </span>
          }
          icon={<TrendingUp className="h-4 w-4" />}
          accent="from-emerald-500/20 to-emerald-500/5"
        />
        <HeroCard
          title="Por cobrar"
          value={formatMoney(data?.debt)}
          hint={<span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><ArrowDownRight className="h-3 w-3" />saldo de las atenciones del período</span>}
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
              isLoading ? (
                <div className="py-4"><LinesSkeleton lines={6} /></div>
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">Sin datos en el período.</div>
              )
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
                  const label = methodLabel(m);
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
        <CardContent className="space-y-4">
          <IntegrityGroup title="Registros">
            <IntegrityRow label="Pacientes sin doctor" v={data?.control.patients_without_doctor ?? 0} />
            <IntegrityRow label="Atenciones sin usuario" v={data?.control.attentions_without_user ?? 0} />
            <IntegrityRow label="Movimientos de caja sin usuario" v={data?.control.cashbox_without_user ?? 0} />
          </IntegrityGroup>
          <IntegrityGroup title="Fechas">
            <IntegrityRow label="Entregados antes de registrarse" v={data?.control.date_errors.delivered_before_created ?? 0} />
            <IntegrityRow label="Pagos a terceros antes del servicio" v={data?.control.date_errors.payment_before_service ?? 0} />
            <IntegrityRow label="Depósitos con fecha futura" v={data?.control.date_errors.future_deposits ?? 0} />
            <IntegrityRow label="Pagos a terceros con fecha futura" v={data?.control.date_errors.future_third_party ?? 0} />
          </IntegrityGroup>
          <IntegrityGroup title="Tarifas y cobros">
            <IntegrityRow label="Tarifas activas con precio ≤ 0" v={data?.control.price_errors.active_price_zero ?? 0} />
            <IntegrityRow label="Estudios activos sin tarifa" v={data?.control.price_errors.active_study_without_price ?? 0} />
            <IntegrityRow label="Atenciones cobradas de más" v={data?.control.overpaid_attentions ?? 0} />
          </IntegrityGroup>
          <p className="text-xs text-muted-foreground">Los controles revisan toda la base, no solo el período seleccionado.</p>
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

function IntegrityGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>
      <div className="grid gap-3 md:grid-cols-3">{children}</div>
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
