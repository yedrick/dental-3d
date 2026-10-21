import { AsyncLocalStorage } from "node:async_hooks";

/** Datos de la petición que la auditoría necesita sin pasarlos por parámetro. */
export interface RequestContext {
  userId: string;
  /** ADMIN que está "iniciando sesión como" este usuario. */
  impersonatedBy?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
