import { IsString, Length } from 'class-validator';
import type { ResetPasswordRequest } from '@avyo/types';

/**
 * `POST /auth/reset-password` request body (Req 7.5).
 *
 * snake_case fields aligned with {@link ResetPasswordRequest} from `@avyo/types`.
 * Constraints:
 * - `token`: non-empty string, at most 512 chars.
 * - `password`: string, 8–128 chars.
 * A request that omits `token`, omits `password`, or supplies a `password`
 * shorter than 8 or longer than 128 chars fails validation.
 */
export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @Length(1, 512)
  token!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
