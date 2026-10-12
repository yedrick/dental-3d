import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiGetQuiet, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";

interface InboxItem {
  id: string;
  read_at: string | null;
  title: string;
  body: string;
  created_at: string;
}

export function NotificationBell() {
  const { user } = useAuth();

  // Supabase empujaba las notificaciones en tiempo real; la API se consulta cada 30 s.
  // El contador es una consulta mínima (responde 304 si no cambió) y la lista solo se
  // vuelve a pedir cuando el contador cambia.
  const { data: count } = useQuery({
    queryKey: ["notif-unread-count", user?.id],
    queryFn: () => apiGetQuiet<{ count: number }>("/api/notifications/unread-count"),
    enabled: !!user,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const unread = count?.count ?? 0;

  const { data: items = [] } = useQuery({
    queryKey: ["notif-unread", user?.id, unread],
    queryFn: async () => (await apiGet<Paged<InboxItem>>("/api/notifications", { limit: 10 })).data,
    enabled: !!user,
    staleTime: 0,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : "Notificaciones"}>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] rounded-full">
              {unread > 9 ? "9+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <div className="text-sm font-semibold">Notificaciones</div>
          <Link to="/app/notifications" className="text-xs text-primary hover:underline">Ver todas</Link>
        </div>
        <div className="max-h-96 overflow-auto">
          {items.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Sin notificaciones</div>}
          {items.map((r) => (
            <Link key={r.id} to="/app/notifications" className={`block border-b p-3 text-sm hover:bg-muted/50 ${!r.read_at ? "bg-primary/5" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium truncate">{r.title}</div>
                {!r.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.body}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{format(new Date(r.created_at), "dd/MM HH:mm")}</div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
