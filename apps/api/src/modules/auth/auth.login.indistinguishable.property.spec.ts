import fc from 'fast-check';

import { AuthService } from './auth.service';
import {
  AppException,
  UnauthenticatedException,
} from '../../common/filters/app.exception';
import type { LoginDto } from './dto/login.dto';

// Feature: auth, Property 6: Login is indistinguishable for unknown email vs wrong password

/**
 * Feature: auth, Property 6: Login is indistinguishable for unknown email vs
 * wrong password
 *
 * Validates: Requirements 2.5
 *
 * For any login attempt with a valid captcha/device where the credentials do
 * not match a user — whether because the email is unknown or because the
 * password is wrong — {@link AuthService.login} rejects with a
 * `401 UNAUTHENTICATED` {@link UnauthenticatedException} and persists no tokens.
 * The two failure causes are observably identical: the thrown error's `code`,
 * `status`, `message`, and `details` are equal, and neither
 * {@link TokenService.sign} nor {@link RefreshTokenService.issue} is ever
 * invoked. No field distinguishes unknown-email from wrong-password.
 */

/** The two credential-mismatch causes login must render indistinguishably. */
type FailureMode = 'unknown-email' | 'wrong-password';

/** The observable shape of a thrown AppException, used for deep comparison. */
interface ObservableError {
  instanceOfUnauthenticated: boolean;
  code: string;
  status: number;
  message: string;
  details: unknown;
}

/**
 * Build an AuthService wired to local fakes for a single failure mode.
 *
 * - captcha.verify → true, so control always reaches the credential check.
 * - hasher.verify → false, so the wrong-password branch fails; the unknown-email
 *   branch runs the dummy verify and ignores it. Both paths therefore throw.
 * - prisma.user.findUnique → null for 'unknown-email', or a user row for
 *   'wrong-password'.
 * - tokenService.sign / refreshTokenService.issue are jest mocks that must never
 *   be called on a failed login (no tokens issued or persisted).
 */
function buildService(mode: FailureMode): {
  service: AuthService;
  sign: jest.Mock;
  issue: jest.Mock;
} {
  const prisma = {
    user: {
      findUnique: () =>
        Promise.resolve(
          mode === 'unknown-email'
            ? null
            : { id: 'user-1', passwordHash: 'stored-hash' },
        ),
    },
  } as never;

  const captcha = { verify: async () => true } as never;
  const hasher = { hash: async () => 'h', verify: async () => false } as never;
  const mailer = {} as never;

  const sign = jest.fn();
  const issue = jest.fn();
  const tokenService = { sign } as never;
  const refreshTokenService = { issue } as never;

  const service = new AuthService(
    prisma,
    hasher,
    captcha,
    mailer,
    tokenService,
    refreshTokenService,
  );

  return { service, sign, issue };
}

/**
 * Attempt a login expected to fail, returning the observable error shape.
 * Asserts (per mode) that no token was issued or persisted.
 */
async function attemptFailedLogin(
  mode: FailureMode,
  dto: LoginDto,
): Promise<ObservableError> {
  const { service, sign, issue } = buildService(mode);

  let thrown: unknown;
  try {
    await service.login(dto);
  } catch (err) {
    thrown = err;
  }

  // No tokens minted or persisted on a failed login (Req 2.5).
  expect(sign).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();

  return {
    instanceOfUnauthenticated: thrown instanceof UnauthenticatedException,
    code: (thrown as AppException).code,
    status: (thrown as AppException).status,
    message: (thrown as AppException).message,
    details: (thrown as AppException).details,
  };
}

describe('AuthService property: login is indistinguishable for unknown email vs wrong password (Property 6)', () => {
  it('rejects both credential-mismatch causes with an identical 401 UNAUTHENTICATED and issues no tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 128 }),
        // A valid, fully-populated device fingerprint (non-empty fields).
        fc.record({
          user_agent: fc.string({ minLength: 1, maxLength: 64 }),
          os: fc.string({ minLength: 1, maxLength: 32 }),
          browser: fc.string({ minLength: 1, maxLength: 32 }),
        }),
        async (email, password, device) => {
          const dto: LoginDto = {
            email,
            password,
            captcha0: 'c0',
            captcha1: 'c1',
            device,
          };

          const unknownEmail = await attemptFailedLogin('unknown-email', dto);
          const wrongPassword = await attemptFailedLogin('wrong-password', dto);

          // Both throw a 401 UNAUTHENTICATED AppException (Req 2.5).
          for (const observed of [unknownEmail, wrongPassword]) {
            expect(observed.instanceOfUnauthenticated).toBe(true);
            expect(observed.code).toBe('UNAUTHENTICATED');
            expect(observed.status).toBe(401);
          }

          // The two failure causes are observably indistinguishable: identical
          // code, status, message, and details (Req 2.5).
          expect(unknownEmail).toEqual(wrongPassword);
        },
      ),
      { numRuns: 100 },
    );
  });
});
