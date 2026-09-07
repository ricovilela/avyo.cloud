// Feature: color-catalogs, Property 11: Invalid filter parameters are rejected
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { age_group } from '@avyo/types';

import { ListOfficialColorQueryDto } from './list-official-color.query.dto';

/**
 * Feature: color-catalogs, Property 11 — Invalid filter parameters are rejected.
 *
 * Validates: Requirements 3.3, 4.2
 *
 * For any `class_id` that is not a valid v4 UUID, and for any `age_group` value
 * outside the exact set {young, adult} (including empty, whitespace-only, or
 * differently-cased values such as `Young`/`ADULT`), validating
 * `ListOfficialColorQueryDto` yields at least one validation error — the path
 * that leads the global `ValidationPipe` to reject the request with HTTP 400
 * `VALIDATION_ERROR` and return no catalog records.
 *
 * This is tested at the pure-logic level (the design's testing note): the DTO
 * is materialized with class-transformer's `plainToInstance` and validated with
 * class-validator's `validate`, exactly as the runtime pipe does.
 */

/** RFC 4122 version-4 UUID matcher (variant 8/9/a/b, version nibble 4). */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Arbitrary strings that are NOT valid v4 UUIDs (Req 3.3). */
const nonUuidArb = fc.string().filter((s) => !UUID_V4.test(s));

/**
 * Arbitrary values outside the exact, case-sensitive {young, adult} set (Req 4.2):
 * empty, whitespace-only, wrong-cased, and arbitrary strings.
 */
const badAgeGroupArb = fc
  .oneof(
    fc.constant(''),
    fc.constant(' '),
    fc.constant('   '),
    fc.constant('\t'),
    fc.constant('Young'),
    fc.constant('YOUNG'),
    fc.constant('Adult'),
    fc.constant('ADULT'),
    fc.constant('young '),
    fc.constant(' adult'),
    fc.string(),
  )
  .filter((s) => s !== 'young' && s !== 'adult');

describe('ListOfficialColorQueryDto property: invalid filters rejected (Property 11)', () => {
  it('fails validation for any non-UUID class_id and/or any out-of-set age_group', async () => {
    // Each generated input makes at least one filter invalid: a bad class_id, a
    // bad age_group, or both. A valid-but-absent field never rescues the input.
    const invalidInputArb = fc.oneof(
      nonUuidArb.map((class_id) => ({ class_id })),
      badAgeGroupArb.map((age_group) => ({ age_group })),
      fc
        .tuple(nonUuidArb, badAgeGroupArb)
        .map(([class_id, age_group]) => ({ class_id, age_group })),
    );

    await fc.assert(
      fc.asyncProperty(invalidInputArb, async (plain) => {
        const dto = plainToInstance(ListOfficialColorQueryDto, plain);
        const errors = await validate(dto);

        // At least one field-level error → 400 VALIDATION_ERROR, no records.
        expect(errors.length).toBeGreaterThan(0);

        // The error(s) name only the filter properties this DTO validates.
        for (const error of errors) {
          expect(['class_id', 'age_group']).toContain(error.property);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('passes validation for any valid v4 UUID class_id and in-set age_group', async () => {
    // Sanity direction: proper v4 UUIDs and exact `young`/`adult` values are
    // accepted, confirming the property above rejects only genuine violations.
    const validInputArb = fc.record(
      {
        class_id: fc.constant(null).map(() => randomUUID()),
        age_group: fc.constantFrom(age_group.young, age_group.adult),
      },
      { requiredKeys: [] },
    );

    await fc.assert(
      fc.asyncProperty(validInputArb, async (plain) => {
        const dto = plainToInstance(ListOfficialColorQueryDto, plain);
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
