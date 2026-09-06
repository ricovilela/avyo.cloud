import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import type { SignupRequest } from '@avyo/types';

/**
 * `POST /auth/signup` request body (Req 1.1, 1.6).
 *
 * snake_case fields aligned with {@link SignupRequest} from `@avyo/types`.
 * Constraints:
 * - `name`: string, 1–255 chars.
 * - `email`: RFC 5322 address format, 3–254 chars.
 * - `password`: string, 8–128 chars.
 * - `captcha0` / `captcha1`: non-empty strings (challenge fields).
 */
export class SignupDto implements SignupRequest {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsString()
  @Length(3, 254)
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  captcha0!: string;

  @IsString()
  @IsNotEmpty()
  captcha1!: string;
}
