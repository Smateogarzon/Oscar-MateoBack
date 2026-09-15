import { CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

// Como BaseEntity pero sin updatedAt, para tablas que solo se crean y nunca se editan (ej: uniones)
export abstract class ImmutableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
