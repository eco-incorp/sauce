// SVM settlement identity is checked by recompiling the expected parameters. Account addresses
// come from the instruction separately; successful verification does not authenticate execution.
import { address, getAddressDecoder, type Address } from "@solana/kit";
import { sha256 } from "../bytes.js";
import { compileWithRs } from "../routes/rs-compile.js";
import { EXECUTE_DISCRIMINATOR, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR } from "./engine.js";
import { SVM_MAX_ESCROWS, svmSettleRefs, svmSettleSource } from "./recipes/index.js";

// The call-level surface (unwrap the Portal envelope, extract the settle from calls) is re-exported
// here so the whole partner-facing decode/verify story lives under `@eco-incorp/sauce/svm/verify`,
// symmetric with the EVM `/verify` barrel re-exporting its own `intent.ts`.
export {
  decodePortalCalldataWithAccounts,
  encodePortalCalldataWithAccounts,
  extractSvmSettleFromCalls,
  type PortalAccountMeta,
  type PortalCalldataWithAccounts,
  type PortalCalldataWithAccountsInput,
  type BytesInput,
  type UniversalAddressInput,
  type SvmIntentCallLike,
  type ExtractSvmSettleOptions,
  type ExtractedSvmSettle,
  type SvmSettleTarget,
} from "./intent.js";

// ── what a caller expects a settle program to enforce ──

/**
 * The values a settle program was compiled with. Both are folded into the bytecode, so they are what
 * a recompile pins: naming them is how a caller says "prove the program enforces THIS floor and THIS
 * split", rather than reading them back out of an execution and trusting them.
 */
export interface SvmSettleExpectation {
  /** The floor applied to escrow 0 (0 disables the floor). */
  minOut: bigint;
  /** Escrows i < splCount sweep via tokenProgram0, the rest via tokenProgram1. */
  splCount: bigint;
}

// ── program (recompile + byte-compare) ──

/** Just enough of an account manifest to count and name its slots. */
export interface SettleManifestLike {
  accounts: readonly { kind: string; name?: string }[];
}

export interface SvmSettleVerification {
  /** True iff the bytecode byte-matches svmSettleSource(escrowCount) AND the plan's refs match svmSettleRefs. */
  genuine: boolean;
  /** The inferred escrow count, or null when the account plan does not fit any settle shape. */
  escrowCount: number | null;
  /** The canonical ref order for `escrowCount` (svmSettleRefs) — empty when escrowCount is null. */
  refs: string[];
  /** Present iff not genuine: what failed (unrecognized shape / bytecode mismatch / ref mismatch). */
  mismatch?: string;
}

/** N escrows declare `3N + 3` accounts (2 token programs + 3 per escrow + the shared owner). */
function escrowCountFromPlan(metaCount: number): number | null {
  if ((metaCount - 3) % 3 !== 0) return null;
  const n = (metaCount - 3) / 3;
  return Number.isInteger(n) && n >= 1 && n <= SVM_MAX_ESCROWS ? n : null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The canonical settle bytecode for `escrowCount` under `expected`, recompiled from the shipped
 *  source with the shipped defines — a deterministic function of exactly those three values, and the
 *  SDK's own ground truth for "what the genuine settle program's bytes are", derivable WITHOUT any
 *  partner-supplied bytecode. */
function compileCanonicalSettle(escrowCount: number, expected: SvmSettleExpectation): Uint8Array {
  return compileWithRs({
    source: svmSettleSource(escrowCount),
    target: "svm",
    defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
  }).bytecode[0]!;
}

/**
 * Verifies a compiled SVM settle program is genuine AND enforces `expected` — the SVM analogue of the
 * EVM check, done by recompile. It:
 *   1. takes the escrow count N (or infers it from the manifest's `3N + 3` slots),
 *   2. recompiles `svmSettleSource(N)` with `expected` as defines, and
 *   3. byte-compares the result, and asserts the manifest's slot names equal `svmSettleRefs(N)`.
 *
 * A genuine result means the bytecode IS the reusable settle logic for N escrows, compiled for
 * exactly this floor and this split — all three are the same bytes, so one comparison pins them all.
 * The resolved account identities (from the executed instruction) remain the caller's own check.
 * Never throws for a non-genuine program; returns `{ genuine: false, mismatch }`.
 */
export function verifySvmSettleProgram(
  bytecode: Uint8Array,
  manifest: SettleManifestLike,
  expected: SvmSettleExpectation,
): SvmSettleVerification {
  const slots = manifest.accounts.filter((entry) => entry.kind === "slot");
  const escrowCount = escrowCountFromPlan(slots.length);
  if (escrowCount === null) {
    return {
      genuine: false,
      escrowCount: null,
      refs: [],
      mismatch: `account manifest has ${slots.length} slots, which is not 3N + 3 for any settle escrow count 1..${SVM_MAX_ESCROWS}`,
    };
  }

  const refs = svmSettleRefs(escrowCount);
  const slotNames = slots.map((slot) => slot.name);
  if (slotNames.length !== refs.length || slotNames.some((name, i) => name !== refs[i])) {
    return {
      genuine: false,
      escrowCount,
      refs,
      mismatch: `account manifest slots do not match svmSettleRefs(${escrowCount})`,
    };
  }

  if (!bytesEqual(bytecode, compileCanonicalSettle(escrowCount, expected))) {
    return {
      genuine: false,
      escrowCount,
      refs,
      mismatch: `bytecode does not byte-match svmSettleSource(${escrowCount}) at minOut=${expected.minOut}, splCount=${expected.splCount}`,
    };
  }

  return { genuine: true, escrowCount, refs };
}

/** Released engine CPI wire, or an explicitly selected pre-gate inspection format. */
export type SvmExecutionWireFormat = "gated-v1" | "legacy-ungated";

export type SvmSettleAccountLike = string | { address?: string; pubkey?: string; ref?: string };

export interface SvmSettleExecutionInput {
  /** Raw ENGINE instruction data, not a Kitchen cook instruction. */
  instructionData: Uint8Array;
  /** Full gated CPI list: [user accounts..., Pot], or [code, user accounts..., Pot] when staged. */
  accounts: readonly SvmSettleAccountLike[];
  /** Defaults to the released gated wire. Legacy mode accepts a user tail or a code-prefixed tail. */
  wireFormat?: SvmExecutionWireFormat;
}

/** Parsed derivation material only; this does not validate the Pot PDA or its signature. */
export interface SvmExecutionGate {
  owner: Address;
  salt: Uint8Array;
  bump: number;
  pot: Address;
}

export interface DecodedSvmSettleExecution {
  instruction: "execute" | "execute_from_account";
  wireFormat: SvmExecutionWireFormat;
  gate?: SvmExecutionGate;
  codeAccount?: Address;
  escrowCount: number;
  refs: string[];
  accounts: Record<string, Address>;
  hadBufferAccount: boolean;
  /** Labels are diagnostic; identities always come from account positions. */
  labeledRefsConsistent: boolean | null;
}

const GATED_PROGRAM_OFFSET = 8 + 32 + 32 + 1;

function accountAddress(account: SvmSettleAccountLike, index: number): Address {
  const raw = typeof account === "string" ? account : (account.address ?? account.pubkey);
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      "account " + index + " is not an address (expected a base58 string, or .address/.pubkey)",
    );
  }

  return address(raw);
}

function engineInstruction(
  data: Uint8Array,
  wireFormat: SvmExecutionWireFormat,
): "execute" | "execute_from_account" {
  if (!(data instanceof Uint8Array)) throw new Error("instructionData must be a Uint8Array");
  if (wireFormat !== "gated-v1" && wireFormat !== "legacy-ungated") {
    throw new Error("unrecognized SVM execution wire format");
  }
  const headerBytes = wireFormat === "gated-v1" ? GATED_PROGRAM_OFFSET : 8;
  if (data.length < headerBytes) {
    throw new Error(
      "instructionData requires at least " + headerBytes + " bytes for " + wireFormat,
    );
  }
  const discriminator = data.subarray(0, 8);
  if (bytesEqual(discriminator, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR)) {
    if (data.length !== headerBytes) {
      throw new Error("execute_from_account does not accept bytes after its header");
    }

    return "execute_from_account";
  }
  if (bytesEqual(discriminator, EXECUTE_DISCRIMINATOR)) return "execute";

  throw new Error("instructionData does not begin with a Sauce engine execute discriminator");
}

/**
 * Decode the released engine's 65-byte gate header and full CPI account list.
 * This inspects bytes and positions; it authenticates neither execution nor account roles.
 * A Kitchen instruction has a different layout and must be decoded separately.
 */
export function decodeSvmSettleExecution(
  input: SvmSettleExecutionInput,
): DecodedSvmSettleExecution {
  const wireFormat = input.wireFormat ?? "gated-v1";
  const instruction = engineInstruction(input.instructionData, wireFormat);
  const gated = wireFormat === "gated-v1";
  const hasBuffer = gated
    ? instruction === "execute_from_account"
    : escrowCountFromPlan(input.accounts.length) === null;
  const prefixCount = hasBuffer ? 1 : 0;
  const suffixCount = gated ? 1 : 0;
  const escrowCount = escrowCountFromPlan(input.accounts.length - prefixCount - suffixCount);
  if (escrowCount === null) {
    throw new Error(
      "account list has " +
        input.accounts.length +
        " accounts: expected 3N+3 settlement accounts" +
        (hasBuffer ? ", a leading code account" : "") +
        (gated ? ", and a trailing Pot" : "") +
        " for an escrow count 1.." +
        SVM_MAX_ESCROWS,
    );
  }
  const userAccounts = input.accounts.slice(prefixCount, input.accounts.length - suffixCount);
  const refs = svmSettleRefs(escrowCount);
  const accounts: Record<string, Address> = {};
  let labeledRefsConsistent: boolean | null = true;
  refs.forEach((ref, index) => {
    const account = userAccounts[index]!;
    accounts[ref] = accountAddress(account, index + prefixCount);
    if (typeof account === "object" && account !== null && typeof account.ref === "string") {
      if (account.ref !== ref) labeledRefsConsistent = false;
    } else if (labeledRefsConsistent !== false) {
      labeledRefsConsistent = null;
    }
  });
  const gate = gated
    ? {
        owner: getAddressDecoder().decode(input.instructionData.subarray(8, 40)),
        salt: input.instructionData.slice(40, 72),
        bump: input.instructionData[72]!,
        pot: accountAddress(input.accounts[input.accounts.length - 1]!, input.accounts.length - 1),
      }
    : undefined;

  return {
    instruction,
    wireFormat,
    ...(gate ? { gate } : {}),
    ...(hasBuffer ? { codeAccount: accountAddress(input.accounts[0]!, 0) } : {}),
    escrowCount,
    refs,
    accounts,
    hadBufferAccount: hasBuffer,
    labeledRefsConsistent,
  };
}

export interface SvmSettleExecutionVerifyInput
  extends SvmSettleExecutionInput, SvmSettleExpectation {
  /** Staged bytes obtained independently from the code account that will execute. */
  bytecode?: Uint8Array;
  /** Caller-supplied SHA-256 pin, normally from the matching Kitchen cook_from_account. */
  pin?: Uint8Array;
}

export type SvmSettleVerifiedBy = "inline-bytecode" | "bytecode" | "caller-asserted-pin" | "none";

export interface SvmSettleExecutionVerification extends DecodedSvmSettleExecution {
  /** Program matches the expected settlement; staged results depend on the caller's pin evidence. */
  genuine: boolean;
  verifiedBy: SvmSettleVerifiedBy;
  pinMatchesCanonical: boolean | null;
  pinMatchesBytecode: boolean | null;
  bytecodeMatchesCanonical: boolean | null;
  mismatch?: string;
}

/**
 * Compare inline bytes, or caller-supplied staged bytes/pin, with a canonical recompile.
 * This does not check the callee, gate derivation/signature, account roles, or transaction success.
 * Engine calldata has no staged content pin; the caller must connect its pin to the code account.
 */
export function verifySvmSettleExecution(
  input: SvmSettleExecutionVerifyInput,
): SvmSettleExecutionVerification {
  const decoded = decodeSvmSettleExecution(input);
  const canonical = compileCanonicalSettle(decoded.escrowCount, input);
  const pin = input.pin;
  const pinMatchesCanonical = pin === undefined ? null : bytesEqual(sha256(canonical), pin);
  const bytecodeMatchesCanonical =
    input.bytecode === undefined ? null : bytesEqual(input.bytecode, canonical);
  const pinMatchesBytecode =
    input.bytecode === undefined || pin === undefined
      ? null
      : bytesEqual(sha256(input.bytecode), pin);

  let genuine: boolean;
  let verifiedBy: SvmSettleVerifiedBy;
  let mismatch: string | undefined;
  if (decoded.instruction === "execute") {
    const inline = input.instructionData.subarray(
      decoded.wireFormat === "gated-v1" ? GATED_PROGRAM_OFFSET : 8,
    );
    const inlineMatchesCanonical = bytesEqual(inline, canonical);
    const suppliedMatchesInline =
      input.bytecode === undefined ? null : bytesEqual(input.bytecode, inline);
    verifiedBy = "inline-bytecode";
    genuine = inlineMatchesCanonical && suppliedMatchesInline !== false;
    mismatch = !inlineMatchesCanonical
      ? "inline execute bytecode does not byte-match svmSettleSource(" + decoded.escrowCount + ")"
      : suppliedMatchesInline === false
        ? "supplied bytecode does not match the bytecode inline in this execute"
        : undefined;
  } else if (input.bytecode !== undefined) {
    verifiedBy = "bytecode";
    genuine = bytecodeMatchesCanonical === true && pinMatchesBytecode === true;
    mismatch =
      bytecodeMatchesCanonical !== true
        ? "bytecode does not byte-match svmSettleSource(" + decoded.escrowCount + ")"
        : pinMatchesBytecode === false
          ? "caller pin does not equal sha256(bytecode)"
          : pinMatchesBytecode === null
            ? "caller supplied no pin, so the staged bytes are not tied to this execution"
            : undefined;
  } else if (pin !== undefined) {
    verifiedBy = "caller-asserted-pin";
    genuine = pinMatchesCanonical === true;
    mismatch = genuine
      ? undefined
      : "pin does not match sha256(svmSettleSource(" + decoded.escrowCount + "))";
  } else {
    verifiedBy = "none";
    genuine = false;
    mismatch =
      "no caller pin and no bytecode supplied: staged program identity cannot be established";
  }

  return {
    ...decoded,
    genuine,
    verifiedBy,
    pinMatchesCanonical,
    pinMatchesBytecode,
    bytecodeMatchesCanonical,
    mismatch,
  };
}
