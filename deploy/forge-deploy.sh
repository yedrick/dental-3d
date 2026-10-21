#!/usr/bin/env bash
# Despliegue en Laravel Forge. El "Deploy Script" del sitio en Forge solo tiene que llamar a este
# archivo (después del git pull), así los pasos viven en el repositorio y no dependen del nombre
# de la carpeta del sitio:
#
#   set -e
#   cd $FORGE_SITE_PATH
#   git pull origin $FORGE_SITE_BRANCH
#   bash deploy/forge-deploy.sh
#
set -euo pipefail

# Raíz del repositorio, sea cual sea la carpeta del sitio (/home/forge/<sitio>).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "→ Desplegando $(git log --oneline -1) en $ROOT"

# El .env de Forge (raíz del sitio) es el de la API.
if [ -f .env ]; then ln -sf ../.env server/.env; fi
if [ ! -e server/.env ]; then
  echo "✗ Falta el .env (Forge → Site → Environment)" >&2
  exit 1
fi

# API: instalar, compilar y migrar. db:migrate corre antes `tenancy install` (tablas centrales
# nuevas de tenancy-node) y después las migraciones de TODAS las sucursales.
echo "→ API"
cd "$ROOT/server"
npm ci
npm run build
npm run db:migrate

# Frontend: instalar y compilar (.output/).
echo "→ Frontend"
cd "$ROOT"
npm ci
npm run build

# Reiniciar los dos procesos (los daemons de Forge usan --title=dental3d-api / dental3d-web, o
# ionix-api / ionix-web después del cambio de nombre: sirven los dos):
# se les pide cerrar en orden y el supervisor de Forge los vuelve a levantar con el código nuevo.
# Los [ ] evitan que el patrón se encuentre a sí mismo.
echo "→ Reinicio"
pkill -TERM -u "$(id -un)" -f "(dental3d|ionix)-ap[i]" || true
pkill -TERM -u "$(id -un)" -f "(dental3d|ionix)-we[b]" || true

echo "✓ Desplegado $(git log --oneline -1)"
