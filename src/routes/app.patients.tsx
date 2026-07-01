import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, calcAge, formatDate } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/patients")({ component: PatientsPage });

function PatientsPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "RECEPCION"]);
  const qc = useQueryClient();
  const { data = [], isLoading } = useList<any>("patients");
  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const activeDoctors = doctors.filter((d: any) => d.status);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ doctor_id: "", full_name: "", birth_date: "", phone: "" });

  const doctorMap = new Map(doctors.map((d: any) => [d.id, d.full_name]));

  const save = async () => {
    if (!form.doctor_id) return toast.error("Doctor requerido");
    const { error } = await supabase.from("patients").insert({
      doctor_id: form.doctor_id,
      full_name: form.full_name,
      birth_date: form.birth_date || null,
      phone: form.phone || null,
      created_by: user!.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Paciente registrado");
    setOpen(false);
    setForm({ doctor_id: "", full_name: "", birth_date: "", phone: "" });
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  return (
    <div>
      <PageHeader
        title="Pacientes"
        description="Todo paciente queda vinculado a un doctor remitente."
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo paciente</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo paciente</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Doctor remitente *</Label>
                  <Select value={form.doctor_id} onValueChange={(v) => setForm({ ...form, doctor_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona un doctor" /></SelectTrigger>
                    <SelectContent>
                      {activeDoctors.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Nombre completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fecha nacimiento (YYYY-MM-DD)</Label><Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
                  <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!form.doctor_id || !form.full_name}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Paciente</TableHead><TableHead>Doctor</TableHead><TableHead>Nacimiento</TableHead>
            <TableHead>Edad</TableHead><TableHead>Teléfono</TableHead><TableHead>Registrado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6}>Cargando…</TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sin pacientes.</TableCell></TableRow>}
            {data.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.full_name}</TableCell>
                <TableCell>{doctorMap.get(p.doctor_id) || "-"}</TableCell>
                <TableCell>{formatDate(p.birth_date)}</TableCell>
                <TableCell>{calcAge(p.birth_date)}</TableCell>
                <TableCell>{p.phone || "-"}</TableCell>
                <TableCell>{formatDate(p.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
