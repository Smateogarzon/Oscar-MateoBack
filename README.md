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
| `CORS_ORIGIN` | Orígenes permitidos (separados por coma) | — (requerida) |

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

Convención de nombres: `V{version}_{accion}_{entidad}.ts` (ej. `V0.1_add_company.ts`), versionado incremental decimal (0.1 → 0.9 → 1.0 → 1.1...). No hace falta pasar ningún argumento — el script `src/scripts/generate-migration.mjs`:

1. Le pide a TypeORM que genere la migración (con un nombre interno temporal).
2. Lee el SQL generado para detectar la acción (`add` si hay `CREATE TABLE`, `remove` si hay `DROP TABLE`, si no `update`) y qué tabla(s) tocó.
3. Cruza esa tabla contra el `@Entity('...')` de tus archivos `*.entity.ts` para encontrar la carpeta del feature (ej. `src/graphql/company/entities/company.entity.ts` → `company`).
4. Renombra el archivo a `V{version}_{accion}_{feature}.ts`.

```bash
npm run migration:generate
npm run migration:run
```

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
  config/           # setup transversal que se ejecuta una vez (no son providers inyectables)
    decimal.config.ts   # precisión/redondeo global de decimal.js
    env.validation.ts   # schema de Joi para las variables de entorno
  common/           # piezas reutilizables e inyectables
    entities/base.entity.ts        # columnas base de TypeORM (id uuid, createdAt, updatedAt)
    dto/base.object-type.ts        # equivalente en GraphQL de BaseEntity
    scalars/decimal.scalar.ts      # scalar GraphQL para Decimal
    guards/gql-throttler.guard.ts  # rate limiting adaptado a contexto GraphQL
    filters/gql-all-exceptions.filter.ts  # errores consistentes, sin filtrar detalles internos en prod
  data-source.ts    # DataSource para el CLI de TypeORM (separado del runtime de Nest)
  migrations/       # migraciones generadas
```

**Convención importante:** una `@Entity()` de TypeORM nunca se expone directo como tipo de GraphQL. Cada entidad de dominio debe tener su contraparte `@ObjectType()` extendiendo `BaseObjectType`, para no acoplar el schema público al modelo de base de datos.

## Seguridad

- **Helmet** (headers HTTP), **CORS** restringido por whitelist de orígenes
- **Rate limiting** (`@nestjs/throttler`, 100 req/min por IP)
- **GraphQL Armor**: límites de profundidad, complejidad, alias y directivas de las queries
- **Introspección** desactivada en producción
- **`ValidationPipe`** global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- **`synchronize`** de TypeORM desactivado fuera de desarrollo (el schema se gestiona con migraciones)
- Errores no controlados enmascarados en producción (ver `GqlAllExceptionsFilter`)

## Pendiente (a implementar durante el desarrollo de features)

- Health checks (`@nestjs/terminus`)
- Dockerfile de la propia app (hoy Docker solo corre Postgres)
- Autenticación/autorización (JWT + guards)
