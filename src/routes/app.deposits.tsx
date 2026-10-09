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

export const Route = createFileRoute("/app/deposits")({ component: DepositsPage });

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const LIMIT = 50;
const MAX_FILE = 5 * 1024 * 1024;

type Deposit = {
  id: string;
  amount: number;
  deposit_date: string;
  reference: string | null;
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

function DepositsPage() {
  const { can } = useAuth();
  // Los permisos los controla la API; aquí solo se oculta el botón
  const canEdit = can("deposits.create");
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));
  const [page, setPage] = useState(1);

  // Últimos años (ya no se deducen de las filas: la API filtra por período)
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i)), []);
  const range = periodRange(year, month);

  const { data: res, isLoading } = useQuery({
    queryKey: ["bank_deposits", range.from, range.to, page],
    queryFn: () => apiGet<Paged<Deposit, { total: number }>>("/api/deposits", { ...range, page, limit: LIMIT }),
    staleTime: STALE.money,
    placeholderData: keepPreviousData,
  });
  const rows = res?.data ?? [];
  const total = res?.summary?.total ?? 0;
  const count = res?.total ?? 0;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyForm = { amount: 0, deposit_date: todayLocal(), reference: "" };
  const [f, setF] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const pickFile = (fl: File | null) => {
    if (fl && fl.size > MAX_FILE) {
      toast.error("El comprobante no puede superar 5 MB");
      return setFile(null);
    }
    setFile(fl);
  };

  const save = async () => {
    if (!(Number(f.amount) > 0)) return toast.error("El monto debe ser mayor a 0");
    if (!f.deposit_date) return toast.error("Fecha de depósito requerida");
    if (file && file.size > MAX_FILE) return toast.error("El comprobante no puede superar 5 MB");
    setSaving(true);
    try {
      // Primero se sube el comprobante; la API recibe solo su llave. created_by lo pone la API.
      const receipt_key = file ? await uploadReceipt(file) : null;
      await apiPost("/api/deposits", {
        amount: Number(f.amount),
        deposit_date: f.deposit_date,
        reference: f.reference.trim() || null,
        receipt_key,
      });
      toast.success("Depósito registrado");
      setOpen(false); setF({ ...emptyForm, deposit_date: todayLocal() }); setFile(null);
      qc.invalidateQueries({ queryKey: ["bank_deposits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Depósitos bancarios"
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo depósito</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo depósito</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Monto</Label><Input type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
                <div><Label>Fecha depósito</Label><Input type="date" value={f.deposit_date} onChange={(e) => setF({ ...f, deposit_date: e.target.value })} /></div>
                <div><Label>Referencia</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
                <div>
                  <Label>Comprobante (imagen o PDF, máx. 5 MB)</Label>
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
          <div className="text-xs text-muted-foreground">{count} depósito(s)</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Monto</TableHead><TableHead>Referencia</TableHead><TableHead>Comprobante</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.deposit_date)}</TableCell>
                <TableCell className="font-medium">{formatMoney(r.amount)}</TableCell>
                <TableCell>{r.reference || "-"}</TableCell>
                <TableCell><ReceiptThumb path={r.receipt_url} /></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center py-6">{isLoading ? "Cargando…" : "Sin depósitos en el período."}</TableCell></TableRow>
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
