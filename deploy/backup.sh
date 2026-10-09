#!/usr/bin/env bash
# Respaldo diario de Dental-3D: base central, base de CADA sucursal y archivos (logos y comprobantes).
# Cron sugerido (como root o un usuario con acceso de lectura):
#   30 3 * * *  /opt/dental3d/deploy/backup.sh >> /var/log/dental3d-backup.log 2>&1
# Credenciales en ~/.my.cnf del usuario que lo corre (usuario MySQL con SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dental3d}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dental3d}"
KEEP_DAYS="${KEEP_DAYS:-30}"
CENTRAL_DB="${CENTRAL_DB:-dental3d_central}"
TENANT_PREFIX="${TENANT_PREFIX:-dental_}"   # mismo "prefix" que src/tenancy/config.ts

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
chmod 700 "$BACKUP_DIR" "$DEST"

dump() {
  mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF "$1" | gzip > "$DEST/$1.sql.gz"
  echo "✔ $1"
}

dump "$CENTRAL_DB"
for db in $(mysql -N -e "SHOW DATABASES LIKE '${TENANT_PREFIX//_/\\_}%'"); do
  dump "$db"
done

# Logos (públicos) y comprobantes (privados)
tar -czf "$DEST/storage.tar.gz" -C "$APP_DIR/server" storage storage-private 2>/dev/null || true
echo "✔ archivos"

# La llave TENANCY_KEY NO va en el respaldo: guárdala aparte (gestor de secretos). Sin ella no se
# pueden abrir las credenciales de las sucursales al restaurar.

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "Respaldo listo: $DEST"
