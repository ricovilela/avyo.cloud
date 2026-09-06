import fc from 'fast-check';

import { UnauthenticatedException } from '../../common/filters/app.exception';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh-token.service';

// Feature: auth, Property 15: Unauthenticated logout changes nothing
//
// Validates: Requirements 4.2
//
// The `/auth/logout` route is gated by `JwtAuthGuard`, which runs BEFORE the
// controller's logout handler (and therefore before `AuthService.logout`, which
// is the only caller of `refreshTokenService.revokeSession`). The guard's
// `handleRequest(err, user)` override rejects any authentication failure — a
// non-null error, or a missing (false/null/undefined) principal, i.e. no Bearer
// token, or an expired/malformed/invalid Access_Token — by throwing
// `UnauthenticatedException` (401 UNAUTHENTICATED). Because the guard throws
// first, the logout handler never executes, so no Refresh_Token is ever revoked
// on an unauthenticated request (Req 4.2).
//
// This property models the guard-before-handler ordering directly: for arbitrary
// authentication failures it asserts the guard throws the 401 envelope AND, since
// the guard threw, `revokeSession` is never invoked. A small control confirms the
// success path (no error + a truthy principal) would let the handler run.
describe('logout property: unauthenticated logout changes nothing (Property 15)', () => {
  it('throws UNAUTHENTICATED and revokes no refresh token on any auth failure', () => {
    // Any authentication failure the guard sees: a non-null Error present,
    // and/or a missing principal (false/null/undefined) — the token is absent,
    // expired, malformed, or otherwise invalid.
    const failureArb = fc
      .record({
        err: fc.oneof(
          fc.string().map((m) => new Error(m)),
          fc.constant(null),
        ),
        user: fc.constantFrom<false | null | undefined>(false, null, undefined),
      })
      // Keep only genuine failures: an error present, or a missing principal.
      .filter((s) => s.err !== null || !s.user);

    fc.assert(
      fc.property(failureArb, fc.string(), (scenario, refreshToken) => {
        const guard = new JwtAuthGuard();

        // Spy standing in for the session-revocation collaborator. It is wired
        // into AuthService as the refresh-token service's `revokeSession`, which
        // is the sole path by which a logout revokes a Refresh_Token.
        const revokeSession = jest.fn().mockResolvedValue(undefined);
        const authService = new AuthService(
          {} as never, // prisma — unused on this path
          {} as never, // hasher — unused on this path
          {} as never, // captcha — unused on this path
          {} as never, // mailer — unused on this path
          {} as never, // tokenService — unused on this path
          { revokeSession } as unknown as RefreshTokenService,
        );

        let thrown: unknown;

        // Simulate the request pipeline: the guard runs FIRST. Only if it does
        // NOT throw would the logout handler (and thus revokeSession) run.
        try {
          guard.handleRequest(scenario.err, scenario.user);
          // Unreached for failure inputs; models the handler running after a
          // successful guard.
          void authService.logout(refreshToken);
        } catch (err) {
          thrown = err;
        }

        // The guard rejects every failure with the project's 401 envelope.
        expect(thrown).toBeInstanceOf(UnauthenticatedException);
        const exception = thrown as UnauthenticatedException;
        expect(exception.code).toBe('UNAUTHENTICATED');
        expect(exception.status).toBe(401);

        // Because the guard threw before the handler ran, no Refresh_Token was
        // revoked (Req 4.2).
        expect(revokeSession).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('control: a successful guard lets the logout handler revoke the session', async () => {
    const guard = new JwtAuthGuard();
    const revokeSession = jest.fn().mockResolvedValue(undefined);
    const authService = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { revokeSession } as unknown as RefreshTokenService,
    );

    const principal = { user_id: 'user-1' };
    // Success path: no error AND a truthy principal → the guard returns the
    // principal and the handler runs, so this failure-scoped property does not
    // constrain revocation here.
    expect(guard.handleRequest(null, principal)).toBe(principal);
    await authService.logout('some-refresh-token');
    expect(revokeSession).toHaveBeenCalledWith('some-refresh-token');
  });
});
