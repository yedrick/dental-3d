# Publicar Dental-3D en Laravel Forge

Forge descarga el código de GitHub (rama **`master`**) y en cada despliegue corre un script que compila en el servidor. **No se suben compilados a mano.** La guía general, sin Forge, está en `DEPLOY.md`.

En esta guía, `dental3d.com` es un ejemplo: reemplázalo por tu dominio. Los pasos marcados con **(revisar en Forge)** pueden verse algo distintos según la versión del panel.

```
internet ──443──► nginx (Forge) ──┬── /api, /tenancy, /admin ──► API Node      127.0.0.1:4000  (daemon 1)
                                  └── todo lo demás ───────────► frontend Node 127.0.0.1:3000  (daemon 2)
API ──► MySQL 127.0.0.1:3306 (base central + una base por sucursal) · Redis 127.0.0.1:6379
```

## 0. Antes de empezar

- [ ] Servidor en Forge con **MySQL 8**, **Redis** y **Node.js 20 o superior** (recomendado 22). Se comprueba por SSH con `node -v`. **(revisar en Forge)**
- [ ] **2 GB de RAM** o más, o swap: compilar el frontend usa 1–2 GB.
- [ ] DNS de tu dominio con dos registros A hacia la IP del servidor: `dental3d.com` y `*.dental3d.com`.
- [ ] Proveedor de correo SMTP (Brevo, Zoho, Google, Amazon SES) con tu dominio verificado (SPF y DKIM), para "¿Olvidaste tu contraseña?".

## 1. MySQL: usuario que crea las bases de cada sucursal

El usuario de base de datos que crea Forge desde el panel **no puede** crear bases ni usuarios para cada sucursal. Se crea uno propio por SSH (`ssh forge@IP`):

```sh
sudo mysql
```

```sql
CREATE DATABASE dental3d_central CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tenancy_admin'@'localhost' IDENTIFIED BY '<contraseña larga y aleatoria>';
GRANT ALL PRIVILEGES ON `dental3d_central`.* TO 'tenancy_admin'@'localhost';
GRANT ALL PRIVILEGES ON `dental\_%`.* TO 'tenancy_admin'@'localhost' WITH GRANT OPTION;
GRANT CREATE USER ON *.* TO 'tenancy_admin'@'localhost';
SET PERSIST max_connections = 400;   -- ver "Conexiones" en DEPLOY.md
```

La zona horaria no hace falta tocarla: la app fija UTC en sus propias conexiones.

## 2. Carpeta para logos y comprobantes (fuera del código)

Así ningún despliegue los borra:

```sh
mkdir -p /home/forge/dental3d-storage/public /home/forge/dental3d-storage/private
chmod 750 /home/forge/dental3d-storage/private
```

## 3. Crear el sitio

En **Forge → Server → New Site** **(revisar en Forge)**:
- **Domain:** `dental3d.com`. **Aliases:** `*.dental3d.com`, para que cada sucursal tenga su subdominio.
- **Tipo de proyecto:** el genérico, HTML/estático o "Other". No uses una plantilla de Laravel.
- **Web directory:** `/public`. No se usa (nginx reenvía todo a Node), pero Forge pide uno.
- **Repositorio:** `yedrick/dental-3d`, rama **`master`**. Desmarca "Install Composer dependencies".
- **No** actives "Zero-downtime deployments". Si lo activas, el `.env` tiene que ser un archivo compartido entre versiones (los archivos ya están fuera del código, por el paso 2).

## 4. Variables de entorno

En **Site → Environment**, Forge guarda este archivo como `/home/forge/dental3d.com/.env`. El script de despliegue lo enlaza a `server/.env`, que es donde lo lee la API. Pega esto y completa los valores:

```ini
PORT=4000
HOST=127.0.0.1
API_PROCESSES=2
TRUST_PROXY=1
CORS_ORIGIN=https://dental3d.com
CENTRAL_DOMAINS=dental3d.com
BUSINESS_UTC_OFFSET=-04:00

DATABASE_URL=mysql://tenancy_admin:<contraseña>@127.0.0.1:3306/dental3d_central
TENANCY_KEY=                 # npx tenancy key:generate (ver paso 6). GUÁRDALA FUERA DEL SERVIDOR
CENTRAL_POOL_MAX=10
TENANT_POOL_MAX=3
TENANT_MAX_OPEN_POOLS=100
TENANT_POOL_IDLE_MS=60000
REDIS_URL=redis://127.0.0.1:6379

STORAGE_DRIVER=local
STORAGE_DIR=/home/forge/dental3d-storage/public
PRIVATE_STORAGE_DIR=/home/forge/dental3d-storage/private

JWT_SECRET=                  # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_EXPIRES_IN=8h

TENANCY_ADMIN_SECRET=        # openssl rand -base64 48
ADMIN_SECURE_COOKIES=true
TENANT_PUBLIC_URL=https://{tenant}.dental3d.com

PASSWORD_RESET_ENABLED=true
MAIL_SMTP_HOST=smtp-relay.brevo.com
MAIL_SMTP_PORT=587
MAIL_SMTP_SECURE=false
MAIL_SMTP_USER=
MAIL_SMTP_PASS=
MAIL_FROM=no-responder@dental3d.com
```

Con `API_PROCESSES=2` se usan dos núcleos. La fórmula de conexiones está en `DEPLOY.md`: (3 × sucursales activas + 10) × 2 tiene que quedar por debajo de 400.

## 5. Script de despliegue

En **Site → Deployments → Deploy Script**, reemplaza el contenido por:

```sh
set -e
cd /home/forge/dental3d.com
git pull origin $FORGE_SITE_BRANCH

# El .env de Forge (raíz del sitio) es el de la API
ln -sf ../.env server/.env

# API: instalar, compilar y aplicar migraciones nuevas en TODAS las sucursales
cd server
npm ci
npm run build
npm run db:migrate
cd ..

# Frontend: instalar y compilar (.output/)
npm ci
npm run build

# Reiniciar los dos procesos: se les pide cerrar en orden (terminan lo que están atendiendo)
# y el supervisor de Forge los vuelve a levantar con el código nuevo
# (los [ ] hacen que el patrón no se encuentre a sí mismo en el comando de este script)
pkill -TERM -u forge -f "dental3d-ap[i]" || true
pkill -TERM -u forge -f "dental3d-we[b]" || true
```

El reinicio corta el servicio unos segundos. Si prefieres reiniciar desde el panel, quita las dos líneas `pkill` y usa **Daemons → Restart** después de cada despliegue.

## 6. Primer despliegue y llave

1. Pulsa **Deploy Now** una vez. El primer `db:migrate` fallará, porque todavía no hay `TENANCY_KEY` ni tablas: es normal.
2. Por SSH, genera la llave y crea las tablas centrales y el dueño del panel:

```sh
cd /home/forge/dental3d.com/server
npx tenancy key:generate          # copia el resultado (base64:...) en TENANCY_KEY (paso 4)
npm run db:install
OWNER_PASS='<12+ caracteres>' npx tenancy admin:user tu@email.com --role=owner --password-env=OWNER_PASS
```

3. Vuelve a pulsar **Deploy Now**. Esta vez tiene que terminar sin errores.

## 7. Los dos procesos (Daemons)

En **Server → Daemons → New Daemon** **(revisar en Forge)** crea dos. Usuario: `forge`.

| | Comando | Directorio |
|---|---|---|
| API | `node --title=dental3d-api dist/index.js` | `/home/forge/dental3d.com/server` |
| Web | `env PORT=3000 HOST=127.0.0.1 NODE_ENV=production node --title=dental3d-web .output/server/index.mjs` | `/home/forge/dental3d.com` |

El `--title` les pone ese nombre a los procesos: es lo que busca el `pkill` del script para reiniciarlos. Probado con `API_PROCESSES=2`: el proceso principal y sus dos procesos hijos cierran en orden en 1 segundo.

La API lee `NODE_ENV` del entorno. Si Forge no lo pone, agrégalo al comando: `env NODE_ENV=production node --title=dental3d-api dist/index.js`.

Para comprobar desde el servidor:

```sh
curl -s http://127.0.0.1:4000/api/health                                   # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dental3d.com" http://127.0.0.1:3000/   # 200
```

## 8. nginx

En **Site → Edit Nginx Configuration** deja las líneas de Forge que dicen `listen`, `server_name`, `ssl_*` y los `include` de Forge. Reemplaza el `root`, el `index` y los `location` existentes por estos:

```nginx
    client_max_body_size 6m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location ~ ^/(api|tenancy)/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;                       # la sucursal sale del subdominio
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # Panel de la plataforma: solo desde tu IP (oficina o VPN)
    location /admin/ {
        allow 203.0.113.10;        # ← tu IP
        deny all;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 15m;
    }

    location = /api/health { allow 127.0.0.1; deny all; proxy_pass http://127.0.0.1:4000; }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

`server_name` tiene que incluir `dental3d.com *.dental3d.com`, lo que Forge pone a partir de los aliases.

## 9. HTTPS para todas las sucursales

En **Site → SSL → Let's Encrypt** pide el certificado para `dental3d.com` y `*.dental3d.com`. Un **comodín** necesita validación por **DNS**: Forge pide la API key de tu proveedor de DNS (Cloudflare, DigitalOcean…). **(revisar en Forge)**

Si tu DNS no está entre los soportados, pide un certificado con los nombres exactos (`dental3d.com, calacoto.dental3d.com, chasquipampa.dental3d.com`) y agrega cada sucursal nueva cuando la crees.

## 10. Verificación

- `https://dental3d.com/admin/`: el panel, solo desde tu IP. Crea una sucursal, por ejemplo `calacoto`.
- `https://calacoto.dental3d.com`: la portada de la sucursal. En `/auth` va el login (la primera vez, con "Entrar como" desde el panel).
- "¿Olvidaste tu contraseña?": tiene que llegar el correo.
- `curl -s https://noexiste.dental3d.com/api/public/studies` → `TENANCY_TENANT_NOT_FOUND`.

## 11. Respaldos

Forge puede respaldar bases desde su panel **(revisar en Forge)**, pero hay que incluir **todas** las bases `dental_*`, no solo la central. Lo más simple es el script de este repositorio: respalda la base central, cada sucursal y los archivos.

1. Crea un usuario MySQL de solo lectura para respaldos (`sudo mysql`):

```sql
CREATE USER 'dental3d_backup'@'localhost' IDENTIFIED BY '<otra contraseña>';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, PROCESS ON *.* TO 'dental3d_backup'@'localhost';
```

2. Pon sus datos en `/home/forge/.my.cnf` (`chmod 600`):

```ini
[client]
user=dental3d_backup
password=<otra contraseña>
```

3. Prográmalo en **Server → Scheduler**, todos los días a las 03:30, como usuario `forge`:

```sh
APP_DIR=/home/forge/dental3d.com BACKUP_DIR=/home/forge/backups STORAGE_DIR=/home/forge/dental3d-storage/public PRIVATE_STORAGE_DIR=/home/forge/dental3d-storage/private bash /home/forge/dental3d.com/deploy/backup.sh
```

Conserva 30 días. **Copia los respaldos fuera del servidor**: otro disco, S3, etc.

## 12. Actualizar

Haz `git push` a `master` y pulsa **Deploy Now** (o activa "Quick Deploy" para que despliegue solo en cada push). El script compila, migra todas las sucursales y reinicia.

## Checklist de seguridad (lo mismo que en `DEPLOY.md`)

- [ ] `TENANCY_KEY` y `JWT_SECRET` guardados también en un gestor de secretos.
- [ ] Firewall de Forge con solo 22, 80 y 443 abiertos. Los puertos 4000 y 3000 escuchan en 127.0.0.1.
- [ ] `/admin/` limitado a tu IP, y 2FA activado para los usuarios del panel (Mi cuenta → 2FA).
- [ ] Respaldos diarios de todas las bases y de `dental3d-storage`, copiados fuera del servidor.
