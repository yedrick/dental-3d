import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate, calcAge } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Wallet, PackageCheck, Phone, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/patients/$id")({ component: PatientProfile });

function PatientProfile() {
  const { id } = Route.useParams();
  const { can, user } = useAuth();
  const canCharge = can("attention.charge");
  const canDeliver = can("attention.deliver");
  const qc = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ["patient", id],
    queryFn: async () => (await supabase.from("patients").select("*").eq("id", id).single()).data,
  });
  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors_all"],
    queryFn: async () => (await supabase.from("doctors").select("*")).data ?? [],
  });
  const { data: studies = [] } = useQuery({
    queryKey: ["studies_all"],
    queryFn: async () => (await supabase.from("studies").select("*")).data ?? [],
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["patient_studies", id],
    queryFn: async () => (await supabase.from("patient_studies").select("*").eq("patient_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const studyName = (sid: string) => (studies as any[]).find((s) => s.id === sid)?.name ?? "—";
  const doctorName = (did?: string) => (doctors as any[]).find((d) => d.id === did)?.full_name ?? "—";

  const enriched = useMemo(() => (rows as any[]).map((r) => {
    const total = Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0);
    const paid = Number(r.amount_paid ?? 0);
    return { ...r, total, paid, debt: Math.max(0, total - paid) };
  }), [rows]);

  const summary = useMemo(() => enriched.reduce((s, r) => ({
    total: s.total + r.total, paid: s.paid + r.paid, debt: s.debt + r.debt,
    pendingDelivery: s.pendingDelivery + (!r.delivered_at && !r.is_voucher ? 1 : 0),
  }), { total: 0, paid: 0, debt: 0, pendingDelivery: 0 }), [enriched]);

  const [charge, setCharge] = useState<{ row: any; amount: string } | null>(null);
  const doCharge = async () => {
    if (!charge) return;
    const amt = Number(charge.amount || 0);
    if (amt <= 0) return toast.error("Monto inválido");
    if (amt > charge.row.debt + 0.001) return toast.error("Excede la deuda");
    const { error } = await supabase.from("patient_studies")
      .update({ amount_paid: Number((charge.row.paid + amt).toFixed(2)) })
      .eq("id", charge.row.id);
    if (error) return toast.error(error.message);
    toast.success("Cobro registrado"); setCharge(null); qc.invalidateQueries();
  };

  const deliver = async (row: any) => {
    if (row.debt > 0.009 && !confirm(`Aún debe ${formatMoney(row.debt)}. ¿Entregar?`)) return;
    const { error } = await supabase.from("patient_studies")
      .update({ delivered_at: new Date().toISOString(), delivered_by: user!.id })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Estudio entregado"); qc.invalidateQueries();
  };

  const chargeAll = async () => {
    for (const r of enriched.filter((x) => x.debt > 0.009)) {
      await supabase.from("patient_studies").update({ amount_paid: Number(r.total.toFixed(2)) }).eq("id", r.id);
    }
    toast.success("Saldo total cobrado"); qc.invalidateQueries();
  };

  if (!patient) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>;

  return (
    <div>
      <div className="mb-3">
        <Link to="/app/attention" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Volver a Atención
        </Link>
      </div>

      <PageHeader title={patient.full_name} description={`Perfil del paciente`} />

      {/* Header info */}
      <div className="grid gap-3 md:grid-cols-[1fr,auto] mb-3">
        <Card className="p-3 grid sm:grid-cols-3 gap-2 text-sm">
          <div><div className="text-[10px] uppercase text-muted-foreground">Celular</div><div className="flex items-center gap-1"><Phone className="h-3 w-3" />{patient.phone || "—"}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Edad</div><div>{patient.birth_date ? `${calcAge(patient.birth_date)} años` : "—"}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Doctor</div><div className="flex items-center gap-1"><UserIcon className="h-3 w-3" />{doctorName(patient.doctor_id)}</div></div>
        </Card>
        <Card className="p-3 grid grid-cols-3 md:grid-cols-1 gap-2 text-xs min-w-[200px]">
          <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono">{formatMoney(summary.total)}</span></div>
          <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><span>Pagado</span><span className="font-mono">{formatMoney(summary.paid)}</span></div>
          <div className={"flex justify-between " + (summary.debt > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "")}><span>Deuda</span><span className="font-mono">{formatMoney(summary.debt)}</span></div>
          {summary.debt > 0.009 && canCharge && (
            <Button size="sm" className="col-span-3 md:col-span-1 mt-1" onClick={chargeAll}><Wallet className="h-3.5 w-3.5 mr-1" />Cobrar todo</Button>
          )}
        </Card>
      </div>

      <Tabs defaultValue="tratamientos">
        <TabsList>
          <TabsTrigger value="tratamientos">Tratamientos / Estudios ({enriched.length})</TabsTrigger>
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
          <TabsTrigger value="entregas">Entregas {summary.pendingDelivery > 0 && <Badge variant="outline" className="ml-1">{summary.pendingDelivery}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="tratamientos">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Estudio</TableHead><TableHead>Doctor</TableHead>
                <TableHead>Total</TableHead><TableHead>Pagado</TableHead><TableHead>Deuda</TableHead>
                <TableHead>Factura</TableHead><TableHead>Entrega</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {enriched.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                    <TableCell>{studyName(r.study_id)} {r.has_report && <Badge variant="outline" className="ml-1 text-[10px]">Inf.</Badge>} {r.is_voucher && <Badge className="ml-1 text-[10px]">Vale</Badge>}</TableCell>
                    <TableCell className="text-xs">{doctorName(r.doctor_id)}</TableCell>
                    <TableCell className="font-mono">{formatMoney(r.total)}</TableCell>
                    <TableCell className="font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(r.paid)}</TableCell>
                    <TableCell className="font-mono">{r.debt > 0.009 ? <Badge variant="outline" className="text-amber-600 border-amber-500">{formatMoney(r.debt)}</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                    <TableCell className="text-xs">{r.with_invoice ? (r.invoice_number || "Sí") : "—"}</TableCell>
                    <TableCell className="text-xs">{r.delivered_at ? formatDate(r.delivered_at) : <Badge variant="outline">Pendiente</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {canCharge && r.debt > 0.009 && <Button size="sm" variant="outline" onClick={() => setCharge({ row: r, amount: r.debt.toFixed(2) })}><Wallet className="h-3.5 w-3.5" /></Button>}
                        {canDeliver && !r.delivered_at && <Button size="sm" onClick={() => deliver(r)}><PackageCheck className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {enriched.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Sin registros.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="pagos">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Estudio</TableHead><TableHead>Método</TableHead>
                <TableHead>Total</TableHead><TableHead>Pagado</TableHead><TableHead>Deuda</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {enriched.filter((r) => r.paid > 0 || r.debt > 0).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                    <TableCell>{studyName(r.study_id)}</TableCell>
                    <TableCell className="text-xs uppercase">{r.payment_method || "—"}</TableCell>
                    <TableCell className="font-mono">{formatMoney(r.total)}</TableCell>
                    <TableCell className="font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(r.paid)}</TableCell>
                    <TableCell className="font-mono">{r.debt > 0.009 ? formatMoney(r.debt) : "—"}</TableCell>
                  </TableRow>
                ))}
                {enriched.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin pagos.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="entregas">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Estudio</TableHead><TableHead>Estado</TableHead>
                <TableHead>Deuda</TableHead><TableHead className="text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {enriched.filter((r) => !r.is_voucher).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                    <TableCell>{studyName(r.study_id)}</TableCell>
                    <TableCell>{r.delivered_at ? <Badge>Entregado {formatDate(r.delivered_at)}</Badge> : <Badge variant="outline">Pendiente</Badge>}</TableCell>
                    <TableCell className="font-mono">{r.debt > 0.009 ? <span className="text-amber-600">{formatMoney(r.debt)}</span> : "—"}</TableCell>
                    <TableCell className="text-right">
                      {canDeliver && !r.delivered_at && <Button size="sm" onClick={() => deliver(r)}><PackageCheck className="h-3.5 w-3.5 mr-1" />Entregar</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {enriched.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin registros.</TableCell></TableRow>}
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
                <div><span className="text-muted-foreground">Estudio:</span> {studyName(charge.row.study_id)}</div>
                <div><span className="text-muted-foreground">Deuda:</span> <strong className="font-mono">{formatMoney(charge.row.debt)}</strong></div>
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
