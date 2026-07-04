import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, formatDate, formatMoney } from "@/lib/data";
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

function CashboxPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "CAJA"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("cashbox");
  const balance = rows[0]?.balance ?? 0;

  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ description: "", income: 0, expense: 0 });

  const save = async () => {
    if (!f.description) return toast.error("Descripción requerida");
    const { error } = await supabase.from("cashbox").insert({ ...f, created_by: user!.id });
    if (error) return toast.error(translateError(error));
    toast.success("Movimiento registrado");
    setOpen(false); setF({ description: "", income: 0, expense: 0 });
    qc.invalidateQueries({ queryKey: ["cashbox"] });
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
                  <div><Label>Ingreso</Label><Input type="number" step="0.01" value={f.income} onChange={(e) => setF({ ...f, income: Number(e.target.value) })} /></div>
                  <div><Label>Gasto</Label><Input type="number" step="0.01" value={f.expense} onChange={(e) => setF({ ...f, expense: Number(e.target.value) })} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={save}>Guardar</Button></DialogFooter>
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
            <TableHead>Gasto</TableHead><TableHead>Saldo</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.created_at)}</TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell className="text-green-600">{Number(r.income) ? formatMoney(r.income) : "-"}</TableCell>
                <TableCell className="text-destructive">{Number(r.expense) ? formatMoney(r.expense) : "-"}</TableCell>
                <TableCell className="font-medium">{formatMoney(r.balance)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sin movimientos.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
