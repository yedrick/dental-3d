import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { STALE } from "@/lib/query-config";
import { formatDate, formatMoney, todayLocal } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { uploadReceipt, ReceiptThumb } from "@/components/receipt-image";
import { TableSkeletonRows } from "@/components/table-skeleton";

export const Route = createFileRoute("/app/third-party")({ component: ThirdPartyPage });

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const LIMIT = 50;
const MAX_FILE = 5 * 1024 * 1024;

type Payment = {
  id: string;
  provider_name: string;
  service_type: string;
  amount: number;
  service_date: string;
  payment_date: string;
  receipt_url: string | null;
  created_by_name: string | null;
  created_at: string;
};

/** Año/mes seleccionados → rango from/to (YYYY-MM-DD). "Todos" los años = sin filtro. */
function periodRange(year: string, month: string): { from?: string; to?: string } {
  if (year === "all") return {};
  if (month === "all") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const m = Number(month);
  const last = new Date(Number(year), m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

function ThirdPartyPage() {
  const { can } = useAuth();
  // Los permisos los controla la API; aquí solo se oculta el botón
  const canEdit = can("third_party.create");
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));
  const [page, setPage] = useState(1);

  // Últimos años (ya no se deducen de las filas: la API filtra por período)
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i)), []);
  const range = periodRange(year, month);

  const { data: res, isLoading } = useQuery({
    queryKey: ["third_party_payments", range.from, range.to, page],
    queryFn: () => apiGet<Paged<Payment, { total: number }>>("/api/third-party-payments", { ...range, page, limit: LIMIT }),
    staleTime: STALE.money,
    placeholderData: keepPreviousData,
  });
  const rows = res?.data ?? [];
  const total = res?.summary?.total ?? 0;
  const count = res?.total ?? 0;

  const [open, setOpen] = useState(false);

  // Autocompletar: proveedores + último tipo de servicio de cada uno, de los pagos más recientes
  // (se pide solo al abrir el formulario)
  const { data: recent = [] } = useQuery({
    queryKey: ["third_party_payments", "providers"],
    queryFn: async () => (await apiGet<Paged<Payment>>("/api/third-party-payments", { page: 1, limit: 500 })).data,
    staleTime: STALE.money,
    enabled: open,
  });
  const providers = useMemo(() => {
    const m = new Map<string, { name: string; last_service: string }>();
    recent.forEach((r) => {
      if (r.provider_name && !m.has(r.provider_name.toLowerCase())) {
        m.set(r.provider_name.toLowerCase(), { name: r.provider_name, last_service: r.service_type ?? "" });
      }
    });
    return Array.from(m.values());
  }, [recent]);

  const [saving, setSaving] = useState(false);
  const newForm = () => {
    const today = todayLocal();
    return { provider_name: "", service_type: "", amount: 0, service_date: today, payment_date: today };
  };
  const [f, setF] = useState(newForm);
  const [file, setFile] = useState<File | null>(null);

  const onProviderChange = (v: string) => {
    const match = providers.find((p) => p.name.toLowerCase() === v.toLowerCase());
    setF((prev) => ({ ...prev, provider_name: v, service_type: match && !prev.service_type ? match.last_service : prev.service_type }));
  };

  const pickFile = (fl: File | null) => {
    if (fl && fl.size > MAX_FILE) {
      toast.error("El comprobante no puede superar 5 MB");
      return setFile(null);
    }
    setFile(fl);
  };

  const save = async () => {
    if (!f.provider_name.trim() || !f.service_type.trim()) return toast.error("Proveedor y servicio son requeridos");
    if (!(Number(f.amount) > 0)) return toast.error("El monto debe ser mayor a 0");
    if (!f.service_date || !f.payment_date) return toast.error("Fechas de servicio y pago requeridas");
    if (file && file.size > MAX_FILE) return toast.error("El comprobante no puede superar 5 MB");
    setSaving(true);
    try {
      // Primero se sube el comprobante; la API recibe solo su llave. created_by lo pone la API.
      const receipt_key = file ? await uploadReceipt(file) : null;
      await apiPost("/api/third-party-payments", {
        provider_name: f.provider_name.trim(),
        service_type: f.service_type.trim(),
        amount: Number(f.amount),
        service_date: f.service_date,
        payment_date: f.payment_date,
        receipt_key,
      });
      toast.success("Pago registrado");
      setOpen(false); setF(newForm()); setFile(null);
      qc.invalidateQueries({ queryKey: ["third_party_payments"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Pagos a terceros" description="Fecha de servicio no se puede modificar después de guardar."
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo pago</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo pago a tercero</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Proveedor</Label>
                  <Input list="providers-list" value={f.provider_name} onChange={(e) => onProviderChange(e.target.value)} placeholder="Escriba o seleccione..." />
                  <datalist id="providers-list">
                    {providers.map((p) => <option key={p.name} value={p.name} />)}
                  </datalist>
                </div>
                <div><Label>Tipo de servicio</Label><Input value={f.service_type} onChange={(e) => setF({ ...f, service_type: e.target.value })} /></div>
                <div><Label>Monto</Label><Input type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fecha servicio</Label><Input type="date" value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></div>
                  <div><Label>Fecha pago</Label><Input type="date" value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Comprobante (opcional, imagen o PDF, máx. 5 MB)</Label>
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  {file && <p className="text-xs text-muted-foreground mt-1">{file.name}</p>}
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <Label className="text-xs">Año</Label>
          <Select value={year} onValueChange={(v) => { setYear(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Mes</Label>
          <Select value={year === "all" ? "all" : month} onValueChange={(v) => { setMonth(v); setPage(1); }} disabled={year === "all"}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Card className="ml-auto p-3 px-5">
          <div className="text-xs text-muted-foreground">Total del período</div>
          <div className="text-2xl font-bold">{formatMoney(total)}</div>
          <div className="text-xs text-muted-foreground">{count} pago(s)</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Proveedor</TableHead><TableHead>Servicio</TableHead><TableHead>Monto</TableHead>
            <TableHead>F. Servicio</TableHead><TableHead>F. Pago</TableHead><TableHead>Comprobante</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.provider_name}</TableCell>
                <TableCell>{r.service_type}</TableCell>
                <TableCell>{formatMoney(r.amount)}</TableCell>
                <TableCell>{formatDate(r.service_date)}</TableCell>
                <TableCell>{formatDate(r.payment_date)}</TableCell>
                <TableCell><ReceiptThumb path={r.receipt_url} /></TableCell>
              </TableRow>
            ))}
            {isLoading && rows.length === 0 && <TableSkeletonRows cols={6} />}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center py-6">Sin pagos en el período.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <Pager page={page} pages={res?.pages ?? 1} onChange={setPage} />
      </Card>
    </div>
  );
}

function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
      <span>Página {page} de {pages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
