#!/usr/bin/env bash
# Ejecuta en el servidor, vía SSM, los comandos del archivo recibido (uno por línea),
# espera a que terminen, muestra su salida y falla si el despliegue falló.
# Requiere INSTANCE_ID en el entorno.
set -euo pipefail

COMMANDS_FILE="${1:?Falta el archivo de comandos}"
PARAMETERS=$(jq -R . "$COMMANDS_FILE" | jq -s '{commands: .}')
# En un rollback el commit que se despliega (IMAGE_TAG) no es el del workflow: el historial de SSM
# debe mostrar el que realmente quedó en el servidor.
DEPLOYED_SHA="${IMAGE_TAG:-$GITHUB_SHA}"

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "GitHub Actions ${GITHUB_REPOSITORY##*/} ${DEPLOYED_SHA:0:7}" \
  --parameters "$PARAMETERS" \
  --query Command.CommandId --output text)

echo "Comando enviado al servidor: $COMMAND_ID"

STATUS=Pending
for _ in $(seq 1 120); do
  sleep 5
  STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending | InProgress | Delayed) ;;
    *) break ;;
  esac
done

echo "----- Salida en el servidor -----"
aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text || true
echo "----- Errores en el servidor -----"
aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query StandardErrorContent --output text || true

echo "Resultado: $STATUS"
[ "$STATUS" = Success ]
