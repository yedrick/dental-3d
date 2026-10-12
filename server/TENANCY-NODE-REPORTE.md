# Reporte para el equipo de tenancy-node

> **Actualización (v0.10.0, 12/10/2026):** los puntos 1 a 7 quedaron **corregidos en v0.9.0**. Los verificamos aquí con pruebas reales, ver "Verificación de v0.10.0". En las pruebas masivas apareció un problema nuevo y **grave**: el **#8**, un bloqueo del pool central al crear varias sucursales a la vez. Más abajo va también una sugerencia de capacidad (#9).

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
| **8** | `@tenancy-node/db` | **Bug** | **Crítica**: crear tantas sucursales a la vez como conexiones tiene el pool central **bloquea toda la API** | `CENTRAL_POOL_MAX=30` y la indicación de no crear más que eso a la vez |
| 9 | `@tenancy-node/db` | Mejora | Media: no hay un tope de conexiones por servidor; el límite de MySQL se alcanza sin aviso | Variables `TENANT_POOL_*` y fórmula en la guía |

| 10 | `core` / `admin-ui` | Mejora | Baja: buscar un id que no existe queda como "error" de ese tenant | — (es solo visual) |
| 11 | `admin-ui` | Mejora | Baja: los campos de contraseña del panel no tienen botón para mostrarla | — (la app ya lo tiene en todos sus campos) |

**Estado en v0.10.0:** 1 a 7 ✅ corregidos y verificados. 8 a 11 siguen abiertos.

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

## 8. `db`: bloqueo del pool central al aprovisionar en paralelo (crítico)

**Qué pasa:** `DatabaseProvisioning.provision()` envuelve todo el aprovisionamiento en `driver.withLock(central, 'tenancy:<id>', …)`. En MySQL, `withLock` toma **una conexión del pool central** y la retiene durante todo el aprovisionamiento (`GET_LOCK` … `RELEASE_LOCK`). Por dentro, `run()` necesita **más** conexiones del mismo pool para registrar los pasos, leer y guardar el tenant y elegir el servidor.

Con `C` aprovisionamientos simultáneos y un pool central de `C` conexiones, cada uno retiene una conexión y espera otra que nunca se libera: **bloqueo permanente**. Como `mysql2` espera indefinidamente una conexión libre, nada falla con error; todo queda colgado.

**Consecuencias, medidas aquí:**
- Las sucursales quedan para siempre en `provisioning`, en el paso `placement`.
- `tenancy.health()` responde `database health check timed out`.
- **Toda la API deja de responder**, incluidas las sucursales que ya existían: la identificación de cada petición usa la base central. Hay que reiniciar el proceso.
- En MySQL no corre ninguna consulta (`PROCESSLIST` vacío): las conexiones están tomadas por el proceso esperando.

**Cómo reproducirlo** (Express + `adminMiddleware`, MySQL 8.4):

| `central.pool.max` | Tenants creados a la vez (`POST /admin/api/tenants`) | Resultado |
|---|---|---|
| 4 | 3 | Todos `active`, API sana |
| 4 | **4** | Los 4 en `provisioning`; `/api/health` → `{"ok":false}`; un tenant existente (`/tenancy/me`) sin respuesta |
| 10 (por defecto) | 30 | Igual: 11 quedaron en `provisioning` y la API se bloqueó |

Lo mismo pasaría con `npx tenancy create --from=archivo.csv --concurrency=N` si `N ≥ central.pool.max`.

**Arreglos sugeridos** (cualquiera sirve; lo ideal es combinar el primero con el tercero):
1. Que `withLock` use una **conexión dedicada fuera del pool** (crearla y cerrarla con el driver nativo), así el candado nunca compite con el trabajo.
2. Un **semáforo de aprovisionamiento** con un máximo de `pool.max - 2` en paralelo; el resto espera en cola.
3. Un **tiempo máximo para obtener conexión** del pool central (en mysql2, `acquireTimeout`/`queueLimit` vía Kysely): en vez de colgarse, fallaría el aprovisionamiento con un error claro, reintentable.

**Aquí:** `CENTRAL_POOL_MAX` (30 por defecto) y la indicación en la guía de no crear más sucursales a la vez que ese número.

## 9. `db`: no hay un tope de conexiones por servidor

**Qué pasa:** cada tenant abre un pool de hasta `pool.max` conexiones y `maxOpenPools` limita la cantidad de **pools**, pero no hay un presupuesto de **conexiones** por servidor. En la prueba masiva, 25 tenants × 5 + 30 del central = 155 superaron `max_connections = 151` (valor por defecto de MySQL). Las peticiones de las sucursales que llegaron últimas fallaron con `Too many connections` (500).

**Sugerencias:**
- Una opción `maxConnectionsPerServer`: el registro cierra los pools libres menos usados para no pasar del límite, o espera.
- O al menos un aviso al arrancar o en `health()` si `maxOpenPools × pool.max + central.pool.max` supera el `max_connections` del servidor, que se puede consultar con `SELECT @@max_connections`.

**Aquí:** `TENANT_POOL_MAX`, `TENANT_MAX_OPEN_POOLS` y `TENANT_POOL_IDLE_MS` configurables, y la fórmula en la guía de despliegue.

## 10. `core` / `admin-ui`: un "no encontrado" queda como error del tenant

**Qué pasa:** `GET /admin/api/tenants/chasquipampa`, pedido unos milisegundos antes de crearlo, devuelve 404 (correcto). Pero `tenants.findOrFail` registra `TENANCY_TENANT_NOT_FOUND` en `observability` con `tenantId: "chasquipampa"`. Cuando el tenant ya existe, su pestaña **Errores (1)** muestra ese 404 como si fuera un error de la sucursal.

**Sugerencia:** no registrar `TENANCY_TENANT_NOT_FOUND` como error del tenant, porque es una respuesta esperada (por ejemplo, al comprobar si un id está libre). Si se quiere registrar, que sea sin `tenantId` o como `warn`.

Los errores viven en la memoria del proceso: reiniciar la API los borra.

## Verificación de v0.10.0 (12/10/2026)

Hecha en Dental-3D con MySQL 8.4, Redis 7, `TRUST_PROXY=1` y Chrome real. Las pruebas están en `server/test/`.

| Punto | Prueba | Resultado |
|---|---|---|
| 1. Fuga de conexiones | Solo pool nativo en 3 tenants → `tenancy.close()` | ✅ 0 sockets abiertos (con 0.8.0 quedaban) |
| 1. A escala | 25 tenants con carga → 80 s sin tráfico | ✅ De 156 a 31 conexiones (solo queda el pool central) |
| 2. IP real en el panel | 6 fallos desde `X-Forwarded-For: 10.0.0.1` → login desde `10.0.0.2` | ✅ Bloquea solo a 10.0.0.1 (429); 10.0.0.2 entra (200); la auditoría guarda las IP reales |
| 3. Tema efectivo | Editor de tema de un tenant nuevo (en el navegador) | ✅ Parte de `#0F172A` (`theme.defaults` de la app) |
| 6. Subir el logo desde el panel | `PUT /tenants/:id/theme/logo` con PNG y con SVG | ✅ PNG guardado y visible en `/tenancy/me`; SVG rechazado (415) |
| `tenantUsers` (0.10.0) | 25 tenants: crear un ADMIN por tenant desde el panel, listar, rol o email inválidos | ✅ (con el adaptador de la app; email normalizado y rol validado, ver abajo) |
| "Entrar como" (0.10.0) | Navegador: pestaña Usuarios → "Entrar como" | ✅ Abre la app del tenant con sesión y la app pide activar la cuenta |

**Ajustes hechos en el adaptador `tenantUsers` de la app (no son del módulo):** email en minúsculas y validado, rol validado (422 en vez de 500) y nombre obligatorio.

## Qué vistas son del módulo y cuáles de la app

| Vista | Origen |
|---|---|
| **Panel de la plataforma** (`dominio.com/admin/`): Login, Dashboard, Tenants, Nuevo tenant (con progreso), Detalle (Resumen, **Usuarios**, Dominios, Tema, Base de datos, Datos, Errores), Webhooks, Eventos, Usuarios del panel, Auditoría, Mi cuenta (2FA) | **tenancy-node** (`@tenancy-node/admin-ui` 0.10.0), ya compilado. **No se modificó**. Solo se le conecta el adaptador `tenantUsers` (`src/tenancy/admin-users.ts`) |
| Pantallas de cada sucursal (`<sucursal>.dominio.com`): login, dashboard, doctores, pacientes, atenciones, caja, reportes, usuarios, etc. | La app. Las generó Lovable sobre Supabase; en la Fase 5 se reescribieron para usar la API Node |
| Pantallas nuevas de la app: "Marca de la sucursal", "Página web", "Activa la cuenta de administrador", destino de "Entrar como…" (`/auth/impersonate`) | Nuevas, hechas en esta migración |
