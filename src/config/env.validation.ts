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
  CORS_ORIGIN: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
});
