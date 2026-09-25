#!/usr/bin/env bash
# Copia la base de datos de PRODUCCIÓN a la base local (Postgres en Docker).
# Uso (en Git Bash, desde Oscar-MateoBack):
#   bash scripts/db-pull-prod.sh                -> abre el túnel a producción, hace el dump, cierra el túnel y restaura en local
#   bash scripts/db-pull-prod.sh --yes          -> igual, sin pedir confirmación antes de borrar la base local
#   bash scripts/db-pull-prod.sh --no-keep      -> igual, pero al terminar borra también el dump (solo aplica al bajar de producción)
#   bash scripts/db-pull-prod.sh --file <dump>  -> no toca producción: restaura en local un dump que ya tienes
#                                                  (ruta estilo Git Bash: /c/Users/Usuario/prod.dump)
#
# Requisitos: AWS CLI v2 + Session Manager plugin, sesión iniciada con `aws login --profile oscarymateo`
# y el Postgres local arriba (docker compose up -d postgres).
# Producción solo se lee: el túnel existe únicamente mientras corre pg_dump y se cierra antes de restaurar.
# El dump trae datos reales. Queda en backups/ (fuera de git) solo el de la última corrida, para poder
# volver a dejar la base local como estaba con --file sin reconectar a producción; los anteriores se borran solos.
set -euo pipefail

# Git Bash convertiría rutas como /oscarymateo/prod/backend-env en rutas de Windows.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

# Con prefijo PROD_ para no confundirse con las variables AWS_* de otros proyectos en tu terminal.
PROD_AWS_PROFILE="${PROD_AWS_PROFILE:-oscarymateo}"
PROD_AWS_REGION="${PROD_AWS_REGION:-us-east-1}"
PROD_AWS_ACCOUNT_ID="${PROD_AWS_ACCOUNT_ID:-384078510350}"
PROD_INSTANCE_ID="${PROD_INSTANCE_ID:-i-04b6684e7c199a1e5}"
PROD_ENV_PARAM="${PROD_ENV_PARAM:-/oscarymateo/prod/backend-env}"
# Puerto local del túnel. No es el 5432 para no chocar con el Postgres local.
TUNNEL_PORT="${TUNNEL_PORT:-15432}"
BACKUP_DIR="$BACKEND_DIR/backups"

ASSUME_YES=false
KEEP_LATEST=true
PULLED=false
DUMP_FILE=""
PARTIAL_FILE=""
TUNNEL_PID=""
TUNNEL_LOG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=true ;;
    --no-keep) KEEP_LATEST=false ;;
    --file)
      DUMP_FILE="${2:?Falta la ruta del dump después de --file}"
      shift
      ;;
    *)
      echo "ERROR: opción desconocida: $1" >&2
      exit 1
      ;;
  esac
  shift
done

log() { echo "==> $*"; }
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# ¿Hay algo escuchando en ese puerto local? (best-effort: si /dev/tcp no existe, dice que no)
port_open() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

stop_tunnel() {
  [ -n "$TUNNEL_PID" ] || return 0
  log "Cerrando el túnel a producción..."
  if [ -r "/proc/$TUNNEL_PID/winpid" ]; then
    # Windows (Git Bash): /T mata también al session-manager-plugin, que es un proceso hijo.
    taskkill /F /T /PID "$(cat "/proc/$TUNNEL_PID/winpid")" > /dev/null 2>&1 || true
  else
    pkill -P "$TUNNEL_PID" 2> /dev/null || true
    kill "$TUNNEL_PID" 2> /dev/null || true
  fi
  wait "$TUNNEL_PID" 2> /dev/null || true
  TUNNEL_PID=""
  sleep 1
  if port_open "$TUNNEL_PORT"; then
    echo "AVISO: el puerto $TUNNEL_PORT sigue abierto: el túnel a producción NO se cerró. Ciérralo a mano (Administrador de tareas -> session-manager-plugin.exe)." >&2
  fi
}

# Corre siempre al salir (también con error o Ctrl+C): el túnel a producción nunca debe quedar abierto.
cleanup() {
  stop_tunnel
  rm -f "$TUNNEL_LOG" "$PARTIAL_FILE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

local_db_name() {
  docker compose exec -T postgres sh -c 'echo "$POSTGRES_DB"' | tr -d '\r'
}

check_aws_login() {
  command -v aws > /dev/null || fail "No encuentro el AWS CLI (aws)."
  command -v session-manager-plugin > /dev/null || fail "No encuentro el Session Manager plugin (session-manager-plugin)."
  local account
  account=$(aws sts get-caller-identity --profile "$PROD_AWS_PROFILE" --query Account --output text 2> /dev/null | tr -d '\r') \
    || fail "No hay sesión de AWS. Inicia sesión con: aws login --profile $PROD_AWS_PROFILE"
  [ "$account" = "$PROD_AWS_ACCOUNT_ID" ] \
    || fail "El perfil $PROD_AWS_PROFILE apunta a la cuenta '$account', no a la de producción ($PROD_AWS_ACCOUNT_ID)."
}

# $1 = nombre de la variable, $2 = contenido del parámetro (líneas CLAVE=valor)
env_value() {
  printf '%s\n' "$2" | tr -d '\r' | grep -m1 "^$1=" | cut -d= -f2- || true
}

read_prod_config() {
  log "Leyendo los datos de conexión de producción..."
  local raw
  raw=$(aws ssm get-parameter --name "$PROD_ENV_PARAM" --with-decryption --region "$PROD_AWS_REGION" \
    --profile "$PROD_AWS_PROFILE" --query Parameter.Value --output text) \
    || fail "No pude leer el parámetro $PROD_ENV_PARAM"
  PROD_DB_HOST=$(env_value DB_HOST "$raw")
  PROD_DB_PORT=$(env_value DB_PORT "$raw")
  PROD_DB_USER=$(env_value DB_USER "$raw")
  PROD_DB_NAME=$(env_value DB_NAME "$raw")
  PROD_DB_PASSWORD=$(env_value DB_PASSWORD "$raw")
  PROD_DB_PORT="${PROD_DB_PORT:-5432}"
  [ -n "$PROD_DB_HOST" ] && [ -n "$PROD_DB_USER" ] && [ -n "$PROD_DB_NAME" ] && [ -n "$PROD_DB_PASSWORD" ] \
    || fail "El parámetro $PROD_ENV_PARAM no trae DB_HOST, DB_USER, DB_NAME y DB_PASSWORD."
}

# $1 = de dónde saldrá la copia, para el aviso.
confirm_restore() {
  local db_name answer
  db_name=$(local_db_name)
  echo
  echo "Esto BORRA la base local '$db_name' (contenedor postgres de este proyecto) y la reemplaza con $1."
  echo "Apaga antes el backend local."
  if [ "$ASSUME_YES" != true ]; then
    read -r -p "Escribe 'si' para continuar: " answer
    [ "$answer" = "si" ] || fail "Cancelado: no se tocó nada."
  fi
}

start_tunnel() {
  if port_open "$TUNNEL_PORT"; then
    fail "El puerto $TUNNEL_PORT ya está en uso (¿sigue abierto un túnel anterior?). Ciérralo o cambia TUNNEL_PORT."
  fi
  TUNNEL_LOG="$(mktemp)"
  log "Abriendo el túnel a producción (puerto local $TUNNEL_PORT)..."
  aws ssm start-session --target "$PROD_INSTANCE_ID" --region "$PROD_AWS_REGION" --profile "$PROD_AWS_PROFILE" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "host=$PROD_DB_HOST,portNumber=$PROD_DB_PORT,localPortNumber=$TUNNEL_PORT" \
    > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  local waited=0
  until grep -q "Waiting for connections" "$TUNNEL_LOG" 2> /dev/null || port_open "$TUNNEL_PORT"; do
    if ! kill -0 "$TUNNEL_PID" 2> /dev/null; then
      cat "$TUNNEL_LOG" >&2
      TUNNEL_PID=""
      fail "El túnel se cerró al abrirse (ver arriba)."
    fi
    waited=$((waited + 1))
    if [ "$waited" -gt 30 ]; then
      cat "$TUNNEL_LOG" >&2
      fail "El túnel no quedó listo en 30 segundos."
    fi
    sleep 1
  done
}

# pg_dump corre dentro del contenedor local (Postgres 17): así no hay que instalar el cliente en Windows.
# Se escribe a un .partial y solo se renombra si terminó bien, para no dejar dumps a medias.
dump_prod() {
  mkdir -p "$BACKUP_DIR"
  DUMP_FILE="$BACKUP_DIR/prod-$(date +%Y%m%d-%H%M%S).dump"
  PARTIAL_FILE="$DUMP_FILE.partial"
  log "Haciendo el dump de producción (solo lectura)..."
  docker compose exec -T -e "PGPASSWORD=$PROD_DB_PASSWORD" postgres \
    pg_dump -h host.docker.internal -p "$TUNNEL_PORT" -U "$PROD_DB_USER" -d "$PROD_DB_NAME" \
    -Fc --no-owner --no-acl > "$PARTIAL_FILE" \
    || fail "pg_dump falló (ver arriba). Si dice 'server version mismatch', el RDS es más nuevo que el Postgres local."
  mv "$PARTIAL_FILE" "$DUMP_FILE"
  PARTIAL_FILE=""
  log "Dump guardado en $DUMP_FILE"
}

verify_dump() {
  [ -s "$DUMP_FILE" ] || fail "El dump no existe o está vacío: $DUMP_FILE"
  docker compose exec -T postgres pg_restore --list < "$DUMP_FILE" > /dev/null \
    || fail "El dump no se puede leer (¿incompleto o de otro formato?): $DUMP_FILE"
}

# Los dumps traen datos reales y crecen con la base: se conserva solo el de esta corrida (con --no-keep, ninguno).
# Solo toca los prod-*.dump que hace este script en backups/; nunca un dump que se pasó con --file.
prune_dumps() {
  local old removed=0
  for old in "$BACKUP_DIR"/prod-*.dump; do
    [ -e "$old" ] || continue
    if [ "$KEEP_LATEST" != true ] || [ "$old" != "$DUMP_FILE" ]; then
      rm -f "$old"
      removed=$((removed + 1))
    fi
  done
  if [ "$removed" -gt 0 ]; then log "Dumps borrados: $removed"; fi
}

restore_local() {
  log "Recreando la base local..."
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""'

  log "Restaurando el dump (puede tardar)..."
  docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' < "$DUMP_FILE" \
    || fail "pg_restore terminó con errores (ver arriba). La base local puede haber quedado incompleta; el dump sigue en $DUMP_FILE."

  local tables
  tables=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()"' | tr -d '\r')
  local origin="$DUMP_FILE"
  if [ "$PULLED" = true ]; then
    prune_dumps
    [ "$KEEP_LATEST" = true ] || origin="producción (dump borrado)"
  fi
  log "Listo. Base local '$(local_db_name)' restaurada desde $origin ($tables tablas)."
  echo "Siguiente: npm run migration:run   (aplica encima las migraciones que producción aún no tiene)"
}

command -v docker > /dev/null || fail "No encuentro Docker."
running=$(docker compose ps --status running --services 2> /dev/null || true)
grep -qx postgres <<< "$running" \
  || fail "El Postgres local no está corriendo. Levántalo con: docker compose up -d postgres"

if [ -z "$DUMP_FILE" ]; then
  check_aws_login
  read_prod_config
  confirm_restore "una copia nueva de producción"
  start_tunnel
  dump_prod
  PULLED=true
  stop_tunnel
else
  confirm_restore "$DUMP_FILE"
fi

verify_dump
restore_local
