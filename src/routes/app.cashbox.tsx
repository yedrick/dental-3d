import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { STALE } from "@/lib/query-config";
import { formatDateTime, formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/app/cashbox")({ component: CashboxPage });

type Movement = {
  id: string;
  description: string;
  income: number;
  expense: number;
  balance: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};
type CashSummary = { income: number; expense: number; balance: number };

const LIMIT = 50;
const emptyForm = { description: "", income: 0, expense: 0 };

function CashboxPage() {
  const { can } = useAuth();
  // Los permisos los controla la API; aquí solo se oculta el botón
  const canEdit = can("cashbox.create");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data: res, isLoading } = useQuery({
    queryKey: ["cashbox", page],
    queryFn: () => apiGet<Paged<Movement, CashSummary>>("/api/cashbox", { page, limit: LIMIT }),
    staleTime: STALE.money,
    placeholderData: keepPreviousData,
  });
  const rows = res?.data ?? [];
  // Saldo actual de la caja (lo calcula el servidor, no depende de la página)
  const balance = res?.summary?.balance ?? 0;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState(emptyForm);

  const save = async () => {
    if (!f.description.trim()) return toast.error("Descripción requerida");
    const income = Number(f.income) || 0;
    const expense = Number(f.expense) || 0;
    if (income < 0 || expense < 0) return toast.error("Los montos no pueden ser negativos");
    if ((income > 0) === (expense > 0)) return toast.error("Registra un ingreso o un gasto (uno de los dos, mayor a 0)");
    setSaving(true);
    try {
      // created_by y el saldo los pone la API; se envía solo el monto mayor a 0
      await apiPost("/api/cashbox", income > 0 ? { description: f.description.trim(), income } : { description: f.description.trim(), expense });
    } catch (e) {
      return toast.error(translateError(e));
    } finally {
      setSaving(false);
    }
    toast.success("Movimiento registrado");
    setOpen(false); setF(emptyForm); setPage(1);
    qc.invalidateQueries({ queryKey: ["cashbox"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <div>
      <PageHeader title="Caja chica" description="Ingresos y gastos con saldo automático."
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo movimiento</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo movimiento</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Descripción</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Ingreso</Label><Input type="number" step="0.01" min="0" value={f.income} onChange={(e) => setF({ ...f, income: Number(e.target.value) })} /></div>
                  <div><Label>Gasto</Label><Input type="number" step="0.01" min="0" value={f.expense} onChange={(e) => setF({ ...f, expense: Number(e.target.value) })} /></div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Registra un ingreso o un gasto (solo uno). Los movimientos no se pueden editar ni eliminar: para corregir, registra un movimiento nuevo.
                </p>
              </div>
              <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm text-muted-foreground">Saldo actual</CardTitle></CardHeader>
        <CardContent><div className="text-3xl font-bold">{formatMoney(balance)}</div></CardContent>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Ingreso</TableHead>
            <TableHead>Gasto</TableHead><TableHead>Saldo</TableHead><TableHead>Usuario</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.created_at)}</TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell className="text-green-600">{Number(r.income) ? formatMoney(r.income) : "-"}</TableCell>
                <TableCell className="text-destructive">{Number(r.expense) ? formatMoney(r.expense) : "-"}</TableCell>
                <TableCell className="font-medium">{formatMoney(r.balance)}</TableCell>
                <TableCell className="text-muted-foreground">{r.created_by_name ?? "-"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">{isLoading ? "Cargando…" : "Sin movimientos."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <Pager page={page} pages={res?.pages ?? 1} total={res?.total ?? 0} onChange={setPage} />
      </Card>
    </div>
  );
}

function Pager({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
      <span>{total} movimiento(s) · Página {page} de {pages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
