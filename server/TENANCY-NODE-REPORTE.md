# Reporte para el equipo de tenancy-node

Hallazgos al integrar **tenancy-node v0.8.0** (instalado desde GitHub Releases) en Dental-3D: Express 5, MySQL 8.4, una base por sucursal, resolver por subdominio, `credentials: 'per-tenant'`, panel `admin-api` + `admin-ui`, `cache-redis`.

Cada punto está escrito para copiarlo como *issue*: paquete, qué pasa, cómo se reproduce, qué se esperaba, arreglo sugerido y cómo lo resolvimos aquí mientras tanto.

## Resumen

| # | Paquete | Tipo | Gravedad | Estado aquí |
|---|---|---|---|---|
| 1 | `@tenancy-node/db-mysql` | Bug | **Alta**: fuga de conexiones MySQL | Parche en `src/db.ts` |
| 2 | `@tenancy-node/admin-api` | Bug | **Media**: el login del panel se bloquea para todos detrás de un proxy | `/admin/` cerrado por IP en nginx |
| 3 | `@tenancy-node/admin-ui` | Bug | Media: el editor de tema ignora `theme.defaults` | Indicación de elegir siempre el color |
| 4 | `@tenancy-node/admin-ui` | Mejora | Baja: la vista previa muestra `tuapp.com` | — |
| 5 | `@tenancy-node/admin-ui` | Mejora | Media: "Nuevo tenant" no permite `data` | El `seed` crea un ADMIN genérico |
| 6 | `@tenancy-node/admin-ui` | Mejora | Media: el tema no permite **subir** el logo | Se sube desde la app |
| 7 | `@tenancy-node/core` | Documentación | Baja: `tenancy.theme()` queda desactualizado en la misma petición | Se usa el valor que devuelve `update` |

## 1. `db-mysql`: `destroy()` no cierra el pool nativo si nunca se usó Kysely

**Qué pasa:** `connect()` devuelve `destroy: () => db.destroy()`. Kysely solo cierra el pool si alguna vez lo inicializó (`RuntimeDriver.destroy` sale sin hacer nada si no hubo `init()`). Una app que usa solo `tenancy.pool()` (el pool de `mysql2`) nunca inicializa Kysely. Cuando el registro cierra ese pool (por `idleTimeoutMs` o en `tenancy.close()`), **sus conexiones MySQL quedan abiertas**.

**Consecuencias:**
- En un servidor que corre semanas, cada sucursal que queda inactiva y vuelve abre un pool nuevo sin cerrar el viejo, hasta llegar a `max_connections`.
- Los scripts no terminan: el proceso queda colgado después de `tenancy.close()`.

**Cómo reproducirlo:**

```ts
await tenancy.run('central', async () => {
  const pool = tenancy.pool<import('mysql2').Pool>();
  await new Promise((ok, fail) => pool.query('SELECT 1', (e) => (e ? fail(e) : ok(null))));
});
await tenancy.close();
console.log(process._getActiveHandles()); // queda un Socket hacia el puerto de MySQL
```

Con `await tenancy.sql\`SELECT 1\`` en lugar del pool nativo no pasa: Kysely queda inicializado y su `destroy` cierra el pool.

**Esperado:** `destroy()` cierra el pool nativo siempre.

**Arreglo sugerido (en `packages/db-mysql/src/index.ts`):**

```ts
let destroyed = false;
return {
  db, native,
  destroy: async () => {
    if (destroyed) return;
    destroyed = true;
    await db.destroy();                                   // cierra si Kysely lo inicializó
    await new Promise<void>((r) => native.end(() => r())); // y siempre el pool nativo
  },
};
```

Hay que tener cuidado con el doble `end()` cuando Kysely sí estaba inicializado: verificar `native._closed` o capturar el error. Probablemente aplica igual a `db-postgres` y `db-mssql`.

**Parche aquí:** `src/db.ts` hace una consulta mínima por Kysely (`tenancy.db().executeQuery(CompiledQuery.raw("SELECT 1"))`) la primera vez que usa cada pool nativo. Verificado: después de `tenancy.close()` no queda ninguna conexión.

## 2. `admin-api`: el límite de intentos de login no sirve detrás de un proxy

**Qué pasa:** la IP sale de `req.socket.remoteAddress` (`admin.ts`, línea ~149) y no existe una opción `trustProxy` ni lectura de `X-Forwarded-For`. Detrás de nginx, todas las peticiones llegan desde `127.0.0.1`.

**Consecuencias:**
- Con 5 fallos de **cualquier persona**, el login del panel queda bloqueado para **todos** durante 15 minutos (429 `ADMIN_TOO_MANY_ATTEMPTS`). El límite por email sigue funcionando.
- La auditoría (`tenancy_audit_log.ip`) guarda `127.0.0.1` en todas las filas.

**Cómo reproducirlo:** panel montado con `adminMiddleware` detrás de nginx (`proxy_set_header X-Forwarded-For …`). Desde dos IP distintas, 5 logins fallidos en la primera bloquean también a la segunda.

**Esperado:** una opción como la que ya tienen los adaptadores (`trustProxy`), o una función `clientIp(req)` en `createAdminApi`:

```ts
createAdminApi(tenancy, { sessionSecret, trustProxy: 1 }); // o: clientIp: (req) => …
```

**Aquí:** `/admin/` solo se permite desde las IP de la oficina o VPN (`deploy/nginx/dental3d.conf`), como recomienda la propia guía del panel.

## 3. `admin-ui`: el editor de tema muestra `DEFAULT_THEME` en vez de `theme.defaults`

**Qué pasa:** con `createTenancy({ theme: { defaults: { primary: '#0F172A' } } })`, un tenant sin tema propio muestra en el editor `#2563EB`, el `DEFAULT_THEME` del paquete. Si el usuario guarda sin tocar ese campo, el tenant queda con `#2563EB`.

**Esperado:** que el editor muestre el tema efectivo del tenant (`tenancy.theme.defaults`, o lo que devuelva `/tenancy/me`) cuando el tenant no tiene tema propio. Por ejemplo, que `GET /tenants/:id` incluya `effectiveTheme`.

## 4. `admin-ui`: la vista previa del tema muestra `<id>.tuapp.com`

**Qué pasa:** la tarjeta de vista previa escribe un dominio de ejemplo fijo. Debería usar el dominio principal del tenant, o `<id>.<primer dominio central>`.

## 5. `admin-ui`: "Nuevo tenant" no permite cargar `data`

**Qué pasa:** `POST /tenants` acepta `data`, pero el formulario solo tiene id, nombre, dominios y plan.

**Caso de uso:** pasar al `seed` el email y el nombre del administrador inicial, o datos públicos como el teléfono y la dirección (`publicFields`).

**Sugerencia:**
- un editor de `data` (clave → valor) en "Nuevo tenant" y en el detalle del tenant;
- o campos declarados por la app, por ejemplo `createAdminApi(..., { tenantFields: [{ key: 'adminEmail', label: 'Email del administrador', type: 'email' }] })`.

**Aquí:** el `seed` crea un ADMIN genérico (`admin`) con la cuenta "por activar", y se activa con "Entrar como…".

## 6. `admin-ui`: el editor de tema no permite subir el logo

**Qué pasa:** el campo `logo` solo acepta una ruta o URL de texto. Para un logo en el almacenamiento del tenant (`tenancy.storage()`), hoy hay que subirlo por otro medio.

**Sugerencia:** `PUT /tenants/:id/theme/logo` (binario, validando el tipo real y sin SVG), que guarde en `tenancy.storage()` y actualice `theme.logo`, con un botón "Subir" en la UI.

**Aquí:** el logo se sube desde la app de la sucursal ("Marca de la sucursal", `PUT /api/branding/logo`).

## 7. `core`: `tenancy.theme()` se lee con el tenant del inicio de la petición

**Qué pasa:** dentro de una petición, después de `await tenancy.theme.update(id, …)`, `tenancy.theme()` sigue devolviendo el tema anterior, porque el contexto tiene la instancia de `Tenant` con la que empezó la petición. Es razonable, pero no está en la documentación de `theme.update`.

**Sugerencia:** documentarlo ("usa el `Theme` que devuelve `update`"), o refrescar el tenant del contexto actual cuando el `update` es sobre ese mismo tenant.

## Qué vistas son del módulo y cuáles de la app

| Vista | Origen |
|---|---|
| **Panel de la plataforma** (`dominio.com/admin/`): Login, Dashboard, Tenants, Nuevo tenant (con progreso), Detalle (Resumen, Dominios, Tema, Base de datos, Datos, Errores), Webhooks, Eventos, Usuarios, Auditoría, Mi cuenta (2FA) | **tenancy-node** (`@tenancy-node/admin-ui`), ya compilado. **No se modificó**: los puntos 3 a 6 son de aquí |
| Pantallas de cada sucursal (`<sucursal>.dominio.com`): login, dashboard, doctores, pacientes, atenciones, caja, reportes, usuarios, etc. | La app. Las generó Lovable sobre Supabase; en la Fase 5 se reescribieron para usar la API Node |
| Pantallas nuevas de la app: "Marca de la sucursal", "Página web", "Activa la cuenta de administrador", destino de "Entrar como…" (`/auth/impersonate`) | Nuevas, hechas en esta migración |
