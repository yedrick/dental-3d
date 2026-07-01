import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, formatMoney, formatDate } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, UserPlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/attention")({ component: AttentionPage });

type SelectedStudy = { study_id: string; has_report: boolean; is_voucher: boolean };
type PayMode = "full" | "advance" | "pending";

function AttentionPage() {
  const { user, can } = useAuth();
  const canCreate = can("attention.create");
  const qc = useQueryClient();

  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const { data: prices = [] } = useList<any>("study_prices");
  const { data: paramsRow = [] } = useQuery({
    queryKey: ["app_params"],
    queryFn: async () => (await supabase.from("app_params").select("*")).data ?? [],
  });
  const params = useMemo(() => {
    const m: Record<string, number> = {};
    (paramsRow as any[]).forEach((p) => { m[p.key] = Number(p.value_num ?? 0); });
    return m;
  }, [paramsRow]);
  const invoicePct = params["invoice_surcharge_pct"] ?? 13;

  const activePrice = (studyId: string, withReport: boolean) => {
    const p: any = (prices as any[]).find((x) => x.study_id === studyId && x.is_active);
    if (!p) return 0;
    return Number(withReport ? p.price_with_report : p.price_without_report) || 0;
  };

  // ---- Search & selection state ----
  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<any | null>(null);
  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return (patients as any[])
      .filter((p) => p.full_name?.toLowerCase().includes(q) || (p.phone ?? "").includes(query))
      .slice(0, 8);
  }, [patients, query]);

  // ---- Quick-create patient dialog ----
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ full_name: "", phone: "", doctor_id: "" });
  const createQuickPatient = async () => {
    if (!quick.full_name || !quick.doctor_id) return toast.error("Nombre y doctor son obligatorios");
    const { data, error } = await supabase.from("patients").insert({
      full_name: quick.full_name, phone: quick.phone || null,
      doctor_id: quick.doctor_id, created_by: user!.id,
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Paciente creado");
    setPatient(data);
    setQuery(data.full_name);
    setQuickOpen(false);
    setQuick({ full_name: "", phone: "", doctor_id: "" });
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  // ---- Attention form state ----
  const [items, setItems] = useState<SelectedStudy[]>([]);
  const [doctorId, setDoctorId] = useState<string>("");
  const [clinic, setClinic] = useState<string>("");
  const [withInvoice, setWithInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("full");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash"|"qr"|"card">("cash");

  const resetForm = () => {
    setPatient(null); setQuery(""); setItems([]); setDoctorId(""); setClinic("");
    setWithInvoice(false); setInvoiceNumber(""); setPayMode("full"); setAmountPaid(""); setPaymentMethod("cash");
  };

  const selectPatient = (p: any) => {
    setPatient(p); setQuery(p.full_name); setDoctorId(p.doctor_id ?? "");
  };

  const addStudy = () => setItems([...items, { study_id: "", has_report: false, is_voucher: false }]);
  const updateItem = (i: number, patch: Partial<SelectedStudy>) => {
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  };
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const totals = useMemo(() => {
    let base = 0, surcharge = 0;
    items.forEach((it) => {
      if (!it.study_id || it.is_voucher) return;
      const p = activePrice(it.study_id, it.has_report);
      base += p;
      if (withInvoice) surcharge += p * (invoicePct / 100);
    });
    return { base, surcharge, total: base + surcharge };
  }, [items, withInvoice, invoicePct, prices]);

  const paid = payMode === "full" ? totals.total : payMode === "advance" ? Number(amountPaid || 0) : 0;
  const debt = Math.max(0, totals.total - paid);

  const save = async () => {
    if (!patient) return toast.error("Selecciona o crea un paciente");
    if (items.length === 0) return toast.error("Agrega al menos un estudio");
    if (items.some((it) => !it.study_id)) return toast.error("Elige el estudio en cada fila");
    if (payMode === "advance" && (paid <= 0 || paid > totals.total)) return toast.error("Monto adelantado inválido");

    // Distribute paid amount across studies in order (fully cover first ones)
    let remainingPaid = paid;
    const rows = items.map((it) => {
      const base = it.is_voucher ? 0 : activePrice(it.study_id, it.has_report);
      const surcharge = it.is_voucher || !withInvoice ? 0 : base * (invoicePct / 100);
      const total = base + surcharge;
      const rowPaid = Math.min(remainingPaid, total);
      remainingPaid -= rowPaid;
      return {
        patient_id: patient.id,
        study_id: it.study_id,
        doctor_id: doctorId || null,
        clinic_name: clinic || null,
        has_report: it.has_report,
        is_voucher: it.is_voucher,
        with_invoice: !it.is_voucher && withInvoice,
        invoice_number: invoiceNumber || null,
        payment_method: it.is_voucher ? null : paymentMethod,
        amount_paid: Math.round(rowPaid * 100) / 100,
        created_by: user!.id,
      };
    });

    const { error } = await supabase.from("patient_studies").insert(rows as any);
    if (error) return toast.error(error.message);
    toast.success(`Atención registrada. ${debt > 0 ? `Deuda pendiente: ${formatMoney(debt)}` : "Pagado."}`);
    resetForm();
    qc.invalidateQueries();
  };

  // ---- Patient history preview ----
  const { data: history = [] } = useQuery({
    queryKey: ["patient_history", patient?.id],
    enabled: !!patient?.id,
    queryFn: async () => {
      const { data } = await supabase.from("patient_studies").select("*").eq("patient_id", patient!.id).order("created_at", { ascending: false }).limit(10);
      return data ?? [];
    },
  });
  const studyName = (id: string) => (studies as any[]).find((s) => s.id === id)?.name ?? "-";

  if (!canCreate) return <div><PageHeader title="Atención" /><Card className="p-6 text-sm text-muted-foreground">No tienes permiso <code>attention.create</code>.</Card></div>;

  return (
    <div>
      <PageHeader title="Atención rápida" description="Busca un paciente por nombre o celular, o créalo al vuelo, luego registra sus estudios y el cobro." />

      <div className="grid gap-4 lg:grid-cols-[1fr,380px]">
        {/* Left: main form */}
        <div className="space-y-4">
          {/* Patient search */}
          <Card className="p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">1. Paciente</Label>
            {patient ? (
              <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 p-3">
                <div>
                  <div className="font-semibold">{patient.full_name}</div>
                  <div className="text-xs text-muted-foreground">Cel: {patient.phone || "—"} · Doctor: {(doctors as any[]).find((d)=>d.id===patient.doctor_id)?.full_name || "—"}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setPatient(null); setQuery(""); }}>
                  <X className="h-4 w-4 mr-1" />Cambiar
                </Button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input autoFocus placeholder="Buscar por nombre o celular…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
                  </div>
                  <Button variant="outline" onClick={() => { setQuick({ ...quick, full_name: /\d/.test(query) ? "" : query, phone: /^\d+$/.test(query) ? query : "" }); setQuickOpen(true); }}>
                    <UserPlus className="h-4 w-4 mr-1" />Nuevo
                  </Button>
                </div>
                {filtered.length > 0 && (
                  <div className="rounded-md border divide-y max-h-64 overflow-auto">
                    {filtered.map((p) => (
                      <button key={p.id} onClick={() => selectPatient(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                        <span className="font-medium">{p.full_name}</span>
                        <span className="text-xs text-muted-foreground">{p.phone || "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
                {query && filtered.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Sin resultados. <button onClick={() => { setQuick({ ...quick, full_name: /\d/.test(query) ? "" : query, phone: /^\d+$/.test(query) ? query : "" }); setQuickOpen(true); }} className="text-primary underline">Crear paciente</button>.
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Studies */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">2. Estudios</Label>
              <Button size="sm" variant="outline" onClick={addStudy}><Plus className="h-4 w-4 mr-1" />Agregar</Button>
            </div>
            {items.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">Sin estudios. Pulsa "Agregar".</div>}
            <div className="space-y-2">
              {items.map((it, i) => {
                const base = it.is_voucher ? 0 : activePrice(it.study_id, it.has_report);
                const surcharge = it.is_voucher || !withInvoice ? 0 : base * (invoicePct / 100);
                return (
                  <div key={i} className="grid grid-cols-[1fr,auto,auto,auto,auto] items-center gap-2 rounded-md border p-2">
                    <Select value={it.study_id} onValueChange={(v) => updateItem(i, { study_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Elegir estudio" /></SelectTrigger>
                      <SelectContent>{(studies as any[]).filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="flex items-center gap-1 text-xs"><Switch checked={it.has_report} onCheckedChange={(v) => updateItem(i, { has_report: v })} /><span>Informe</span></div>
                    <div className="flex items-center gap-1 text-xs"><Switch checked={it.is_voucher} onCheckedChange={(v) => updateItem(i, { is_voucher: v })} /><span>Vale</span></div>
                    <div className="text-sm font-mono w-28 text-right">{formatMoney(base + surcharge)}</div>
                    <Button size="icon" variant="ghost" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Referral & invoice */}
          <Card className="p-4 grid gap-3 md:grid-cols-2">
            <div>
              <Label>Doctor referente</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{(doctors as any[]).filter((d) => d.status !== false).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Clínica</Label>
              <Input value={clinic} onChange={(e) => setClinic(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={withInvoice} onCheckedChange={setWithInvoice} />
              <Label>Con factura ({invoicePct}% recargo)</Label>
            </div>
            {withInvoice && (
              <div>
                <Label>N° Factura</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
            )}
          </Card>

          {/* Payment */}
          <Card className="p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">3. Cobro</Label>
            <RadioGroup value={payMode} onValueChange={(v) => setPayMode(v as PayMode)} className="grid grid-cols-3 gap-2 mt-2">
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="full" /><span>Pago total</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="advance" /><span>Adelanto</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="pending" /><span>Cobrar en entrega</span>
              </label>
            </RadioGroup>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {payMode === "advance" && (
                <div>
                  <Label>Monto adelantado</Label>
                  <Input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                </div>
              )}
              {payMode !== "pending" && (
                <div>
                  <Label>Forma de pago</Label>
                  <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Efectivo</SelectItem>
                      <SelectItem value="qr">QR</SelectItem>
                      <SelectItem value="card">Tarjeta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right: summary */}
        <aside className="space-y-3">
          <Card className="p-4 sticky top-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Resumen</div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right font-mono">{formatMoney(totals.base)}</dd>
              <dt className="text-muted-foreground">Recargo factura</dt><dd className="text-right font-mono">{formatMoney(totals.surcharge)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{formatMoney(totals.total)}</dd>
              <dt className="text-emerald-600 dark:text-emerald-400">Pagado ahora</dt><dd className="text-right font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(paid)}</dd>
              <dt className={debt > 0 ? "text-amber-600 dark:text-amber-400" : ""}>Deuda</dt>
              <dd className={"text-right font-mono " + (debt > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "")}>{formatMoney(debt)}</dd>
            </dl>
            <Button className="w-full mt-4" onClick={save} disabled={!patient || items.length === 0}>
              Registrar atención
            </Button>
          </Card>

          {patient && (
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Historial reciente</div>
              {history.length === 0 && <div className="text-sm text-muted-foreground">Sin atenciones previas.</div>}
              <div className="space-y-2 max-h-72 overflow-auto">
                {(history as any[]).map((h) => {
                  const rowTotal = Number(h.price ?? 0) + Number(h.invoice_surcharge ?? 0);
                  const rowDebt = Math.max(0, rowTotal - Number(h.amount_paid ?? 0));
                  return (
                    <div key={h.id} className="text-xs border-l-2 pl-2" style={{ borderColor: rowDebt > 0 ? "hsl(var(--warning, 45 90% 55%))" : "hsl(var(--muted))" }}>
                      <div className="flex justify-between">
                        <span className="font-medium">{studyName(h.study_id)}</span>
                        <span className="font-mono">{formatMoney(rowTotal)}</span>
                      </div>
                      <div className="text-muted-foreground flex justify-between">
                        <span>{formatDate(h.created_at)}</span>
                        {rowDebt > 0 ? <Badge variant="outline" className="text-amber-600 border-amber-500">Debe {formatMoney(rowDebt)}</Badge> : <Badge variant="secondary">Pagado</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </aside>
      </div>

      {/* Quick-create patient dialog */}
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Crear paciente rápido</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Nombre completo *</Label><Input value={quick.full_name} onChange={(e) => setQuick({ ...quick, full_name: e.target.value })} autoFocus /></div>
            <div><Label>Celular</Label><Input value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} /></div>
            <div>
              <Label>Doctor referente *</Label>
              <Select value={quick.doctor_id} onValueChange={(v) => setQuick({ ...quick, doctor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>{(doctors as any[]).filter((d) => d.status !== false).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={createQuickPatient}>Crear y seleccionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recent attentions table */}
      <div className="mt-6">
        <RecentAttentions />
      </div>
    </div>
  );
}

function RecentAttentions() {
  const { data: rows = [] } = useList<any>("patient_studies");
  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const patMap = new Map((patients as any[]).map((p) => [p.id, p.full_name]));
  const stMap = new Map((studies as any[]).map((s) => [s.id, s.name]));
  return (
    <Card>
      <div className="p-3 border-b text-sm font-medium">Últimas atenciones</div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Fecha</TableHead><TableHead>Paciente</TableHead><TableHead>Estudio</TableHead>
          <TableHead>Total</TableHead><TableHead>Pagado</TableHead><TableHead>Deuda</TableHead>
          <TableHead>Factura</TableHead><TableHead>Entrega</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(rows as any[]).slice(0, 20).map((r) => {
            const total = Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0);
            const debt = Math.max(0, total - Number(r.amount_paid ?? 0));
            return (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.created_at)}</TableCell>
                <TableCell>{patMap.get(r.patient_id) || "-"}</TableCell>
                <TableCell>{stMap.get(r.study_id) || "-"}</TableCell>
                <TableCell className="font-mono">{formatMoney(total)}</TableCell>
                <TableCell className="font-mono">{formatMoney(r.amount_paid)}</TableCell>
                <TableCell className="font-mono">{debt > 0 ? <Badge variant="outline" className="text-amber-600 border-amber-500">{formatMoney(debt)}</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                <TableCell>{r.with_invoice ? (r.invoice_number || "Sí") : "—"}</TableCell>
                <TableCell>{r.delivered_at ? formatDate(r.delivered_at) : <Badge variant="outline">Pendiente</Badge>}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground text-center">Sin atenciones registradas.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}
