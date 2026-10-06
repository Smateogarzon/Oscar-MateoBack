import bcrypt from 'bcryptjs';

// El costo de bcrypt de TODAS las contraseñas de la app (alta de usuario, restablecimiento, cambio
// de contraseña, el script create:admin y el hash de relleno del login): uno solo, para que ningún
// lado lo cambie sin los demás.
export const PASSWORD_SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_SALT_ROUNDS);
}
