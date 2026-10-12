import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, type Paged } from "@/lib/api";
import { formatDateTime } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { keepPreviousData, useQuery, useQueryClient, useMutation, type QueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, CheckCheck, ChevronDown, ChevronUp, Send, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LinesSkeleton } from "@/components/table-skeleton";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

const PAGE_SIZE = 30;

type Received = {
  id: string; // id del destinatario (notification_recipients)
  read_at: string | null;
  created_at: string;
  notification_id: string;
  title: string;
  body: string;
  sender_id: string | null;
  sender_name: string | null;
};

type Sent = { id: string; title: string; body: string; created_at: string; recipients: number; read_count: number };

/** Refresca la campana del encabezado y las listas de esta pantalla. */
function invalidateNotifs(qc: QueryClient) {
  for (const key of ["notif-unread-count", "notif-unread", "notif-received", "notif-sent"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-1">
      <div className="text-xs text-muted-foreground">Página {page} de {pages}</div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}

function NotificationsPage() {
  const { user, can } = useAuth();
  const canSend = can("notifications.send");
  const qc = useQueryClient();
  const [recPage, setRecPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);

  const { data: receivedRes } = useQuery({
    queryKey: ["notif-received", user?.id, recPage],
    queryFn: () => apiGet<Paged<Received>>("/api/notifications", { page: recPage, limit: PAGE_SIZE }),
    enabled: !!user,
    staleTime: STALE.ops,
    placeholderData: keepPreviousData,
  });
  const received = receivedRes?.data ?? [];

  const { data: sentRes } = useQuery({
    queryKey: ["notif-sent", user?.id, sentPage],
    queryFn: () => apiGet<Paged<Sent>>("/api/notifications/sent", { page: sentPage, limit: PAGE_SIZE }),
    enabled: !!user && canSend,
    staleTime: STALE.ops,
    placeholderData: keepPreviousData,
  });
  const sent = sentRes?.data ?? [];

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/api/notifications/${id}/read`),
    onSuccess: () => invalidateNotifs(qc),
    onError: (e) => toast.error(translateError(e)),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiPost<{ updated: number }>("/api/notifications/read-all"),
    onSuccess: () => invalidateNotifs(qc),
    onError: (e) => toast.error(translateError(e)),
  });
  const hasUnread = received.some((r) => !r.read_at);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Bell className="h-6 w-6" /> Notificaciones</h1>
          <p className="text-sm text-muted-foreground">Mensajes internos del sistema</p>
        </div>
        {canSend && <ComposeDialog onSent={() => { setSentPage(1); invalidateNotifs(qc); }} />}
      </div>

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">Recibidas ({receivedRes?.total ?? 0})</TabsTrigger>
          {canSend && <TabsTrigger value="sent">Enviadas ({sentRes?.total ?? 0})</TabsTrigger>}
        </TabsList>

        <TabsContent value="received" className="space-y-3">
          {hasUnread && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                <CheckCheck className="mr-1 h-4 w-4" /> Marcar todas como leídas
              </Button>
            </div>
          )}
          {received.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">Sin notificaciones</div>}
          {received.map((r) => {
            const unread = !r.read_at;
            return (
              <Card key={r.id} className={unread ? "border-primary/50 bg-primary/5" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{r.title}</CardTitle>
                      {unread && <Badge>Nueva</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      {formatDateTime(r.created_at)}
                      {r.sender_name && <div>De: {r.sender_name}</div>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                  {unread ? (
                    <Button size="sm" variant="outline" onClick={() => markRead.mutate(r.id)} disabled={markRead.isPending}>
                      <Check className="mr-1 h-4 w-4" /> Marcar como leída
                    </Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">Leída · {formatDateTime(r.read_at)}</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Pager page={recPage} pages={receivedRes?.pages ?? 1} onChange={setRecPage} />
        </TabsContent>

        {canSend && (
          <TabsContent value="sent" className="space-y-3">
            {sent.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No has enviado notificaciones</div>}
            {sent.map((n) => (
              <Card key={n.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{n.title}</CardTitle>
                    <div className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <div className="text-xs">
                    <Badge variant="outline">Leída por {n.read_count}/{n.recipients}</Badge>
                  </div>
                  <SentRecipients notificationId={n.id} />
                </CardContent>
              </Card>
            ))}
            <Pager page={sentPage} pages={sentRes?.pages ?? 1} onChange={setSentPage} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type Recipient = { user_id: string; full_name: string | null; username: string | null; read_at: string | null };

/** Destinatarios de una notificación enviada: se cargan al desplegar la lista. */
function SentRecipients({ notificationId }: { notificationId: string }) {
  const [open, setOpen] = useState(false);
  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ["notif-sent", "recipients", notificationId],
    queryFn: () => apiGet<Recipient[]>(`/api/notifications/${notificationId}/recipients`),
    enabled: open,
    staleTime: STALE.ops,
  });

  return (
    <div className="space-y-2">
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
        {open ? "Ocultar destinatarios" : "Ver destinatarios"}
      </Button>
      {open && (
        <div className="grid gap-1 max-h-48 overflow-auto rounded-md border p-2 text-xs">
          {isLoading && <LinesSkeleton lines={4} />}
          {!isLoading && recipients.length === 0 && <div className="text-muted-foreground">Sin destinatarios</div>}
          {recipients.map((r) => (
            <div key={r.user_id} className="flex items-center justify-between">
              <span>{r.full_name || r.username || r.user_id}</span>
              {r.read_at
                ? <span className="text-green-600">✓ Leída el {formatDateTime(r.read_at)}</span>
                : <span className="text-muted-foreground">Sin leer</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeDialog({ onSent }: { onSent: () => void }) {
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | string>("all");
  const [sending, setSending] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ["notif-users"],
    queryFn: () => apiGet<{ id: string; full_name: string; username: string }[]>("/api/notifications/recipients"),
    staleTime: STALE.master,
    enabled: open,
  });

  const send = async () => {
    if (!title.trim() || !body.trim()) return toast.error("Completa título y mensaje");
    setSending(true);
    try {
      const res = await apiPost<{ id: string; recipients: number }>("/api/notifications", {
        title: title.trim(),
        body: body.trim(),
        target: target === "all" ? "all" : [target],
      });
      toast.success(`Notificación enviada a ${res.recipients} usuario(s)`);
      setTitle(""); setBody(""); setTarget("all");
      setOpen(false);
      onSent();
    } catch (e) {
      toast.error(translateError(e) || "Error al enviar");
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
            <Label htmlFor={`${uid}-target`}>Destinatario</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id={`${uid}-target`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los usuarios</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-title`}>Título</Label>
            <Input id={`${uid}-title`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Asunto" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-body`}>Mensaje</Label>
            <Textarea id={`${uid}-body`} value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Escribe el mensaje..." />
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
