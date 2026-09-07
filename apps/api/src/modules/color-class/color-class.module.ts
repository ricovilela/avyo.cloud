import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ColorClassController } from './color-class.controller';
import { ColorClassService } from './color-class.service';

/**
 * NestJS module for the global `color-class` catalog.
 *
 * Imports {@link AuthModule} to reuse the exported {@link JwtAuthGuard} and
 * {@link EmailVerifiedGuard} without re-wiring the Passport `jwt` strategy —
 * the guards resolve through `AuthModule`'s provider graph. Registers the
 * {@link ColorClassController} and its {@link ColorClassService}, and provides
 * {@link PrismaService} for the service's global (no-tenant) reads.
 *
 * The module is already registered in `app.module.ts`.
 *
 * Requirements: 1.1, 1.4, 1.6, 5.1, 5.3, 5.4
 */
@Module({
  imports: [AuthModule],
  controllers: [ColorClassController],
  providers: [ColorClassService, PrismaService],
})
export class ColorClassModule {}
