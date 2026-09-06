import { IsString, Matches } from 'class-validator';
import type { RefreshRequest } from '@avyo/types';

/**
 * `POST /auth/refresh` request body (Req 3.5).
 *
 * snake_case field aligned with {@link RefreshRequest} from `@avyo/types`.
 * `refresh_token` must be a non-empty, non-whitespace string: a value that is
 * missing, null, empty, whitespace-only, or a non-string fails validation. The
 * `@Matches(/\S/)` rule rejects whitespace-only strings (it requires at least
 * one non-whitespace character).
 */
export class RefreshDto implements RefreshRequest {
  @IsString()
  @Matches(/\S/, {
    message: 'refresh_token must not be empty or whitespace-only',
  })
  refresh_token!: string;
}
