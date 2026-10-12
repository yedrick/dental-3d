#!/usr/bin/env bash
# Corre una prueba k6 en Docker (no hace falta instalar k6).
#   ./correr.sh api <perfil>     perfil: humo | carga | estres | pico | resistencia | capacidad
#   ./correr.sh paginas          velocidad de páginas en navegador (necesita nginx y el frontend)
#   ./correr.sh nginx            levanta el nginx de pruebas en el puerto 8088
# Variables útiles: ESCALA, PAUSA, LOGINS, DURACION, PASOS, MESETA, VUS, VUELTAS, API, WEB, DOMINIO.
# Además del resumen en pantalla, deja en resultados/: <prueba>-<fecha>.txt, .json y .html (gráficos).
set -euo pipefail
cd "$(dirname "$0")"
K6_IMAGE="grafana/k6:2.3.0-with-browser"
mkdir -p resultados
FECHA="$(date +%Y%m%d-%H%M%S)"

case "${1:-}" in
  nginx)
    docker rm -f dental3d-k6-nginx >/dev/null 2>&1 || true
    docker run -d --name dental3d-k6-nginx --network host -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine >/dev/null
    echo "nginx de pruebas en http://<sucursal>.localhost:8088"; exit 0 ;;
  api) SCRIPT=api.js; PERFIL="${2:-humo}"; NOMBRE="$PERFIL" ;;
  paginas) SCRIPT=paginas.js; PERFIL=""; NOMBRE=paginas ;;
  *) sed -n 2,8p "$0"; exit 1 ;;
esac

[ -f datos.json ] || { echo "Falta datos.json: corre primero  OWNER_PASS=... node preparar.mjs 20 k6a"; exit 1; }

docker run --rm -i --network host -u "$(id -u):$(id -g)" -e HOME=/tmp --shm-size=1g \
  -v "$PWD:/pruebas" -w /pruebas \
  -e PERFIL="$PERFIL" -e FECHA="$FECHA" \
  -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_EXPORT="resultados/$NOMBRE-$FECHA.html" \
  -e K6_WEB_DASHBOARD_PORT=-1 \
  ${ESCALA:+-e ESCALA="$ESCALA"} ${PAUSA:+-e PAUSA="$PAUSA"} ${DURACION:+-e DURACION="$DURACION"} \
  ${LOGINS:+-e LOGINS="$LOGINS"} ${PASOS:+-e PASOS="$PASOS"} ${MESETA:+-e MESETA="$MESETA"} ${MAX_VUS:+-e MAX_VUS="$MAX_VUS"} \
  ${VUS:+-e VUS="$VUS"} ${VUELTAS:+-e VUELTAS="$VUELTAS"} ${API:+-e API="$API"} ${WEB:+-e WEB="$WEB"} \
  ${DOMINIO:+-e DOMINIO="$DOMINIO"} ${K6_USER_PASS:+-e K6_USER_PASS="$K6_USER_PASS"} \
  "$K6_IMAGE" run --quiet "$SCRIPT"
