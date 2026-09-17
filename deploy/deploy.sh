#!/bin/bash
# Despliega un servicio en el servidor. Lo ejecuta GitHub Actions vía SSM, como root:
#   deploy.sh backend <etiqueta>
#   deploy.sh web <etiqueta>
set -euo pipefail

SERVICE="${1:?Falta el servicio: backend o web}"
TAG="${2:?Falta la etiqueta de la imagen}"

case "$SERVICE" in
  backend) TAG_VAR=BACKEND_TAG ;;
  web) TAG_VAR=WEB_TAG ;;
  *) echo "Servicio desconocido: $SERVICE" >&2; exit 1 ;;
esac

cd /opt/oscarymateo

# SSM no define HOME, y sin esto Docker no encuentra la configuración que le permite
# descargar de ECR usando el rol del servidor.
export DOCKER_CONFIG=/root/.docker

# Si los dos repos despliegan al mismo tiempo, uno espera a que termine el otro.
exec 9> deploy.lock
flock 9

touch .env backend.env
chmod 600 backend.env

if [ "$SERVICE" = backend ]; then
  # Se lee en cada despliegue: un cambio en Parameter Store se aplica con el siguiente
  # despliegue del backend, sin tocar el servidor.
  aws ssm get-parameter --name /oscarymateo/prod/backend-env --with-decryption \
    --region us-east-1 --query Parameter.Value --output text > backend.env
fi

export "$TAG_VAR=$TAG"
docker compose pull --quiet "$SERVICE"

if [ "$SERVICE" = backend ]; then
  # Las migraciones corren antes de reemplazar el contenedor: si fallan, el script se
  # detiene aquí y la versión anterior sigue atendiendo.
  docker compose run --rm --no-deps backend npm run migration:run:prod
fi

docker compose up -d --no-deps "$SERVICE"

backend_ready() {
  docker compose exec -T backend node -e "
    fetch('http://localhost:3000/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ ping }' }),
    }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
  " > /dev/null 2>&1
}

READY=false
for _ in $(seq 1 30); do
  sleep 3
  if [ "$SERVICE" = backend ]; then
    backend_ready && READY=true && break
  elif docker compose ps --status running --services | grep -qx web; then
    READY=true
    break
  fi
done

if [ "$READY" != true ]; then
  echo "El servicio $SERVICE no quedó funcionando. Últimos logs:" >&2
  docker compose logs --tail 80 "$SERVICE" >&2
  exit 1
fi

# La etiqueta queda registrada solo cuando la versión nueva ya responde.
sed -i "/^${TAG_VAR}=/d" .env
echo "${TAG_VAR}=${TAG}" >> .env

docker image prune -af > /dev/null

echo "Despliegue de $SERVICE completado: $TAG"
