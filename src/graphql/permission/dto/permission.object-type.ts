import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { PermissionModule } from '../entities/permission-module.enum.js';

registerEnumType(PermissionModule, {
  name: 'PermissionModule',
  description: 'Módulo del sistema al que pertenece el permiso',
});

@ObjectType('Permission')
export class PermissionObjectType extends BaseObjectType {
  @Field()
  code: string;

  @Field()
  name: string;

  @Field(() => PermissionModule)
  module: PermissionModule;

  @Field({ nullable: true })
  description: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
