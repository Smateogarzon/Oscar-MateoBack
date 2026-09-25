import { plainToInstance } from 'class-transformer';
import { IsEmail, validateSync } from 'class-validator';
import { NormalizeEmail } from './normalize-email.decorator.js';

class Probe {
  @NormalizeEmail()
  @IsEmail()
  email: string;
}

const transformed = (email: unknown) => plainToInstance(Probe, { email }).email as unknown;

describe('NormalizeEmail', () => {
  it('puts the email in lowercase', () => {
    expect(transformed('Ana.Lopez@X.com')).toBe('ana.lopez@x.com');
  });

  it('cuts the spaces at both ends of the email', () => {
    expect(transformed('  ana@example.com \n')).toBe('ana@example.com');
  });

  it('gives the same result however the email is written', () => {
    expect(transformed(' ANA.LOPEZ@x.COM')).toBe(transformed('ana.lopez@X.com '));
  });

  it('leaves alone whatever is not a text', () => {
    expect(transformed(42)).toBe(42);
    expect(transformed(null)).toBeNull();
  });

  it('happens before validating: an email with spaces and capitals passes IsEmail once normalized', () => {
    const dto = plainToInstance(Probe, { email: '  Ana@Example.COM ' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.email).toBe('ana@example.com');
  });

  it('still rejects what is not an email', () => {
    expect(validateSync(plainToInstance(Probe, { email: '  no es un correo ' }))).toHaveLength(1);
    expect(validateSync(plainToInstance(Probe, { email: 42 }))).toHaveLength(1);
  });
});
