import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, Send, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user, hasRole, can } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const canSend = isAdmin || can("notifications.send");
  const qc = useQueryClient();


  const { data: received = [] } = useQuery({
    queryKey: ["notif-received", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .select("id, read_at, created_at, notification:notifications(id, title, body, created_at, sender_id)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: sent = [] } = useQuery({
    queryKey: ["notif-sent", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, created_at, recipients:notification_recipients(id, user_id, read_at)")
        .eq("sender_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).flatMap((n: any) => n.recipients.map((r: any) => r.user_id))));
      const profMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        (profs ?? []).forEach((p: any) => profMap.set(p.id, { full_name: p.full_name, email: p.email }));
      }
      return (data ?? []).map((n: any) => ({
        ...n,
        recipients: n.recipients.map((r: any) => ({ ...r, profile: profMap.get(r.user_id) ?? null })),
      }));
    },
    enabled: !!user && isAdmin,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notification_recipients").update({ read_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-received"] });
      qc.invalidateQueries({ queryKey: ["notif-unread"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Bell className="h-6 w-6" /> Notificaciones</h1>
          <p className="text-sm text-muted-foreground">Mensajes internos del sistema</p>
        </div>
        {canSend && <ComposeDialog onSent={() => { qc.invalidateQueries({ queryKey: ["notif-sent"] }); }} />}
      </div>

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">Recibidas ({received.length})</TabsTrigger>
          {canSend && <TabsTrigger value="sent">Enviadas ({sent.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="received" className="space-y-3">
          {received.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">Sin notificaciones</div>}
          {received.map((r: any) => {
            const n = r.notification;
            const unread = !r.read_at;
            return (
              <Card key={r.id} className={unread ? "border-primary/50 bg-primary/5" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{n?.title}</CardTitle>
                      {unread && <Badge>Nueva</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{n?.created_at && format(new Date(n.created_at), "dd/MM/yyyy HH:mm")}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="whitespace-pre-wrap text-sm">{n?.body}</p>
                  {unread ? (
                    <Button size="sm" variant="outline" onClick={() => markRead.mutate(r.id)} disabled={markRead.isPending}>
                      <Check className="mr-1 h-4 w-4" /> Marcar como leída
                    </Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">Leída · {format(new Date(r.read_at), "dd/MM/yyyy HH:mm")}</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="sent" className="space-y-3">
            {sent.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No has enviado notificaciones</div>}
            {sent.map((n: any) => {
              const total = n.recipients?.length ?? 0;
              const read = n.recipients?.filter((r: any) => r.read_at).length ?? 0;
              return (
                <Card key={n.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{n.title}</CardTitle>
                      <div className="text-xs text-muted-foreground">{format(new Date(n.created_at), "dd/MM/yyyy HH:mm")}</div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <div className="text-xs">
                      <Badge variant="outline">Leída por {read}/{total}</Badge>
                    </div>
                    <div className="grid gap-1 max-h-48 overflow-auto rounded-md border p-2 text-xs">
                      {n.recipients?.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between">
                          <span>{r.profile?.full_name ?? r.profile?.email ?? r.user_id}</span>
                          {r.read_at
                            ? <span className="text-green-600">✓ {format(new Date(r.read_at), "dd/MM HH:mm")}</span>
                            : <span className="text-muted-foreground">Sin leer</span>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function ComposeDialog({ onSent }: { onSent: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | string>("all");
  const [sending, setSending] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ["notif-users"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").eq("approved", true).order("full_name");
      return data ?? [];
    },
  });

  const send = async () => {
    if (!title.trim() || !body.trim()) return toast.error("Completa título y mensaje");
    setSending(true);
    try {
      const { data: notif, error } = await supabase.from("notifications")
        .insert({ sender_id: user!.id, title: title.trim(), body: body.trim() })
        .select().single();
      if (error) throw error;
      const recipients = target === "all"
        ? users.map(u => ({ notification_id: notif.id, user_id: u.id }))
        : [{ notification_id: notif.id, user_id: target }];
      const { error: e2 } = await supabase.from("notification_recipients").insert(recipients);
      if (e2) throw e2;
      toast.success(`Notificación enviada a ${recipients.length} usuario(s)`);
      setTitle(""); setBody(""); setTarget("all");
      setOpen(false);
      onSent();
    } catch (e: any) {
      toast.error(e.message ?? "Error al enviar");
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-1 h-4 w-4" /> Nueva notificación</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Enviar notificación</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Destinatario</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los usuarios ({users.length})</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Título</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Asunto" />
          </div>
          <div className="space-y-2">
            <Label>Mensaje</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Escribe el mensaje..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
