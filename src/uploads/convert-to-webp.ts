import { parse } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { UploadedFileLike } from '../common/storage/storage.service.js';

const WEBP_QUALITY = 80;

export async function convertToWebp(
  file: UploadedFileLike,
): Promise<UploadedFileLike> {
  let buffer: Buffer;

  try {
    buffer = await sharp(file.buffer)
      .rotate()
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new BadRequestException('El archivo no es una imagen válida');
  }

  return {
    buffer,
    originalname: `${parse(file.originalname).name}.webp`,
    mimetype: 'image/webp',
  };
}
