import { Argon2PasswordHasher } from "./password.hasher";

// These tests exercise the real (native) argon2 implementation. Argon2id is
// deliberately memory-hard, so each hash/verify call is not free. Keep
// passwords short and the number of hashes low, and give Jest a generous
// timeout to absorb cold-start variance on CI.
jest.setTimeout(30_000);

describe("Argon2PasswordHasher (Req 1.3)", () => {
  const hasher = new Argon2PasswordHasher();

  it("verifies a password against its own hash (round-trip)", async () => {
    const plain = "s3cret-pw";
    const hash = await hasher.hash(plain);

    await expect(hasher.verify(hash, plain)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hasher.hash("correct-pw");

    await expect(hasher.verify(hash, "wrong-pw")).resolves.toBe(false);
  });

  it("produces a hash that is not the plaintext and is argon2id-encoded", async () => {
    const plain = "another-pw";
    const hash = await hasher.hash(plain);

    expect(hash).not.toBe(plain);
    expect(hash).not.toContain(plain);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("returns false (does not throw) for a malformed hash string", async () => {
    await expect(hasher.verify("not-a-valid-hash", "any-pw")).resolves.toBe(false);
  });
});
