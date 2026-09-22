import { BadRequestException, Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import { CsrfGuard } from '../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

const MAX_MESSAGE_LENGTH = 50_000;

@Controller('pos-hardware')
@UseGuards(JwtAuthGuard)
export class PosHardwareController {
  private readonly privateKey: string;
  private readonly certificate: string;

  constructor(config: ConfigService) {
    this.privateKey = Buffer.from(config.getOrThrow<string>('QZ_PRIVATE_KEY_B64'), 'base64').toString('utf8');
    this.certificate = Buffer.from(config.getOrThrow<string>('QZ_CERTIFICATE_B64'), 'base64').toString('utf8');
  }

  @Get('certificate')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getCertificate(): string {
    return this.certificate;
  }

  @Post('sign')
  @UseGuards(CsrfGuard)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  sign(@Body('message') message: unknown): string {
    if (typeof message !== 'string' || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException('Mensaje inválido');
    }
    const signer = createSign('SHA512');
    signer.update(message);
    return signer.sign(this.privateKey, 'base64');
  }
}
