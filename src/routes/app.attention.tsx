import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, formatMoney, formatDate } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/attention")({ component: AttentionPage });

function AttentionPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "RECEPCION", "CAJA"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("patient_studies");
  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const { data: studies = [] } = useList<any>("studies", "name", true);

  const patMap = new Map(patients.map((p: any) => [p.id, p.full_name]));
  const stMap = new Map(studies.map((s: any) => [s.id, s.name]));

  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ patient_id: "", study_id: "", has_report: false, is_voucher: false, payment_method: "cash", invoice_number: "", delivery_date: "" });

  const save = async () => {
    if (!f.patient_id || !f.study_id) return toast.error("Paciente y estudio son obligatorios");
    const { error } = await supabase.from("patient_studies").insert({
      patient_id: f.patient_id,
      study_id: f.study_id,
      has_report: f.has_report,
      is_voucher: f.is_voucher,
      payment_method: f.is_voucher ? null : f.payment_method,
      invoice_number: f.invoice_number || null,
      delivery_date: f.delivery_date || null,
      created_by: user!.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Atención registrada (precio y comisión calculados)");
    setOpen(false);
    setF({ patient_id: "", study_id: "", has_report: false, is_voucher: false, payment_method: "cash", invoice_number: "", delivery_date: "" });
    qc.invalidateQueries();
  };

  return (
    <div>
      <PageHeader title="Atenciones" description="Registro de estudios realizados. Precio y comisión son automáticos."
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nueva atención</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Registrar atención</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Paciente</Label>
                  <Select value={f.patient_id} onValueChange={(v) => setF({ ...f, patient_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona paciente" /></SelectTrigger>
                    <SelectContent>{patients.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Estudio</Label>
                  <Select value={f.study_id} onValueChange={(v) => setF({ ...f, study_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona estudio" /></SelectTrigger>
                    <SelectContent>{studies.filter((s: any) => s.active).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2"><Switch checked={f.has_report} onCheckedChange={(v) => setF({ ...f, has_report: v })} /><Label>Con informe</Label></div>
                  <div className="flex items-center gap-2"><Switch checked={f.is_voucher} onCheckedChange={(v) => setF({ ...f, is_voucher: v })} /><Label>Vale (sin monto)</Label></div>
                </div>
                {!f.is_voucher && (
                  <div>
                    <Label>Forma de pago</Label>
                    <Select value={f.payment_method} onValueChange={(v) => setF({ ...f, payment_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Efectivo</SelectItem>
                        <SelectItem value="qr">QR</SelectItem>
                        <SelectItem value="card">Tarjeta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>N° Factura</Label><Input value={f.invoice_number} onChange={(e) => setF({ ...f, invoice_number: e.target.value })} /></div>
                  <div><Label>Fecha entrega</Label><Input type="date" value={f.delivery_date} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></div>
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
            <TableHead>Fecha</TableHead><TableHead>Paciente</TableHead><TableHead>Estudio</TableHead>
            <TableHead>Precio</TableHead><TableHead>Informe</TableHead><TableHead>Pago</TableHead>
            <TableHead>Factura</TableHead><TableHead>Entrega</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.created_at)}</TableCell>
                <TableCell>{patMap.get(r.patient_id) || "-"}</TableCell>
                <TableCell>{stMap.get(r.study_id) || "-"}</TableCell>
                <TableCell>{formatMoney(r.price)}</TableCell>
                <TableCell>{r.is_voucher ? <Badge variant="secondary">Vale</Badge> : (r.has_report ? "Con" : "Sin")}</TableCell>
                <TableCell>{r.payment_method || "-"}</TableCell>
                <TableCell>{r.invoice_number || "-"}</TableCell>
                <TableCell>{formatDate(r.delivery_date)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Sin atenciones registradas.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
