import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SnakeCaseInterceptor } from './common/interceptors/snake-case.interceptor';
import { ConfigModule } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { AviaryModule } from './modules/aviary/aviary.module';
import { BandModule } from './modules/band/band.module';
import { BandColorModule } from './modules/band-color/band-color.module';
import { BirdModule } from './modules/bird/bird.module';
import { CageModule } from './modules/cage/cage.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ColorClassModule } from './modules/color-class/color-class.module';
import { GeneticsModule } from './modules/genetics/genetics.module';
import { ManagementModule } from './modules/management/management.module';
import { OfficialColorModule } from './modules/official-color/official-color.module';
import { SpeciesModule } from './modules/species/species.module';
import { StatusModule } from './modules/status/status.module';

/**
 * Root application module.
 *
 * Imports the global {@link ConfigModule} (which validates the environment at
 * bootstrap) and registers all 13 MVP modules that map 1:1 with the menu.
 *
 * Requirements: 7.2, 7.6
 */
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    BirdModule,
    GeneticsModule,
    CalendarModule,
    BandModule,
    BandColorModule,
    CageModule,
    SpeciesModule,
    OfficialColorModule,
    ColorClassModule,
    StatusModule,
    ManagementModule,
    AviaryModule,
  ],
  providers: [
    // Global input validation: strip unknown properties, reject non-whitelisted
    // ones, and transform payloads into their DTO classes (needed for nested
    // @Type validation). Registered via APP_PIPE so it participates in DI and
    // applies to every route (Req 12.4).
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    // Global error envelope + snake_case serialization (Req 12.1, 12.3). Both
    // are dependency-free, so binding a fresh instance is sufficient.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: SnakeCaseInterceptor },
  ],
})
export class AppModule {}
