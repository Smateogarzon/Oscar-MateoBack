import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { convertToWebp } from './convert-to-webp.js';

async function pngFile(originalname = 'zapato.png') {
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();

  return { buffer, originalname, mimetype: 'image/png' };
}

describe('convertToWebp', () => {
  it('converts the image to webp and renames it', async () => {
    const result = await convertToWebp(await pngFile());

    expect(result.mimetype).toBe('image/webp');
    expect(result.originalname).toBe('zapato.webp');
    expect((await sharp(result.buffer).metadata()).format).toBe('webp');
  });

  it('rejects a file that claims to be an image but is not', async () => {
    const fake = {
      buffer: Buffer.from('no soy una imagen'),
      originalname: 'foto.png',
      mimetype: 'image/png',
    };

    await expect(convertToWebp(fake)).rejects.toThrow(BadRequestException);
  });
});
