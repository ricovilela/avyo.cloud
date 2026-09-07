import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { age_group } from '@avyo/types';

/**
 * `GET /official-color` query filters (Req 3.3, 4.2).
 *
 * Both filters are optional. When present:
 * - `class_id` must be a valid v4 UUID; a non-UUID value is rejected with
 *   HTTP 400 `VALIDATION_ERROR` (Req 3.3).
 * - `age_group` must be an exact, case-sensitive member of the {@link age_group}
 *   enum (`young` / `adult`); any other value — including `Young`, `ADULT`,
 *   empty, or whitespace-only strings — is rejected with HTTP 400
 *   `VALIDATION_ERROR` (Req 4.2).
 *
 * Unknown query parameters are rejected by the globally-configured
 * `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`,
 * `transform: true`), which also materializes this DTO as a class instance.
 */
export class ListOfficialColorQueryDto {
  @IsOptional()
  @IsUUID('4')
  class_id?: string;

  @IsOptional()
  @IsEnum(age_group)
  age_group?: age_group;
}
