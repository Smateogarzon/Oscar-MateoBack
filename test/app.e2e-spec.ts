import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

// La app entera levantada (con la base del .env): es la misma comprobación que hace el despliegue
// para saber que el servidor ya responde (deploy/deploy.sh, `{ ping }`).
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('answers the readiness query of the deploy', () => {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ ping }' })
      .expect(200)
      .expect({ data: { ping: 'pong' } });
  });

  afterEach(async () => {
    await app.close();
  });
});
