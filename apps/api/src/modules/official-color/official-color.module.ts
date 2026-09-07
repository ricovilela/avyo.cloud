import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { OfficialColorController } from './official-color.controller';
import { OfficialColorService } from './official-color.service';

/**
 * Wires the read-only `GET /official-color` endpoint.
 *
 * Imports {@link AuthModule} to reuse its exported {@link JwtAuthGuard} and
 * {@link EmailVerifiedGuard} for route protection (Req 5.1, 5.3, 5.4). Provides
 * {@link OfficialColorService} and {@link PrismaService} for the global catalog
 * read. Registered in the root `AppModule` (Req 7.2).
 */
@Module({
  imports: [AuthModule],
  controllers: [OfficialColorController],
  providers: [OfficialColorService, PrismaService],
})
export class OfficialColorModule {}
