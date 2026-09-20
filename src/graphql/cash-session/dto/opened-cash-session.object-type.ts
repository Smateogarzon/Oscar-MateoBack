import { Field, ObjectType } from '@nestjs/graphql';
import { CashSessionObjectType } from './cash-session.object-type.js';

// Lo que recibe el administrador al abrir un turno: el turno y su código, que solo verá él. El
// código no se vuelve a mostrar en el turno; si lo necesita de nuevo lo consulta con
// cashSessionMovementCode.
@ObjectType('OpenedCashSession')
export class OpenedCashSessionObjectType {
  @Field(() => CashSessionObjectType)
  session: CashSessionObjectType;

  // El código del día de este turno: 6 dígitos que el cajero le pide para cada movimiento de caja
  @Field()
  code: string;
}
