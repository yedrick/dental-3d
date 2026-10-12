import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiGetAll, apiPost, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, PackageCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/delivery")({ component: DeliveryPage });

function DeliveryPage() {
  const { can } = useAuth();
  const canCharge = can("attention.charge");
  const canDeliver = can("attention.deliver");
  const qc = useQueryClient();
  // Solo lo pendiente: con saldo, o sin entregar (antes se bajaba toda la tabla)
  const { data: debtRows = [] } = useQuery({
    queryKey: ["attentions", "all", { status: "debt" }],
    queryFn: () => apiGetAll<any>("/api/attentions", { status: "debt" }),
    staleTime: STALE.ops,
  });
  const { data: pendingRows = [] } = useQuery({
    queryKey: ["attentions", "all", { status: "pending_delivery" }],
    queryFn: () => apiGetAll<any>("/api/attentions", { status: "pending_delivery" }),
    staleTime: STALE.ops,
  });

  const [q, setQ] = useState("");
  // Las filas de atenciones no traen el celular: para buscar por número se consulta a pacientes
  const phoneQ = /\d{3,}/.test(q) ? q.trim() : "";
  const { data: phoneIds } = useQuery({
    queryKey: ["patients", "search", phoneQ, "ids"],
    queryFn: async () => new Set((await apiGet<Paged<any>>("/api/patients", { q: phoneQ, limit: 100 })).data.map((p) => p.id as string)),
    enabled: phoneQ.length > 0,
    staleTime: STALE.master,
  });

  const enrich = (r: any) => ({
    ...r,
    total: Number(r.total ?? 0),
    paid: Number(r.amount_paid ?? 0),
    debt: Math.max(0, Number(r.debt ?? 0)),
    patient: { id: r.patient_id, full_name: r.patient_name, phone: r.patient_phone ?? null },
  });
  const debtEnriched = useMemo(() => (debtRows as any[]).map(enrich), [debtRows]);
  const pendingEnriched = useMemo(() => (pendingRows as any[]).map(enrich), [pendingRows]);

  const filterFn = (r: any) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (r.patient?.full_name ?? "").toLowerCase().includes(s)
      || (r.patient?.phone ?? "").includes(q)
      || !!phoneIds?.has(r.patient_id);
  };
  const pendingDelivery = pendingEnriched.filter((r) => !r.delivered_at && !r.is_voucher).filter(filterFn);
  const pendingPayment = debtEnriched.filter((r) => r.debt > 0.009).filter(filterFn);
  const patMap = new Map(pendingPayment.map((r) => [r.patient_id, r.patient]));

  // ---- Charge dialog ----
  const [charge, setCharge] = useState<{ row: any; amount: string } | null>(null);
  const doCharge = async () => {
    if (!charge) return;
    const amt = Math.round(Number(charge.amount || 0) * 100) / 100;
    if (amt <= 0) return toast.error("Monto inválido");
    if (amt > charge.row.debt + 0.001) return toast.error("Excede la deuda");
    try {
      // La API valida el saldo y registra la auditoría
      await apiPost(`/api/attentions/${charge.row.id}/charge`, { amount: amt });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Cobro registrado");
    setCharge(null);
    await qc.invalidateQueries(); // el botón sigue bloqueado hasta ver el saldo nuevo
  };

  const deliver = async (row: any) => {
    if (row.debt > 0.009 && !confirm(`Aún debe ${formatMoney(row.debt)}. ¿Entregar de todos modos?`)) return;
    try {
      await apiPost("/api/attentions/deliver", { ids: [row.id] });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Estudio entregado");
    await qc.invalidateQueries();
  };

  const chargeAll = async (patientId: string) => {
    try {
      await apiPost("/api/attentions/charge-all", { patient_id: patientId });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(`Cobrado saldo total del paciente`);
    await qc.invalidateQueries();
  };

  const renderRow = (r: any) => (
    <TableRow key={r.id}>
      <TableCell>
        <div className="font-medium">{r.patient?.full_name || "-"}</div>
        {r.patient?.phone && <div className="text-xs text-muted-foreground">Cel: {r.patient.phone}</div>}
      </TableCell>
      <TableCell>{r.study_name}</TableCell>
      <TableCell>{formatDate(r.created_at)}</TableCell>
      <TableCell className="font-mono">{formatMoney(r.total)}</TableCell>
      <TableCell className="font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(r.paid)}</TableCell>
      <TableCell className="font-mono">
        {r.debt > 0.009 ? <Badge variant="outline" className="text-amber-600 border-amber-500">{formatMoney(r.debt)}</Badge> : <Badge variant="secondary">Pagado</Badge>}
      </TableCell>
      <TableCell>{r.delivered_at ? <Badge>Entregado {formatDate(r.delivered_at)}</Badge> : <Badge variant="outline">Pendiente</Badge>}</TableCell>
      <TableCell className="text-right">
        <div className="flex gap-1 justify-end">
          {canCharge && r.debt > 0.009 && (
            <Button size="sm" variant="outline" onClick={() => setCharge({ row: r, amount: r.debt.toFixed(2) })}>
              <Wallet className="h-4 w-4 mr-1" />Cobrar
            </Button>
          )}
          {canDeliver && !r.delivered_at && (
            <Button size="sm" onClick={() => deliver(r)}>
              <PackageCheck className="h-4 w-4 mr-1" />Entregar
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div>
      <PageHeader title="Entregas y cobros" description="Estudios pendientes de entrega o con saldo. Búsqueda por nombre o celular." />

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar paciente por nombre o celular…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
      </div>

      <Tabs defaultValue="payment">
        <TabsList>
          <TabsTrigger value="payment">Pendientes de cobro ({pendingPayment.length})</TabsTrigger>
          <TabsTrigger value="delivery">Pendientes de entrega ({pendingDelivery.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="payment">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Paciente</TableHead><TableHead>Estudio</TableHead><TableHead>Fecha</TableHead>
                <TableHead>Total</TableHead><TableHead>Pagado</TableHead><TableHead>Deuda</TableHead>
                <TableHead>Entrega</TableHead><TableHead className="text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pendingPayment.map(renderRow)}
                {pendingPayment.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Sin pendientes de cobro.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
          {pendingPayment.length > 0 && canCharge && (
            <div className="mt-3 text-xs text-muted-foreground">
              Tip: para cobrar el saldo total de todos los estudios de un paciente, usa el botón "Cobrar todo" abajo:
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.from(new Set(pendingPayment.map((r) => r.patient_id))).map((pid) => {
                  const p = patMap.get(pid);
                  const total = pendingPayment.filter((r) => r.patient_id === pid).reduce((s, r) => s + r.debt, 0);
                  return <Button key={pid} size="sm" variant="outline" onClick={() => chargeAll(pid)}>Cobrar todo — {p?.full_name} ({formatMoney(total)})</Button>;
                })}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="delivery">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Paciente</TableHead><TableHead>Estudio</TableHead><TableHead>Fecha</TableHead>
                <TableHead>Total</TableHead><TableHead>Pagado</TableHead><TableHead>Deuda</TableHead>
                <TableHead>Entrega</TableHead><TableHead className="text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pendingDelivery.map(renderRow)}
                {pendingDelivery.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Sin pendientes de entrega.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!charge} onOpenChange={(o) => !o && setCharge(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cobrar saldo</DialogTitle></DialogHeader>
          {charge && (
            <div className="space-y-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">Paciente:</span> <strong>{charge.row.patient?.full_name}</strong></div>
                <div><span className="text-muted-foreground">Estudio:</span> {charge.row.study_name}</div>
                <div><span className="text-muted-foreground">Deuda actual:</span> <strong className="font-mono">{formatMoney(charge.row.debt)}</strong></div>
              </div>
              <div>
                <Label>Monto a cobrar</Label>
                <Input type="number" step="0.01" autoFocus value={charge.amount} onChange={(e) => setCharge({ ...charge, amount: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={doCharge}>Registrar cobro</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
