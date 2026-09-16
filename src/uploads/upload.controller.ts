import { BadRequestException, Controller, Inject, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { STORAGE_SERVICE, type StorageService, type UploadedFileLike } from '../common/storage/storage.service.js';

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = 'image/';

@Controller('uploads')
@UseGuards(JwtAuthGuard, CsrfGuard)
export class UploadController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE_BYTES } }))
  async uploadAvatar(@UploadedFile() file: UploadedFileLike | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Falta el archivo');
    if (!file.mimetype.startsWith(ALLOWED_MIME_PREFIX)) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = await this.storage.save(file, 'avatars', baseUrl);
    return { url };
  }
}
