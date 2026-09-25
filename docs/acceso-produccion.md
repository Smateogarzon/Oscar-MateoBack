# Acceso a producción: login de AWS y túnel a la base de datos

Cómo entrar a AWS con un perfil propio del proyecto y abrir un túnel seguro hasta la base de datos de producción (RDS) para copiarla a tu base local. Sirve para probar migraciones y datos reales sin tocar producción.

## Cómo funciona

```
tu PC                        AWS (cuenta de producción)
localhost:15432  ──SSM──▶  EC2 (i-04b6684e7c199a1e5)  ──▶  RDS Postgres :5432
```

- El RDS **no es público** y no se abre ningún puerto ni llave SSH: el túnel usa AWS Systems Manager (SSM), el mismo canal que ya usa el despliegue.
- El túnel solo existe mientras la terminal que lo abrió está corriendo. Cerrarla (`Ctrl+C`) lo corta.
- Con el túnel abierto, `localhost:15432` **es producción**. Se usa solo para `pg_dump`. El backend local siempre va contra su Postgres local en el `5432`.

## Datos fijos

| Dato                                    | Valor                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cuenta AWS                              | `384078510350`                                                                                      |
| Región                                  | `us-east-1`                                                                                         |
| Perfil local de AWS                     | `oscarymateo`                                                                                       |
| Instancia EC2                           | `i-04b6684e7c199a1e5`                                                                               |
| Parámetro SSM con la config del backend | `/oscarymateo/prod/backend-env` (trae `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`, …) |
| Puerto local del túnel                  | `15432`                                                                                             |

## Requisitos (una sola vez)

1. **AWS CLI v2, versión 2.32 o superior** (antes no existe `aws login`). Comprobar: `aws --version` debe decir `aws-cli/2.32` o más. Si sale `aws-cli/1.x` o una 2.x anterior, actualiza: desinstala la versión vieja (Configuración → Aplicaciones, o `pip uninstall awscli` si se instaló con pip) e instala la v2 desde <https://awscli.amazonaws.com/AWSCLIV2.msi>. Abre una terminal nueva y vuelve a comprobar.
2. **Session Manager plugin** (instalador de Windows de AWS). Comprobar: `session-manager-plugin` debe responder `The Session Manager plugin was installed successfully.`
3. **Docker Desktop** encendido y el Postgres local arriba (`docker compose up -d postgres`, desde `Oscar-MateoBack`).
4. **Git Bash** para correr el script (no PowerShell: allí `bash` puede abrir WSL).

## Login de AWS

Cada proyecto usa su **propio perfil con nombre**,y nunca se corre algo de este proyecto en la cuenta equivocada. Por eso **todos los comandos de AWS llevan `--profile oscarymateo`**.

```bash
aws login --profile oscarymateo
```

- Se abre el navegador: entra con tu usuario de la consola de la cuenta `384078510350`.
- Si pregunta la región: `us-east-1`.
- Queda una sesión con credenciales temporales (rol `OrganizationAccountAccessRole`). No se guardan llaves en el disco.
- La sesión caduca al cabo de unas horas: cuando un comando diga `NoCredentials` o que la sesión expiró, repite el login.

Comprobar con quién estás:

```bash
aws sts get-caller-identity --profile oscarymateo
```

`Account` debe ser `384078510350`.

> No uses las llaves del `.env` del backend (`AWS_ACCESS_KEY_ID`): son de un usuario que solo sube archivos al bucket y no puede abrir el túnel.

## Camino rápido: el script

Desde Git Bash, dentro de `Oscar-MateoBack`:

```bash
bash scripts/db-pull-prod.sh
```

Hace todo: comprueba el login, lee los datos de conexión de SSM, te pide confirmar, abre el túnel, hace el dump, **cierra el túnel** y restaura en tu base local. El dump queda en `backups/prod-<fecha>.dump`, y los de corridas anteriores se borran solos: **siempre hay un solo dump** (el último). Se conserva para poder dejar la base local como estaba, tras probar cosas, con `--file` y sin reconectar a producción.

| Comando                                                          | Qué hace                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bash scripts/db-pull-prod.sh`                                   | Dump nuevo de producción y restaurar en local                                               |
| `bash scripts/db-pull-prod.sh --yes`                             | Igual, sin pedir confirmación                                                               |
| `bash scripts/db-pull-prod.sh --no-keep`                         | Igual, pero al terminar borra también el dump (no queda ningún archivo con datos reales)    |
| `bash scripts/db-pull-prod.sh --file /c/Users/Usuario/prod.dump` | Restaurar en local un dump que ya tienes; no toca producción y nunca borra ese archivo      |

Variables opcionales (con estos valores por defecto): `PROD_AWS_PROFILE`, `PROD_AWS_REGION`, `PROD_AWS_ACCOUNT_ID`, `PROD_INSTANCE_ID`, `PROD_ENV_PARAM`, `TUNNEL_PORT`.

Después de restaurar, aplica encima las migraciones que producción todavía no tiene:

```bash
npm run migration:run
```

## Camino manual (paso a paso)

Útil para entender qué hace el script o si algo falla. Usa **2 terminales de PowerShell**.

**1. Ver los datos de conexión** (sin la contraseña):

```bash
(aws ssm get-parameter --name /oscarymateo/prod/backend-env --with-decryption --region us-east-1 --profile oscarymateo --query Parameter.Value --output text) -split "`n" | Select-String '^DB_(HOST|PORT|USER|NAME|SSL)='
```

**2. Terminal 1: abrir el túnel** (queda ocupada; no la cierres). Cambia `<DB_HOST>` por el valor del paso 1:

```bash
aws ssm start-session --target i-04b6684e7c199a1e5 --region us-east-1 --profile oscarymateo --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters "host=<DB_HOST>,portNumber=5432,localPortNumber=15432"
```

Debe imprimir `Port 15432 opened for sessionId ...` y `Waiting for connections...`.

**3. Terminal 2: comprobar que responde:**

```bash
docker run --rm postgres:17-alpine pg_isready -h host.docker.internal -p 15432
```

Debe decir `accepting connections`.

**4. Terminal 2: cargar la contraseña sin mostrarla.** Queda solo en esa ventana; imprime únicamente el largo:

```bash
$env:PGPASSWORD = (((aws ssm get-parameter --name /oscarymateo/prod/backend-env --with-decryption --region us-east-1 --profile oscarymateo --query Parameter.Value --output text) -split "`n" | Where-Object { $_ -like 'DB_PASSWORD=*' }) -replace '^DB_PASSWORD=','').Trim(); $env:PGPASSWORD.Length
```

**5. Terminal 2: el dump.** Corre en una carpeta que no sea un repo; el archivo queda ahí. Usa `-f` y no `>`, porque el `>` de PowerShell corrompe archivos binarios:

```bash
docker run --rm -e PGPASSWORD -v "${PWD}:/dump" postgres:17-alpine pg_dump -h host.docker.internal -p 15432 -U <DB_USER> -d <DB_NAME> -Fc --no-owner --no-acl -f /dump/prod.dump
```

Si sale bien, no imprime nada.

**6. Cerrar el túnel:** `Ctrl+C` en la terminal 1.

**7. Restaurar en local** (desde `Oscar-MateoBack`, con el backend local apagado). **Borra** la base local:

```bash
docker compose cp prod.dump postgres:/tmp/prod.dump
```

```bash
docker compose exec postgres psql -U ferreyepes -d postgres -c "DROP DATABASE IF EXISTS ferreyepes WITH (FORCE)" -c "CREATE DATABASE ferreyepes"
```

```bash
docker compose exec postgres pg_restore -U ferreyepes -d ferreyepes --no-owner --no-acl /tmp/prod.dump
```

(`ferreyepes` son el usuario y la base por defecto del Postgres local; cámbialos si tu `.env` usa otros.)

## Reglas de seguridad

- **Solo lectura:** el túnel se usa únicamente para `pg_dump`. Nunca pongas `DB_PORT=15432` en el `.env` del backend local: sería el backend local escribiendo en producción. Como red de seguridad, `scripts/db-setup.sh` y el test de integración de caja se niegan a correr salvo que `DB_HOST` sea `localhost`/`127.0.0.1` y `DB_PORT` sea `5432` (o se fuerce con `ALLOW_DB_WRITES=1`, solo para otra base local).
- **Revertir migraciones:** `migration:revert:prod` exige `ALLOW_DESTRUCTIVE_DOWN=1` (`ALLOW_DESTRUCTIVE_DOWN=1 npm run migration:revert:prod`), y los `down` que borran tablas, columnas o filas reales piden lo mismo también en local (en PowerShell: `$env:ALLOW_DESTRUCTIVE_DOWN=1` antes del comando). Haz un respaldo antes: revertir esos `down` no se puede deshacer.
- **Cierra el túnel** al terminar. El script lo cierra solo; si avisa que el puerto `15432` sigue abierto, ciérralo a mano (Administrador de tareas → `session-manager-plugin.exe`). Comprobarlo: `netstat -ano | findstr 15432` no debe mostrar nada.
- **El dump trae datos reales** (correos, hashes de contraseña y, cuando haya ventas, datos de clientes). Vive en `backups/` (ignorado por git, igual que `*.dump`); solo se conserva el último y con `--no-keep` no queda ninguno. No lo subas a ningún lado.
- Con la copia restaurada, cualquier usuario de producción entra en local con su contraseña real. Además, el `.env` local tiene llaves que suben al bucket de producción; con datos reales, considera apuntar el backend local a otro bucket.
- Nunca pegues la contraseña de la base en chats, issues ni commits.

## Problemas frecuentes

| Síntoma                                                                       | Causa y solución                                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NoCredentials` / `Unable to locate credentials`                              | Falta el login o expiró: `aws login --profile oscarymateo`. Olvidaste `--profile oscarymateo` en el comando.                  |
| `aws login` responde `argument command: Invalid choice` y lista muchos servicios | El AWS CLI es demasiado viejo (`aws login` existe desde la 2.32). Actualiza como se indica en Requisitos y abre una terminal nueva. |
| `AccessDeniedException` al abrir el túnel                                     | Tu usuario no tiene `ssm:StartSession` sobre la instancia ni sobre el documento `AWS-StartPortForwardingSessionToRemoteHost`. |
| `TargetNotConnected`                                                          | La instancia no está en línea en SSM (¿apagada?). Mira el estado en la consola de EC2.                                        |
| El script dice que el puerto `15432` está en uso                              | Un túnel anterior sigue abierto. Ciérralo (`Ctrl+C` en su terminal) o usa otro `TUNNEL_PORT`.                                 |
| `pg_isready` dice `no response`                                               | El túnel no está abierto o no terminó de abrir; mira la terminal 1. Docker Desktop debe estar encendido.                      |
| `pg_dump: server version mismatch`                                            | El RDS es más nuevo que el Postgres 17 del contenedor. Usa una imagen con la versión del RDS.                                 |
| `password authentication failed`                                              | `PGPASSWORD` no quedó bien cargada; repite el paso 4 en esa misma terminal.                                                   |
| En Git Bash el parámetro SSM sale como `C:/Program Files/Git/oscarymateo/...` | Git Bash convierte rutas que empiezan con `/`. El script ya lo evita (`MSYS_NO_PATHCONV=1`); a mano, usa PowerShell.          |
| `bash` desde PowerShell abre otro entorno (WSL) y falla                       | Corre el script desde Git Bash.                                                                                               |
| El dump sale corrupto o vacío                                                 | Se usó `>` en PowerShell. Usa `-f` con el volumen, como en el paso 5, o el script.                                            |
| `host.docker.internal` no resuelve                                            | Solo pasa fuera de Docker Desktop (Linux nativo); el script asume Docker Desktop.                                             |
