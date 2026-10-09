// Cliente de la API Node (server/). El frontend y la API se sirven desde el MISMO host
// (sur.dental3d.com/api): la sucursal se identifica por el subdominio. En desarrollo, Vite
// reenvía /api y /tenancy a http://localhost:4000 (vite.config.ts).

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const TOKEN_KEY = "dental3d.token";
/** Token del ADMIN mientras suplanta a otro usuario, para volver a su sesión. */
const ADMIN_TOKEN_KEY = "dental3d.admin_token";

export const LOGOUT_EVENT = "dental3d:logout";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const tokenStore = {
  get: () => storage()?.getItem(TOKEN_KEY) ?? null,
  set: (t: string) => storage()?.setItem(TOKEN_KEY, t),
  clear: () => storage()?.removeItem(TOKEN_KEY),
  getAdmin: () => storage()?.getItem(ADMIN_TOKEN_KEY) ?? null,
  setAdmin: (t: string) => storage()?.setItem(ADMIN_TOKEN_KEY, t),
  clearAdmin: () => storage()?.removeItem(ADMIN_TOKEN_KEY),
};

/** Error de la API: { error: { code, message, details? } }. El mensaje ya viene en español. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface Paged<T, S = Record<string, unknown>> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  summary?: S;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Query;
  body?: unknown;
  /** Archivo binario (logo, comprobante): se envía tal cual con su Content-Type. */
  file?: Blob;
}

function buildUrl(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ""}`;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.file) {
    headers["Content-Type"] = opts.file.type || "application/octet-stream";
    body = opts.file;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? "GET", headers, body });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Error de conexión. Verifica tu internet e inténtalo de nuevo.");
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } } | null)?.error;
    const apiErr = new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? `Error ${res.status}`, err?.details);
    // Sesión vencida o cerrada (contraseña nueva, rol cambiado…): volver al login
    if (res.status === 401 && token && path !== "/api/auth/login") {
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent(LOGOUT_EVENT, { detail: apiErr.message }));
    }
    throw apiErr;
  }
  return json as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const apiGet = <T = unknown>(path: string, query?: Query) => api<T>(path, { query });
export const apiPost = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const apiPatch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const apiPut = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body: body ?? {} });
export const apiDelete = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });
export const apiUpload = <T = unknown>(path: string, file: Blob, method: "POST" | "PUT" = "POST") => api<T>(path, { method, file });

/** Trae TODAS las páginas de una lista paginada (para pantallas que muestran todo, como los selectores). */
export async function apiGetAll<T>(path: string, query: Query = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await apiGet<Paged<T>>(path, { ...query, page, limit: 500 });
    out.push(...res.data);
    if (page >= res.pages) return out;
  }
}
