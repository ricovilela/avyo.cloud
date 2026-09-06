import {
  validateEnv,
  EnvValidationError,
  type EnvSource,
} from './env.validation';

/**
 * Unit tests for env validation.
 *
 * Validates: Requirements 7.4, 7.5
 *
 * These are example / edge-case unit tests (this spec is scaffolding-only).
 * Every case passes an explicit env object to `validateEnv()` rather than
 * mutating `process.env`.
 */
describe('validateEnv', () => {
  /** A complete, valid environment for the required API variables. */
  const validEnv: EnvSource = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/avyo',
    JWT_SECRET: 'jwt-secret',
    JWT_EXPIRES_IN: '15m',
    REFRESH_SECRET: 'refresh-secret',
    REFRESH_EXPIRES_IN: '7d',
    PORT: '3000',
  };

  describe('when all required variables are present', () => {
    it('returns a typed config with PORT coerced to a number', () => {
      const config = validateEnv(validEnv);

      expect(config.PORT).toBe(3000);
      expect(typeof config.PORT).toBe('number');
    });

    it('preserves the string fields intact', () => {
      const config = validateEnv(validEnv);

      expect(config.DATABASE_URL).toBe(
        'postgresql://user:pass@localhost:5432/avyo',
      );
      expect(config.JWT_SECRET).toBe('jwt-secret');
      expect(config.JWT_EXPIRES_IN).toBe('15m');
      expect(config.REFRESH_SECRET).toBe('refresh-secret');
      expect(config.REFRESH_EXPIRES_IN).toBe('7d');
    });
  });

  describe('when a required variable is missing', () => {
    it('throws EnvValidationError naming the missing variable', () => {
      const { JWT_SECRET: _omitted, ...envWithoutJwt } = validEnv;

      expect(() => validateEnv(envWithoutJwt)).toThrow(EnvValidationError);

      try {
        validateEnv(envWithoutJwt);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const validationError = error as EnvValidationError;
        expect(validationError.variables).toContain('JWT_SECRET');
        expect(validationError.message).toContain('JWT_SECRET');
      }
    });

    it('treats an empty string as missing', () => {
      const envWithEmptyDbUrl: EnvSource = { ...validEnv, DATABASE_URL: '   ' };

      try {
        validateEnv(envWithEmptyDbUrl);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).variables).toContain(
          'DATABASE_URL',
        );
      }
    });
  });

  describe('when a variable has an invalid type', () => {
    it('throws naming PORT when PORT is non-numeric', () => {
      const envWithBadPort: EnvSource = { ...validEnv, PORT: 'abc' };

      try {
        validateEnv(envWithBadPort);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const validationError = error as EnvValidationError;
        expect(validationError.variables).toContain('PORT');
        expect(validationError.message).toContain('PORT');
      }
    });

    it('throws naming PORT when PORT is not a positive integer', () => {
      const envWithZeroPort: EnvSource = { ...validEnv, PORT: '0' };

      expect(() => validateEnv(envWithZeroPort)).toThrow(EnvValidationError);
      try {
        validateEnv(envWithZeroPort);
      } catch (error) {
        expect((error as EnvValidationError).variables).toContain('PORT');
      }
    });
  });

  describe('when both auth secrets are missing (collect-all, Req 10.6)', () => {
    it('reports BOTH JWT_SECRET and REFRESH_SECRET as offenders', () => {
      const {
        JWT_SECRET: _jwt,
        REFRESH_SECRET: _refresh,
        ...envWithoutSecrets
      } = validEnv;

      try {
        validateEnv(envWithoutSecrets);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const validationError = error as EnvValidationError;
        expect(validationError.variables).toEqual(
          expect.arrayContaining(['JWT_SECRET', 'REFRESH_SECRET']),
        );
        expect(validationError.message).toContain('JWT_SECRET');
        expect(validationError.message).toContain('REFRESH_SECRET');
      }
    });

    it('treats empty and whitespace-only secrets as offenders too', () => {
      const envWithBlankSecrets: EnvSource = {
        ...validEnv,
        JWT_SECRET: '',
        REFRESH_SECRET: '   ',
      };

      try {
        validateEnv(envWithBlankSecrets);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).variables).toEqual(
          expect.arrayContaining(['JWT_SECRET', 'REFRESH_SECRET']),
        );
      }
    });

    it('does not report JWT_EXPIRES_IN as an offender when absent (defaults, Req 10.2)', () => {
      const {
        JWT_SECRET: _jwt,
        REFRESH_SECRET: _refresh,
        JWT_EXPIRES_IN: _expires,
        ...envWithoutSecretsOrExpiry
      } = validEnv;

      try {
        validateEnv(envWithoutSecretsOrExpiry);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).variables).not.toContain(
          'JWT_EXPIRES_IN',
        );
      }
    });
  });

  describe('when multiple variables are invalid', () => {
    it('names every offending variable', () => {
      const brokenEnv: EnvSource = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/avyo',
        JWT_EXPIRES_IN: '15m',
        REFRESH_EXPIRES_IN: '7d',
        PORT: 'not-a-number',
      };

      try {
        validateEnv(brokenEnv);
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const validationError = error as EnvValidationError;
        expect(validationError.variables).toEqual(
          expect.arrayContaining(['JWT_SECRET', 'REFRESH_SECRET', 'PORT']),
        );
      }
    });
  });
});
