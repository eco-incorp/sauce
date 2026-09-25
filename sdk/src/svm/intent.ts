// Decode Portal call envelopes carrying raw Sauce engine instructions. Kitchen cook envelopes
// need a separate decoder. Staged identity depends on a caller-supplied, independently trusted pin.
import {
  addDecoderSizePrefix,
  addEncoderSizePrefix,
  address,
  getArrayDecoder,
  getArrayEncoder,
  getAddressDecoder,
  getAddressEncoder,
  getBooleanDecoder,
  getBooleanEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU8Decoder,
  getU8Encoder,
  getU32Decoder,
  getU32Encoder,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  verifySvmSettleExecution,
  type SvmSettleExecutionVerification,
  type SvmExecutionWireFormat,
  type SvmSettleExpectation,
} from "./verify.js";

// ── Portal CalldataWithAccounts envelope (Eco Portal program IDL) ──

/** One attached account, as the Portal `SerializableAccountMeta` struct serializes it. */
export interface PortalAccountMeta {
  pubkey: Address;
  isSigner: boolean;
  isWritable: boolean;
}

/** The decoded Portal `CalldataWithAccounts` envelope: the wrapped CPI instruction data and its accounts. */
export interface PortalCalldataWithAccounts {
  /** The target program's instruction data, unchanged by the Portal. */
  instructionData: Uint8Array;
  /** The `account_count` the envelope declares (Portal's own count of the wrapped accounts). */
  accountCount: number;
  /** The attached account metas, in order. */
  accounts: PortalAccountMeta[];
}

// Borsh (Anchor): `bytes` = u32 LE length prefix + bytes; `Vec<T>` = u32 LE length + elements;
// `bool` = 1 byte; `pubkey` = 32 bytes; `u8` = 1 byte. Field order is the IDL struct order.
const calldataDecoder = getStructDecoder([
  ["data", addDecoderSizePrefix(getBytesDecoder(), getU32Decoder())],
  ["accountCount", getU8Decoder()],
]);
const accountMetaDecoder = getStructDecoder([
  ["pubkey", getAddressDecoder()],
  ["isSigner", getBooleanDecoder()],
  ["isWritable", getBooleanDecoder()],
]);
const calldataWithAccountsDecoder = getStructDecoder([
  ["calldata", calldataDecoder],
  ["accounts", getArrayDecoder(accountMetaDecoder, { size: getU32Decoder() })],
]);

/** An opaque byte payload: `Uint8Array` as-is; a `0x`-prefixed hex string (the viem `Hex` form
 *  `route.calls[].data` uses); or a base64 string (the Solana convention) for anything not 0x-prefixed.
 *  A BARE STRING IS BASE64 HERE. For an address, use `UniversalAddressInput` — same three carriage
 *  forms, but a bare string there is base58, and the two must never be handed to the same reader. */
export type BytesInput = Uint8Array | string;

/** A 32-byte universal address, in the forms one arrives in: raw bytes, `0x`-hex (what
 *  `buildSauceSvmCall` emits into `route.calls[].target`), or the base58 program id itself. Deliberately
 *  NOT `BytesInput`, whose bare-string form is base64 — only a branded `Address` may be spent as the
 *  base58 form, so an unvalidated `string` does not typecheck and the two encodings cannot be confused
 *  at a call site. */
export type UniversalAddressInput = Uint8Array | `0x${string}` | Address;

function toBytes(input: BytesInput, label: string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof input !== "string")
    throw new Error(`${label} must be a Uint8Array or string, got ${typeof input}`);
  if (input.startsWith("0x") || input.startsWith("0X")) {
    const hex = input.slice(2);
    if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex))
      throw new Error(`${label} is not valid 0x-hex`);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    return out;
  }
  // Not 0x-prefixed → base64 (Buffer is available; this module is node-side like the rest of svm/verify).
  return new Uint8Array(Buffer.from(input, "base64"));
}

/** Resolves any `UniversalAddressInput` to the base58 `Address` form the rest of a settle verdict reports
 *  accounts in, so it compares directly against a program id. Throws on input that is not a 32-byte
 *  universal address; `resolveSettleTarget` is what makes that non-fatal for a scan. */
function toTargetAddress(input: UniversalAddressInput): Address {
  if (typeof input === "string" && !input.startsWith("0x") && !input.startsWith("0X"))
    return address(input);
  const bytes = toBytes(input, "target");
  if (bytes.length !== 32)
    throw new Error(`target is ${bytes.length} bytes — an SVM universal address is 32`);
  return getAddressDecoder().decode(bytes);
}

/**
 * Decodes a Portal `CalldataWithAccounts` envelope (the form of every SVM `route.calls[].data`) into the
 * wrapped instruction data and its account list. Accepts the envelope as raw bytes, `0x`-hex (the viem
 * `Hex` a call carries), or base64. Throws on a truncated / malformed envelope.
 */
export function decodePortalCalldataWithAccounts(data: BytesInput): PortalCalldataWithAccounts {
  const bytes = toBytes(data, "portal calldata");
  const [decoded, consumed] = calldataWithAccountsDecoder.read(bytes, 0);
  if (consumed !== bytes.length) throw new Error("Portal calldata has trailing bytes");
  if (decoded.calldata.accountCount !== decoded.accounts.length) {
    throw new Error("Portal accountCount must equal the attached accounts length");
  }
  // Portal reconstructs canonical Borsh; Kit's boolean decoder alone accepts values beyond 0/1.
  const canonical = calldataWithAccountsEncoder.encode(decoded);
  if (canonical.some((value, index) => value !== bytes[index])) {
    throw new Error("Portal calldata is not canonical Borsh");
  }

  return {
    // @solana/kit's bytes decoder yields a ReadonlyUint8Array — copy to a plain Uint8Array so the
    // downstream payload parser (subarray / DataView) has a mutable, standard view.
    instructionData: new Uint8Array(decoded.calldata.data),
    accountCount: decoded.calldata.accountCount,
    accounts: decoded.accounts.map((a) => ({
      pubkey: a.pubkey,
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
  };
}

// Encoder side of the exact same envelope — kept beside the decoder above so the Portal
// `CalldataWithAccounts` Borsh layout has exactly one source of truth (field order, u32-length
// prefixes, u8 account_count, u32-length-prefixed accounts vec).
const calldataEncoder = getStructEncoder([
  ["data", addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
  ["accountCount", getU8Encoder()],
]);
const accountMetaEncoder = getStructEncoder([
  ["pubkey", getAddressEncoder()],
  ["isSigner", getBooleanEncoder()],
  ["isWritable", getBooleanEncoder()],
]);
const calldataWithAccountsEncoder = getStructEncoder([
  ["calldata", calldataEncoder],
  ["accounts", getArrayEncoder(accountMetaEncoder, { size: getU32Encoder() })],
]);

/** Input to {@link encodePortalCalldataWithAccounts} — the mirror of {@link PortalCalldataWithAccounts}. */
export interface PortalCalldataWithAccountsInput {
  /** The wrapped instruction data — for a Sauce call, the `execute_from_account` payload. */
  instructionData: Uint8Array;
  /** The attached account metas, in order. */
  accounts: readonly PortalAccountMeta[];
  /** Defaults to accounts.length. An explicit value must match, including any code and Pot accounts. */
  accountCount?: number;
}

/**
 * Encodes a Portal `CalldataWithAccounts` envelope — the exact inverse of
 * {@link decodePortalCalldataWithAccounts}, sharing its codec byte-for-byte (both are built from the
 * same field list above), so encoder and decoder cannot drift apart. This is what a route `Call.data`
 * for a staged SVM Sauce execution looks like on the wire.
 */
export function encodePortalCalldataWithAccounts(
  input: PortalCalldataWithAccountsInput,
): `0x${string}` {
  const accountCount = input.accountCount ?? input.accounts.length;
  if (accountCount !== input.accounts.length) {
    throw new Error("Portal accountCount must equal the attached accounts length");
  }
  const encoded = calldataWithAccountsEncoder.encode({
    calldata: { data: input.instructionData, accountCount },
    accounts: input.accounts.map((a) => ({
      pubkey: a.pubkey,
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
  });
  return `0x${Buffer.from(Uint8Array.from(encoded as ArrayLike<number>)).toString("hex")}`;
}

// ── intent extraction ──

/** An intent call, duck-typed: only `data` (the Portal envelope) is required; `target` (the callee
 *  program) is carried through when present. Matches eco-solver's `Call` / persisted `IntentCall` (both
 *  carry `data` as viem `Hex`). */
export interface SvmIntentCallLike {
  data: BytesInput;
  /** The callee, as a 32-byte universal address — `0x`-hex on the wire (what `buildSauceSvmCall` emits),
   *  raw bytes, or a base58 `Address`. NOT `BytesInput`: see `UniversalAddressInput`. */
  target?: UniversalAddressInput;
  /**
   * The content pin committing to the bytes THIS call executes, if the caller has it — read off the
   * Kitchen's `cook_from_account`, since the engine instruction carries no content pin.
   *
   * Per call, deliberately. A batch can hold a settle-shaped decoy that differs from the genuine
   * settle only in its pin, so one pin shared across the scan would make the two indistinguishable
   * and let the decoy be reported as genuine.
   */
  pin?: BytesInput;
}

/** An intent, duck-typed to just the SVM route calls this reads. */
export interface SvmIntentLike {
  route: { calls: readonly SvmIntentCallLike[] };
}

export interface ExtractSvmSettleOptions extends SvmSettleExpectation {
  /** Defaults to released gated engine CPI data; Kitchen envelopes are not decoded here. */
  wireFormat?: SvmExecutionWireFormat;
  /** Staged bytes to compare with the canonical program and the call's independently obtained pin. */
  bytecode?: BytesInput;
}

/** The callee of an extracted settle — three states a caller must keep apart. `program`: the call's
 *  `target`, resolved to a program id to compare against the engine you trust. `absent`: the call carried
 *  no `target` at all. `unreadable`: it carried one that is not a 32-byte universal address, so there is
 *  nothing to compare it to.
 *
 *  Collapsing `unreadable` into `absent` is the bypass this shape exists to prevent. A caller may
 *  legitimately skip the callee check for a call that named no callee; skipping it because the callee it
 *  named was garbage accepts a settle whose callee is unknown. Only `program` is ever safe to clear. */
export type SvmSettleTarget =
  | { readonly kind: "program"; readonly address: Address }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The extracted settle for a call: the full `verifySvmSettleExecution` verdict (resolved accounts and
 *  the `genuine` / `verifiedBy` genuineness fields), extended with the call's index and callee. */
export type ExtractedSvmSettle = SvmSettleExecutionVerification & {
  /** Index of the `route.calls[]` entry the genuine settle execution was found in. */
  callIndex: number;
  /** The call's callee — always reported, as one of `SvmSettleTarget`'s three states. */
  target: SvmSettleTarget;
};

/** Total, so the `… | null` scan around it stays total: a `target` this cannot resolve becomes
 *  `unreadable` rather than an exception thrown out of a function no caller of that type would guard. */
function resolveSettleTarget(input: UniversalAddressInput | undefined): SvmSettleTarget {
  if (input === undefined) return { kind: "absent" };

  try {
    return { kind: "program", address: toTargetAddress(input) };
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Return the first recognized raw-engine settlement in Portal envelopes, or null.
 * Staged identity depends on each call's independently trusted pin. The caller must also
 * require a readable target matching v12SvmEngineProgramId(), validate gate/account roles,
 * and inspect every other call. Kitchen cook envelopes are not handled here.
 */
export function extractSvmSettleFromCalls(
  calls: readonly SvmIntentCallLike[],
  options: ExtractSvmSettleOptions,
): ExtractedSvmSettle | null {
  const bytecode =
    options.bytecode !== undefined ? toBytes(options.bytecode, "bytecode") : undefined;

  for (let i = 0; i < calls.length; i++) {
    let envelope: PortalCalldataWithAccounts;
    try {
      envelope = decodePortalCalldataWithAccounts(calls[i]!.data);
    } catch {
      continue; // not a decodable Portal envelope — skip
    }

    let verified: SvmSettleExecutionVerification;
    try {
      verified = verifySvmSettleExecution({
        pin: calls[i]!.pin !== undefined ? toBytes(calls[i]!.pin!, "pin") : undefined,
        instructionData: envelope.instructionData,
        wireFormat: options.wireFormat,
        accounts: envelope.accounts,
        bytecode,
        minOut: options.minOut,
        splCount: options.splCount,
      });
    } catch {
      continue; // a decodable envelope, but its instruction is not even settle-SHAPED — skip
    }

    if (verified.genuine)
      return { ...verified, callIndex: i, target: resolveSettleTarget(calls[i]!.target) };
    // shape-matched but NOT a genuine settle (decoy / wrong program / wrong escrow count) — keep scanning,
    // so a genuine settle later in the batch is never masked by an earlier lookalike.
  }
  return null;
}

/** Inspect the route's calls with the same trust boundaries as extractSvmSettleFromCalls. */
export function extractSvmSettleFromIntent(
  intent: SvmIntentLike,
  options: ExtractSvmSettleOptions,
): ExtractedSvmSettle | null {
  return extractSvmSettleFromCalls(intent.route.calls, options);
}
