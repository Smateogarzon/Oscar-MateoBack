import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { RecordStatus } from '../common/enums/record-status.enum.js';
import dataSource from '../data-source.js';
import { Company } from '../graphql/company/entities/company.entity.js';
import { Role } from '../graphql/role/entities/role.entity.js';
import { UserCompanyRole } from '../graphql/user-company-role/entities/user-company-role.entity.js';
import { User } from '../graphql/user/entities/user.entity.js';

const ADMIN_ROLE_CODE = 'ADMIN';
const MIN_PASSWORD_LENGTH = 8;
// Debe coincidir con PASSWORD_SALT_ROUNDS de user.service.ts.
const PASSWORD_SALT_ROUNDS = 10;

async function main(): Promise<void> {
  await dataSource.initialize();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const firstName = (await rl.question('Nombre: ')).trim();
    const lastName = (await rl.question('Apellido: ')).trim();
    const email = (await rl.question('Email: ')).trim().toLowerCase();
    // La contraseña se escribe a la vista: ocultar el eco exige APIs privadas de readline
    // que se rompen en la terminal de Git Bash en Windows.
    const password = await rl.question('Contraseña: ');

    if (!firstName || !lastName || !email) {
      throw new Error('Nombre, apellido y email son obligatorios.');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }

    await dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);

      if (await userRepository.findOneBy({ email })) {
        throw new Error(`Ya existe un usuario con el email ${email}.`);
      }

      const role = await manager.getRepository(Role).findOneBy({ code: ADMIN_ROLE_CODE });
      if (!role) {
        throw new Error(
          `No existe el rol ${ADMIN_ROLE_CODE}. Corre primero: npm run migration:run`,
        );
      }

      const company = await manager
        .getRepository(Company)
        .findOne({ where: {}, order: { createdAt: 'ASC' } });
      if (!company) {
        throw new Error('No hay ninguna empresa registrada. Corre primero: npm run migration:run');
      }

      const user = await userRepository.save(
        userRepository.create({
          firstName,
          lastName,
          email,
          passwordHash: await bcrypt.hash(password, PASSWORD_SALT_ROUNDS),
          status: RecordStatus.ACTIVE,
          // El operador eligió la contraseña él mismo; no hay nada que forzarlo a cambiar.
          mustChangePassword: false,
        }),
      );

      const assignmentRepository = manager.getRepository(UserCompanyRole);
      await assignmentRepository.save(
        assignmentRepository.create({
          userId: user.id,
          companyId: company.id,
          roleId: role.id,
          status: RecordStatus.ACTIVE,
        }),
      );

      console.log(`\nSuper admin creado: ${email} — empresa "${company.name}"`);
    });
  } finally {
    rl.close();
    await dataSource.destroy();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
