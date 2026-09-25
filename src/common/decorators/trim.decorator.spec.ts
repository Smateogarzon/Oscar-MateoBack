import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, validateSync } from 'class-validator';
import { Trim } from './trim.decorator.js';

class Probe {
  @Trim()
  @IsNotEmpty()
  name: string;
}

const transformed = (name: unknown) => plainToInstance(Probe, { name }).name as unknown;

describe('Trim', () => {
  it('cuts the spaces at both ends of a text', () => {
    expect(transformed('  Ana María  ')).toBe('Ana María');
  });

  it('cuts tabs and line breaks too', () => {
    expect(transformed('\t Ana \n')).toBe('Ana');
  });

  it('keeps the spaces inside the text', () => {
    expect(transformed(' Ana   María ')).toBe('Ana   María');
  });

  it('turns a text of only spaces into an empty one', () => {
    expect(transformed('    ')).toBe('');
  });

  it('leaves alone whatever is not a text', () => {
    expect(transformed(42)).toBe(42);
    expect(transformed(null)).toBeNull();
    expect(transformed(false)).toBe(false);
  });

  it('makes IsNotEmpty reject a text of only spaces, which would otherwise pass', () => {
    expect(validateSync(plainToInstance(Probe, { name: '   ' }))).toHaveLength(1);
    expect(validateSync(plainToInstance(Probe, { name: ' Ana ' }))).toHaveLength(0);
  });
});
