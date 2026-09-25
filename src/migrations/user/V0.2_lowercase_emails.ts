import { MigrationInterface, QueryRunner } from 'typeorm';

// Desde ahora el correo se guarda y se busca siempre en minúsculas (UserService, AuthService y los
// DTO lo normalizan). Los usuarios que ya existen con mayúsculas tienen que igualarse, si no, quien
// se registró como "Ana@Correo.com" no podría entrar escribiendo "ana@correo.com".
//
// Dos cuentas que solo se distinguen por mayúsculas ("ana@x.com" y "Ana@x.com") chocarían al
// igualarlas: en vez de elegir una en silencio, la migración se detiene y dice cuáles son, para
// resolverlo a mano (desactivar o renombrar una de las dos) y volver a correrla.
// Es una migración nueva y no una edición de V0.1_add_user: esa ya corrió.
export class LowercaseUserEmails1790250000000 implements MigrationInterface {
  name = 'LowercaseUserEmails1790250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: { email: string; count: string }[] = await queryRunner.query(`
      SELECT lower("email") AS "email", count(*) AS "count"
      FROM "users"
      GROUP BY lower("email")
      HAVING count(*) > 1
    `);

    if (duplicates.length > 0) {
      const list = duplicates.map((row) => `${row.email} (${row.count} cuentas)`).join(', ');
      throw new Error(
        `No se pueden igualar los correos a minúsculas: hay cuentas que solo se distinguen por mayúsculas: ${list}. ` +
          'Renombra o desactiva una de cada par y vuelve a correr la migración.',
      );
    }

    await queryRunner.query(`
      UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email")
    `);
  }

  // Las mayúsculas originales no se pueden recuperar, y tampoco hace falta: buscar en minúsculas
  // funciona igual con los correos ya igualados.
  public async down(): Promise<void> {
    return;
  }
}
