export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** `baseUrl` (origen de la petición, ej. "http://localhost:3000") es lo que
 * necesita una implementación en disco local para devolver una URL absoluta; una
 * futura implementación en S3 la ignora y arma la suya con la URL del bucket. */
export interface StorageService {
  save(file: UploadedFileLike, folder: string, baseUrl: string): Promise<string>;
}
