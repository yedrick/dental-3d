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
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/app/deposits")({ component: DepositsPage });

function DepositsPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "CAJA", "CONTABILIDAD"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("bank_deposits", "deposit_date");

  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ amount: 0, deposit_date: new Date().toISOString().slice(0, 10), reference: "" });

  const save = async () => {
    const { error } = await supabase.from("bank_deposits").insert({ ...f, created_by: user!.id });
    if (error) return toast.error(error.message);
    toast.success("Depósito registrado");
    setOpen(false); setF({ amount: 0, deposit_date: new Date().toISOString().slice(0, 10), reference: "" });
    qc.invalidateQueries({ queryKey: ["bank_deposits"] });
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
                <div><Label>Monto</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
                <div><Label>Fecha depósito</Label><Input type="date" value={f.deposit_date} onChange={(e) => setF({ ...f, deposit_date: e.target.value })} /></div>
                <div><Label>Referencia</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Monto</TableHead><TableHead>Referencia</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.deposit_date)}</TableCell>
                <TableCell>{formatMoney(r.amount)}</TableCell>
                <TableCell>{r.reference || "-"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Sin depósitos.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
