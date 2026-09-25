#!/bin/bash
# Despliega un servicio en el servidor. Lo ejecuta GitHub Actions vía SSM, como root:
#   deploy.sh backend <etiqueta>
#   deploy.sh web <etiqueta>
# Si la versión nueva no queda funcionando, vuelve a levantar la anterior y sale con error.
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

# La etiqueta que está sirviendo hoy: solo se registra en .env cuando una versión ya respondió
# (ver el final). Se lee ANTES de sobrescribirla, para poder volver a ella si esta falla.
PREV_TAG=$(grep -m1 "^${TAG_VAR}=" .env | cut -d= -f2- || true)

BACKEND_ENV_TMP=""
cleanup() {
  if [ -n "$BACKEND_ENV_TMP" ]; then rm -f "$BACKEND_ENV_TMP"; fi
}
trap cleanup EXIT

if [ "$SERVICE" = backend ]; then
  # Se lee en cada despliegue: un cambio en Parameter Store se aplica con el siguiente
  # despliegue del backend, sin tocar el servidor.
  # Se escribe primero a un archivo temporal y solo reemplaza a backend.env si aws respondió bien
  # y no vino vacío: así una falla de red o de permisos no deja al servidor sin configuración.
  BACKEND_ENV_TMP=$(mktemp backend.env.XXXXXX)
  if ! aws ssm get-parameter --name /oscarymateo/prod/backend-env --with-decryption \
    --region us-east-1 --query Parameter.Value --output text > "$BACKEND_ENV_TMP"; then
    echo "No pude leer el parámetro /oscarymateo/prod/backend-env: se deja la configuración actual." >&2
    exit 1
  fi
  if [ ! -s "$BACKEND_ENV_TMP" ]; then
    echo "El parámetro /oscarymateo/prod/backend-env llegó vacío: se deja la configuración actual." >&2
    exit 1
  fi
  # Lo que no cabe en el parámetro principal (uno Estándar admite 4096 caracteres) va en un segundo
  # parámetro con el mismo formato, líneas NOMBRE=valor: hoy, las llaves QZ. Se agrega al final de la
  # configuración y, si el principal también trae alguna variable, gana la del segundo (no quedan
  # duplicadas). El nombre del segundo parámetro es solo un nombre: puede traer varias variables.
  EXTRA_ENV_PARAM=/oscarymateo/prod/backend-env-extra/QZ_CERTIFICATE_B64
  if ! extra_env=$(aws ssm get-parameter --name "$EXTRA_ENV_PARAM" --with-decryption \
    --region us-east-1 --query Parameter.Value --output text); then
    echo "No pude leer el parámetro $EXTRA_ENV_PARAM: se deja la configuración actual." >&2
    exit 1
  fi
  if [ -z "$extra_env" ]; then
    echo "El parámetro $EXTRA_ENV_PARAM llegó vacío: se deja la configuración actual." >&2
    exit 1
  fi
  while IFS= read -r extra_line || [ -n "$extra_line" ]; do
    extra_line="${extra_line%$'\r'}"
    case "$extra_line" in '' | '#'*) continue ;; esac
    extra_name="${extra_line%%=*}"
    # Nunca se imprime la línea: trae secretos.
    if [ "$extra_name" = "$extra_line" ] || ! [[ "$extra_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "El parámetro $EXTRA_ENV_PARAM trae una línea que no es NOMBRE=valor: se deja la configuración actual." >&2
      exit 1
    fi
    sed -i "/^${extra_name}=/d" "$BACKEND_ENV_TMP"
    printf '%s\n' "$extra_line" >> "$BACKEND_ENV_TMP"
  done <<< "$extra_env"

  # La configuración con la que ya funcionaba la versión anterior, por si hay que volver a ella.
  cp -p backend.env backend.env.prev
  chmod 600 "$BACKEND_ENV_TMP"
  mv "$BACKEND_ENV_TMP" backend.env
  BACKEND_ENV_TMP=""
fi

export "$TAG_VAR=$TAG"
docker compose pull --quiet "$SERVICE"

if [ "$SERVICE" = backend ]; then
  # Revisa la configuración con la imagen nueva antes de tocar la base o el contenedor que
  # atiende: una variable faltante o una llave QZ dañada detiene el despliegue aquí y la versión
  # anterior sigue funcionando.
  docker compose run --rm --no-deps backend npm run check:env:prod

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

wait_ready() {
  for _ in $(seq 1 30); do
    sleep 3
    if [ "$SERVICE" = backend ]; then
      backend_ready && return 0
    elif docker compose ps --status running --services | grep -qx web; then
      return 0
    fi
  done
  return 1
}

READY=false
wait_ready && READY=true

if [ "$READY" != true ]; then
  echo "El servicio $SERVICE no quedó funcionando. Últimos logs:" >&2
  docker compose logs --tail 80 "$SERVICE" >&2

  # Sin esto el servicio quedaría caído hasta el siguiente despliegue.
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$TAG" ]; then
    echo "Se vuelve a la versión anterior de $SERVICE: $PREV_TAG" >&2
    if [ "$SERVICE" = backend ] && [ -s backend.env.prev ]; then
      cp -p backend.env.prev backend.env
    fi
    export "$TAG_VAR=$PREV_TAG"
    if docker compose up -d --no-deps "$SERVICE" && wait_ready; then
      echo "Se revirtió $SERVICE a $PREV_TAG: el despliegue de $TAG falló." >&2
    else
      echo "ERROR: tampoco quedó funcionando la versión anterior ($PREV_TAG). Revisa el servidor: docker compose logs $SERVICE" >&2
    fi
  else
    echo "No hay una versión anterior registrada a la que volver." >&2
  fi
  exit 1
fi

# La etiqueta queda registrada solo cuando la versión nueva ya responde.
sed -i "/^${TAG_VAR}=/d" .env
echo "${TAG_VAR}=${TAG}" >> .env

docker image prune -af > /dev/null

echo "Despliegue de $SERVICE completado: $TAG"
