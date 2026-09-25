#!/usr/bin/env bash
# Levanta la base de datos Postgres en Docker y aplica todas las migraciones.
# Uso:
#   ./scripts/db-setup.sh          -> levanta el contenedor (si ya existe, lo reutiliza) y corre migraciones pendientes
#   ./scripts/db-setup.sh --reset  -> borra el volumen de datos, levanta un Postgres limpio y corre TODAS las migraciones desde cero
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DB_USER="${DB_USER:-ferreyepes}"
DB_NAME="${DB_NAME:-ferreyepes}"

# Este script crea (y con --reset borra) datos: solo puede apuntar al Postgres local. "localhost" no
# basta, porque el túnel a producción de db-pull-prod.sh también es localhost (puerto 15432): el
# puerto tiene que ser el del Postgres local (5432) o pedirse a propósito con ALLOW_DB_WRITES=1.
case "${DB_HOST:-}" in
  localhost | 127.0.0.1) ;;
  *)
    echo "ERROR: DB_HOST='${DB_HOST:-}' no es local. Este script solo corre contra localhost o 127.0.0.1 (define DB_HOST=localhost en .env)." >&2
    exit 1
    ;;
esac
if [ "${DB_PORT:-5432}" != "5432" ] && [ "${ALLOW_DB_WRITES:-}" != "1" ]; then
  echo "ERROR: DB_PORT=${DB_PORT} no es el 5432 del Postgres local. Si es un túnel a producción, NO sigas: escribiría en producción." >&2
  echo "Si de verdad es otra base local, repite con ALLOW_DB_WRITES=1." >&2
  exit 1
fi

if [ "${1:-}" = "--reset" ]; then
  echo "==> Borrando contenedor y volumen actuales de Postgres..."
  docker compose down -v
fi

echo "==> Levantando Postgres..."
docker compose up -d

echo "==> Esperando a que Postgres acepte conexiones..."
until docker compose exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; do
  sleep 1
done

if [ ! -d node_modules ]; then
  echo "==> Instalando dependencias (node_modules no existe)..."
  npm install
fi

echo "==> Corriendo migraciones..."
npm run migration:run

echo "==> Listo. Base de datos '$DB_NAME' arriba y migrada."
