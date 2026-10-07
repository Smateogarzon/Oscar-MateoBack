// Pasa un nombre a "slug": minúsculas, sin tildes, y todo lo que no sea letra o número se
// vuelve un guion. Sirve para identificar marcas y categorías con un texto estable y legible en
// una URL, aparte de su nombre (que sí puede cambiar). Nunca lo escribe la persona: lo arma el
// servicio a partir del nombre y, si choca con uno que ya existe, le agrega un sufijo numérico
// (ver `uniqueSlug`).
export function slugify(name: string, maxLength: number): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  // Un nombre que no deja ninguna letra o número (solo símbolos, o vacío) no puede quedar sin slug.
  return base || 'item';
}

// El slug de `name` que todavía no usa nadie: el base, o `base-2`, `base-3`... `isTaken` dice si un
// candidato ya existe; dónde buscarlo lo sabe cada servicio (las marcas son de todas las empresas,
// las categorías de una sola).
export async function uniqueSlug(
  name: string,
  maxLength: number,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name, maxLength);
  let candidate = base;
  for (let suffix = 2; await isTaken(candidate); suffix++) {
    candidate = `${base}-${suffix}`.slice(0, maxLength);
  }
  return candidate;
}
