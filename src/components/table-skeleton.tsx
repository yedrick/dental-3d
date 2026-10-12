import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/** Filas "fantasma" animadas mientras carga una tabla (en vez de un texto "Cargando…"). */
export function TableSkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <TableCell key={c}>
              <Skeleton
                className="h-4"
                style={{ width: `${c === 0 ? 70 : 40 + ((r * 7 + c * 13) % 45)}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
      <TableRow className="sr-only">
        <TableCell>Cargando…</TableCell>
      </TableRow>
    </>
  );
}

/** Bloque de líneas fantasma para tarjetas o listas que no son tablas. */
export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 15}%` }} />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
