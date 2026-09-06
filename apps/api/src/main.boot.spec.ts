import { NestFactory } from '@nestjs/core';

import { CONFIG, type Config } from './config';

/**
 * Boot smoke test for `main.ts`.
 *
 * Validates: Requirements 7.1
 *
 * This is an example / smoke test (this spec is scaffolding-only). Rather than
 * starting a real HTTP server, it mocks `NestFactory.create` to return a fake
 * app whose validated `Config` carries a fixed `PORT`, then asserts that
 * `bootstrap` binds the server to that exact validated `PORT` value.
 */

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

describe('bootstrap (Req 7.1)', () => {
  const FIXED_PORT = 4321;

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('binds app.listen to the validated PORT from config', async () => {
    const listen = jest.fn().mockResolvedValue(undefined);
    const config: Config = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/avyo',
      JWT_SECRET: 'jwt-secret',
      JWT_EXPIRES_IN: '15m',
      REFRESH_SECRET: 'refresh-secret',
      REFRESH_EXPIRES_IN: '7d',
      PORT: FIXED_PORT,
    };

    const get = jest.fn((token: unknown) =>
      token === CONFIG ? config : undefined,
    );
    const fakeApp = { get, listen };

    (NestFactory.create as jest.Mock).mockResolvedValue(fakeApp);

    const { bootstrap } = await import('./main');
    await bootstrap();

    expect(NestFactory.create).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(CONFIG);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(FIXED_PORT);
  });
});
