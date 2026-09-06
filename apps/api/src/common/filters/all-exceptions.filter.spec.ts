import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import fc from 'fast-check';
import { ERROR_CODES, type ErrorCode } from '@avyo/types';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from './app.exception';

/**
 * Drives {@link AllExceptionsFilter.catch} with a mocked Express-style
 * response captured through `res.status().json()`, returning the emitted
 * HTTP status and JSON body.
 */
function invokeFilter(exception: unknown): { status: number; body: unknown } {
  const filter = new AllExceptionsFilter();
  let capturedStatus = -1;
  let capturedBody: unknown;

  const res = {
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(body: unknown) {
      capturedBody = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);
  return { status: capturedStatus, body: capturedBody };
}

/** True when `value` is a snake_case identifier (lower alnum groups joined by `_`). */
function isSnakeCase(value: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(value);
}

/**
 * Universal envelope-contract assertions applied to every emitted body
 * regardless of the driving exception (Req 12.1, 12.2, 12.4, 12.5).
 */
function assertEnvelopeContract(body: unknown): void {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();

  // Exactly the single top-level `error` key.
  expect(Object.keys(body as object)).toEqual(['error']);

  const error = (body as { error: unknown }).error;
  expect(typeof error).toBe('object');
  expect(error).not.toBeNull();

  // Exactly `code`, `message`, `details` (order-independent).
  expect(new Set(Object.keys(error as object))).toEqual(
    new Set(['code', 'message', 'details']),
  );

  const { code, message, details } = error as {
    code: unknown;
    message: unknown;
    details: unknown;
  };

  // code is from the allowed set.
  expect(ERROR_CODES).toContain(code as ErrorCode);

  // message is a string of 1..500 chars.
  expect(typeof message).toBe('string');
  expect((message as string).length).toBeGreaterThanOrEqual(1);
  expect((message as string).length).toBeLessThanOrEqual(500);

  // details is an array; every entry has exactly { field, message }.
  expect(Array.isArray(details)).toBe(true);
  for (const detail of details as unknown[]) {
    expect(typeof detail).toBe('object');
    expect(detail).not.toBeNull();
    expect(new Set(Object.keys(detail as object))).toEqual(
      new Set(['field', 'message']),
    );
    const { field, message: detailMessage } = detail as {
      field: unknown;
      message: unknown;
    };
    expect(typeof field).toBe('string');
    expect(isSnakeCase(field as string)).toBe(true);
    expect(typeof detailMessage).toBe('string');
    expect((detailMessage as string).length).toBeGreaterThanOrEqual(1);
    expect((detailMessage as string).length).toBeLessThanOrEqual(500);
  }
}

// --- Smart generators constrained to the realistic input space --------------

/** Non-empty client-safe message within the 1..500 char contract bound. */
const messageArb = fc.string({ minLength: 1, maxLength: 500 });

/** A snake_case field identifier, matching real DTO/body field names. */
const snakeFieldArb = fc
  .array(
    fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 6,
      })
      .map((chars) => chars.join('')),
    { minLength: 1, maxLength: 3 },
  )
  .map((segments) => segments.join('_'));

/** One field-level detail: snake_case field + 1..500 char message. */
const detailArb = fc.record({
  field: snakeFieldArb,
  message: fc.string({ minLength: 1, maxLength: 490 }),
});

type DriveCase =
  | { kind: 'app'; exception: unknown; details: { field: string; message: string }[] }
  | { kind: 'http'; exception: unknown }
  | { kind: 'validation'; exception: unknown; expectedFieldCount: number }
  | { kind: 'unknown'; exception: unknown };

/** Deliberately-thrown domain error carrying an explicit code + details. */
const appCaseArb: fc.Arbitrary<DriveCase> = fc
  .record({
    code: fc.constantFrom(...ERROR_CODES),
    message: messageArb,
    details: fc.array(detailArb, { minLength: 0, maxLength: 5 }),
  })
  .map(({ code, message, details }) => ({
    kind: 'app' as const,
    exception: new AppException(code, message, details),
    details,
  }));

/** Built-in Nest HttpException across mapped and unmapped statuses. */
const httpCaseArb: fc.Arbitrary<DriveCase> = fc
  .record({
    status: fc.constantFrom(
      HttpStatus.BAD_REQUEST,
      HttpStatus.UNAUTHORIZED,
      HttpStatus.FORBIDDEN,
      HttpStatus.NOT_FOUND,
      HttpStatus.CONFLICT,
      HttpStatus.UNPROCESSABLE_ENTITY,
      HttpStatus.TOO_MANY_REQUESTS,
      HttpStatus.I_AM_A_TEAPOT,
      HttpStatus.BAD_GATEWAY,
      HttpStatus.SERVICE_UNAVAILABLE,
    ),
    message: messageArb,
  })
  .map(({ status, message }) => ({
    kind: 'http' as const,
    exception: new HttpException(message, status),
  }));

/**
 * A `ValidationPipe`-style `BadRequestException` whose response `message` is a
 * string array, one conventionally field-prefixed constraint per entry.
 */
const validationCaseArb: fc.Arbitrary<DriveCase> = fc
  .array(
    fc.record({ field: snakeFieldArb, constraint: fc.string({ maxLength: 200 }) }),
    { minLength: 1, maxLength: 6 },
  )
  .map((entries) => {
    const messages = entries.map((e) => `${e.field} ${e.constraint}`.trim());
    const expectedFieldCount = new Set(entries.map((e) => e.field)).size;
    return {
      kind: 'validation' as const,
      exception: new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
      }),
      expectedFieldCount,
    };
  });

/** Arbitrary non-Http, non-App value thrown/leaked into the filter. */
const unknownCaseArb: fc.Arbitrary<DriveCase> = fc
  .oneof(
    messageArb.map((m) => new Error(m)),
    messageArb.map((m) => new TypeError(m)),
    fc.string(),
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined),
    fc.object(),
  )
  .map((exception) => ({ kind: 'unknown' as const, exception }));

const driveCaseArb: fc.Arbitrary<DriveCase> = fc.oneof(
  appCaseArb,
  httpCaseArb,
  validationCaseArb,
  unknownCaseArb,
);

describe('AllExceptionsFilter — error envelope contract', () => {
  // Feature: auth, Property 31: Error responses conform to the envelope contract
  // Validates: Requirements 12.1, 12.2, 12.4, 12.5
  it('renders every error as a well-formed envelope with a valid code, message, and details', () => {
    fc.assert(
      fc.property(driveCaseArb, (driveCase) => {
        const { body } = invokeFilter(driveCase.exception);

        // Universal contract holds for every error (Req 12.1, 12.2).
        assertEnvelopeContract(body);

        const details = (body as { error: { details: { field: string }[] } })
          .error.details;

        switch (driveCase.kind) {
          case 'app':
            // Details are passed through faithfully; [] when none (Req 12.4, 12.5).
            expect(details).toEqual(driveCase.details);
            break;
          case 'validation':
            // Exactly one entry per invalid field (Req 12.4).
            expect(details).toHaveLength(driveCase.expectedFieldCount);
            break;
          case 'http':
          case 'unknown':
            // No field-level detail => empty array (Req 12.5).
            expect(details).toEqual([]);
            break;
        }
      }),
      { numRuns: 300 },
    );
  });
});
