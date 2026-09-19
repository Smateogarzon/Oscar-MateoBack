import { Field, ID, ObjectType } from '@nestjs/graphql';

// Lo que el usuario de la sesión puede hacer en la empresa con la que trabaja. El front lo usa
// para mostrar solo lo que le corresponde; quien decide de verdad es el backend, en cada
// petición.
@ObjectType('CompanyAccess')
export class CompanyAccessObjectType {
  @Field(() => ID)
  companyId: string;

  @Field(() => [String])
  roleCodes: string[];

  @Field(() => [String])
  permissionCodes: string[];
}
