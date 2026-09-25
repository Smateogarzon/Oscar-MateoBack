import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_POOL_MAX: Joi.number().default(10),
  DB_POOL_IDLE_TIMEOUT_MS: Joi.number().default(10000),
  DB_POOL_CONNECTION_TIMEOUT_MS: Joi.number().default(5000),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),
  CORS_ORIGIN: Joi.string().required(),
  // En producción las cookies de sesión se comparten entre el front y la API (dos subdominios):
  // sin dominio quedarían atadas al de la API y el login no funcionaría desde el front.
  COOKIE_DOMAIN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Con 32 caracteres como mínimo se descartan los secretos de ejemplo ("change-me") que
  // dejarían firmar sesiones a cualquiera.
  JWT_SECRET: Joi.string().min(32).invalid('change-me').required(),
  AWS_REGION: Joi.string().required(),
  // Solo en desarrollo local: en el servidor no existen y S3 usa el rol del EC2.
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_S3_BUCKET: Joi.string().required(),
  QZ_PRIVATE_KEY_B64: Joi.string().base64().required(),
  QZ_CERTIFICATE_B64: Joi.string().base64().required(),
});
