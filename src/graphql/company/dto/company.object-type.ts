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

  @Field({ nullable: true })
  legalName: string | null;

  @Field()
  taxId: string;

  @Field({ nullable: true })
  taxIdCheckDigit: string | null;

  @Field({ nullable: true })
  address: string | null;

  @Field({ nullable: true })
  city: string | null;

  @Field()
  countryCode: string;

  @Field({ nullable: true })
  phone: string | null;

  @Field({ nullable: true })
  email: string | null;

  @Field({ nullable: true })
  logoUrl: string | null;

  @Field()
  currencyCode: string;

  @Field()
  timezone: string;

  @Field(() => CompanyStatus)
  status: CompanyStatus;
}
