import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { AppRole } from "@/lib/auth";

const ROLES: AppRole[] = ["ADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"];

export const Route = createFileRoute("/app/users")({ component: UsersPage });

function UsersPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["users_with_roles"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
      ]);
      const rolesByUser = new Map<string, AppRole[]>();
      (roles ?? []).forEach((r: any) => {
        rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role]);
      });
      return (profiles ?? []).map((p: any) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] }));
    },
  });

  const toggle = async (userId: string, role: AppRole, on: boolean) => {
    if (on) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["users_with_roles"] });
  };

  return (
    <div>
      <PageHeader title="Usuarios y roles" description="Asigna roles a cada usuario. Solo ADMIN puede modificar." />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead><TableHead>Email</TableHead>
              {ROLES.map((r) => <TableHead key={r} className="text-center">{r}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}<div className="text-xs text-muted-foreground">@{u.username}</div></TableCell>
                <TableCell>{u.email}</TableCell>
                {ROLES.map((r) => (
                  <TableCell key={r} className="text-center">
                    <Checkbox checked={u.roles.includes(r)} onCheckedChange={(v) => toggle(u.id, r, !!v)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={2 + ROLES.length} className="text-muted-foreground">Sin usuarios.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
