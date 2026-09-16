import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { StorageService, UploadedFileLike } from './storage.service.js';

// Sirve /uploads como estático desde main.ts. Cuando conectemos S3, esta clase se
// reemplaza por una que suba al bucket y devuelva su URL — el resto de la app solo
// conoce la interfaz StorageService, no esta implementación.
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');

@Injectable()
export class LocalStorageService implements StorageService {
  async save(file: UploadedFileLike, folder: string, baseUrl: string): Promise<string> {
    const dir = join(UPLOADS_ROOT, folder);
    await mkdir(dir, { recursive: true });

    const fileName = `${randomUUID()}${extname(file.originalname)}`;
    await writeFile(join(dir, fileName), file.buffer);

    return `${baseUrl}/uploads/${folder}/${fileName}`;
  }
}
