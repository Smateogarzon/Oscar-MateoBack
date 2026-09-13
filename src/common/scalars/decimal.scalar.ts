import { Decimal } from 'decimal.js';
import { CustomScalar, Scalar } from '@nestjs/graphql';
import { GraphQLError, Kind, type ValueNode } from 'graphql';

@Scalar('Decimal', () => Decimal)
export class DecimalScalar implements CustomScalar<string, Decimal> {
  description =
    'Decimal arbitrary-precision number (decimal.js), transportado como string para no perder precisión';

  parseValue(value: unknown): Decimal {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new GraphQLError('Decimal debe ser un string o number');
    }
    return new Decimal(value);
  }

  serialize(value: unknown): string {
    if (!(value instanceof Decimal)) {
      throw new GraphQLError(
        'DecimalScalar solo puede serializar instancias de Decimal',
      );
    }
    return value.toString();
  }

  parseLiteral(ast: ValueNode): Decimal {
    if (
      ast.kind !== Kind.STRING &&
      ast.kind !== Kind.INT &&
      ast.kind !== Kind.FLOAT
    ) {
      throw new GraphQLError('Decimal debe ser un literal string, int o float');
    }
    return new Decimal(ast.value);
  }
}
