import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { uploadReceipt, ReceiptThumb } from "@/components/receipt-image";

export const Route = createFileRoute("/app/third-party")({ component: ThirdPartyPage });

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function ThirdPartyPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "CONTABILIDAD"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("third_party_payments", "payment_date");

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));

  const years = useMemo(() => {
    const s = new Set<string>([String(now.getFullYear())]);
    rows.forEach((r: any) => r.payment_date && s.add(r.payment_date.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r: any) => {
    if (!r.payment_date) return false;
    const [y, m] = r.payment_date.split("-");
    if (year !== "all" && y !== year) return false;
    if (month !== "all" && String(Number(m)) !== month) return false;
    return true;
  }), [rows, year, month]);

  const total = filtered.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  // Autocomplete: providers + last service_type per provider
  const providers = useMemo(() => {
    const m = new Map<string, { name: string; last_service: string }>();
    rows.forEach((r: any) => {
      if (r.provider_name && !m.has(r.provider_name.toLowerCase())) {
        m.set(r.provider_name.toLowerCase(), { name: r.provider_name, last_service: r.service_type ?? "" });
      }
    });
    return Array.from(m.values());
  }, [rows]);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const emptyForm = { provider_name: "", service_type: "", amount: 0, service_date: today, payment_date: today };
  const [f, setF] = useState<any>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const onProviderChange = (v: string) => {
    const match = providers.find((p) => p.name.toLowerCase() === v.toLowerCase());
    setF((prev: any) => ({ ...prev, provider_name: v, service_type: match && !prev.service_type ? match.last_service : prev.service_type }));
  };

  const save = async () => {
    if (!f.provider_name || !f.service_type) return toast.error("Proveedor y servicio son requeridos");
    setSaving(true);
    try {
      let receipt_url: string | null = null;
      if (file) receipt_url = await uploadReceipt(file, "third-party");
      const { error } = await supabase.from("third_party_payments").insert({ ...f, receipt_url, created_by: user!.id });
      if (error) throw error;
      toast.success("Pago registrado");
      setOpen(false); setF(emptyForm); setFile(null);
      qc.invalidateQueries({ queryKey: ["third_party_payments"] });
    } catch (e: any) {
      toast.error(translateError(e));
    } finally { setSaving(false); }
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
                <div>
                  <Label>Proveedor</Label>
                  <Input list="providers-list" value={f.provider_name} onChange={(e) => onProviderChange(e.target.value)} placeholder="Escriba o seleccione..." />
                  <datalist id="providers-list">
                    {providers.map((p) => <option key={p.name} value={p.name} />)}
                  </datalist>
                </div>
                <div><Label>Tipo de servicio</Label><Input value={f.service_type} onChange={(e) => setF({ ...f, service_type: e.target.value })} /></div>
                <div><Label>Monto</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fecha servicio</Label><Input type="date" value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></div>
                  <div><Label>Fecha pago</Label><Input type="date" value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Comprobante (opcional)</Label>
                  <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Mes</Label>
          <Select value={month} onValueChange={setMonth}>
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
          <div className="text-xs text-muted-foreground">{filtered.length} pago(s)</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Proveedor</TableHead><TableHead>Servicio</TableHead><TableHead>Monto</TableHead>
            <TableHead>F. Servicio</TableHead><TableHead>F. Pago</TableHead><TableHead>Comprobante</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.provider_name}</TableCell>
                <TableCell>{r.service_type}</TableCell>
                <TableCell>{formatMoney(r.amount)}</TableCell>
                <TableCell>{formatDate(r.service_date)}</TableCell>
                <TableCell>{formatDate(r.payment_date)}</TableCell>
                <TableCell><ReceiptThumb path={r.receipt_url} /></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center py-6">Sin pagos en el período.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
