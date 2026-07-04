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

export const Route = createFileRoute("/app/deposits")({ component: DepositsPage });

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function DepositsPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "CAJA", "CONTABILIDAD"]);
  const qc = useQueryClient();
  const { data: rows = [] } = useList<any>("bank_deposits", "deposit_date");

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));

  const years = useMemo(() => {
    const s = new Set<string>([String(now.getFullYear())]);
    rows.forEach((r: any) => r.deposit_date && s.add(r.deposit_date.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r: any) => {
    if (!r.deposit_date) return false;
    const [y, m] = r.deposit_date.split("-");
    if (year !== "all" && y !== year) return false;
    if (month !== "all" && String(Number(m)) !== month) return false;
    return true;
  }), [rows, year, month]);

  const total = filtered.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyForm = { amount: 0, deposit_date: new Date().toISOString().slice(0, 10), reference: "" };
  const [f, setF] = useState<any>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const save = async () => {
    setSaving(true);
    try {
      let receipt_url: string | null = null;
      if (file) receipt_url = await uploadReceipt(file, "deposits");
      const { error } = await supabase.from("bank_deposits").insert({ ...f, receipt_url, created_by: user!.id });
      if (error) throw error;
      toast.success("Depósito registrado");
      setOpen(false); setF(emptyForm); setFile(null);
      qc.invalidateQueries({ queryKey: ["bank_deposits"] });
    } catch (e: any) {
      toast.error(translateError(e));
    } finally { setSaving(false); }
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
                <div>
                  <Label>Comprobante (imagen)</Label>
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
          <div className="text-xs text-muted-foreground">{filtered.length} depósito(s)</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Monto</TableHead><TableHead>Referencia</TableHead><TableHead>Comprobante</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.deposit_date)}</TableCell>
                <TableCell className="font-medium">{formatMoney(r.amount)}</TableCell>
                <TableCell>{r.reference || "-"}</TableCell>
                <TableCell><ReceiptThumb path={r.receipt_url} /></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center py-6">Sin depósitos en el período.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
