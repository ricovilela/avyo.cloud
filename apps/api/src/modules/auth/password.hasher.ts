import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Provider-agnostic password hashing contract.
 *
 * The concrete algorithm is isolated behind this interface so the
 * implementation can be swapped without touching call sites. Neither the
 * plaintext password nor the resulting hash is ever included in any response
 * body (Req 1.3).
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/**
 * Argon2id implementation of {@link PasswordHasher}.
 *
 * Argon2id is the current OWASP-recommended password hashing algorithm and is
 * memory-hard. Its parameters (memory, iterations, parallelism) are encoded
 * inside the produced hash string, so the cost can be tuned without schema
 * changes and {@link verify} reads them back from the stored hash.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  /**
   * Produce an Argon2id encoded hash of the given plaintext password.
   */
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /**
   * Verify a plaintext password against a stored Argon2id hash.
   *
   * Returns false (never throws) on mismatch or when the stored hash is
   * malformed or unparseable, so callers get a uniform boolean outcome.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
