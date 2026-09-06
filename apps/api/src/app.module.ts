import { Module } from '@nestjs/common';

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
})
export class AppModule {}
