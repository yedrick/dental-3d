import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, CalendarDays } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/appointments")({ component: AppointmentsPage });

const STATUSES = [
  { v: "SCHEDULED", label: "Programada", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  { v: "CONFIRMED", label: "Confirmada", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  { v: "DONE", label: "Atendida", cls: "bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/30" },
  { v: "CANCELLED", label: "Cancelada", cls: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30" },
  { v: "NO_SHOW", label: "No asistió", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
];
const statusMeta = (s: string) => STATUSES.find((x) => x.v === s) ?? STATUSES[0];

type Form = {
  id?: string;
  patient_id: string; patient_name: string; patient_phone: string;
  doctor_id: string; study_id: string;
  date: string; time: string;
  duration_min: number; status: string; notes: string;
};
const emptyForm = (d = new Date()): Form => ({
  patient_id: "", patient_name: "", patient_phone: "",
  doctor_id: "", study_id: "",
  date: d.toISOString().slice(0, 10), time: "09:00",
  duration_min: 30, status: "SCHEDULED", notes: "",
});

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function fmtISO(d: Date) { return d.toISOString().slice(0, 10); }

function AppointmentsPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "RECEPCION"]);
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [selected, setSelected] = useState<string>(fmtISO(new Date()));
  const [form, setForm] = useState<Form>(emptyForm());
  const [open, setOpen] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = addMonths(monthStart, 1);

  const { data: appts = [], isLoading } = useQuery({
    queryKey: ["appointments", fmtISO(monthStart)],
    queryFn: async () => (await supabase.from("appointments").select("*")
      .gte("starts_at", monthStart.toISOString())
      .lt("starts_at", monthEnd.toISOString())
      .order("starts_at", { ascending: true })).data ?? [],
  });

  const { data: patients = [] } = useList<any>("patients", "full_name", true);
  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const { data: studies = [] } = useList<any>("studies", "name", true);
  const activePatients = (patients as any[]).filter((p) => p.status !== false);

  // Group by day
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of appts as any[]) {
      const k = a.starts_at.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [appts]);

  // Build calendar grid (Sun-first) with leading blanks
  const cells = useMemo(() => {
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const firstDow = monthStart.getDay();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [monthStart]);

  const todayIso = fmtISO(new Date());
  const selectedList = (byDay.get(selected) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const openNew = (dateIso?: string) => {
    const base = emptyForm(dateIso ? new Date(dateIso + "T09:00:00") : new Date());
    if (dateIso) base.date = dateIso;
    setForm(base); setOpen(true);
  };
  const openEdit = (a: any) => {
    const d = new Date(a.starts_at);
    setForm({
      id: a.id,
      patient_id: a.patient_id || "", patient_name: a.patient_name, patient_phone: a.patient_phone || "",
      doctor_id: a.doctor_id || "", study_id: a.study_id || "",
      date: fmtISO(d), time: d.toTimeString().slice(0, 5),
      duration_min: a.duration_min ?? 30, status: a.status, notes: a.notes || "",
    });
    setOpen(true);
  };

  const pickPatient = (id: string) => {
    const p = (patients as any[]).find((x) => x.id === id);
    setForm((f) => ({ ...f, patient_id: id, patient_name: p?.full_name ?? f.patient_name, patient_phone: p?.phone ?? f.patient_phone, doctor_id: p?.doctor_id ?? f.doctor_id }));
  };

  const save = async () => {
    if (!form.patient_name.trim()) return toast.error("Nombre del paciente requerido");
    if (!form.date || !form.time) return toast.error("Fecha y hora requeridas");
    const starts_at = new Date(`${form.date}T${form.time}:00`).toISOString();
    const payload: any = {
      patient_id: form.patient_id || null,
      patient_name: form.patient_name.trim(),
      patient_phone: form.patient_phone || null,
      doctor_id: form.doctor_id || null,
      study_id: form.study_id || null,
      starts_at, duration_min: Number(form.duration_min) || 30,
      status: form.status, notes: form.notes || null,
    };
    if (form.id) {
      const { error } = await supabase.from("appointments").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      await supabase.rpc("log_audit_event", {
        _action: "APPOINTMENT_UPDATE",
        _table_name: "appointments",
        _record_id: form.id,
        _data: payload,
      });
      toast.success("Cita actualizada");
    } else {
      payload.created_by = user!.id;
      const { data: ins, error } = await supabase.from("appointments").insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      await supabase.rpc("log_audit_event", {
        _action: "APPOINTMENT_CREATE",
        _table_name: "appointments",
        _record_id: (ins as any)?.id ?? "",
        _data: payload,
      });
      toast.success("Cita creada");
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const del = async (a: any) => {
    if (!confirm("¿Eliminar cita?")) return;
    const { error } = await supabase.from("appointments").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    await supabase.rpc("log_audit_event", {
      _action: "APPOINTMENT_DELETE",
      _table_name: "appointments",
      _record_id: a.id,
      _data: { patient_name: a.patient_name, starts_at: a.starts_at, status: a.status } as any,
    });
    toast.success("Cita eliminada");
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const changeStatus = async (a: any, v: string) => {
    await supabase.from("appointments").update({ status: v }).eq("id", a.id);
    await supabase.rpc("log_audit_event", {
      _action: "APPOINTMENT_STATUS",
      _table_name: "appointments",
      _record_id: a.id,
      _data: { from: a.status, to: v, patient_name: a.patient_name } as any,
    });
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const monthLabel = cursor.toLocaleDateString("es-BO", { month: "long", year: "numeric" });
  const dow = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  return (
    <div>
      <PageHeader
        title="Agenda de citas"
        description="Calendario mensual con gestión completa de citas."
        action={canEdit && <Button onClick={() => openNew(selected)}><Plus className="mr-1 h-4 w-4" />Nueva cita</Button>}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr,340px]">
        <Card className="p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Mes anterior" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[160px] text-center text-sm font-semibold capitalize">{monthLabel}</div>
              <Button size="sm" variant="ghost" aria-label="Mes siguiente" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => { const t = new Date(); setCursor(startOfMonth(t)); setSelected(fmtISO(t)); }}>
              <CalendarDays className="h-3.5 w-3.5 mr-1" />Hoy
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">
            {dow.map((d) => <div key={d} className="text-center py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="h-20 md:h-24 rounded-md bg-muted/30" />;
              const iso = fmtISO(d);
              const list = byDay.get(iso) ?? [];
              const isSel = iso === selected;
              const isToday = iso === todayIso;
              return (
                <button key={iso} onClick={() => setSelected(iso)}
                  className={`h-20 md:h-24 rounded-md border p-1 text-left flex flex-col gap-0.5 hover:bg-accent transition-colors
                    ${isSel ? "border-primary ring-1 ring-primary" : "border-border"}
                    ${isToday ? "bg-primary/5" : ""}`}>
                  <div className={`text-xs font-medium ${isToday ? "text-primary" : ""}`}>{d.getDate()}</div>
                  <div className="flex-1 overflow-hidden space-y-0.5">
                    {list.slice(0, 2).map((a) => (
                      <div key={a.id} className={`truncate rounded px-1 py-0.5 text-[10px] border ${statusMeta(a.status).cls}`}>
                        {a.starts_at.slice(11, 16)} {a.patient_name}
                      </div>
                    ))}
                    {list.length > 2 && <div className="text-[10px] text-muted-foreground">+{list.length - 2} más</div>}
                  </div>
                </button>
              );
            })}
          </div>
          {isLoading && <div className="text-xs text-muted-foreground mt-2">Cargando…</div>}
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-muted-foreground">Citas del día</div>
              <div className="text-sm font-semibold">{new Date(selected + "T00:00:00").toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })}</div>
            </div>
            {canEdit && <Button size="sm" onClick={() => openNew(selected)}><Plus className="h-3.5 w-3.5" /></Button>}
          </div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {selectedList.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Sin citas este día.</div>}
            {selectedList.map((a) => {
              const meta = statusMeta(a.status);
              return (
                <div key={a.id} className="rounded-md border p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs font-semibold">{a.starts_at.slice(11, 16)} <span className="text-muted-foreground">· {a.duration_min}min</span></div>
                    <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                  </div>
                  <div className="text-sm font-medium">{a.patient_name}</div>
                  {a.patient_phone && <div className="text-[11px] text-muted-foreground">📞 {a.patient_phone}</div>}
                  {a.notes && <div className="text-[11px] text-muted-foreground line-clamp-2">{a.notes}</div>}
                  {canEdit && (
                    <div className="flex items-center gap-1 pt-1">
                      <Select value={a.status} onValueChange={(v) => changeStatus(a, v)}>
                        <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => del(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Editar cita" : "Nueva cita"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Paciente registrado (opcional)</Label>
              <Select value={form.patient_id} onValueChange={pickPatient}>
                <SelectTrigger><SelectValue placeholder="Selecciona o escribe un nombre libre abajo" /></SelectTrigger>
                <SelectContent>
                  {activePatients.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.full_name}{p.phone ? ` — ${p.phone}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre paciente *</Label><Input value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input value={form.patient_phone} onChange={(e) => setForm({ ...form, patient_phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Fecha *</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Hora *</Label><Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
              <div><Label>Duración (min)</Label><Input type="number" min={5} step={5} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Doctor</Label>
                <Select value={form.doctor_id} onValueChange={(v) => setForm({ ...form, doctor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(doctors as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estudio</Label>
                <Select value={form.study_id} onValueChange={(v) => setForm({ ...form, study_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(studies as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>{form.id ? "Actualizar" : "Guardar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
