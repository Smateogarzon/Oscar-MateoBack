import { Field, ObjectType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';

@ObjectType('RolePermission')
export class RolePermissionObjectType extends ImmutableObjectType {
  @Field()
  roleId: string;

  @Field()
  permissionId: string;
}
