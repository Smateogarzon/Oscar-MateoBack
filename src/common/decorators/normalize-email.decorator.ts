import { Transform } from 'class-transformer';

// El correo se recorta y se pasa a minúsculas ANTES de validarlo y guardarlo: "Ana.Lopez@X.com" y
// "ana.lopez@x.com" son la misma persona. Antes se guardaba y se comparaba tal cual, así quien escribía su
// correo en minúsculas no entraba si el administrador lo había tecleado con mayúsculas, y podían existir
// dos cuentas que solo se diferenciaban en ellas.
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
