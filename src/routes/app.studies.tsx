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
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/studies")({ component: StudiesPage });

function StudiesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const qc = useQueryClient();
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const { data: prices = [] } = useList<any>("study_prices");

  const [openS, setOpenS] = useState(false);
  const [openP, setOpenP] = useState(false);
  const [s, setS] = useState<any>({ name: "", description: "", fixed_commission: 0, active: true });
  const [p, setP] = useState<any>({ study_id: "", price_with_report: 0, price_without_report: 0, effective_date: new Date().toISOString().slice(0, 10), is_active: true });

  const studyMap = new Map(studies.map((x: any) => [x.id, x.name]));

  const saveStudy = async () => {
    const { error } = await supabase.from("studies").insert(s);
    if (error) return toast.error(error.message);
    toast.success("Estudio creado");
    setOpenS(false); setS({ name: "", description: "", fixed_commission: 0, active: true });
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const savePrice = async () => {
    if (!p.study_id) return toast.error("Selecciona un estudio");
    const { error } = await supabase.from("study_prices").insert(p);
    if (error) return toast.error(error.message);
    toast.success("Tarifa registrada (versiones anteriores desactivadas)");
    setOpenP(false); setP({ ...p, price_with_report: 0, price_without_report: 0 });
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
              <Dialog open={openS} onOpenChange={setOpenS}>
                <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo estudio</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Nuevo estudio</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div><Label>Nombre</Label><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
                    <div><Label>Descripción</Label><Input value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
                    <div>
                      <Label>Comisión fija (Bs)</Label>
                      <Input type="number" step="0.01" min="0" value={s.fixed_commission} onChange={(e) => setS({ ...s, fixed_commission: Number(e.target.value) })} />
                      <p className="text-[10px] text-muted-foreground mt-1">Se paga al doctor cuando NO tiene "Comisión por porcentaje" activo.</p>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={saveStudy} disabled={!s.name}>Guardar</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Descripción</TableHead><TableHead>Activo</TableHead></TableRow></TableHeader>
              <TableBody>
                {studies.map((x: any) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-medium">{x.name}</TableCell>
                    <TableCell>{x.description || "-"}</TableCell>
                    <TableCell><Badge variant={x.active ? "default" : "secondary"}>{x.active ? "Sí" : "No"}</Badge></TableCell>
                  </TableRow>
                ))}
                {studies.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Sin estudios.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="prices">
          {isAdmin && (
            <div className="mb-3">
              <Dialog open={openP} onOpenChange={setOpenP}>
                <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nueva tarifa</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Nueva tarifa</DialogTitle></DialogHeader>
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
              </TableRow></TableHeader>
              <TableBody>
                {prices.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{studyMap.get(r.study_id) || "-"}</TableCell>
                    <TableCell>{formatMoney(r.price_with_report)}</TableCell>
                    <TableCell>{formatMoney(r.price_without_report)}</TableCell>
                    <TableCell>{formatDate(r.effective_date)}</TableCell>
                    <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Vigente" : "Histórica"}</Badge></TableCell>
                  </TableRow>
                ))}
                {prices.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sin tarifas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
