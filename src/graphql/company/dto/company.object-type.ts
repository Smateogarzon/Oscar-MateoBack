import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { CompanyStatus } from '../entities/company-status.enum.js';

registerEnumType(CompanyStatus, {
  name: 'CompanyStatus',
  description: 'Estado de la compañía',
});

@ObjectType('Company')
export class CompanyObjectType extends BaseObjectType {
  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  legalName: string | null;

  @Field()
  taxId: string;

  @Field(() => String, { nullable: true })
  taxIdCheckDigit: string | null;

  @Field(() => String, { nullable: true })
  address: string | null;

  @Field(() => String, { nullable: true })
  city: string | null;

  @Field()
  countryCode: string;

  @Field(() => String, { nullable: true })
  phone: string | null;

  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => String, { nullable: true })
  logoUrl: string | null;

  @Field()
  currencyCode: string;

  @Field()
  timezone: string;

  @Field(() => CompanyStatus)
  status: CompanyStatus;
}
