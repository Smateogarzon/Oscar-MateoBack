
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
