import { BadRequestException, Body, Controller, Inject, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { STORAGE_SERVICE, type StorageService, type UploadedFileLike } from '../common/storage/storage.service.js';
import { isUploadFolder } from './upload-folder.constant.js';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = 'image/';

// Endpoint universal de imágenes: el front manda `folder` para decir qué está
// subiendo (users hoy, brands mañana...) y esa carpeta es también el prefijo de
// la key en el bucket. Un solo endpoint para cualquier entidad futura.
@Controller('uploads')
@UseGuards(JwtAuthGuard, CsrfGuard)
export class UploadController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

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

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = await this.storage.save(file, folder, baseUrl);
    return { url };
  }
}
