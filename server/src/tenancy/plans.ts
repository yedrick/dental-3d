/**
 * Módulos y planes de IONIX (tenancy-node 0.11). Es la única fuente: de aquí salen el menú de la
 * app (/tenancy/me), los permisos de la API (requireFeature), los límites, el panel /admin y los
 * precios de la web comercial (GET /tenancy/plans).
 *
 * Lo que no está aquí es el núcleo y lo tienen todos los planes: dashboard, pacientes, doctores,
 * estudios y tarifas, atenciones, entregas y cobros, usuarios, roles, parámetros y marca.
 * Al bajar de plan no se borra nada: el módulo se oculta y la API lo rechaza.
 */
export const features = {
  agenda: { label: "Agenda de citas", description: "Citas por día y por doctor, con estados" },
  caja: { label: "Caja chica", description: "Ingresos y gastos de caja con comprobantes" },
  comisiones: { label: "Comisiones", description: "Comisiones por doctor, con Excel y PDF" },
  reportes: { label: "Reportes", description: "Ventas, cobros, utilidad y PDF por período" },
  pagina_web: { label: "Página web", description: "Página pública de la clínica, editable" },
  importar: { label: "Importar Excel", description: "Carga masiva de estudios y tarifas" },
  finanzas: { label: "Depósitos y pagos a terceros", description: "Depósitos bancarios y pagos a terceros" },
  auditoria: { label: "Auditoría", description: "Quién hizo cada cambio y cuándo" },
} as const;

export type Feature = keyof typeof features;

// Sin precio = "a consultar" en la web comercial. Precios en Bs: { currency: "BOB", monthly, yearly }.
export const plans = {
  basico: {
    label: "Básico",
    description: "Para empezar: atención, cobros, agenda y caja",
    features: ["agenda", "caja"] as Feature[],
    limits: { usuarios: 3 },
  },
  profesional: {
    label: "Profesional",
    description: "Comisiones, reportes y la página web de tu clínica",
    features: ["agenda", "caja", "comisiones", "reportes", "pagina_web", "importar"] as Feature[],
    limits: { usuarios: 10 },
    highlight: true,
  },
  clinica: {
    label: "Clínica",
    description: "Todo IONIX, sin límite de usuarios",
    features: "*" as const,
    limits: { usuarios: null },
  },
};

/** Plan de las sucursales nuevas que no eligen uno. */
export const defaultPlan = "basico";

declare module "@tenancy-node/core" {
  interface TenancyFeatureMap {
    agenda: true;
    caja: true;
    comisiones: true;
    reportes: true;
    pagina_web: true;
    importar: true;
    finanzas: true;
    auditoria: true;
  }
  interface TenancyLimitMap {
    usuarios: true;
  }
}
