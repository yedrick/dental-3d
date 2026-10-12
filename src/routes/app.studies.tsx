import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate, todayLocal } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { StudiesImport } from "@/components/studies-import";
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
const emptyPrice = { id: null as string | null, study_id: "", price_with_report: 0, price_without_report: 0, effective_date: "", is_active: true };

function StudiesPage() {
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const { can } = useAuth();
  // Los permisos los controla la API; aquí solo se ocultan los botones
  const canCreate = can("studies.create");
  const canEdit = can("studies.edit");
  const qc = useQueryClient();
  const { data: studies = [] } = useQuery({
    queryKey: ["studies"],
    queryFn: () => apiGet<any[]>("/api/studies"),
    staleTime: STALE.catalog,
  });
  // Todas las tarifas (historial) en una sola petición
  const { data: prices = [] } = useQuery({
    queryKey: ["study_prices"],
    queryFn: () => apiGet<any[]>("/api/study-prices"),
    staleTime: STALE.catalog,
  });

  const [openS, setOpenS] = useState(false);
  const [openP, setOpenP] = useState(false);
  const [s, setS] = useState<any>(emptyStudy);
  const [p, setP] = useState<any>(emptyPrice);

  const studyMap = new Map(studies.map((x: any) => [x.id, x.name]));
  // Las tarifas cambian la "tarifa activa" que trae la lista de estudios
  const refreshPrices = () => {
    qc.invalidateQueries({ queryKey: ["study_prices"] });
    qc.invalidateQueries({ queryKey: ["studies"] });
  };

  const openNewStudy = () => { setS(emptyStudy); setOpenS(true); };
  const openEditStudy = (x: any) => { setS({ id: x.id, name: x.name, description: x.description || "", fixed_commission: x.fixed_commission ?? 0, active: x.active }); setOpenS(true); };

  const saveStudy = async () => {
    const payload = { name: s.name, description: s.description || null, fixed_commission: s.fixed_commission, active: s.active };
    try {
      if (s.id) await apiPatch(`/api/studies/${s.id}`, payload);
      else await apiPost("/api/studies", payload);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(s.id ? "Estudio actualizado" : "Estudio creado");
    setOpenS(false);
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const toggleStudy = async (x: any) => {
    try {
      await apiPatch(`/api/studies/${x.id}`, { active: !x.active });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(!x.active ? "Estudio activado" : "Estudio desactivado");
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const deleteStudy = async (x: any) => {
    try {
      await apiDelete(`/api/studies/${x.id}`);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Estudio eliminado");
    qc.invalidateQueries({ queryKey: ["studies"] });
    qc.invalidateQueries({ queryKey: ["study_prices"] });
  };

  const openNewPrice = () => { setP({ ...emptyPrice, effective_date: todayLocal() }); setOpenP(true); };
  const openEditPrice = (r: any) => { setP({ id: r.id, study_id: r.study_id, price_with_report: r.price_with_report, price_without_report: r.price_without_report, effective_date: r.effective_date, is_active: r.is_active }); setOpenP(true); };
  const savePrice = async () => {
    if (!p.study_id) return toast.error("Selecciona un estudio");
    const payload = { price_with_report: p.price_with_report, price_without_report: p.price_without_report, effective_date: p.effective_date, is_active: p.is_active };
    try {
      if (p.id) await apiPatch(`/api/study-prices/${p.id}`, payload);
      else await apiPost(`/api/studies/${p.study_id}/prices`, payload);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(p.id ? "Tarifa actualizada" : "Tarifa registrada");
    setOpenP(false);
    refreshPrices();
  };
  const togglePrice = async (r: any) => {
    try {
      await apiPatch(`/api/study-prices/${r.id}`, { is_active: !r.is_active });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(!r.is_active ? "Tarifa activada" : "Tarifa desactivada");
    refreshPrices();
  };
  const deletePrice = async (r: any) => {
    try {
      await apiDelete(`/api/study-prices/${r.id}`);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Tarifa eliminada");
    refreshPrices();
  };

  return (
    <div>
      <PageHeader
        title="Estudios y tarifas"
        description="El precio se toma siempre de la tarifa activa."
        action={canCreate && canEdit && <StudiesImport studies={studies} />}
      />
      <Tabs defaultValue="studies">
        <TabsList>
          <TabsTrigger value="studies">Estudios</TabsTrigger>
          <TabsTrigger value="prices">Tarifas</TabsTrigger>
        </TabsList>

        <TabsContent value="studies">
          {canCreate && (
            <div className="mb-3">
              <Button onClick={openNewStudy}><Plus className="mr-1 h-4 w-4" />Nuevo estudio</Button>
              <Dialog open={openS} onOpenChange={setOpenS}>
                <DialogContent>
                  <DialogHeader><DialogTitle>{s.id ? "Editar estudio" : "Nuevo estudio"}</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div><Label htmlFor={`${uid}-name`}>Nombre</Label><Input id={`${uid}-name`} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
                    <div><Label htmlFor={`${uid}-desc`}>Descripción</Label><Input id={`${uid}-desc`} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
                    <div>
                      <Label htmlFor={`${uid}-commission`}>Comisión fija (Bs)</Label>
                      <Input id={`${uid}-commission`} type="number" step="0.01" min="0" value={s.fixed_commission} onChange={(e) => setS({ ...s, fixed_commission: Number(e.target.value) })} />
                      <p className="text-[10px] text-muted-foreground mt-1">Se paga al doctor cuando NO tiene "Comisión por porcentaje" activo.</p>
                    </div>
                    <div className="flex items-center gap-2"><Switch id={`${uid}-active`} checked={s.active} onCheckedChange={(v) => setS({ ...s, active: v })} /><Label htmlFor={`${uid}-active`}>Activo</Label></div>
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
                {canEdit && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {studies.map((x: any) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-medium">{x.name}</TableCell>
                    <TableCell>{x.description || "-"}</TableCell>
                    <TableCell className="text-right">{formatMoney(x.fixed_commission ?? 0)}</TableCell>
                    <TableCell>
                      {canEdit
                        ? <Switch checked={x.active} aria-label={`Activo: ${x.name}`} onCheckedChange={() => toggleStudy(x)} />
                        : <Badge variant={x.active ? "default" : "secondary"}>{x.active ? "Sí" : "No"}</Badge>}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" aria-label={`Editar ${x.name}`} onClick={() => openEditStudy(x)}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" aria-label={`Eliminar ${x.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>¿Eliminar {x.name}?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer y elimina también sus tarifas. Si el estudio tiene atenciones registradas no se podrá eliminar: desactívalo en su lugar.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteStudy(x)}>Eliminar</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {studies.length === 0 && <TableRow><TableCell colSpan={canEdit ? 5 : 4} className="text-muted-foreground">Sin estudios.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="prices">
          {canEdit && (
            <div className="mb-3">
              <Button onClick={openNewPrice}><Plus className="mr-1 h-4 w-4" />Nueva tarifa</Button>
              <Dialog open={openP} onOpenChange={setOpenP}>
                <DialogContent>
                  <DialogHeader><DialogTitle>{p.id ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div>
                      <Label htmlFor={`${uid}-pstudy`}>Estudio</Label>
                      <Select value={p.study_id} onValueChange={(v) => setP({ ...p, study_id: v })} disabled={!!p.id}>
                        <SelectTrigger id={`${uid}-pstudy`}><SelectValue placeholder="Selecciona un estudio" /></SelectTrigger>
                        <SelectContent>{studies.map((x: any) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label htmlFor={`${uid}-pwith`}>Precio con informe</Label><Input id={`${uid}-pwith`} type="number" step="0.01" value={p.price_with_report} onChange={(e) => setP({ ...p, price_with_report: Number(e.target.value) })} /></div>
                      <div><Label htmlFor={`${uid}-pwithout`}>Precio sin informe</Label><Input id={`${uid}-pwithout`} type="number" step="0.01" value={p.price_without_report} onChange={(e) => setP({ ...p, price_without_report: Number(e.target.value) })} /></div>
                    </div>
                    <div><Label htmlFor={`${uid}-pdate`}>Fecha efectiva</Label><Input id={`${uid}-pdate`} type="date" value={p.effective_date} onChange={(e) => setP({ ...p, effective_date: e.target.value })} /></div>
                    <div className="flex items-center gap-2"><Switch id={`${uid}-pactive`} checked={p.is_active} onCheckedChange={(v) => setP({ ...p, is_active: v })} /><Label htmlFor={`${uid}-pactive`}>Vigente (desactiva las anteriores del mismo estudio)</Label></div>
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
                {canEdit && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {prices.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{studyMap.get(r.study_id) || "-"}</TableCell>
                    <TableCell>{formatMoney(r.price_with_report)}</TableCell>
                    <TableCell>{formatMoney(r.price_without_report)}</TableCell>
                    <TableCell>{formatDate(r.effective_date)}</TableCell>
                    <TableCell>
                      {canEdit
                        ? <Switch checked={r.is_active} aria-label={`Vigente: tarifa de ${studyMap.get(r.study_id) || "estudio"} (${formatDate(r.effective_date)})`} onCheckedChange={() => togglePrice(r)} />
                        : <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Vigente" : "Histórica"}</Badge>}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" aria-label={`Editar tarifa de ${studyMap.get(r.study_id) || "estudio"}`} onClick={() => openEditPrice(r)}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" aria-label={`Eliminar tarifa de ${studyMap.get(r.study_id) || "estudio"}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>¿Eliminar tarifa?</AlertDialogTitle><AlertDialogDescription>Se eliminará de forma permanente.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deletePrice(r)}>Eliminar</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {prices.length === 0 && <TableRow><TableCell colSpan={canEdit ? 6 : 5} className="text-muted-foreground">Sin tarifas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
