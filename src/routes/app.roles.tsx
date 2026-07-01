import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth, type AppRole } from "@/lib/auth";

const ROLES: AppRole[] = ["ADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"];

export const Route = createFileRoute("/app/roles")({ component: RolesPage });

function RolesPage() {
  const { can, reloadPermissions } = useAuth();
  const canEdit = can("roles.manage_permissions");
  const qc = useQueryClient();

  const { data: permissions = [] } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("permissions").select("*").order("category").order("key");
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: rolePerms = [] } = useQuery({
    queryKey: ["role_permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("*");
      if (error) throw error;
      return data as any[];
    },
  });

  const has = (role: AppRole, key: string) => rolePerms.some((r) => r.role === role && r.permission_key === key);

  const toggle = async (role: AppRole, key: string, on: boolean) => {
    if (!canEdit) return toast.error("Sin permiso");
    if (role === "ADMIN") return toast.error("ADMIN siempre tiene todos los permisos");
    if (on) {
      const { error } = await supabase.from("role_permissions").insert({ role, permission_key: key });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("role_permissions").delete().eq("role", role).eq("permission_key", key);
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["role_permissions"] });
    await reloadPermissions();
  };

  const grouped = permissions.reduce<Record<string, any[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p); return acc;
  }, {});

  return (
    <div>
      <PageHeader title="Roles y permisos" description="Matriz configurable. ADMIN siempre tiene todo. Marca/desmarca para cada rol." />
      {!canEdit && <div className="mb-3 text-sm text-muted-foreground">Solo lectura — necesitas el permiso <code>roles.manage_permissions</code>.</div>}
      <Card className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Permiso</TableHead>
              {ROLES.map((r) => <TableHead key={r} className="text-center">{r}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(grouped).map(([cat, list]) => (
              <>
                <TableRow key={`h-${cat}`} className="bg-muted/40">
                  <TableCell colSpan={1 + ROLES.length} className="font-semibold uppercase text-xs tracking-wider">
                    <Badge variant="outline">{cat}</Badge>
                  </TableCell>
                </TableRow>
                {list.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>
                      <div className="font-medium text-sm">{p.description}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.key}</div>
                    </TableCell>
                    {ROLES.map((r) => (
                      <TableCell key={r} className="text-center">
                        <Checkbox
                          checked={r === "ADMIN" ? true : has(r, p.key)}
                          disabled={!canEdit || r === "ADMIN"}
                          onCheckedChange={(v) => toggle(r, p.key, !!v)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
