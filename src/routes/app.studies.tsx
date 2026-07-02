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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/studies")({ component: StudiesPage });

const emptyStudy = { id: null as string | null, name: "", description: "", fixed_commission: 0, active: true };
const emptyPrice = { id: null as string | null, study_id: "", price_with_report: 0, price_without_report: 0, effective_date: new Date().toISOString().slice(0, 10), is_active: true };

function StudiesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const qc = useQueryClient();
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const { data: prices = [] } = useList<any>("study_prices");

  const [openS, setOpenS] = useState(false);
  const [openP, setOpenP] = useState(false);
  const [s, setS] = useState<any>(emptyStudy);
  const [p, setP] = useState<any>(emptyPrice);

  const studyMap = new Map(studies.map((x: any) => [x.id, x.name]));

  const openNewStudy = () => { setS(emptyStudy); setOpenS(true); };
  const openEditStudy = (x: any) => { setS({ id: x.id, name: x.name, description: x.description || "", fixed_commission: x.fixed_commission ?? 0, active: x.active }); setOpenS(true); };

  const saveStudy = async () => {
    const payload = { name: s.name, description: s.description, fixed_commission: s.fixed_commission, active: s.active };
    const { error } = s.id
      ? await supabase.from("studies").update(payload).eq("id", s.id)
      : await supabase.from("studies").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(s.id ? "Estudio actualizado" : "Estudio creado");
    setOpenS(false);
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const toggleStudy = async (x: any) => {
    const { error } = await supabase.from("studies").update({ active: !x.active }).eq("id", x.id);
    if (error) return toast.error(error.message);
    toast.success(!x.active ? "Estudio activado" : "Estudio desactivado");
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const deleteStudy = async (x: any) => {
    const { error } = await supabase.from("studies").delete().eq("id", x.id);
    if (error) return toast.error(error.message);
    toast.success("Estudio eliminado");
    qc.invalidateQueries({ queryKey: ["studies"] });
  };

  const openNewPrice = () => { setP(emptyPrice); setOpenP(true); };
  const openEditPrice = (r: any) => { setP({ id: r.id, study_id: r.study_id, price_with_report: r.price_with_report, price_without_report: r.price_without_report, effective_date: r.effective_date, is_active: r.is_active }); setOpenP(true); };
  const savePrice = async () => {
    if (!p.study_id) return toast.error("Selecciona un estudio");
    const payload = { study_id: p.study_id, price_with_report: p.price_with_report, price_without_report: p.price_without_report, effective_date: p.effective_date, is_active: p.is_active };
    const { error } = p.id
      ? await supabase.from("study_prices").update(payload).eq("id", p.id)
      : await supabase.from("study_prices").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(p.id ? "Tarifa actualizada" : "Tarifa registrada");
    setOpenP(false);
    qc.invalidateQueries({ queryKey: ["study_prices"] });
  };
  const togglePrice = async (r: any) => {
    const { error } = await supabase.from("study_prices").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(!r.is_active ? "Tarifa activada" : "Tarifa desactivada");
    qc.invalidateQueries({ queryKey: ["study_prices"] });
  };
  const deletePrice = async (r: any) => {
    const { error } = await supabase.from("study_prices").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Tarifa eliminada");
    qc.invalidateQueries({ queryKey: ["study_prices"] });
  };

  return (
    <div>
      <PageHeader title="Estudios y tarifas" description="El precio se toma siempre de la tarifa activa." />
      <Tabs defaultValue="studies">
        <TabsList>
          <TabsTrigger value="studies">Estudios</TabsTrigger>
          <TabsTrigger value="prices">Tarifas</TabsTrigger>
        </TabsList>

        <TabsContent value="studies">
          {isAdmin && (
            <div className="mb-3">
              <Button onClick={openNewStudy}><Plus className="mr-1 h-4 w-4" />Nuevo estudio</Button>
              <Dialog open={openS} onOpenChange={setOpenS}>
                <DialogContent>
                  <DialogHeader><DialogTitle>{s.id ? "Editar estudio" : "Nuevo estudio"}</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div><Label>Nombre</Label><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
                    <div><Label>Descripción</Label><Input value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
                    <div>
                      <Label>Comisión fija (Bs)</Label>
                      <Input type="number" step="0.01" min="0" value={s.fixed_commission} onChange={(e) => setS({ ...s, fixed_commission: Number(e.target.value) })} />
                      <p className="text-[10px] text-muted-foreground mt-1">Se paga al doctor cuando NO tiene "Comisión por porcentaje" activo.</p>
                    </div>
                    <div className="flex items-center gap-2"><Switch checked={s.active} onCheckedChange={(v) => setS({ ...s, active: v })} /><Label>Activo</Label></div>
                  </div>
                  <DialogFooter><Button onClick={saveStudy} disabled={!s.name}>Guardar</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nombre</TableHead><TableHead>Descripción</TableHead>
                <TableHead className="text-right">Comisión fija</TableHead>
                <TableHead>Activo</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {studies.map((x: any) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-medium">{x.name}</TableCell>
                    <TableCell>{x.description || "-"}</TableCell>
                    <TableCell className="text-right">{formatMoney(x.fixed_commission ?? 0)}</TableCell>
                    <TableCell>
                      {isAdmin
                        ? <Switch checked={x.active} onCheckedChange={() => toggleStudy(x)} />
                        : <Badge variant={x.active ? "default" : "secondary"}>{x.active ? "Sí" : "No"}</Badge>}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditStudy(x)}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>¿Eliminar {x.name}?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer. Si el estudio tiene registros, se recomienda desactivarlo.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteStudy(x)}>Eliminar</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {studies.length === 0 && <TableRow><TableCell colSpan={isAdmin ? 5 : 4} className="text-muted-foreground">Sin estudios.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="prices">
          {isAdmin && (
            <div className="mb-3">
              <Button onClick={openNewPrice}><Plus className="mr-1 h-4 w-4" />Nueva tarifa</Button>
              <Dialog open={openP} onOpenChange={setOpenP}>
                <DialogContent>
                  <DialogHeader><DialogTitle>{p.id ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div>
                      <Label>Estudio</Label>
                      <Select value={p.study_id} onValueChange={(v) => setP({ ...p, study_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Selecciona un estudio" /></SelectTrigger>
                        <SelectContent>{studies.map((x: any) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Precio con informe</Label><Input type="number" step="0.01" value={p.price_with_report} onChange={(e) => setP({ ...p, price_with_report: Number(e.target.value) })} /></div>
                      <div><Label>Precio sin informe</Label><Input type="number" step="0.01" value={p.price_without_report} onChange={(e) => setP({ ...p, price_without_report: Number(e.target.value) })} /></div>
                    </div>
                    <div><Label>Fecha efectiva</Label><Input type="date" value={p.effective_date} onChange={(e) => setP({ ...p, effective_date: e.target.value })} /></div>
                    <div className="flex items-center gap-2"><Switch checked={p.is_active} onCheckedChange={(v) => setP({ ...p, is_active: v })} /><Label>Vigente (desactiva las anteriores del mismo estudio)</Label></div>
                  </div>
                  <DialogFooter><Button onClick={savePrice}>Guardar</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Estudio</TableHead><TableHead>Con informe</TableHead><TableHead>Sin informe</TableHead>
                <TableHead>Vigencia</TableHead><TableHead>Activa</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {prices.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{studyMap.get(r.study_id) || "-"}</TableCell>
                    <TableCell>{formatMoney(r.price_with_report)}</TableCell>
                    <TableCell>{formatMoney(r.price_without_report)}</TableCell>
                    <TableCell>{formatDate(r.effective_date)}</TableCell>
                    <TableCell>
                      {isAdmin
                        ? <Switch checked={r.is_active} onCheckedChange={() => togglePrice(r)} />
                        : <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Vigente" : "Histórica"}</Badge>}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditPrice(r)}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>¿Eliminar tarifa?</AlertDialogTitle><AlertDialogDescription>Se eliminará de forma permanente.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deletePrice(r)}>Eliminar</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {prices.length === 0 && <TableRow><TableCell colSpan={isAdmin ? 6 : 5} className="text-muted-foreground">Sin tarifas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
