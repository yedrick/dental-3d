// Pantallas que pertenecen a un módulo del plan (los mismos de server/src/tenancy/plans.ts).
// Lo que no está aquí es el núcleo: lo tienen todos los planes.
export const MODULE_ROUTES: { path: string; feature: string; label: string }[] = [
  { path: "/app/appointments", feature: "agenda", label: "Agenda de citas" },
  { path: "/app/cashbox", feature: "caja", label: "Caja chica" },
  { path: "/app/commissions", feature: "comisiones", label: "Comisiones" },
  { path: "/app/reports", feature: "reportes", label: "Reportes" },
  { path: "/app/site", feature: "pagina_web", label: "Página web" },
  { path: "/app/deposits", feature: "finanzas", label: "Depósitos" },
  { path: "/app/third-party", feature: "finanzas", label: "Pagos a terceros" },
  { path: "/app/audit", feature: "auditoria", label: "Auditoría" },
];

/** Módulo que necesita una ruta de la app, si es de un módulo. */
export function moduleFor(pathname: string) {
  return MODULE_ROUTES.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));
}

/** Web comercial de IONIX (dominio principal): la sucursal es el primer subdominio. */
export function platformUrl() {
  if (typeof window === "undefined") return "/";
  const { protocol, hostname, port } = window.location;
  const central = hostname.split(".").slice(1).join(".") || hostname;
  return `${protocol}//${central}${port ? `:${port}` : ""}/`;
}
