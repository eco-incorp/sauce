/**
 * Byte helpers with no Node dependency: what `node:crypto`'s `createHash` and the `Buffer` global
 * did for the SDK, on web-standard APIs and `viem`, so the same code runs in a browser.
 */
import { bytesToHex, sha256 as sha256Hash } from "viem";

const utf8 = new TextEncoder();

/** `text` as UTF-8 bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** SHA-256 of the concatenation of `parts`, each string UTF-8 encoded — `createHash("sha256")`
 *  with one `update` per part. */
export function sha256(...parts: ReadonlyArray<Uint8Array | string>): Uint8Array {
  const chunks = parts.map((part) => (typeof part === "string" ? utf8.encode(part) : part));
  const joined = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  return sha256Hash(joined, "bytes");
}

/** Standard base64 (an RPC's account `data`) decoded to bytes. */
export function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** Lowercase hex without a `0x` prefix — `Buffer.from(bytes).toString("hex")`. */
export function hexString(bytes: Uint8Array): string {
  return bytesToHex(bytes).slice(2);
}
