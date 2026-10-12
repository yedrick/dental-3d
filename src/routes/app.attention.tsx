import { translateError } from "@/lib/translate-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiGetAll, apiPost, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate } from "@/lib/data";
import { STALE } from "@/lib/query-config";
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

// Dinero en centavos, con el mismo redondeo que el servidor (server/src/lib/money.ts),
// para que la vista previa coincida con lo que se registra.
const toCents = (amount: number) => Math.round(Number(amount) * 100);
const percentOf = (cents: number, pct: number) => {
  const raw = (cents * pct) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw) + 1e-9);
};

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
  const { can } = useAuth();
  const canCreate = can("attention.create");
  const qc = useQueryClient();

  const { data: doctors = [], isSuccess: doctorsReady } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiGet<any[]>("/api/doctors"),
    staleTime: STALE.master,
  });
  // Cada estudio trae price_with_report / price_without_report de su tarifa ACTIVA (null si no tiene)
  const { data: studies = [], isSuccess: studiesReady } = useQuery({
    queryKey: ["studies", "active"],
    queryFn: () => apiGet<any[]>("/api/studies", { active: true }),
    staleTime: STALE.catalog,
  });
  const { data: paramsRow = [], isSuccess: paramsReady } = useQuery({
    queryKey: ["app_params"],
    queryFn: () => apiGet<any[]>("/api/params"),
    staleTime: STALE.catalog,
  });
  const params = useMemo(() => {
    const m: Record<string, number> = {};
    (paramsRow as any[]).forEach((p) => { m[p.key] = Number(p.value_num ?? 0); });
    return m;
  }, [paramsRow]);
  // Mismo valor por defecto que el servidor si el parámetro no existe
  const invoicePct = params["invoice_surcharge_pct"] ?? 0;

  const studyMap = useMemo(() => new Map((studies as any[]).map((s) => [s.id, s])), [studies]);
  /** Precio de la tarifa activa; null si el estudio no tiene tarifa activa. */
  const activePrice = (studyId: string, withReport: boolean): number | null => {
    const s: any = studyMap.get(studyId);
    if (!s) return null;
    const v = withReport ? s.price_with_report : s.price_without_report;
    return v == null ? null : Number(v);
  };

  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<any | null>(null);
  // Búsqueda en el servidor (nombre, celular o email), con una pequeña espera al escribir
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data: filtered = [], isFetching: searching } = useQuery({
    queryKey: ["patients", "search", debounced],
    queryFn: async () => (await apiGet<Paged<any>>("/api/patients", { q: debounced, sort: "name", limit: 6 })).data,
    enabled: !patient && debounced.length > 0,
    staleTime: STALE.master,
  });
  const searchPending = searching || debounced !== query.trim();

  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ full_name: "", phone: "", doctor_id: "" });
  const createQuickPatient = async () => {
    if (!quick.full_name.trim()) return toast.error("El nombre es obligatorio");
    let data: any;
    try {
      // created_by lo pone la API con el usuario de la sesión
      data = await apiPost<any>("/api/patients", {
        full_name: quick.full_name, phone: quick.phone || null, doctor_id: quick.doctor_id || null,
      });
    } catch (e) {
      return toast.error(translateError(e));
    }
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
  const [saving, setSaving] = useState(false);

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

  // Descuento por convenio del doctor que usará el servidor: el elegido o, si no, el del paciente
  const effectiveDoctorId = doctorId || patient?.doctor_id || "";
  const discountPct = Number((doctors as any[]).find((d) => d.id === effectiveDoctorId)?.agreement_discount_pct ?? 0);

  /** Vista previa de una línea, en centavos y con el mismo redondeo que el servidor. */
  const lineCents = (it: SelectedStudy) => {
    if (!it.study_id || it.is_voucher) return { base: 0, surcharge: 0, discount: 0, total: 0 };
    const base = toCents(activePrice(it.study_id, it.has_report) ?? 0);
    const surcharge = withInvoice ? percentOf(base, invoicePct) : 0;
    const discount = percentOf(base, discountPct);
    return { base, surcharge, discount, total: base + surcharge - discount };
  };

  const totals = useMemo(() => {
    let base = 0, surcharge = 0, discount = 0;
    items.forEach((it) => {
      const l = lineCents(it);
      base += l.base; surcharge += l.surcharge; discount += l.discount;
    });
    return { base: base / 100, surcharge: surcharge / 100, discount: discount / 100, total: (base + surcharge - discount) / 100 };
  }, [items, withInvoice, invoicePct, discountPct, studyMap]);

  const paid = payMode === "full" ? totals.total : payMode === "advance" ? Number(amountPaid || 0) : 0;
  const debt = Math.max(0, Math.round((totals.total - paid) * 100) / 100);

  const save = async () => {
    if (!patient) return toast.error("Selecciona o crea un paciente");
    if (items.length === 0) return toast.error("Agrega al menos un estudio");
    if (items.some((it) => !it.study_id)) return toast.error("Elige el estudio en cada fila");
    if (!paramsReady || !studiesReady || !doctorsReady) return toast.error("Cargando tarifas, espera un momento");
    const noPrice = items.find((it) => !it.is_voucher && activePrice(it.study_id, it.has_report) == null);
    if (noPrice) return toast.error(`No hay tarifa activa para el estudio "${studyMap.get(noPrice.study_id)?.name ?? ""}"`);
    if (payMode === "advance" && (paid <= 0 || paid > totals.total)) return toast.error("Monto adelantado inválido");

    const hasCharge = items.some((it) => !it.is_voucher);
    setSaving(true);
    let res: any;
    try {
      // El servidor calcula precio, recargo, descuento por convenio y comisión: aquí solo se dice qué y cuánto se pagó
      res = await apiPost<any>("/api/attentions", {
        patient_id: patient.id,
        doctor_id: doctorId || null,
        clinic_name: clinic || null,
        with_invoice: withInvoice,
        invoice_number: withInvoice ? invoiceNumber || null : null,
        payment_method: hasCharge ? paymentMethod : null,
        amount_paid: Math.round(paid * 100) / 100,
        delivery_date: null,
        items: items.map((it) => ({ study_id: it.study_id, has_report: it.has_report, is_voucher: it.is_voucher })),
      });
    } catch (e) {
      setSaving(false);
      return toast.error(translateError(e));
    }
    setSaving(false);
    const serverDebt = Number(res?.debt ?? 0);
    toast.success(`Atención registrada. Total: ${formatMoney(Number(res?.total ?? 0))}.${serverDebt > 0 ? ` Deuda: ${formatMoney(serverDebt)}` : ""}`);
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
            {totals.discount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Desc. convenio ({discountPct}%)</dt><dd className="font-mono">−{formatMoney(totals.discount)}</dd></div>}
            <div className="flex justify-between border-t pt-1"><dt className="font-semibold">Total</dt><dd className="font-mono font-bold text-base">{formatMoney(totals.total)}</dd></div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><dt>Pagado</dt><dd className="font-mono">{formatMoney(paid)}</dd></div>
            <div className={"flex justify-between " + (debt > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "")}><dt>Deuda</dt><dd className="font-mono">{formatMoney(debt)}</dd></div>
          </dl>
          <Button size="sm" className="w-full" onClick={save} disabled={!patient || items.length === 0 || saving}>{saving ? "Registrando…" : "Registrar"}</Button>
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
      <div className="order-1 space-y-3 min-w-0">
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
              {query.trim() && filtered.length > 0 && (
                <div className="rounded-md border divide-y max-h-52 overflow-auto">
                  {(filtered as any[]).map((p) => (
                    <button key={p.id} onClick={() => selectPatient(p)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-accent">
                      <span className="font-medium truncate">{p.full_name}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{p.phone || "—"}</span>
                    </button>
                  ))}
                </div>
              )}
              {query && !searchPending && filtered.length === 0 && (
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
          <div className="space-y-2">
            {items.map((it, i) => {
              const total = lineCents(it).total / 100;
              const selected = studyMap.get(it.study_id);
              return (
                <div key={i} className="rounded-lg border bg-card/50 p-2.5 space-y-2 transition hover:border-primary/40">
                  <div className="flex items-center gap-2">
                    <Select value={it.study_id} onValueChange={(v) => updateItem(i, { study_id: v })}>
                      <SelectTrigger className="h-9 text-sm flex-1"><SelectValue placeholder="Selecciona estudio" /></SelectTrigger>
                      <SelectContent>{(studies as any[]).filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" onClick={() => removeItem(i)} className="h-9 w-9 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {selected && (
                    <div className="flex items-center justify-between gap-2 pl-1">
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <Switch checked={it.has_report} onCheckedChange={(v) => updateItem(i, { has_report: v })} />
                        <span>Con informe</span>
                      </label>
                      <div className="text-sm font-semibold tabular-nums">{formatMoney(total)}</div>
                    </div>
                  )}
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
              <SelectTrigger className="h-9"><SelectValue placeholder="Sin doctor" /></SelectTrigger>
              <SelectContent>{(doctors as any[]).filter((d) => d.status !== false).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
            </Select>
            {patient && !effectiveDoctorId && (
              <p className="mt-1 text-xs text-muted-foreground">Sin doctor: se registra sin comisión ni descuento por convenio.</p>
            )}
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
              <Label>Doctor referente (opcional)</Label>
              <Select value={quick.doctor_id || "none"} onValueChange={(v) => setQuick({ ...quick, doctor_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin doctor" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sin doctor</SelectItem>{(doctors as any[]).filter((d) => d.status !== false).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
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
function printDeliveryTicket(opts: {
  patient: any;
  studies: { name: string; price: number; has_report: boolean; with_invoice: boolean }[];
  totalPaid: number;
  totalDebt: number;
}) {
  const { patient, studies, totalPaid, totalDebt } = opts;
  const now = new Date();
  const fecha = now.toLocaleString("es-BO");
  const rows = studies.map((s) => `
    <tr>
      <td>${s.name}${s.has_report ? " (c/inf.)" : ""}${s.with_invoice ? " *Fact." : ""}</td>
      <td style="text-align:right">${s.price.toFixed(2)}</td>
    </tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Entrega ${patient.full_name}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      body { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #000; margin: 0; padding: 4px; }
      h1 { font-size: 13px; text-align: center; margin: 0 0 4px; }
      .muted { color: #444; font-size: 10px; text-align: center; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 1px 0; vertical-align: top; }
      .tot { font-weight: 700; font-size: 12px; }
      .foot { text-align: center; margin-top: 8px; font-size: 10px; }
    </style></head><body>
    <h1>DENTAL-3D</h1>
    <div class="muted">Comprobante de entrega</div>
    <div class="muted">${fecha}</div>
    <hr>
    <div><b>Paciente:</b> ${patient.full_name}</div>
    <div>Cel: ${patient.phone || "—"}</div>
    <hr>
    <table>${rows}</table>
    <hr>
    <table>
      <tr><td>Pagado</td><td style="text-align:right">${totalPaid.toFixed(2)} Bs</td></tr>
      <tr class="tot"><td>Saldo</td><td style="text-align:right">${totalDebt.toFixed(2)} Bs</td></tr>
    </table>
    <div class="foot">Gracias por su preferencia</div>
    <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) { toast.error("Habilita ventanas emergentes para imprimir"); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function EntregasTab() {
  const qc = useQueryClient();
  // Solo lo que tiene saldo o falta entregar (antes se bajaba toda la tabla)
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
  const [busy, setBusy] = useState<string | null>(null);
  const [chargeTarget, setChargeTarget] = useState<any | null>(null);

  // Las filas de atenciones no traen el celular: para buscar por número se consulta a pacientes
  const phoneQ = /\d{3,}/.test(q) ? q.trim() : "";
  const { data: phoneIds } = useQuery({
    queryKey: ["patients", "search", phoneQ, "ids"],
    queryFn: async () => new Set((await apiGet<Paged<any>>("/api/patients", { q: phoneQ, limit: 100 })).data.map((p) => p.id as string)),
    enabled: phoneQ.length > 0,
    staleTime: STALE.master,
  });

  const grouped = useMemo(() => {
    const byId = new Map<string, any>();
    [...(debtRows as any[]), ...(pendingRows as any[])].forEach((r) => byId.set(r.id, r));
    const map = new Map<string, { patient: any; items: any[]; total: number; paid: number; debt: number; pendingDelivery: number; lastDate: string }>();
    byId.forEach((r) => {
      const total = Number(r.total ?? 0);
      const paid = Number(r.amount_paid ?? 0);
      const debt = Math.max(0, Number(r.debt ?? 0));
      const patient = { id: r.patient_id, full_name: r.patient_name, phone: r.patient_phone ?? null };
      const g = map.get(r.patient_id) ?? { patient, items: [] as any[], total: 0, paid: 0, debt: 0, pendingDelivery: 0, lastDate: r.created_at };
      g.items.push({ ...r, _total: total, _debt: debt });
      g.total += total; g.paid += paid; g.debt += debt;
      if (!r.delivered_at && !r.is_voucher) g.pendingDelivery += 1;
      if (r.created_at > g.lastDate) g.lastDate = r.created_at;
      map.set(r.patient_id, g);
    });
    return Array.from(map.values()).filter((g) => g.debt > 0.009 || g.pendingDelivery > 0);
  }, [debtRows, pendingRows]);

  const filtered = grouped.filter((g) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (g.patient.full_name ?? "").toLowerCase().includes(s)
      || (g.patient.phone ?? "").includes(q)
      || !!phoneIds?.has(g.patient.id);
  }).sort((a, b) => b.debt - a.debt);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attentions"] });
    qc.invalidateQueries({ queryKey: ["audit_logs"] });
  };

  const openCharge = (g: typeof filtered[number], e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (g.debt <= 0.009) return;
    setChargeTarget(g);
  };

  const confirmCharge = async () => {
    const g = chargeTarget;
    if (!g) return;
    setBusy(g.patient.id);
    try {
      // Cobra todo el saldo del paciente en una transacción; la API registra la auditoría
      await apiPost("/api/attentions/charge-all", { patient_id: g.patient.id });
    } catch (e) {
      toast.error(translateError(e));
      setBusy(null);
      return;
    }
    toast.success("Saldo cobrado");
    setBusy(null);
    setChargeTarget(null);
    refresh();
  };

  const deliverAll = async (g: typeof filtered[number], e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (g.debt > 0.009) { toast.error(`No se puede entregar: saldo pendiente ${formatMoney(g.debt)}. Cobre primero.`); return; }
    const pending = g.items.filter((it) => !it.delivered_at && !it.is_voucher);
    if (pending.length === 0) { toast.info("Nada por entregar"); return; }
    setBusy(g.patient.id);
    const ids = pending.map((it) => it.id);
    let patient = g.patient;
    try {
      await apiPost("/api/attentions/deliver", { ids });
      // Celular para el comprobante (las filas de atenciones no lo traen)
      if (!patient.phone) patient = await apiGet<any>(`/api/patients/${g.patient.id}`).catch(() => g.patient);
    } catch (err) {
      toast.error(translateError(err));
      setBusy(null);
      return;
    }
    // Print ticket
    printDeliveryTicket({
      patient,
      studies: pending.map((it) => ({
        name: it.study_name ?? "Estudio",
        price: Number(it._total ?? 0),
        has_report: !!it.has_report,
        with_invoice: !!it.with_invoice,
      })),
      totalPaid: g.paid,
      totalDebt: g.debt,
    });
    toast.success(`${pending.length} estudio(s) entregados`);
    setBusy(null);
    refresh();
  };


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
            <div key={g.patient.id} className="flex items-center gap-3 py-2.5 px-1 hover:bg-accent/50 rounded-md transition-colors">
              <Link to="/app/patients/$id" params={{ id: g.patient.id }} className="flex-1 min-w-0">
                <div className="font-medium truncate">{g.patient.full_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {g.patient.phone ? `Cel: ${g.patient.phone} · ` : ""}Última: {formatDate(g.lastDate)}
                </div>
              </Link>
              <div className="text-right shrink-0 min-w-[110px]">
                {g.debt > 0.009 ? (
                  <>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Saldo</div>
                    <div className="font-mono font-bold text-amber-600 dark:text-amber-400">{formatMoney(g.debt)}</div>
                  </>
                ) : (
                  <Badge variant="secondary" className="gap-1"><Wallet className="h-3 w-3" />Saldo 0</Badge>
                )}
                {g.pendingDelivery > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">{g.pendingDelivery} x entregar</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                {g.debt > 0.009 && (
                  <Button size="sm" variant="outline" disabled={busy === g.patient.id} onClick={(e) => openCharge(g, e)}>
                    <Wallet className="h-3.5 w-3.5 mr-1" />Cobrar {formatMoney(g.debt)}
                  </Button>
                )}
                {g.pendingDelivery > 0 && (
                  <Button size="sm" disabled={busy === g.patient.id || g.debt > 0.009} onClick={(e) => deliverAll(g, e)} title={g.debt > 0.009 ? `Cobre el saldo pendiente (${formatMoney(g.debt)}) antes de entregar` : "Entregar e imprimir"}>
                    Entregar
                  </Button>
                )}
              </div>
              <Link to="/app/patients/$id" params={{ id: g.patient.id }}><ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /></Link>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground flex items-center gap-1 pt-1 border-t">
        <Wallet className="h-3 w-3" /> "Cobrar" salda la deuda; "Entregar" marca los estudios como entregados e imprime el comprobante.
      </div>

      <Dialog open={!!chargeTarget} onOpenChange={(o) => !o && setChargeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cobrar saldo</DialogTitle></DialogHeader>
          {chargeTarget && (
            <div className="space-y-4 py-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Paciente</div>
                <div className="font-medium">{chargeTarget.patient.full_name}</div>
              </div>
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-4 text-center">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Monto a cobrar</div>
                <div className="text-3xl font-bold font-mono text-amber-700 dark:text-amber-400">{formatMoney(chargeTarget.debt)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Total</div><div className="font-mono">{formatMoney(chargeTarget.total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Pagado</div><div className="font-mono">{formatMoney(chargeTarget.paid)}</div></div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setChargeTarget(null)} disabled={busy !== null}>Cancelar</Button>
            <Button onClick={confirmCharge} disabled={busy !== null}>
              <Wallet className="h-4 w-4 mr-1" />Cobrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
