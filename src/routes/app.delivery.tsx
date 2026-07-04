import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, formatMoney, formatDate } from "@/lib/data";
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
  const { can, user } = useAuth();
  const canCharge = can("attention.charge");
  const canDeliver = can("attention.deliver");
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("patient_studies");
  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const patMap = new Map((patients as any[]).map((p) => [p.id, p]));
  const stMap = new Map((studies as any[]).map((s) => [s.id, s.name]));

  const [q, setQ] = useState("");
  const enriched = useMemo(() => (rows as any[]).map((r) => {
    const total = Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0);
    const paid = Number(r.amount_paid ?? 0);
    const debt = Math.max(0, total - paid);
    return { ...r, total, paid, debt, patient: patMap.get(r.patient_id), study_name: stMap.get(r.study_id) };
  }), [rows, patMap, stMap]);

  const filterFn = (r: any) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (r.patient?.full_name ?? "").toLowerCase().includes(s) || (r.patient?.phone ?? "").includes(q);
  };
  const pendingDelivery = enriched.filter((r) => !r.delivered_at && !r.is_voucher).filter(filterFn);
  const pendingPayment = enriched.filter((r) => r.debt > 0.009).filter(filterFn);

  // ---- Charge dialog ----
  const [charge, setCharge] = useState<{ row: any; amount: string } | null>(null);
  const doCharge = async () => {
    if (!charge) return;
    const amt = Number(charge.amount || 0);
    if (amt <= 0) return toast.error("Monto inválido");
    if (amt > charge.row.debt + 0.001) return toast.error("Excede la deuda");
    const before = charge.row.debt;
    const newPaid = Number((charge.row.paid + amt).toFixed(2));
    const { error } = await supabase.from("patient_studies")
      .update({ amount_paid: newPaid })
      .eq("id", charge.row.id);
    if (error) return toast.error(translateError(error));
    await supabase.rpc("log_audit_event", {
      _action: "CHARGE",
      _table_name: "patient_studies",
      _record_id: charge.row.id,
      _data: {
        patient_id: charge.row.patient_id,
        patient_name: charge.row.patient?.full_name,
        study_id: charge.row.study_id,
        amount_charged: amt,
        balance_before: Math.round(before * 100) / 100,
        balance_after: Math.round((before - amt) * 100) / 100,
      } as any,
    });
    toast.success("Cobro registrado");
    setCharge(null);
    qc.invalidateQueries();
  };

  const deliver = async (row: any) => {
    if (row.debt > 0.009 && !confirm(`Aún debe ${formatMoney(row.debt)}. ¿Entregar de todos modos?`)) return;
    const { error } = await supabase.from("patient_studies")
      .update({ delivered_at: new Date().toISOString(), delivered_by: user!.id })
      .eq("id", row.id);
    if (error) return toast.error(translateError(error));
    await supabase.rpc("log_audit_event", {
      _action: "DELIVER",
      _table_name: "patient_studies",
      _record_id: row.id,
      _data: {
        patient_id: row.patient_id,
        patient_name: row.patient?.full_name,
        study_id: row.study_id,
        balance_before: Math.round(row.debt * 100) / 100,
        balance_after: Math.round(row.debt * 100) / 100,
        total: Math.round(row.total * 100) / 100,
      } as any,
    });
    toast.success("Estudio entregado");
    qc.invalidateQueries();
  };

  const chargeAll = async (patientId: string) => {
    const patientRows = enriched.filter((r) => r.patient_id === patientId && r.debt > 0.009);
    const totalDebt = patientRows.reduce((s, r) => s + r.debt, 0);
    for (const r of patientRows) {
      await supabase.from("patient_studies").update({ amount_paid: Number(r.total.toFixed(2)) }).eq("id", r.id);
    }
    await supabase.rpc("log_audit_event", {
      _action: "CHARGE_ALL",
      _table_name: "patient_studies",
      _record_id: patientId,
      _data: {
        patient_id: patientId,
        patient_name: patientRows[0]?.patient?.full_name,
        items_count: patientRows.length,
        record_ids: patientRows.map((r) => r.id),
        amount_charged: Math.round(totalDebt * 100) / 100,
        balance_before: Math.round(totalDebt * 100) / 100,
        balance_after: 0,
      } as any,
    });
    toast.success(`Cobrado saldo total del paciente`);
    qc.invalidateQueries();
  };

  const renderRow = (r: any) => (
    <TableRow key={r.id}>
      <TableCell>
        <div className="font-medium">{r.patient?.full_name || "-"}</div>
        <div className="text-xs text-muted-foreground">Cel: {r.patient?.phone || "—"}</div>
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
