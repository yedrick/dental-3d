import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useList<T = any>(table: string, order = "created_at", ascending = false) {
  return useQuery({
    queryKey: [table, order, ascending],
    queryFn: async () => {
      const { data, error } = await (supabase.from(table as any) as any).select("*").order(order, { ascending });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export function formatDate(v?: string | null) {
  if (!v) return "-";
  return v.slice(0, 10);
}

export function formatMoney(v?: number | string | null) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(n);
}

export function calcAge(birth?: string | null) {
  if (!birth) return "-";
  const b = new Date(birth);
  const d = new Date();
  let a = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a--;
  return a;
}
