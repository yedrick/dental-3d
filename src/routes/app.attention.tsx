import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, UserPlus, Plus, Trash2, X, ChevronRight, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/attention")({ component: AttentionPage });

type SelectedStudy = { study_id: string; has_report: boolean; is_voucher: boolean };
type PayMode = "full" | "advance" | "pending";

function AttentionPage() {
  return (
    <div>
      <PageHeader title="Atención" description="Registro rápido y entregas / cobros de saldos pendientes." />
      <Tabs defaultValue="registro">
        <TabsList className="mb-3">
          <TabsTrigger value="registro">Registro</TabsTrigger>
          <TabsTrigger value="entregas">Entregas</TabsTrigger>
        </TabsList>
        <TabsContent value="registro"><RegistroTab /></TabsContent>
        <TabsContent value="entregas"><EntregasTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// REGISTRO TAB
// ============================================================
function RegistroTab() {
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

  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<any | null>(null);
  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return (patients as any[])
      .filter((p) => p.full_name?.toLowerCase().includes(q) || (p.phone ?? "").includes(query))
      .slice(0, 6);
  }, [patients, query]);

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
    setPatient(data); setQuery(data.full_name);
    setQuickOpen(false); setQuick({ full_name: "", phone: "", doctor_id: "" });
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

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

    let remainingPaid = paid;
    const rows = items.map((it) => {
      const base = it.is_voucher ? 0 : activePrice(it.study_id, it.has_report);
      const surcharge = it.is_voucher || !withInvoice ? 0 : base * (invoicePct / 100);
      const total = base + surcharge;
      const rowPaid = Math.min(remainingPaid, total);
      remainingPaid -= rowPaid;
      return {
        patient_id: patient.id, study_id: it.study_id,
        doctor_id: doctorId || null, clinic_name: clinic || null,
        has_report: it.has_report, is_voucher: it.is_voucher,
        with_invoice: !it.is_voucher && withInvoice,
        invoice_number: invoiceNumber || null,
        payment_method: it.is_voucher ? null : paymentMethod,
        amount_paid: Math.round(rowPaid * 100) / 100,
        created_by: user!.id,
      };
    });

    const { error } = await supabase.from("patient_studies").insert(rows as any);
    if (error) return toast.error(error.message);
    toast.success(`Atención registrada.${debt > 0 ? ` Deuda: ${formatMoney(debt)}` : ""}`);
    resetForm(); qc.invalidateQueries();
  };

  if (!canCreate) return <Card className="p-6 text-sm text-muted-foreground">Sin permiso <code>attention.create</code>.</Card>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* LEFT: compact summary / total */}
      <aside className="order-2">
        <Card className="p-3 lg:sticky lg:top-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Resumen</div>
          <dl className="text-xs space-y-1">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-mono">{formatMoney(totals.base)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Recargo</dt><dd className="font-mono">{formatMoney(totals.surcharge)}</dd></div>
            <div className="flex justify-between border-t pt-1"><dt className="font-semibold">Total</dt><dd className="font-mono font-bold text-base">{formatMoney(totals.total)}</dd></div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><dt>Pagado</dt><dd className="font-mono">{formatMoney(paid)}</dd></div>
            <div className={"flex justify-between " + (debt > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "")}><dt>Deuda</dt><dd className="font-mono">{formatMoney(debt)}</dd></div>
          </dl>
          <Button size="sm" className="w-full" onClick={save} disabled={!patient || items.length === 0}>Registrar</Button>
          {patient && (
            <div className="pt-2 border-t text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground truncate">{patient.full_name}</div>
              <div>Cel: {patient.phone || "—"}</div>
              <Link to="/app/patients/$id" params={{ id: patient.id }} className="text-primary hover:underline inline-flex items-center gap-0.5 mt-1">Ver perfil <ChevronRight className="h-3 w-3" /></Link>
            </div>
          )}
        </Card>
      </aside>

      {/* RIGHT: form */}
      <div className="order-1 lg:order-2 space-y-3 min-w-0">
        {/* Patient */}
        <Card className="p-3">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">1. Paciente</Label>
          {patient ? (
            <div className="mt-1.5 flex items-center justify-between rounded-md border bg-muted/40 p-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold truncate">{patient.full_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">Cel: {patient.phone || "—"}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setPatient(null); setQuery(""); }}><X className="h-3 w-3 mr-1" />Cambiar</Button>
            </div>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input autoFocus placeholder="Nombre o celular…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 h-9" />
                </div>
                <Button variant="outline" size="sm" onClick={() => { setQuick({ ...quick, full_name: /\d/.test(query) ? "" : query, phone: /^\d+$/.test(query) ? query : "" }); setQuickOpen(true); }}>
                  <UserPlus className="h-4 w-4 mr-1" />Nuevo
                </Button>
              </div>
              {filtered.length > 0 && (
                <div className="rounded-md border divide-y max-h-52 overflow-auto">
                  {filtered.map((p) => (
                    <button key={p.id} onClick={() => selectPatient(p)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-accent">
                      <span className="font-medium truncate">{p.full_name}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{p.phone || "—"}</span>
                    </button>
                  ))}
                </div>
              )}
              {query && filtered.length === 0 && (
                <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                  Sin resultados. <button onClick={() => { setQuick({ ...quick, full_name: /\d/.test(query) ? "" : query, phone: /^\d+$/.test(query) ? query : "" }); setQuickOpen(true); }} className="text-primary underline">Crear</button>.
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Studies */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">2. Estudios</Label>
            <Button size="sm" variant="outline" onClick={addStudy} className="h-7"><Plus className="h-3.5 w-3.5 mr-1" />Agregar</Button>
          </div>
          {items.length === 0 && <div className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-md">Sin estudios.</div>}
          <div className="space-y-1.5">
            {items.map((it, i) => {
              const base = it.is_voucher ? 0 : activePrice(it.study_id, it.has_report);
              const surcharge = it.is_voucher || !withInvoice ? 0 : base * (invoicePct / 100);
              return (
                <div key={i} className="grid grid-cols-[1fr,auto,auto] sm:grid-cols-[1fr,auto,auto,auto,auto] items-center gap-1.5 rounded-md border p-1.5">
                  <Select value={it.study_id} onValueChange={(v) => updateItem(i, { study_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Estudio" /></SelectTrigger>
                    <SelectContent>{(studies as any[]).filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 text-[10px]"><Switch checked={it.has_report} onCheckedChange={(v) => updateItem(i, { has_report: v })} /><span>Inf.</span></label>
                  <label className="flex items-center gap-1 text-[10px]"><Switch checked={it.is_voucher} onCheckedChange={(v) => updateItem(i, { is_voucher: v })} /><span>Vale</span></label>
                  <div className="text-xs font-mono w-20 text-right col-span-2 sm:col-span-1">{formatMoney(base + surcharge)}</div>
                  <Button size="icon" variant="ghost" onClick={() => removeItem(i)} className="h-7 w-7"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Referral + invoice */}
        <Card className="p-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Doctor referente</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{(doctors as any[]).filter((d) => d.status !== false).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Clínica</Label>
            <Input value={clinic} onChange={(e) => setClinic(e.target.value)} placeholder="Opcional" className="h-9" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={withInvoice} onCheckedChange={setWithInvoice} />
            <Label className="text-xs">Con factura ({invoicePct}% recargo)</Label>
            {withInvoice && (
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="N° Factura" className="h-8 max-w-[180px] ml-auto" />
            )}
          </div>
        </Card>

        {/* Payment */}
        <Card className="p-3">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">3. Cobro</Label>
          <RadioGroup value={payMode} onValueChange={(v) => setPayMode(v as PayMode)} className="grid grid-cols-3 gap-1.5 mt-1.5">
            <label className="flex items-center gap-1.5 rounded-md border p-2 text-xs cursor-pointer hover:bg-accent"><RadioGroupItem value="full" /><span>Total</span></label>
            <label className="flex items-center gap-1.5 rounded-md border p-2 text-xs cursor-pointer hover:bg-accent"><RadioGroupItem value="advance" /><span>Adelanto</span></label>
            <label className="flex items-center gap-1.5 rounded-md border p-2 text-xs cursor-pointer hover:bg-accent"><RadioGroupItem value="pending" /><span>En entrega</span></label>
          </RadioGroup>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {payMode === "advance" && (
              <div>
                <Label className="text-xs">Monto adelantado</Label>
                <Input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className="h-9" />
              </div>
            )}
            {payMode !== "pending" && (
              <div>
                <Label className="text-xs">Forma de pago</Label>
                <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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

      {/* Quick-create dialog */}
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
    </div>
  );
}

// ============================================================
// ENTREGAS TAB — search by patient, aggregated pending amounts
// ============================================================
function EntregasTab() {
  const { data: rows = [] } = useList<any>("patient_studies");
  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const [q, setQ] = useState("");

  const patMap = new Map((patients as any[]).map((p) => [p.id, p]));

  const grouped = useMemo(() => {
    const map = new Map<string, { patient: any; total: number; paid: number; debt: number; pendingDelivery: number; lastDate: string }>();
    (rows as any[]).forEach((r) => {
      const p = patMap.get(r.patient_id); if (!p) return;
      const total = Number(r.price ?? 0) + Number(r.invoice_surcharge ?? 0) - Number(r.discount ?? 0);
      const paid = Number(r.amount_paid ?? 0);
      const debt = Math.max(0, total - paid);
      const g = map.get(r.patient_id) ?? { patient: p, total: 0, paid: 0, debt: 0, pendingDelivery: 0, lastDate: r.created_at };
      g.total += total; g.paid += paid; g.debt += debt;
      if (!r.delivered_at && !r.is_voucher) g.pendingDelivery += 1;
      if (r.created_at > g.lastDate) g.lastDate = r.created_at;
      map.set(r.patient_id, g);
    });
    return Array.from(map.values()).filter((g) => g.debt > 0.009 || g.pendingDelivery > 0);
  }, [rows, patMap]);

  const filtered = grouped.filter((g) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (g.patient.full_name ?? "").toLowerCase().includes(s) || (g.patient.phone ?? "").includes(q);
  }).sort((a, b) => b.debt - a.debt);

  return (
    <Card className="p-3 space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input autoFocus placeholder="Buscar paciente por nombre o celular…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          {q ? "Sin resultados." : "Sin pacientes con pendientes."}
        </div>
      ) : (
        <div className="divide-y">
          {filtered.map((g) => (
            <Link key={g.patient.id} to="/app/patients/$id" params={{ id: g.patient.id }}
              className="flex items-center gap-3 py-2.5 px-1 hover:bg-accent rounded-md transition-colors">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{g.patient.full_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  Cel: {g.patient.phone || "—"} · Última: {formatDate(g.lastDate)}
                </div>
              </div>
              <div className="text-right shrink-0">
                {g.debt > 0.009 ? (
                  <div className="font-mono font-semibold text-amber-600 dark:text-amber-400">{formatMoney(g.debt)}</div>
                ) : (
                  <Badge variant="secondary">Al día</Badge>
                )}
                <div className="flex gap-1 justify-end mt-0.5">
                  {g.pendingDelivery > 0 && <Badge variant="outline" className="text-[10px]">{g.pendingDelivery} x entregar</Badge>}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground flex items-center gap-1 pt-1 border-t">
        <Wallet className="h-3 w-3" /> Toca un paciente para ver su perfil, pagos y tratamientos.
      </div>
    </Card>
  );
}
