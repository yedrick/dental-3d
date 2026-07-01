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

export const Route = createFileRoute("/app/third-party")({ component: ThirdPartyPage });

function ThirdPartyPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "CONTABILIDAD"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("third_party_payments", "payment_date");

  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({ provider_name: "", service_type: "", amount: 0, service_date: today, payment_date: today });

  const save = async () => {
    if (!f.provider_name || !f.service_type) return toast.error("Proveedor y servicio son requeridos");
    const { error } = await supabase.from("third_party_payments").insert({ ...f, created_by: user!.id });
    if (error) return toast.error(error.message);
    toast.success("Pago registrado");
    setOpen(false); setF({ provider_name: "", service_type: "", amount: 0, service_date: today, payment_date: today });
    qc.invalidateQueries({ queryKey: ["third_party_payments"] });
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
                <div><Label>Proveedor</Label><Input value={f.provider_name} onChange={(e) => setF({ ...f, provider_name: e.target.value })} /></div>
                <div><Label>Tipo de servicio</Label><Input value={f.service_type} onChange={(e) => setF({ ...f, service_type: e.target.value })} /></div>
                <div><Label>Monto</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fecha servicio</Label><Input type="date" value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></div>
                  <div><Label>Fecha pago</Label><Input type="date" value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Proveedor</TableHead><TableHead>Servicio</TableHead><TableHead>Monto</TableHead>
            <TableHead>F. Servicio</TableHead><TableHead>F. Pago</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.provider_name}</TableCell>
                <TableCell>{r.service_type}</TableCell>
                <TableCell>{formatMoney(r.amount)}</TableCell>
                <TableCell>{formatDate(r.service_date)}</TableCell>
                <TableCell>{formatDate(r.payment_date)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sin pagos.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
