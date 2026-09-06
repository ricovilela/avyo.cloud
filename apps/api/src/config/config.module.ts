import { Global, Module } from '@nestjs/common';

import { validateEnv, type Config } from './env.validation';

/**
 * Injection token for the validated, typed API {@link Config}.
 *
 * Inject with `@Inject(CONFIG)` to receive the parsed configuration produced by
 * {@link validateEnv}.
 */
export const CONFIG = Symbol('AVYO_CONFIG');

/**
 * Global configuration module for the Avyo API.
 *
 * On instantiation it runs {@link validateEnv} over `process.env`. Because the
 * factory executes while the Nest application is being created (before
 * `app.listen`), a missing or invalid environment variable aborts startup
 * before the HTTP server begins listening (Req 7.4, 7.5).
 *
 * The resulting {@link Config} is provided under the {@link CONFIG} token and,
 * being `@Global`, is available to every module without re-importing.
 *
 * Requirements: 7.2, 7.4, 7.5
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): Config => validateEnv(),
    },
  ],
  exports: [CONFIG],
})
export class ConfigModule {}
