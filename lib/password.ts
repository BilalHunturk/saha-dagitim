const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LENGTH = 8;
// Largest multiple of the alphabet size that fits in a byte; bytes above it are
// rejected so every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length);

/** Generates an 8-character password from an unambiguous alphabet using crypto randomness. */
export function generatePassword(): string {
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < LENGTH) {
    globalThis.crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= LIMIT) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === LENGTH) break;
    }
  }
  return out;
}
