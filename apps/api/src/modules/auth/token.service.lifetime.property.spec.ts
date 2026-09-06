import fc from 'fast-check';
import {
  DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
  resolveExpiresIn,
} from './token.service';

/**
 * Property-based test for Access_Token lifetime resolution.
 *
 * Validates: Requirements 10.2
 *
 * Property 28 (Access-token lifetime resolution): for any `JWT_EXPIRES_IN`
 * value that is absent, empty, or whitespace-only, the resolved lifetime is
 * {@link DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS} (86400 seconds); otherwise it
 * equals the configured value — a purely numeric value resolving to that number
 * of seconds and any other non-blank value resolving to the trimmed duration
 * string.
 */

/** Whitespace characters used to build blank inputs. */
const WHITESPACE_CHARS = [' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'];

/**
 * Generates inputs that are "blank" per Req 10.2: `undefined`, the empty
 * string, or strings composed solely of whitespace characters.
 */
function blankInputArbitrary(): fc.Arbitrary<string | undefined> {
  const whitespaceOnly = fc
    .array(fc.constantFrom(...WHITESPACE_CHARS), { minLength: 1, maxLength: 8 })
    .map((chars) => chars.join(''));

  return fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    whitespaceOnly,
  );
}

/**
 * Generates purely-numeric second counts (as raw strings, optionally padded
 * with surrounding whitespace) that must resolve to the equivalent number.
 */
function numericInputArbitrary(): fc.Arbitrary<{
  raw: string;
  expected: number;
}> {
  return fc
    .tuple(
      fc.nat({ max: 10_000_000 }),
      fc.stringMatching(/^[ \t]*$/),
      fc.stringMatching(/^[ \t]*$/),
    )
    .map(([seconds, lead, trail]) => ({
      raw: `${lead}${seconds}${trail}`,
      expected: seconds,
    }));
}

/**
 * Generates non-blank, non-numeric duration strings (e.g. `"15m"`, `"7d"`)
 * that must resolve to their trimmed form verbatim. The core token contains at
 * least one non-whitespace, non-digit-only character.
 */
function durationInputArbitrary(): fc.Arbitrary<{
  raw: string;
  expected: string;
}> {
  const core = fc
    .string({ minLength: 1, maxLength: 12 })
    // A trimmed core that is neither blank nor purely numeric.
    .filter((s) => {
      const t = s.trim();
      return t.length > 0 && !/^\d+$/.test(t);
    });

  return fc
    .tuple(core, fc.stringMatching(/^[ \t]*$/), fc.stringMatching(/^[ \t]*$/))
    .map(([token, lead, trail]) => ({
      raw: `${lead}${token.trim()}${trail}`,
      expected: token.trim(),
    }));
}

describe('resolveExpiresIn (Access_Token lifetime resolution)', () => {
  // Feature: auth, Property 28: Access-token lifetime resolution
  it('returns 86400 for blank inputs and the configured value otherwise', () => {
    const blankCase = blankInputArbitrary().map((raw) => ({
      kind: 'blank' as const,
      raw,
    }));
    const numericCase = numericInputArbitrary().map(({ raw, expected }) => ({
      kind: 'numeric' as const,
      raw,
      expected,
    }));
    const durationCase = durationInputArbitrary().map(({ raw, expected }) => ({
      kind: 'duration' as const,
      raw,
      expected,
    }));

    fc.assert(
      fc.property(
        fc.oneof(blankCase, numericCase, durationCase),
        (input) => {
          const actual = resolveExpiresIn(input.raw);

          switch (input.kind) {
            case 'blank':
              // Absent/empty/whitespace-only -> default lifetime.
              expect(actual).toBe(DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS);
              expect(actual).toBe(86400);
              break;
            case 'numeric':
              // Purely-numeric -> that number of seconds.
              expect(actual).toBe(input.expected);
              break;
            case 'duration':
              // Otherwise -> trimmed duration string verbatim.
              expect(actual).toBe(input.expected);
              break;
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
