import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import type { DeviceFingerprint, LoginRequest } from '@avyo/types';

/**
 * Device fingerprint captured at login (Req 2.1, 2.4, 2.7).
 *
 * Nested DTO aligned with {@link DeviceFingerprint}; each field is a non-empty
 * string. A `device` that omits or empties any field fails validation.
 */
export class DeviceDto implements DeviceFingerprint {
  @IsString()
  @IsNotEmpty()
  user_agent!: string;

  @IsString()
  @IsNotEmpty()
  os!: string;

  @IsString()
  @IsNotEmpty()
  browser!: string;
}

/**
 * `POST /auth/login` request body (Req 2.1, 2.7).
 *
 * snake_case fields aligned with {@link LoginRequest} from `@avyo/types`.
 * Login validation is about presence and shape: the `email` must be a valid
 * address (3–254 chars) and `password` a non-empty string; captcha fields are
 * non-empty; and `device` is a required, validated nested object. A missing
 * `device` fails validation.
 */
export class LoginDto implements LoginRequest {
  @IsString()
  @Length(3, 254)
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  captcha0!: string;

  @IsString()
  @IsNotEmpty()
  captcha1!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
