import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { ForgotPasswordRequest } from '@avyo/types';

/**
 * `POST /auth/forgot-password` request body (Req 6.3).
 *
 * snake_case field aligned with {@link ForgotPasswordRequest} from `@avyo/types`.
 * `email` must be a non-empty string of at most 254 chars conforming to the
 * standard `local-part@domain` format: a value that is missing, empty, exceeds
 * 254 chars, or is malformed fails validation.
 */
export class ForgotPasswordDto implements ForgotPasswordRequest {
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;
}
