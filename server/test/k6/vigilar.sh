#!/usr/bin/env bash
# Mientras corre una prueba, anota cada 5 s qué se está gastando en el servidor (para ver qué se agota primero).
#   ./vigilar.sh [segundos_total]     → resultados/vigilar-<fecha>.csv   (Ctrl+C para parar)
# Variables: MYSQL_CMD (cómo llamar a mysql), API_PORT (4000), REDIS_CLI.
set -uo pipefail
export LC_ALL=C   # punto decimal (con es_BO saldría coma y rompería el CSV)
cd "$(dirname "$0")"; mkdir -p resultados
MYSQL_CMD="${MYSQL_CMD:-docker exec dental3d-mysql mysql -uroot -proot_dev_password}"
API_PORT="${API_PORT:-4000}"
REDIS_CLI="${REDIS_CLI:-docker exec dental3d-k6-redis redis-cli}"
OUT="resultados/vigilar-$(date +%Y%m%d-%H%M%S).csv"
FIN=$(( $(date +%s) + ${1:-36000} ))
PID=$(ss -ltnpH "sport = :$API_PORT" | grep -oP 'pid=\K[0-9]+' | head -1)
# CPU de la API en cada intervalo (100 % = un núcleo entero), con todos sus hilos (incluye los de bcrypt)
# Con API_PROCESSES > 1 se suman el proceso principal y sus procesos hijos
pids() { echo "$PID" $(pgrep -P "$PID" 2>/dev/null); }
ticks() { for p in $(pids); do awk '{print $14 + $15}' "/proc/$p/stat" 2>/dev/null; done | awk '{s+=$1} END{print s+0}'; }
HZ=$(getconf CLK_TCK); T0=$(ticks); S0=$(date +%s.%N)
echo "hora,api_cpu_pct,api_mem_mb,mysql_conexiones,mysql_en_curso,mysql_max_usadas_desde_inicio,redis_mem_mb,carga_1m" > "$OUT"
echo "Anotando en $OUT (API pid ${PID:-?})"
while [ "$(date +%s)" -lt "$FIN" ]; do
  T1=$(ticks); S1=$(date +%s.%N)
  CPU=$(awk -v a="$T0" -v b="$T1" -v s="$S0" -v e="$S1" -v hz="$HZ" 'BEGIN{printf "%.0f", (b-a)/hz/(e-s)*100}'); T0=$T1; S0=$S1
  MEM=$(ps -o rss= -p "$(pids | tr ' ' ',')" 2>/dev/null | awk '{s+=$1} END{printf "%.0f", s/1024}')
  read -r CON RUN MAXU < <($MYSQL_CMD -N -e "SELECT (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Threads_connected'), (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Threads_running'), (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Max_used_connections')" 2>/dev/null)
  RMEM=$($REDIS_CLI info memory 2>/dev/null | awk -F: '/^used_memory:/{printf "%.1f", $2/1048576}')
  echo "$(date +%T),${CPU:-},${MEM:-},${CON:-},${RUN:-},${MAXU:-},${RMEM:-},$(cut -d' ' -f1 /proc/loadavg)" | tee -a "$OUT"
  sleep 5
done
