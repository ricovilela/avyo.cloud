import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';

import { CONFIG } from '../../config/config.module';
import type { Config } from '../../config/env.validation';

/**
 * The authenticated principal bound to the request by {@link JwtStrategy}.
 *
 * It carries only the tenant identifier (`user_id`), derived solely from the
 * validated Access_Token's `sub` claim. No other claim from the token is
 * propagated (Req 11.1, 11.4).
 */
export interface JwtPrincipal {
  user_id: string;
}

/**
 * The shape of the JWT payload this strategy consumes. Only `sub` is read; any
 * other claims are intentionally ignored so that the resolved tenant identity
 * can never be influenced by additional token content (Req 11.4).
 */
interface JwtPayload {
  sub: string;
}

/**
 * Passport `jwt` strategy for the Avyo API.
 *
 * Extracts the Bearer token from the `Authorization` header, verifies its HS256
 * signature and expiry against `JWT_SECRET` (Req 10.1, 10.5), and resolves the
 * request principal from the `sub` claim only (Req 11.1, 11.4).
 *
 * `ignoreExpiration` is `false` so expired tokens are rejected by Passport
 * before {@link validate} runs, which surfaces as `UNAUTHENTICATED` via the
 * guard (Req 10.4, 10.5).
 *
 * Requirements: 10.4, 10.5, 11.1, 11.4
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(CONFIG) config: Config) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.JWT_SECRET,
      algorithms: ['HS256'],
    };
    super(options);
  }

  /**
   * Build the request principal from a verified token payload.
   *
   * The tenant identity is derived solely from the `sub` claim; every other
   * claim is discarded (Req 11.1, 11.4).
   *
   * @param payload - The decoded, signature- and expiry-verified JWT payload.
   * @returns The {@link JwtPrincipal} bound to the request as `request.user`.
   */
  validate(payload: JwtPayload): JwtPrincipal {
    return { user_id: payload.sub };
  }
}
