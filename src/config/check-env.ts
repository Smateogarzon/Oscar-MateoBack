import { X509Certificate, createPrivateKey } from 'node:crypto';
import { envValidationSchema } from './env.validation.js';

// Revisa la configuración de producción sin arrancar la app ni tocar la base. deploy.sh la corre
// dentro del contenedor nuevo ANTES de las migraciones: si falta algo o está mal, el despliegue se
// detiene y la versión anterior sigue atendiendo, en vez de tumbar el servicio al arrancar.
// Solo imprime nombres de variables, nunca sus valores. Se compila a dist/config/check-env.js
// (npm run check:env:prod).
const problems: string[] = [];

// Es un chequeo de producción: sin NODE_ENV (p. ej. al correrlo a mano) se valida como tal.
const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' };
const { error } = envValidationSchema.validate(env, { abortEarly: false, allowUnknown: true });

for (const detail of error?.details ?? []) {
  // Algunas reglas de Joi citan el valor en su mensaje: si es largo (un secreto) se tapa.
  const value: unknown = detail.context?.value;
  problems.push(
    typeof value === 'string' && value.length >= 8
      ? detail.message.split(value).join('***')
      : detail.message,
  );
}

function decodeBase64(name: string): string | undefined {
  const encoded = process.env[name];
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : undefined;
}

// Si la variable falta, Joi ya lo reportó arriba; aquí solo se revisa que lo que hay sirva.
const privateKeyPem = decodeBase64('QZ_PRIVATE_KEY_B64');
if (privateKeyPem) {
  try {
    createPrivateKey(privateKeyPem);
  } catch {
    problems.push(
      'QZ_PRIVATE_KEY_B64 no es una llave privada PEM válida en base64 (¿está protegida con contraseña o es otro archivo?)',
    );
  }
}

const certificatePem = decodeBase64('QZ_CERTIFICATE_B64');
if (certificatePem) {
  try {
    new X509Certificate(certificatePem);
  } catch {
    problems.push('QZ_CERTIFICATE_B64 no es un certificado PEM válido en base64');
  }
}

if (problems.length > 0) {
  console.error('La configuración de producción no es válida:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Configuración de producción válida.');
