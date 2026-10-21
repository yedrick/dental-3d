#!/usr/bin/env bash
# Borra las sucursales de prueba de datos.json (bases y usuarios MySQL incluidos) y apaga el nginx de pruebas.
# Ojo: en tenancy-node el id de una sucursal borrada queda reservado; la próxima vez usa otro prefijo.
set -euo pipefail
cd "$(dirname "$0")"
[ -f datos.json ] || { echo "No hay datos.json"; exit 0; }
for id in $(node -e 'for (const t of require("./datos.json").tenants) console.log(t.id)'); do
  (cd ../.. && npx tenancy delete "$id" --force >/dev/null 2>&1 && echo "borrada $id") || echo "no se pudo borrar $id"
done
rm -f datos.json
docker rm -f dental3d-k6-nginx >/dev/null 2>&1 || true
