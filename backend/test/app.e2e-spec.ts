import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('API e2e (requiere servicios: postgres + redis)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rechaza login con payload inválido', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'no-es-email', password: '' })
      .expect(400);
  });

  it('protege endpoints sin token', async () => {
    await request(app.getHttpServer()).get('/api/v1/products').expect(401);
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    await request(app.getHttpServer()).get('/api/v1/audit').expect(401);
  });
});
