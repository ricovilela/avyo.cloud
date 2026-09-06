import { IsString, Length } from 'class-validator';
import type { VerifyEmailRequest } from '@avyo/types';

/**
 * `POST /auth/verify-email` request body (Req 5.3).
 *
 * snake_case field aligned with {@link VerifyEmailRequest} from `@avyo/types`.
 * `token` must be a non-empty string of at most 512 chars: a value that is
 * missing, null, empty, non-string, or exceeds 512 chars fails validation.
 */
export class VerifyEmailDto implements VerifyEmailRequest {
  @IsString()
  @Length(1, 512)
  token!: string;
}
