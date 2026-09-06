import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { CONFIG, type Config } from './config';

/**
 * Bootstrap the Avyo API.
 *
 * Creating the Nest application instantiates the global `ConfigModule`, whose
 * factory runs `validateEnv` over `process.env`. If any required variable is
 * missing or invalid the factory throws, aborting startup before the server
 * begins listening (Req 7.5). On success the validated `PORT` drives
 * `app.listen` (Req 7.1).
 *
 * Requirements: 7.1, 7.2
 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<Config>(CONFIG);

  await app.listen(config.PORT);
}

// Auto-run only when executed directly (e.g. `node dist/main`), so importing
// this module in a test does not start the HTTP server.
if (require.main === module) {
  void bootstrap();
}
