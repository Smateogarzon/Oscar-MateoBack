import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageService, UploadedFileLike } from './storage.service.js';

@Injectable()
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(config: ConfigService) {
    this.region = config.getOrThrow<string>('AWS_REGION');
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET');
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');

    // Las llaves solo existen en el .env local. En el EC2 no se configuran y el SDK
    // toma credenciales temporales del rol asignado al servidor.
    this.client = new S3Client({
      region: this.region,
      ...(accessKeyId &&
        secretAccessKey && { credentials: { accessKeyId, secretAccessKey } }),
    });
  }

  async save(file: UploadedFileLike, folder: string): Promise<string> {
    const key = `${folder}/${randomUUID()}${extname(file.originalname)}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
