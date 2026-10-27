# ferreYepes — Backend

API GraphQL para ferreYepes, construida con NestJS.

## Stack

- **Runtime:** Node.js 22, TypeScript, módulos ESM
- **API:** GraphQL code-first (`@nestjs/graphql` + Apollo Server 5)
- **Base de datos:** PostgreSQL vía TypeORM
- **Librerías de dominio:** `decimal.js` (cálculos con precisión exacta, ej. precios), `dayjs` (fechas)
- **Testing:** Vitest
- **Lint/format:** oxlint + Prettier
- **Logging:** pino (estructurado, vía `nestjs-pino`)

## Requisitos

- Node.js 22+
- Docker (para levantar Postgres localmente)

## Puesta en marcha

1. Instala dependencias:

   ```bash
   npm install --legacy-peer-deps
   ```

   > **Nota:** `--legacy-peer-deps` es necesario porque `@nestjs/throttler` todavía no actualiza su rango de `peerDependencies` para NestJS 12 (lanzado el 2026-08-27, muy reciente). Es un desfase de metadata, no una incompatibilidad real.

2. Copia el archivo de variables de entorno y ajusta lo que necesites:

   ```bash
   cp .env.example .env
   ```

3. Levanta Postgres:

   ```bash
   docker compose up -d
   ```

4. Arranca el servidor en modo desarrollo:

   ```bash
   npm run start:dev
   ```

   El playground de GraphQL queda disponible en `http://localhost:3000/graphql` (solo en `development`; en `production` la introspección está desactivada).

## Variables de entorno

Todas se validan al arrancar con Joi (`src/config/env.validation.ts`) — si falta alguna requerida, la app no arranca.

| Variable | Descripción | Default |
|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` |
| `PORT` | Puerto HTTP del servidor | `3000` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión a Postgres | — (requeridas) |
| `DB_POOL_MAX` | Máximo de conexiones simultáneas en el pool | `10` |
| `DB_POOL_IDLE_TIMEOUT_MS` | Tiempo de inactividad antes de cerrar una conexión del pool | `10000` |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | Tiempo máximo de espera por una conexión libre antes de fallar | `5000` |
| `DB_SSL` | Conexión cifrada a Postgres (`true` en RDS) | `false` |
| `CORS_ORIGIN` | Orígenes permitidos (separados por coma) | — (requerida) |
| `COOKIE_DOMAIN` | Dominio de la cookie de sesión | — (requerida en `production`) |
| `JWT_SECRET` | Firma de la sesión (mínimo 32 caracteres) | — (requerida) |
| `AWS_REGION`, `AWS_S3_BUCKET` | Dónde se guardan las imágenes subidas (avatares, fotos de producto) | — (requeridas) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciales de S3 en local (en producción las da el rol de la instancia) | — |
| `QZ_PRIVATE_KEY_B64`, `QZ_CERTIFICATE_B64` | Firma de las impresiones con QZ Tray (tirillas, cajón) | — (requeridas) |

## Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Servidor en modo watch |
| `npm run build` | Compila a `dist/` |
| `npm run start:prod` | Corre el build compilado |
| `npm run lint` | oxlint sobre `src/` y `test/` |
| `npm test` | Corre los tests con Vitest |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:cov` | Tests con reporte de cobertura |
| `npm run migration:generate` | Genera una migración de TypeORM, detectando solo el nombre (ver convención abajo) |
| `npm run migration:run` | Aplica las migraciones pendientes |
| `npm run migration:revert` | Revierte la última migración aplicada |

## Migraciones

Cada carpeta de `src/migrations/<feature>/` numera sus archivos `V{version}_{accion}_{entidad}.ts` (`V0.1`, `V0.2`... `V0.9`, `V1.0`...) **en el orden en que corren**. Lo que de verdad decide el orden de ejecución es el timestamp de 13 dígitos al final del `name` de la clase (TypeORM lo lee de ahí), y lo que queda registrado en la tabla `migrations` es ese `name`.

```bash
npm run migration:generate
npm run migration:run
```

El script `src/scripts/generate-migration.mjs` le pide el diff a TypeORM, lo reparte en un archivo por feature (cruzando cada tabla con su `@Entity`), los ordena según sus llaves foráneas y les pone nombre y versión. El timestamp que asigna siempre es mayor que el de la última migración existente, aunque esa vaya por delante del reloj.

Reglas:

- **Una migración que ya corrió no se edita** (ni su `name` ni su `up`): se escribe otra. Renombrar el archivo sí es inofensivo.
- **Una migración escrita a mano** lleva un timestamp mayor que el de la última que exista.
- **Los índices y llaves con nombre propio** (`IDX_inventory_balances_variant_location`, `FK_..._reservedBy`) se declaran con ese mismo nombre en la entidad (`@Index('IDX_...', [...])`, `@JoinColumn({ foreignKeyConstraintName })`). Si no, cada `migration:generate` propone borrarlos y crearlos de nuevo.
- **Un `down` que borra datos reales** (tablas, columnas o filas de negocio) empieza con `assertDestructiveDownAllowed(this.name)`. Revertirlo exige `ALLOW_DESTRUCTIVE_DOWN=1`.
- **Para comprobar que entidades y base coinciden**, corre `npx typeorm-ts-node-esm schema:log -d ./src/data-source.ts`. Tiene que decir "Your schema is up to date". El CI además aplica todas las migraciones sobre una base vacía.

## Copiar producción a la base local

`scripts/db-pull-prod.sh` abre un túnel SSM hacia el RDS de producción, hace un `pg_dump` (solo lectura), cierra el túnel y reemplaza la base local con esa copia. Sirve para probar migraciones con datos reales antes de desplegarlas.

Requisitos: AWS CLI v2, el Session Manager plugin y una sesión iniciada con un perfil propio (`aws login --profile oscarymateo`, para no mezclarla con la de otros proyectos). Se corre en Git Bash, con el Postgres local arriba:

```bash
bash scripts/db-pull-prod.sh                # dump nuevo de producción + restaurar en local
bash scripts/db-pull-prod.sh --file <dump>  # restaurar en local un dump que ya tienes (no toca producción)
npm run migration:run                       # después, aplica encima las migraciones pendientes
```

El dump queda en `backups/` (fuera de git) y trae datos reales: solo se conserva el último (con `--no-keep` no queda ninguno). Mientras el túnel está abierto, `localhost:15432` es producción; el backend local siempre va contra el `5432`. Login, paso a paso manual y solución de problemas: [docs/acceso-produccion.md](docs/acceso-produccion.md).

## Estructura del proyecto

```
src/
  config/           # setup que corre una vez: Joi del .env, decimal.js, SSL de la base, guardas de migraciones
  common/           # piezas compartidas por todos los módulos
    access/           # quién puede qué: loadCompanyAccess (permisos por empresa), hasStoreAccess (tiendas),
                      # rol de plataforma (el super admin lo puede todo), "solo das lo que tienes"
    enums/            # PermissionCode, RoleCode, RecordStatus: los códigos que usa la lógica
    utils/            # dinero (patrones, MAX_AMOUNT, roundMoney), texto, slugs, contraseñas, errores de Postgres
    decorators/ guards/ filters/ scalars/ transformers/ storage/ logging/
  graphql/<dominio>/ # un módulo por dominio: <dominio>.module/.resolver/.service, dto/ (ObjectType e
                     # InputType) y entities/. Lo que el servicio necesita dentro de una transacción
                     # ajena va en funciones sueltas que reciben el EntityManager (p. ej.
                     # inventory-reservation/reserved-quantity.ts, purchase-order/purchase-order-lines.ts)
  realtime/         # suscripciones (graphql-ws) y la cola de eventos que salen al confirmar la transacción
  uploads/          # POST /uploads/image (a S3, en WebP)
  pos-hardware/     # firma de QZ Tray
  migrations/       # ver "Migraciones"
  scripts/          # generate-migration, create:admin
  data-source.ts    # DataSource para el CLI de TypeORM (separado del runtime de Nest)
```

**Convención importante:** una `@Entity()` de TypeORM nunca se expone directo como tipo de GraphQL. Cada entidad de dominio tiene su contraparte `@ObjectType()`, para no acoplar el schema público al modelo de base de datos.

**Una sola cuenta para cada regla:** la disponibilidad de inventario (lo que hay menos lo apartado) vive en `InventoryBalanceService` y en `reserved-quantity.ts`. El front la lee del servidor (`sellableStock`), no la recalcula. Lo mismo vale para los permisos (`loadCompanyAccess`) y el acceso a tiendas (`hasStoreAccess`): un módulo nuevo los usa, no los reimplementa.

## Seguridad

- **Helmet** (headers HTTP), **CORS** restringido por whitelist de orígenes
- **Rate limiting** (`@nestjs/throttler`, 100 req/min por IP)
- **GraphQL Armor**: límites de profundidad, complejidad, alias y directivas de las queries
- **Introspección** desactivada en producción
- **`ValidationPipe`** global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- **`synchronize`** de TypeORM desactivado fuera de desarrollo (el schema se gestiona con migraciones)
- Errores no controlados enmascarados en producción (ver `GqlAllExceptionsFilter`)

## Pendiente

- Health check propio (`@nestjs/terminus`): hoy el despliegue comprueba que el servidor responde con la query `{ ping }`.
- Un rol de base de datos para la app sin `DELETE` sobre las tablas contables (ver [docs/proteccion-contable.md](docs/proteccion-contable.md)).
