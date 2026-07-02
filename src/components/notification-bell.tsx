import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";

export function NotificationBell() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ["notif-unread", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .select("id, read_at, notification:notifications(id, title, body, created_at)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_recipients", filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["notif-unread"] });
        qc.invalidateQueries({ queryKey: ["notif-received"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, qc]);

  const unread = items.filter((i: any) => !i.read_at).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
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
          {items.map((r: any) => (
            <Link key={r.id} to="/app/notifications" className={`block border-b p-3 text-sm hover:bg-muted/50 ${!r.read_at ? "bg-primary/5" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium truncate">{r.notification?.title}</div>
                {!r.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.notification?.body}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{r.notification?.created_at && format(new Date(r.notification.created_at), "dd/MM HH:mm")}</div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
