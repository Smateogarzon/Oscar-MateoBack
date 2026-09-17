// Lista blanca de carpetas válidas para POST /uploads/image. El front manda
// `folder` como flag de qué está subiendo (users, brands, ...); se valida acá
// para que nunca escriba a una ruta arbitraria del bucket.
export const UPLOAD_FOLDERS = ['users'] as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export function isUploadFolder(value: unknown): value is UploadFolder {
  return typeof value === 'string' && (UPLOAD_FOLDERS as readonly string[]).includes(value);
}
