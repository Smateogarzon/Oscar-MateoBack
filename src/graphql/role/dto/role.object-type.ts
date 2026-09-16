import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { RoleScope } from '../entities/role-scope.enum.js';

registerEnumType(RoleScope, {
  name: 'RoleScope',
  description: 'Nivel de aplicación del rol: global, empresa o proveedor',
});

@ObjectType('Role')
export class RoleObjectType extends BaseObjectType {
  @Field()
  code: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => RoleScope)
  scope: RoleScope;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
