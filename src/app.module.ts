import './config/decimal.config.js';
import { envValidationSchema } from './config/env.validation.js';
import { databaseSsl } from './config/database-ssl.js';
import { DecimalScalar } from './common/scalars/decimal.scalar.js';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ApolloArmor } from '@escape.tech/graphql-armor';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppResolver } from './app.resolver.js';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard.js';
import { GqlAllExceptionsFilter } from './common/filters/gql-all-exceptions.filter.js';
import { GraphqlLoggingPlugin } from './common/logging/graphql-logging.plugin.js';
import { AuthModule } from './graphql/auth/auth.module.js';
import { CompanyModule } from './graphql/company/company.module.js';
import { LocationModule } from './graphql/location/location.module.js';
import { PermissionModule } from './graphql/permission/permission.module.js';
import { RoleModule } from './graphql/role/role.module.js';
import { UserModule } from './graphql/user/user.module.js';
import { UserCompanyRoleModule } from './graphql/user-company-role/user-company-role.module.js';
import { RolePermissionModule } from './graphql/role-permission/role-permission.module.js';
import { UserLocationAccessModule } from './graphql/user-location-access/user-location-access.module.js';
import { SaleModule } from './graphql/sale/sale.module.js';
import { DiscountRequestModule } from './graphql/discount-request/discount-request.module.js';
import { PaymentMethodModule } from './graphql/payment-method/payment-method.module.js';
import { StorePaymentMethodModule } from './graphql/store-payment-method/store-payment-method.module.js';
import { CashRegisterModule } from './graphql/cash-register/cash-register.module.js';
import { CashSessionModule } from './graphql/cash-session/cash-session.module.js';
import { CashMovementModule } from './graphql/cash-movement/cash-movement.module.js';
import { SalePaymentModule } from './graphql/sale-payment/sale-payment.module.js';
import { SaleReturnModule } from './graphql/sale-return/sale-return.module.js';
import { NotificationModule } from './graphql/notification/notification.module.js';
import { IdempotencyModule } from './graphql/idempotency/idempotency.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { graphqlContext, wsOnClose, wsOnConnect, wsOnSubscribe } from './realtime/ws-context.js';
import { StorageModule } from './common/storage/storage.module.js';
import { UploadModule } from './uploads/upload.module.js';
import { PosHardwareModule } from './pos-hardware/pos-hardware.module.js';

const { validationRules, plugins } = new ApolloArmor().protect();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        exclude: [{ path: 'graphql', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true } },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: false,
        },
      }),
    }),
    // El límite es por IP y por operación. Las terminales de una tienda salen por la misma IP pública,
    // así que 100 por minuto se alcanzaba con unos pocos equipos y pantallas pesadas (y el 429 lo
    // pagaban todos). 600 sigue frenando un abuso; el inicio de sesión tiene un límite propio, más
    // estricto (AuthResolver.login).
    ThrottlerModule.forRoot([
      {
        ttl: seconds(60),
        limit: 600,
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        ssl: databaseSsl(config.get<boolean>('DB_SSL') === true),
        autoLoadEntities: true,
        synchronize: false,
        extra: {
          max: config.get<number>('DB_POOL_MAX'),
          idleTimeoutMillis: config.get<number>('DB_POOL_IDLE_TIMEOUT_MS'),
          connectionTimeoutMillis: config.get<number>(
            'DB_POOL_CONNECTION_TIMEOUT_MS',
          ),
        },
      }),
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // En producción el schema se arma en memoria: el contenedor no trae src/ y
      // corre sin permisos de escritura.
      autoSchemaFile:
        process.env.NODE_ENV === 'production'
          ? true
          : join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      introspection: process.env.NODE_ENV !== 'production',
      validationRules,
      plugins: plugins as unknown as ApolloDriverConfig['plugins'],
      // Las suscripciones (tiempo real) viajan por WebSocket con el protocolo graphql-ws, por la
      // misma ruta /graphql. Al abrir la conexión se comprueba que venga del sitio de la app.
      // wsOnConnect rechaza sin sesión y por encima de los topes de conexiones; wsOnSubscribe solo deja pasar
      // la suscripción notificationEvents (el WebSocket no hereda las defensas del canal HTTP).
      subscriptions: {
        'graphql-ws': {
          onConnect: wsOnConnect,
          onClose: wsOnClose,
          onSubscribe: wsOnSubscribe,
        },
      },
      // Para una petición HTTP entrega { req, res }; para una suscripción arma un `req` con la
      // cookie y la empresa de la conexión, así los mismos guards protegen las dos.
      context: graphqlContext,
    }),
    AuthModule,
    CompanyModule,
    LocationModule,
    PermissionModule,
    RoleModule,
    UserModule,
    UserCompanyRoleModule,
    RolePermissionModule,
    UserLocationAccessModule,
    SaleModule,
    DiscountRequestModule,
    PaymentMethodModule,
    StorePaymentMethodModule,
    CashRegisterModule,
    CashSessionModule,
    CashMovementModule,
    SalePaymentModule,
    SaleReturnModule,
    NotificationModule,
    IdempotencyModule,
    RealtimeModule,
    StorageModule,
    UploadModule,
    PosHardwareModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppResolver,
    DecimalScalar,
    GraphqlLoggingPlugin,
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_FILTER, useClass: GqlAllExceptionsFilter },
  ],
})
export class AppModule {}
