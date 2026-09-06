import fc from 'fast-check';

import { UnauthenticatedException } from '../filters/app.exception';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Feature: auth, Property 26: Unauthenticated /auth/me leaks no profile
 *
 * Validates: Requirements 8.3
 *
 * `JwtAuthGuard` is the gate that runs before `AuthController.me`. Its
 * `handleRequest(err, user)` override normalises Passport's outcome: on any
 * authentication failure — a non-null error, or a missing (false/null/undefined)
 * principal, i.e. a missing/invalid/expired Bearer token — it throws
 * `UnauthenticatedException`. Because the guard rejects before the controller
 * runs, no `user` object and no `menu` array is ever constructed on failure;
 * the thrown exception is rendered by the global filter into the
 * `401 UNAUTHENTICATED` error envelope with neither `user` nor `menu` (Req 8.3).
 *
 * This property drives `handleRequest` directly across arbitrary failure inputs
 * and asserts it always throws (returning no principal), and — as a control —
 * that a genuine success (`err` null AND a truthy principal) returns exactly
 * that principal, proving the gate blocks only failures.
 */
describe('JwtAuthGuard property: unauthenticated /auth/me leaks no profile (Property 26)', () => {
  it('throws UNAUTHENTICATED (no user/menu) on any auth failure, and returns the principal on success', () => {
    // Any authentication failure: a non-null Error, and/or a missing principal.
    const failureArb = fc
      .record({
        err: fc.oneof(
          fc.string().map((m) => new Error(m)),
          fc.constant(null),
        ),
        user: fc.constantFrom<false | null | undefined>(false, null, undefined),
        // The optional `info` arg Passport may pass; irrelevant to the outcome.
        info: fc.option(fc.string(), { nil: undefined }),
      })
      // Keep only genuine failures: an error present, or a missing principal.
      .filter((s) => s.err !== null || !s.user);

    fc.assert(
      fc.property(failureArb, (scenario) => {
        const guard = new JwtAuthGuard();

        let thrown: unknown;
        let returned: unknown;
        try {
          // The guard runs before AuthController.me; a throw here means the
          // controller/service never executes, so no user/menu is produced.
          returned = guard.handleRequest(scenario.err, scenario.user);
        } catch (err) {
          thrown = err;
        }

        // Must reject every failure with the project's 401 envelope code.
        expect(returned).toBeUndefined();
        expect(thrown).toBeInstanceOf(UnauthenticatedException);
        const exception = thrown as UnauthenticatedException;
        expect(exception.code).toBe('UNAUTHENTICATED');
        expect(exception.status).toBe(401);
        // Nothing profile-shaped ever flows out of the gate on failure.
        expect(exception).not.toHaveProperty('user');
        expect(exception).not.toHaveProperty('menu');
      }),
      { numRuns: 200 },
    );
  });

  it('control: returns the authenticated principal unchanged when authentication succeeds', () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        const guard = new JwtAuthGuard();
        const principal = { user_id: userId };

        // Success path: no error AND a truthy principal → the principal flows
        // through untouched, so the authenticated /auth/me path is preserved.
        expect(guard.handleRequest(null, principal)).toBe(principal);
      }),
      { numRuns: 100 },
    );
  });
});
