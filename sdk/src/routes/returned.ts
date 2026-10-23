/**
 * What a cook returned, read as the type `main` declares (the compile's `entrySignature.returns`).
 *
 * A program's return comes back with no ABI framing: a scalar (`Address`, `Uint256`, `bool`) as one
 * 32-byte word, a record as its fields one word each, an array as its elements one after another
 * with no length in front, and `bytes` as the bytes themselves. So `Uint256[]` of 371 words is
 * 371 numbers here, not 11 KB of hex to split by hand.
 */
import { getAddressDecoder } from "@solana/kit";
import { bytesToHex, getAddress, hexToBytes, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { parseEntryType, type EntryType } from "./entry.js";

/** A returned value as JSON: an address or key as text, a number in decimal, bytes as hex. */
export type Returned =
  string | boolean | readonly Returned[] | { readonly [field: string]: Returned };

/** The words one value of `type` takes, when the type is fixed-size; `undefined` when it is not. */
function wordsOf(type: EntryType): number | undefined {
  switch (type.kind) {
    case "uint":
    case "int":
    case "address":
    case "bool":
    case "account":
      return 1;
    case "tuple": {
      let words = 0;
      for (const field of type.fields) {
        const size = wordsOf(field.type);
        if (size === undefined) return undefined;
        words += size;
      }

      return words;
    }
    default:
      return undefined;
  }
}

/** One fixed-size value of `type` from `words` at `at`. */
function readValue(
  type: EntryType,
  words: readonly Uint8Array[],
  at: number,
  chain: CanonicalChain,
): Returned {
  if (type.kind === "tuple") {
    const record: Record<string, Returned> = {};
    let next = at;
    for (const field of type.fields) {
      record[field.name] = readValue(field.type, words, next, chain);
      next += wordsOf(field.type)!;
    }

    return record;
  }
  const word = words[at]!;
  if (type.kind === "bool") return word.some((byte) => byte !== 0);
  if (type.kind === "address" || type.kind === "account") {
    return chain.kind === "svm"
      ? getAddressDecoder().decode(word)
      : getAddress(bytesToHex(word.subarray(12)));
  }

  const value = BigInt(bytesToHex(word));

  return (type.kind === "int" ? BigInt.asIntN(256, value) : value).toString();
}

/**
 * `data` read as `type`, or `undefined` when it does not have that shape (a length that is not the
 * type's, a type this cannot read): the raw hex is shown then, and nothing guessed.
 */
export function decodeReturned(
  typeText: string,
  data: Hex,
  chain: CanonicalChain,
): Returned | undefined {
  let type: EntryType;
  try {
    type = parseEntryType(typeText);
  } catch {
    return undefined;
  }
  const bytes = hexToBytes(data);
  if (type.kind === "bytes") return data;
  if (type.kind === "string") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }
  if (bytes.length % 32 !== 0) return undefined;
  const words = Array.from({ length: bytes.length / 32 }, (_, index) =>
    bytes.subarray(index * 32, index * 32 + 32),
  );
  if (type.kind === "array") {
    const size = wordsOf(type.of);
    if (size === undefined || words.length % size !== 0) return undefined;

    return Array.from({ length: words.length / size }, (_, index) =>
      readValue(type.of, words, index * size, chain),
    );
  }
  const size = wordsOf(type);
  if (size === undefined || words.length !== size) return undefined;

  return readValue(type, words, 0, chain);
}

/** A returned value for a person: as JSON, its numbers unquoted. */
export function returnedText(value: Returned): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(returnedText).join(", ")}]`;

  return `{ ${Object.entries(value)
    .map(([field, inner]) => `${field}: ${returnedText(inner)}`)
    .join(", ")} }`;
}

/** The line that says what `main` returned: its type and the value, or why it is not shown. */
export function returnedLine(typeText: string, data: Hex, chain: CanonicalChain): string {
  const value = decodeReturned(typeText, data, chain);

  return value === undefined
    ? `main returns ${typeText}: ${data === "0x" ? "nothing came back" : "the data above does not read as one"}`
    : `main returns ${typeText}: ${returnedText(value)}`;
}
