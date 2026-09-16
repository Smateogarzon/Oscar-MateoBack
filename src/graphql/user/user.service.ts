import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { User } from './entities/user.entity.js';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(status?: RecordStatus): Promise<User[]> {
    return this.userRepository.find(status ? { where: { status } } : {});
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  // La contraseña inicial es la cédula (documentNumber); queda forzado el cambio en el primer login.
  async create(input: CreateUserInput): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);

      const existing = await repo.findOneBy({ email: input.email });
      if (existing) {
        throw new ConflictException(`Ya existe un usuario con el email ${input.email}`);
      }

      const passwordHash = await bcrypt.hash(input.documentNumber, PASSWORD_SALT_ROUNDS);

      const user = repo.create({
        ...input,
        passwordHash,
        mustChangePassword: true,
      });

      return repo.save(user);
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, input);
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  async deactivate(id: string): Promise<User> {
    const user = await this.findOne(id);
    user.status = RecordStatus.INACTIVE;
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }
}
