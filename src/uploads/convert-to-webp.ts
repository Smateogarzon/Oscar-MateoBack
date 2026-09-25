import { parse } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { UploadedFileLike } from '../common/storage/storage.service.js';

const WEBP_QUALITY = 80;
// Una imagen de 5 MB comprimida puede descomprimirse a cientos de MB (un PNG de 16000×16000 ocupa menos de
// 1 MB y ~1 GB en memoria: con 2 GB de RAM tumbaba el servidor). Más de 25 megapíxeles no se decodifica.
const MAX_INPUT_PIXELS = 25_000_000;
// Fotos de perfil y logos: no hace falta más grande, y se guarda más liviano.
const MAX_SIDE_PX = 1024;

export async function convertToWebp(
  file: UploadedFileLike,
): Promise<UploadedFileLike> {
  let buffer: Buffer;

  try {
    buffer = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new BadRequestException('El archivo no es una imagen válida o es demasiado grande');
  }

  return {
    buffer,
    originalname: `${parse(file.originalname).name}.webp`,
    mimetype: 'image/webp',
  };
}
