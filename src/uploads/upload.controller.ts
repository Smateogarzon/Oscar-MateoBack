import { BadRequestException, Body, Controller, Inject, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { STORAGE_SERVICE, type StorageService, type UploadedFileLike } from '../common/storage/storage.service.js';
import { convertToWebp } from './convert-to-webp.js';
import { isUploadFolder, PUBLIC_PREFIX } from './upload-folder.constant.js';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = 'image/';

// Endpoint universal de imágenes: el front manda `folder` para decir qué está
// subiendo (users hoy, brands mañana...) y la key en el bucket queda como
// public/<folder>/... Un solo endpoint para cualquier entidad futura.
@Controller('uploads')
@UseGuards(JwtAuthGuard, CsrfGuard)
export class UploadController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  // Subir es caro (decodificar y recomprimir): 20 por minuto por IP alcanza para las fotos de perfil.
  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_SIZE_BYTES } }))
  async uploadImage(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('folder') folder: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo');
    if (!file.mimetype.startsWith(ALLOWED_MIME_PREFIX)) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    if (!isUploadFolder(folder)) {
      throw new BadRequestException('Carpeta de subida inválida');
    }

    const webpFile = await convertToWebp(file);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = await this.storage.save(webpFile, `${PUBLIC_PREFIX}/${folder}`, baseUrl);
    return { url };
  }
}
