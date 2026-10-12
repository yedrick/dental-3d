# Desplegar Dental-3D en un servidor propio

Guía para publicar el backend (`server/`) y el frontend (raíz del repo) en un servidor Linux propio, con un **subdominio por sucursal** (`central.tudominio.com`, `sur.tudominio.com`…).

Se probó en local el mismo esquema: API compilada, frontend compilado y nginx con esta configuración. Login, dashboard, API, sucursales y límites de tamaño funcionaron.

```
internet ──443──► nginx ──┬── /api, /tenancy ──► API Node     127.0.0.1:4000  (dental3d-api)
                          └── todo lo demás ───► frontend Node 127.0.0.1:3000  (dental3d-web)
API ──► MySQL 127.0.0.1:3306: dental3d_central + dental_<sucursal> (una base por sucursal)
```

En esta guía, `dental3d.com` es un ejemplo: reemplázalo por tu dominio en todos los archivos.

**No usa Docker:** MySQL, Redis y nginx se instalan directo en el servidor, y la API y el frontend corren como servicios de systemd.

## 0. Requisitos

- Linux (Ubuntu 22.04/24.04 o Debian 12), con acceso `sudo`.
- **Node.js 20 o superior** (recomendado 22 LTS).
- **MySQL 8.0.13 o superior** (recomendado 8.4).
- nginx 1.25 o superior.
- Redis 7 (recomendado: `apt install redis-server`, escuchando solo en `127.0.0.1`).
- certbot con el plugin DNS de tu proveedor (para el certificado comodín).
- Un dominio con dos registros DNS apuntando a la IP del servidor: `dental3d.com` y `*.dental3d.com`.
- Firewall: abrir solo los puertos 22, 80 y 443. **MySQL no debe quedar expuesto.**

### Instalar los requisitos (Ubuntu 24.04)

```sh
sudo apt update && sudo apt upgrade -y
# Node.js 22 (queda en /usr/bin/node, que es lo que usan los servicios de systemd)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
# MySQL, Redis y nginx
sudo apt install -y mysql-server redis-server nginx
# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
node -v && mysql --version && redis-cli ping && nginx -v
```

- Ubuntu 24.04 trae MySQL 8.0, que sirve: hace falta 8.0.13 o más nuevo. Como root de MySQL se entra con `sudo mysql`.
- Redis queda escuchando solo en `127.0.0.1`, que es lo correcto. Se comprueba con `ss -ltn | grep 6379`.

## 1. Usuario y carpeta

```sh
sudo useradd --system --create-home --home-dir /opt/dental3d --shell /usr/sbin/nologin dental3d
sudo -u dental3d git clone <url-del-repo> /opt/dental3d
cd /opt/dental3d && sudo -u dental3d git checkout dev   # o la rama que se publique
```

**Si el repositorio es privado** (GitHub), el servidor necesita permiso de lectura. Usa una *deploy key*:
- `sudo -u dental3d ssh-keygen -t ed25519 -f /opt/dental3d/.ssh/id_ed25519 -N ""`;
- pega `/opt/dental3d/.ssh/id_ed25519.pub` en GitHub → el repo → Settings → Deploy keys (solo lectura);
- clona con `git@github.com:<usuario>/<repo>.git`.

**Sin git en el servidor:** desde tu máquina, `rsync -az --exclude node_modules --exclude .output --exclude server/dist --exclude server/.env --exclude server/storage --exclude server/storage-private ./ usuario@servidor:/tmp/dental3d/`. Después, en el servidor, `sudo rsync -a /tmp/dental3d/ /opt/dental3d/ && sudo chown -R dental3d: /opt/dental3d`, y sigue con los pasos 3 y 4: se compila en el servidor.

## 2. MySQL

En `/etc/mysql/mysql.conf.d/dental3d.cnf`:

```ini
[mysqld]
default-time-zone = '+00:00'      # obligatorio: las fechas se guardan en UTC
bind-address      = 127.0.0.1
character-set-server = utf8mb4
collation-server     = utf8mb4_unicode_ci
max_connections      = 400        # ver "Conexiones" abajo
```

**Conexiones:** cada sucursal con tráfico abre hasta `TENANT_POOL_MAX` conexiones (5 por defecto); la base central, hasta `CENTRAL_POOL_MAX` (30). Tiene que cumplirse:

```
(TENANT_POOL_MAX × sucursales activas a la vez + CENTRAL_POOL_MAX) × API_PROCESSES  <  max_connections
```

El valor por defecto de MySQL (151) alcanza para unas 20 sucursales activas. Con 400 alcanza para unas 70. Los pools sin uso se cierran solos a los `TENANT_POOL_IDLE_MS` (60 s).

Después, `sudo systemctl restart mysql` y, como root de MySQL:

```sql
CREATE DATABASE dental3d_central CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Usuario de tenancy-node: crea la base y el usuario MySQL de cada sucursal
CREATE USER 'tenancy_admin'@'localhost' IDENTIFIED BY '<contraseña larga y aleatoria>';
GRANT ALL PRIVILEGES ON `dental3d_central`.* TO 'tenancy_admin'@'localhost';
GRANT ALL PRIVILEGES ON `dental\_%`.* TO 'tenancy_admin'@'localhost' WITH GRANT OPTION;
GRANT CREATE USER ON *.* TO 'tenancy_admin'@'localhost';

-- Usuario de solo lectura para los respaldos
CREATE USER 'dental3d_backup'@'localhost' IDENTIFIED BY '<otra contraseña>';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, PROCESS ON *.* TO 'dental3d_backup'@'localhost';
```

Cada sucursal tendrá su propio usuario MySQL (`credentials: 'per-tenant'`), con acceso **solo** a su base.

## 3. Backend (`server/`)

```sh
cd /opt/dental3d/server
sudo -u dental3d npm ci
sudo -u dental3d npm run build                  # compila a dist/
sudo -u dental3d cp .env.example .env
sudo -u dental3d mkdir -p storage storage-private
sudo chmod 600 .env
```

Edita `server/.env`:

| Variable | Valor en producción |
|---|---|
| `PORT` / `HOST` | `4000` / `127.0.0.1` (solo nginx llega a la API) |
| `TRUST_PROXY` | `1` (nginx está delante: así los límites de intentos ven la IP real) |
| `CORS_ORIGIN` | `https://dental3d.com` (el frontend usa el mismo host, CORS casi no interviene) |
| `CENTRAL_DOMAINS` | `dental3d.com` (las sucursales son sus subdominios) |
| `BUSINESS_UTC_OFFSET` | `-04:00` (Bolivia) |
| `DATABASE_URL` | `mysql://tenancy_admin:<contraseña>@127.0.0.1:3306/dental3d_central` |
| `TENANCY_KEY` | generada con `npx tenancy key:generate`. **Guárdala también fuera del servidor** (gestor de secretos): sin ella no se pueden abrir las bases de las sucursales |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `STORAGE_DIR` / `PRIVATE_STORAGE_DIR` | `./storage` / `./storage-private` |
| `REDIS_URL` | `redis://127.0.0.1:6379`: caché compartida por sucursal (sesiones, catálogos, página web, reportes) |
| `CENTRAL_POOL_MAX` | `30`. **No crear más sucursales a la vez que este número**: tenancy-node 0.10 se bloquea entero (ver `server/TENANCY-NODE-REPORTE.md`, punto 8) |
| `TENANT_POOL_MAX` / `TENANT_MAX_OPEN_POOLS` / `TENANT_POOL_IDLE_MS` | `5` / `100` / `60000`: ver "Conexiones" en el paso 2 |
| `API_PROCESSES` | Procesos de la API, uno por núcleo libre (deja núcleos para MySQL y el frontend). Medido con k6: **1 proceso ≈ 750 peticiones/s, 4 ≈ 1500**. Con más de 1 hace falta `REDIS_URL`. Con 4 procesos, bajar los pools: `TENANT_POOL_MAX=3` y `CENTRAL_POOL_MAX=10` |
| `TENANCY_ADMIN_SECRET` | `openssl rand -base64 48`: enciende el **panel de la plataforma** en `https://dental3d.com/admin/` |
| `ADMIN_SECURE_COOKIES` | `true` |
| `TENANT_PUBLIC_URL` | `https://{tenant}.dental3d.com` ("Entrar como…" abre esta dirección) |

Crear las tablas centrales y el **dueño de la plataforma** (el usuario del panel):

```sh
sudo -u dental3d npm run db:install
sudo -u dental3d OWNER_PASS='<contraseña de 12+ caracteres>' npx tenancy admin:user tu@email.com --role=owner --password-env=OWNER_PASS
```

### Crear sucursales desde el panel (recomendado)

1. Entra a `https://dental3d.com/admin/` con el usuario dueño. Solo desde las IP permitidas en nginx (paso 6).
2. **Tenants → Nuevo tenant**: id `calacoto`, nombre "3D Dental Calacoto". El panel muestra el progreso:
   - crea la base `dental_calacoto` y su usuario MySQL;
   - aplica las migraciones;
   - crea el **ADMIN por defecto** (`admin`, cuenta "por activar").
3. **Tema**: color principal, demás colores y logo. El logo también se puede cambiar después desde la app, en "Marca de la sucursal".
4. **Usuarios → Entrar como** en el usuario "Administrador". Se abre `https://calacoto.dental3d.com` con la sesión iniciada y la app pide **activar la cuenta**: nombre, usuario, email y contraseña. En la misma pestaña se pueden crear más usuarios para la sucursal.
5. Listo: `https://calacoto.dental3d.com` ya funciona con ese usuario.

Desde el panel también se puede suspender una sucursal o ponerla en mantenimiento, ver su auditoría y sus migraciones, y explorar sus datos (solo lectura).

### Alternativas por terminal

- Crear una sucursal: `npm run tenant:create -- calacoto --name="3D Dental Calacoto"`. También deja el ADMIN por defecto.
- Activar o reemplazar el ADMIN sin el panel:

  ```sh
  sudo -u dental3d ADMIN_PASSWORD='<Contraseña123!>' npm run prod:create-admin -- calacoto admin@clinica.com admin "Nombre Apellido"
  ```

- **Copiar los datos de Supabase:** ver el [paso 9](#9-el-día-del-corte-desde-supabase). Se hace sobre una sucursal recién creada, **sin activar** su ADMIN por defecto (la importación lo reemplaza).

Opcional: `npm prune --omit=dev` quita las herramientas de desarrollo. La CLI `tenancy` y los scripts `prod:*` siguen funcionando.

## 4. Frontend (raíz del repo)

```sh
cd /opt/dental3d
sudo -u dental3d npm install
sudo -u dental3d npm run build          # genera .output/ (servidor Node, no Cloudflare)
```

- No necesita variables de entorno: llama a `/api` en el mismo host.
- El `.env` de la raíz (claves de Supabase) ya no se usa.

## 5. Servicios (systemd)

```sh
sudo cp deploy/systemd/dental3d-api.service deploy/systemd/dental3d-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dental3d-api dental3d-web
sudo systemctl status dental3d-api dental3d-web
journalctl -u dental3d-api -f        # logs en JSON, con la sucursal de cada petición
```

Los servicios corren como el usuario `dental3d`. La API solo puede escribir en `storage/` y `storage-private/`.

## 6. nginx

```sh
sudo cp deploy/nginx/dental3d.conf /etc/nginx/sites-available/dental3d.conf
sudo sed -i 's/dental3d\.com/tudominio.com/g' /etc/nginx/sites-available/dental3d.conf
sudo ln -s /etc/nginx/sites-available/dental3d.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Puntos clave de la configuración:
- `proxy_set_header Host $host` en `/api` y `/tenancy`: la API reconoce la sucursal por el subdominio. **No actives `trustProxy` de tenancy-node.**
- `/admin/` (panel de la plataforma) está **cerrado por IP**. Agrega `allow <IP de tu oficina o VPN>;` antes de `deny all;`. El módulo recomienda no exponerlo a internet. Con `TRUST_PROXY=1`, su límite de intentos de login ve la IP real de cada persona (corregido en tenancy-node 0.9).

## 7. Certificado HTTPS comodín

Un comodín (`*.dental3d.com`) solo se emite con validación DNS. Ejemplo con Cloudflare (hay plugins para la mayoría de los proveedores):

```sh
sudo apt install certbot python3-certbot-dns-cloudflare
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.cloudflare.ini \
  -d dental3d.com -d '*.dental3d.com'
sudo systemctl reload nginx
```

La renovación es automática (`systemctl list-timers | grep certbot`).

**Si tu proveedor de DNS no tiene plugin de certbot:** saca un certificado normal con todos los nombres, sin comodín: `sudo certbot certonly --nginx -d dental3d.com -d calacoto.dental3d.com -d chasquipampa.dental3d.com`. Cada sucursal nueva necesita su registro DNS y volver a correr el comando, sumando el nombre nuevo con `--expand`. En `dental3d.conf`, la ruta del certificado es la que muestra certbot.

## 8. Respaldos

```sh
sudo cp deploy/backup.sh /usr/local/bin/dental3d-backup && sudo chmod 700 /usr/local/bin/dental3d-backup
# credenciales del usuario dental3d_backup en /root/.my.cnf ([client] user=… password=…), chmod 600
echo '30 3 * * * root APP_DIR=/opt/dental3d /usr/local/bin/dental3d-backup >> /var/log/dental3d-backup.log 2>&1' | sudo tee /etc/cron.d/dental3d-backup
```

- Respalda la base central, **cada sucursal** y los archivos (logos y comprobantes). Conserva 30 días.
- **Copia los respaldos fuera del servidor** (otro disco, S3, etc.).
- Prueba restaurar uno al menos una vez al mes.

## 9. El día del corte desde Supabase

1. Congelar los cambios en el sistema actual (Lovable).
2. Crear la sucursal (panel o `npm run tenant:create -- central --name="…"`) **sin activar** su ADMIN por defecto.
3. Simulación, revisar el informe (conteos, sumas, observaciones):

   ```sh
   SUPABASE_DB_URL='postgresql://postgres:<clave>@db.<proyecto>.supabase.co:5432/postgres?sslmode=require' \
     npm run prod:import-supabase -- central --dry-run
   ```

4. Importación real, con los comprobantes:

   ```sh
   SUPABASE_DB_URL=… SUPABASE_URL=https://<proyecto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
     npm run prod:import-supabase -- central
   ```

5. Entrar con un usuario existente: las contraseñas se conservan.
6. Anunciar la nueva dirección: `https://central.tudominio.com`.

Detalles en `server/README.md`, sección "Copiar datos desde Supabase".

## 10. Actualizar a una versión nueva

```sh
cd /opt/dental3d && sudo -u dental3d git pull
# backend
cd server && sudo -u dental3d npm ci && sudo -u dental3d npm run build \
  && sudo -u dental3d npm run db:migrate && sudo systemctl restart dental3d-api
# frontend
cd .. && sudo -u dental3d npm install && sudo -u dental3d npm run build && sudo systemctl restart dental3d-web
```

- `db:migrate` aplica las migraciones nuevas de `server/db/tenant/` a **todas** las sucursales.
- Haz un respaldo antes de migrar.

## 11. Verificación rápida

```sh
curl -s http://127.0.0.1:4000/api/health                    # {"ok":true}
curl -s https://central.dental3d.com/tenancy/me              # nombre y tema de la sucursal
curl -s -o /dev/null -w "%{http_code}\n" https://central.dental3d.com/auth   # 200
curl -s https://noexiste.dental3d.com/api/public/studies     # TENANCY_TENANT_NOT_FOUND
```

## Checklist de seguridad

- [ ] `server/.env` con `chmod 600` y fuera de git (ya está en `.gitignore`).
- [ ] `TENANCY_KEY` y `JWT_SECRET` únicos y guardados en un gestor de secretos.
- [ ] MySQL en `127.0.0.1` y con `default-time-zone=+00:00`.
- [ ] La API y el frontend escuchan solo en `127.0.0.1`.
- [ ] Firewall con solo 22, 80 y 443.
- [ ] HTTPS con comodín y HSTS activo.
- [ ] Respaldos diarios, copiados fuera del servidor, y una restauración probada.
- [ ] El usuario `tenancy_admin` no es `root` de MySQL.
- [ ] `/admin/` limitado a las IP de la oficina o VPN, y 2FA activada para los usuarios del panel (Mi cuenta → 2FA).
