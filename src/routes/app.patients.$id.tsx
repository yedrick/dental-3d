import { translateError } from "@/lib/translate-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate, calcAge } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Wallet, PackageCheck, Phone, Mail, Cake, User as UserIcon,
  Building2, CalendarDays, FileText, Save, Percent, Stethoscope, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/patients/$id")({ component: PatientProfile });

function PatientProfile() {
  const { id } = Route.useParams();
  const { can, user } = useAuth();
  const canCharge = can("attention.charge");
  const canDeliver = can("attention.deliver");
  const canEdit = can("patients.edit");
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
  const { data: appointments = [] } = useQuery({
    queryKey: ["patient_appointments", id],
    queryFn: async () => (await supabase.from("appointments").select("*").eq("patient_id", id).order("starts_at", { ascending: false })).data ?? [],
  });

  const studyName = (sid: string) => (studies as any[]).find((s) => s.id === sid)?.name ?? "—";
  const doctor = (doctors as any[]).find((d) => d.id === patient?.doctor_id);

  const enriched = useMemo(() => (rows as any[]).map((r) => {
    const total = Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0);
    const paid = Number(r.amount_paid ?? 0);
    return { ...r, total, paid, debt: Math.max(0, total - paid) };
  }), [rows]);

  const summary = useMemo(() => enriched.reduce((s, r) => ({
    total: s.total + r.total, paid: s.paid + r.paid, debt: s.debt + r.debt,
    pendingDelivery: s.pendingDelivery + (!r.delivered_at && !r.is_voucher ? 1 : 0),
    delivered: s.delivered + (r.delivered_at ? 1 : 0),
    withInvoice: s.withInvoice + (r.with_invoice ? 1 : 0),
    vouchers: s.vouchers + (r.is_voucher ? 1 : 0),
  }), { total: 0, paid: 0, debt: 0, pendingDelivery: 0, delivered: 0, withInvoice: 0, vouchers: 0 }), [enriched]);

  const [charge, setCharge] = useState<{ row: any; amount: string } | null>(null);
  const doCharge = async () => {
    if (!charge) return;
    const amt = Number(charge.amount || 0);
    if (amt <= 0) return toast.error("Monto inválido");
    if (amt > charge.row.debt + 0.001) return toast.error("Excede la deuda");
    const { error } = await supabase.from("patient_studies")
      .update({ amount_paid: Number((charge.row.paid + amt).toFixed(2)) })
      .eq("id", charge.row.id);
    if (error) return toast.error(translateError(error));
    toast.success("Cobro registrado"); setCharge(null); qc.invalidateQueries();
  };

  const deliver = async (row: any) => {
    if (row.debt > 0.009) return toast.error(`Aún debe ${formatMoney(row.debt)}. Cobra primero.`);
    const { error } = await supabase.from("patient_studies")
      .update({ delivered_at: new Date().toISOString(), delivered_by: user!.id })
      .eq("id", row.id);
    if (error) return toast.error(translateError(error));
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
      <div className="mb-3 flex items-center gap-3">
        <Link to="/app/patients" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Pacientes
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link to="/app/attention" className="text-xs text-muted-foreground hover:text-foreground">Atención</Link>
      </div>

      {/* Hero header */}
      <Card className="p-5 mb-4 bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center text-2xl font-bold shrink-0">
            {(patient.full_name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{patient.full_name}</h1>
              <Badge variant={patient.status ? "default" : "outline"}>{patient.status ? "Activo" : "Inactivo"}</Badge>
              {patient.birth_date && <Badge variant="outline"><Cake className="h-3 w-3 mr-1" />{calcAge(patient.birth_date)} años</Badge>}
            </div>
            <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {patient.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{patient.phone}</span>}
              {patient.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{patient.email}</span>}
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />Registrado {formatDate(patient.created_at)}</span>
            </div>
          </div>
          {summary.debt > 0.009 && canCharge && (
            <Button onClick={chargeAll} className="bg-amber-600 hover:bg-amber-700">
              <Wallet className="h-4 w-4 mr-2" />Cobrar deuda total {formatMoney(summary.debt)}
            </Button>
          )}
        </div>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KPI label="Total facturado" value={formatMoney(summary.total)} />
        <KPI label="Pagado" value={formatMoney(summary.paid)} tone="ok" />
        <KPI label="Saldo pendiente" value={formatMoney(summary.debt)} tone={summary.debt > 0 ? "warn" : "muted"} />
        <KPI label="Pendiente entregar" value={String(summary.pendingDelivery)} tone={summary.pendingDelivery > 0 ? "warn" : "muted"} />
      </div>

      <Tabs defaultValue="tratamientos">
        <TabsList>
          <TabsTrigger value="tratamientos">Estudios ({enriched.length})</TabsTrigger>
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
          <TabsTrigger value="entregas">Entregas {summary.pendingDelivery > 0 && <Badge variant="outline" className="ml-1">{summary.pendingDelivery}</Badge>}</TabsTrigger>
          <TabsTrigger value="citas">Citas ({appointments.length})</TabsTrigger>
          <TabsTrigger value="datos">Datos</TabsTrigger>
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
                    <TableCell className="text-xs">{(doctors as any[]).find((d) => d.id === r.doctor_id)?.full_name ?? "—"}</TableCell>
                    <TableCell className="font-mono">{formatMoney(r.total)}</TableCell>
                    <TableCell className="font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(r.paid)}</TableCell>
                    <TableCell className="font-mono">{r.debt > 0.009 ? <Badge variant="outline" className="text-amber-600 border-amber-500">{formatMoney(r.debt)}</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                    <TableCell className="text-xs">{r.with_invoice ? (r.invoice_number || "Sí") : "—"}</TableCell>
                    <TableCell className="text-xs">{r.delivered_at ? formatDate(r.delivered_at) : <Badge variant="outline">Pendiente</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {canCharge && r.debt > 0.009 && <Button size="sm" variant="outline" onClick={() => setCharge({ row: r, amount: r.debt.toFixed(2) })} title="Cobrar"><Wallet className="h-3.5 w-3.5" /></Button>}
                        {canDeliver && !r.delivered_at && <Button size="sm" onClick={() => deliver(r)} disabled={r.debt > 0.009} title={r.debt > 0.009 ? `Saldo pendiente: ${formatMoney(r.debt)}` : "Entregar"}><PackageCheck className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {enriched.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Sin registros.</TableCell></TableRow>}
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
                {enriched.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin pagos.</TableCell></TableRow>}
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
                    <TableCell className="font-mono">{r.debt > 0.009 ? <span className="text-amber-600 font-semibold">{formatMoney(r.debt)}</span> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {canCharge && r.debt > 0.009 && <Button size="sm" variant="outline" onClick={() => setCharge({ row: r, amount: r.debt.toFixed(2) })}><Wallet className="h-3.5 w-3.5 mr-1" />Cobrar {formatMoney(r.debt)}</Button>}
                        {canDeliver && !r.delivered_at && <Button size="sm" onClick={() => deliver(r)} disabled={r.debt > 0.009}><PackageCheck className="h-3.5 w-3.5 mr-1" />Entregar</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {enriched.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sin registros.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="citas">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Doctor</TableHead><TableHead>Estudio</TableHead>
                <TableHead>Estado</TableHead><TableHead>Notas</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(appointments as any[]).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.starts_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{(doctors as any[]).find((d) => d.id === a.doctor_id)?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{a.study_id ? studyName(a.study_id) : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.notes || "—"}</TableCell>
                  </TableRow>
                ))}
                {appointments.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sin citas registradas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="datos">
          <div className="grid gap-4 md:grid-cols-2">
            <PatientDataCard patient={patient} doctors={doctors} canEdit={canEdit} onSaved={() => qc.invalidateQueries({ queryKey: ["patient", id] })} />
            <DoctorInfoCard doctor={doctor} />
          </div>
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

function KPI({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "muted" }) {
  const cls =
    tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn" ? "text-amber-600 dark:text-amber-400"
        : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={"text-xl font-bold font-mono " + cls}>{value}</div>
    </Card>
  );
}

function PatientDataCard({ patient, doctors, canEdit, onSaved }: any) {
  const [form, setForm] = useState({
    full_name: patient.full_name ?? "",
    phone: patient.phone ?? "",
    email: patient.email ?? "",
    birth_date: patient.birth_date ?? "",
    doctor_id: patient.doctor_id ?? "",
    notes: patient.notes ?? "",
  });
  useEffect(() => {
    setForm({
      full_name: patient.full_name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      birth_date: patient.birth_date ?? "",
      doctor_id: patient.doctor_id ?? "",
      notes: patient.notes ?? "",
    });
  }, [patient.id]);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("patients").update({
      full_name: form.full_name,
      phone: form.phone || null,
      email: form.email || null,
      birth_date: form.birth_date || null,
      doctor_id: form.doctor_id || null,
      notes: form.notes || null,
    }).eq("id", patient.id);
    setSaving(false);
    if (error) return toast.error(translateError(error));
    toast.success("Datos actualizados");
    onSaved();
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Datos del paciente</h3>
      </div>
      <div className="grid gap-3">
        <div><Label>Nombre completo</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} disabled={!canEdit} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Celular</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} /></div>
          <div><Label>Fecha de nacimiento</Label><Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} disabled={!canEdit} /></div>
        </div>
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canEdit} /></div>
        <div>
          <Label>Doctor referente</Label>
          <Select value={form.doctor_id} onValueChange={(v) => setForm({ ...form, doctor_id: v })} disabled={!canEdit}>
            <SelectTrigger><SelectValue placeholder="Sin doctor" /></SelectTrigger>
            <SelectContent>
              {(doctors as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Notas clínicas</Label><Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!canEdit} /></div>
        {canEdit && (
          <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Guardando…" : "Guardar cambios"}</Button></div>
        )}
      </div>
    </Card>
  );
}

function DoctorInfoCard({ doctor }: { doctor: any }) {
  if (!doctor) return (
    <Card className="p-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 mb-2"><Stethoscope className="h-4 w-4" /><span>Doctor</span></div>
      Este paciente no tiene doctor asignado.
    </Card>
  );
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Stethoscope className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Doctor referente</h3>
      </div>
      <div className="space-y-2 text-sm">
        <div className="font-medium text-base">{doctor.full_name}</div>
        {doctor.clinic_address && <div className="flex items-start gap-2"><Building2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" /><span>{doctor.clinic_address}</span></div>}
        {doctor.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><span>{doctor.phone}</span></div>}
        {doctor.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span>{doctor.email}</span></div>}
        <div className="flex flex-wrap gap-2 pt-2">
          <Badge variant="outline"><Percent className="h-3 w-3 mr-1" />Comisión {doctor.default_commission_pct}%</Badge>
          {Number(doctor.agreement_discount_pct) > 0 && <Badge variant="outline">Convenio {doctor.agreement_discount_pct}% desc.</Badge>}
          <Badge variant={doctor.status ? "default" : "outline"}>{doctor.status ? "Activo" : "Inactivo"}</Badge>
        </div>
        <div className="pt-2">
          <Link to="/app/doctors" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />Ver en Doctores
          </Link>
        </div>
      </div>
    </Card>
  );
}
