import { Decimal } from 'decimal.js';
import { Kind, type ValueNode } from 'graphql';
import { DecimalScalar } from './decimal.scalar.js';

describe('DecimalScalar', () => {
  const scalar = new DecimalScalar();

  describe('serialize', () => {
    it('converts a Decimal instance to a string', () => {
      expect(scalar.serialize(new Decimal('1250.50'))).toBe('1250.5');
    });

    it('throws when the value is not a Decimal instance', () => {
      expect(() => scalar.serialize('1250.50')).toThrow();
    });
  });

  describe('parseValue', () => {
    it('parses a string into a Decimal', () => {
      const result = scalar.parseValue('1250.50');
      expect(result.equals(new Decimal('1250.50'))).toBe(true);
    });

    it('parses a number into a Decimal', () => {
      const result = scalar.parseValue(10);
      expect(result.equals(new Decimal(10))).toBe(true);
    });

    it('throws for types that are not string or number', () => {
      expect(() => scalar.parseValue(true)).toThrow();
    });
  });

  describe('parseLiteral', () => {
    it('parses a STRING literal', () => {
      const literal = { kind: Kind.STRING, value: '99.99' } as ValueNode;
      expect(scalar.parseLiteral(literal).equals(new Decimal('99.99'))).toBe(true);
    });

    it('parses an INT literal', () => {
      const literal = { kind: Kind.INT, value: '42' } as ValueNode;
      expect(scalar.parseLiteral(literal).equals(new Decimal(42))).toBe(true);
    });

    it('throws for unsupported literal kinds', () => {
      const literal = { kind: Kind.BOOLEAN, value: true } as ValueNode;
      expect(() => scalar.parseLiteral(literal)).toThrow();
    });
  });
});
