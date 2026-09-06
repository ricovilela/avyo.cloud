/**
 * Environment variable validation for the Avyo API.
 *
 * Decorator-free and framework-agnostic so it can be unit-tested in isolation
 * and later wired into NestJS via `ConfigModule.forRoot({ validate })`.
 *
 * On success it returns a typed, parsed {@link Config}. On failure it throws an
 * {@link EnvValidationError} naming *every* offending variable (it collects all
 * problems instead of failing on the first one).
 *
 * Requirements: 7.4, 7.5
 */

/**
 * The parsed, validated API configuration.
 *
 * `JWT_EXPIRES_IN` / `REFRESH_EXPIRES_IN` are kept as strings because they may
 * be either a raw number of seconds (e.g. `"86400"`) or a duration string
 * understood by the JWT layer (e.g. `"15m"`). `PORT` is coerced to a number.
 */
export interface Config {
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  REFRESH_SECRET: string;
  REFRESH_EXPIRES_IN: string;
  PORT: number;
}

/** Source of raw environment values (defaults to `process.env`). */
export type EnvSource = Record<string, string | undefined>;

/**
 * Error thrown when one or more required environment variables are missing or
 * invalid. `variables` lists every offending variable name.
 */
export class EnvValidationError extends Error {
  readonly variables: string[];

  constructor(issues: string[], variables: string[]) {
    super(
      `Invalid environment configuration. ${issues.length} problem(s) found:\n` +
        issues.map((issue) => `  - ${issue}`).join('\n'),
    );
    this.name = 'EnvValidationError';
    this.variables = variables;
  }
}

/** Required string variables that must be present and non-empty. */
const REQUIRED_STRING_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'REFRESH_SECRET',
  'REFRESH_EXPIRES_IN',
] as const;

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate and parse the environment.
 *
 * @param env - The raw environment source. Defaults to `process.env`.
 * @returns The typed, parsed {@link Config} when every required variable is
 *   present and well-typed.
 * @throws {EnvValidationError} when any required variable is missing or invalid;
 *   the error message and `variables` list name every offender.
 */
export function validateEnv(env: EnvSource = process.env): Config {
  const issues: string[] = [];
  const offenders: string[] = [];

  const parsed: Partial<Config> = {};

  for (const key of REQUIRED_STRING_VARS) {
    const value = env[key];
    if (!isNonEmpty(value)) {
      issues.push(`${key} is required but was missing or empty`);
      offenders.push(key);
    } else {
      parsed[key] = value.trim();
    }
  }

  // PORT: required and must be a positive integer.
  const rawPort = env.PORT;
  if (!isNonEmpty(rawPort)) {
    issues.push('PORT is required but was missing or empty');
    offenders.push('PORT');
  } else {
    const trimmed = rawPort.trim();
    const port = Number(trimmed);
    if (!Number.isInteger(port) || port <= 0) {
      issues.push(
        `PORT must be a positive integer but received "${rawPort}"`,
      );
      offenders.push('PORT');
    } else {
      parsed.PORT = port;
    }
  }

  if (offenders.length > 0) {
    throw new EnvValidationError(issues, offenders);
  }

  return parsed as Config;
}
