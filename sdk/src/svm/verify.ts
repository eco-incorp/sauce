// @eco-incorp/sauce/svm/verify — the SVM counterpart of `@eco-incorp/sauce/verify`, for a
// compiled `settle` program.
//
// VERIFICATION IS BY RECOMPILE, on both VMs. A settle program's per-execution values
// (`minOut`, `splCount`) are compile-time `defines`, constant-folded into the bytecode, and every
// account identity is an attach slot that never appears in it. So there is nothing to decode OUT of
// a program — and nothing that needs to be: a caller checking an execution already knows the values
// it expects. What it needs is proof that the program it was handed IS the one those values produce.
//
// `verifySvmSettleProgram` is that proof: recompile `svmSettleSource(N)` with the expected defines
// and byte-compare. A match establishes THREE things at once — the logic is the genuine settle
// logic, `minOut` is the expected floor, and `splCount` is the expected token-program split —
// because all three are folded into the same bytes. Under the older staged form the blob was a pure
// function of N and the scalars rode the instruction payload, so they had to be decoded and checked
// separately; binding them into the program is strictly stronger.
//
// The account identities are never in the bytecode on SVM in either form — Solana requires them
// attached — so they come from the executed instruction's account list, matched positionally against
// `svmSettleRefs(N)`. `decodeSvmSettleExecution` does that half; `verifySvmSettleExecution` adds the
// recompile check and the pin↔bytecode tie.
//
// Unlike `@eco-incorp/sauce/verify`, this pulls the compiler in to recompile — a node-side check.
import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";
import { compileWithRs } from "../routes/rs-compile.js";
import { EXECUTE_DISCRIMINATOR, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR } from "./engine.js";
import { SVM_MAX_ESCROWS, svmSettleRefs, svmSettleSource } from "./recipes/index.js";

// The intent-level surface (unwrap the Portal envelope + extract from an intent) is re-exported here so
// the whole partner-facing decode/verify story lives under `@eco-incorp/sauce/svm/verify`, symmetric
// with the EVM `/verify` barrel re-exporting its own `intent.ts`.
export {
  decodePortalCalldataWithAccounts,
  encodePortalCalldataWithAccounts,
  extractSvmSettleFromCalls,
  extractSvmSettleFromIntent,
  type PortalAccountMeta,
  type PortalCalldataWithAccounts,
  type PortalCalldataWithAccountsInput,
  type BytesInput,
  type UniversalAddressInput,
  type SvmIntentCallLike,
  type SvmIntentLike,
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

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
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

// ── execution (calldata + accounts together) ──
//
// `verifySvmSettleProgram` above checks the PROGRAM. The other half of an execution is WHICH accounts
// it ran against, and the two shapes a caller actually holds carry both at once:
//   - the sauce-recipes `split=1` response's settle sauce — `execution.instructionData` (calldata) +
//     `execution.accounts[]` (the user account tail, no buffer prefix), and
//   - an executed engine instruction (e.g. eco-solver's Portal `CalldataWithAccounts` after its own
//     envelope decode) — the full `execute_from_account` data + the full account list `[buffer, …user]`.
// `decodeSvmSettleExecution` consumes either shape at once: it parses the execute payload grammar off
// the calldata and resolves each `svmSettleRefs(N)` slot to its attached pubkey — so a caller gets the
// staged-execute header (`instruction`, `pin`, `slice`) AND which account is which ref from a single
// call. It does NOT yield `minOut`/`splCount`: those are defines folded into the bytecode and never
// ride the calldata, so the only way to establish them is the recompile — `verifySvmSettleExecution`,
// which adds the bytecode genuineness check and the pin↔bytecode tie.

/** An account entry as either the base58 address itself or an object carrying it (the recipes split
 *  response uses `{ pubkey, isSigner, isWritable, ref }`; a resolved instruction meta uses `{ address }`). */
export type SvmSettleAccountLike = string | { address?: string; pubkey?: string; ref?: string };

function accountAddress(a: SvmSettleAccountLike, i: number): Address {
  const raw = typeof a === "string" ? a : (a.address ?? a.pubkey);
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      `account ${i} is not an address (expected a base58 string, or an object with .address/.pubkey)`,
    );
  }
  return raw as Address;
}

/** Classifies an account-list length as a settle shape: `3N+3` is the user tail alone, `3N+4` is that
 *  tail with the leading bytecode-buffer account. Returns null for any other length (the two never
 *  collide — `3N+3 = 3M+4` has no integer solution). */
function classifyAccountList(length: number): { escrowCount: number; hasBuffer: boolean } | null {
  for (const hasBuffer of [false, true]) {
    const userCount = hasBuffer ? length - 1 : length;
    if ((userCount - 3) % 3 !== 0) continue;
    const escrowCount = (userCount - 3) / 3;
    if (Number.isInteger(escrowCount) && escrowCount >= 1 && escrowCount <= SVM_MAX_ESCROWS) {
      return { escrowCount, hasBuffer };
    }
  }
  return null;
}

/**
 * Names the engine instruction from its discriminator alone.
 *
 * Replaces a parser for the `[disc][flags][pin?][slice?]` grammar the pre-release engine took here;
 * the released engine has no payload beyond the discriminator, so there is nothing left to parse.
 */
function classifyEngineInstruction(data: Uint8Array): "execute" | "execute_from_account" {
  if (!(data instanceof Uint8Array)) throw new Error("instructionData must be a Uint8Array");
  if (data.length < 8)
    throw new Error(
      `instructionData is ${data.length} bytes — too short for an 8-byte discriminator`,
    );

  const disc = data.subarray(0, 8);
  if (bytesEqual(disc, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR)) return "execute_from_account";
  if (bytesEqual(disc, EXECUTE_DISCRIMINATOR)) return "execute";

  throw new Error("instructionData does not begin with a Sauce engine execute discriminator");
}

export interface SvmSettleExecutionInput {
  /**
   * The instruction data. On the released engine that is the 8-byte discriminator and nothing else:
   * `executeFromAccount` reads account 0's data verbatim, and a settle's params are defines folded
   * into the bytecode. From the recipes split response this is
   * base64-decode(`execution.instructionData`); from an executed instruction it is the raw ix data.
   */
  instructionData: Uint8Array;
  /**
   * The instruction's account list — EITHER the user tail alone (`3N+3`, the recipes
   * `execution.accounts[]`) OR the full list with the leading buffer (`3N+4`, a raw instruction). The
   * leading buffer is detected by length and stripped; each entry is a base58 address or an object
   * with `.address`/`.pubkey`.
   */
  accounts: readonly SvmSettleAccountLike[];
}

export interface DecodedSvmSettleExecution {
  /**
   * Which engine instruction the calldata is.
   *
   * `execute_and_close` is gone with the pre-release engine, and so are the `pin` and `slice` this
   * used to report: the released engine carries no payload here, so there is nothing on this wire
   * committing to the staged bytecode. **A caller that wants that commitment must read the
   * KITCHEN's `cook_from_account`**, whose `pin` refuses unless the staged bytes hash to it — see
   * `kitchen.ts`. Reporting a pin from here would now always be `undefined`, which reads as "no pin
   * was given" rather than "this wire cannot carry one".
   */
  instruction: "execute" | "execute_from_account";
  /** The escrow count inferred from the account-list length. */
  escrowCount: number;
  /** The canonical ref order for `escrowCount` — `svmSettleRefs(escrowCount)`. */
  refs: string[];
  /** Each settle account ref → the pubkey attached at that slot, positionally against `refs`. */
  accounts: Record<string, Address>;
  /** True iff a leading bytecode-buffer account was detected in `accounts` and skipped. */
  hadBufferAccount: boolean;
  /** Whether the provided account labels matched the canonical refs, or null if entries carried no
   *  `ref` (a bare address list). Identities are resolved positionally regardless — this only reports
   *  whether a caller-supplied label agreed with the slot it landed in. */
  labeledRefsConsistent: boolean | null;
}

/**
 * Decodes a full settle execution — the calldata AND the account list — into its staged-execute header
 * and resolved account identities in one call. It parses the execute payload grammar off
 * `instructionData`, infers the escrow count from the account-list length, and resolves each
 * `svmSettleRefs(N)` slot to the attached pubkey. Consumes the sauce-recipes `split=1` settle sauce
 * (`execution.instructionData` + `execution.accounts[]`) directly, and equally an executed engine
 * instruction (full data + `[buffer, …user]` account list).
 *
 * `minOut`/`splCount` are NOT among the results, and cannot be: they are defines folded into the
 * bytecode, so no amount of reading the calldata recovers them. `verifySvmSettleExecution` establishes
 * them the only way available — by recompiling with the values a caller expects and byte-comparing.
 *
 * What IS here is not trusted either: the header comes from the raw calldata (not from a receipt), and
 * the account identities are resolved positionally against the canonical refs, never from
 * caller-supplied labels — `labeledRefsConsistent` only reports whether a label the caller happened to
 * attach agreed with the slot it landed in.
 *
 * IMPORTANT — this is a STRUCTURAL decode, NOT a genuineness proof. A staged settle's calldata
 * carries no structural signature: any staged Sauce execute with a `3N+3`/`3N+4` account count has
 * this exact shape. So a non-settle execution (or an adversarial decoy) decodes here without error
 * into any staged program at all. To prove the execution actually runs the genuine settle program,
 * use `verifySvmSettleExecution` (or `extractSvmSettleFromIntent`), which ties the calldata to the
 * SDK's own recompiled canonical settle bytecode.
 *
 * The EVM half splits the same two questions the same way — `decodeSettleProgram` is structural and
 * accepts any 363-byte program, `validateSettleProgram` is the genuineness proof — but reaches the
 * second one WITHOUT a compiler: an EVM settle's params ride the payload after the program, so the
 * program is a constant and one `keccak256` settles it. Here they are `defines` folded into the
 * bytecode, which is why this side recompiles.
 */
export function decodeSvmSettleExecution(
  input: SvmSettleExecutionInput,
): DecodedSvmSettleExecution {
  const instruction = classifyEngineInstruction(input.instructionData);

  const shape = classifyAccountList(input.accounts.length);
  if (shape === null) {
    throw new Error(
      `account list has ${input.accounts.length} accounts, which is neither 3N+3 (user tail) nor 3N+4 (with buffer) for any settle escrow count 1..${SVM_MAX_ESCROWS}`,
    );
  }
  const { escrowCount, hasBuffer } = shape;

  const refs = svmSettleRefs(escrowCount);

  const userAccounts = hasBuffer ? input.accounts.slice(1) : input.accounts;
  const accounts: Record<string, Address> = {};
  let labeledRefsConsistent: boolean | null = true;
  refs.forEach((ref, i) => {
    accounts[ref] = accountAddress(userAccounts[i]!, i);
    const entry = userAccounts[i];
    if (typeof entry === "object" && entry !== null && typeof entry.ref === "string") {
      if (entry.ref !== ref) labeledRefsConsistent = false;
    } else if (labeledRefsConsistent !== false) {
      labeledRefsConsistent = null; // at least one entry carried no label → can't confirm
    }
  });

  return {
    instruction,
    escrowCount,
    refs,
    accounts,
    hadBufferAccount: hasBuffer,
    labeledRefsConsistent,
  };
}

export interface SvmSettleExecutionVerifyInput
  extends SvmSettleExecutionInput, SvmSettleExpectation {
  /**
   * OPTIONAL. The compiled settle bytecode this execution runs (from the recipes split response this is
   * base64-decode(`sauces[settleIdx].program.bytecode`); from an eco-solver intent it is
   * base64-decode(`fulfillmentMetadata.svm.sauceStage.buffers[settleIdx].bytecode`)). When supplied, the
   * actual staged bytes are byte-compared to the canonical settle and tied to the pin.
   *
   * A partner usually does NOT have this (only the on-chain `route.calls`), and does not need it: the SDK
   * recompiles the canonical settle itself and proves genuineness via the calldata pin (see below).
   */
  bytecode?: Uint8Array;
  /**
   * OPTIONAL. The 32-byte content pin committing to the staged bytes.
   *
   * **Supplied by the caller, not read off this instruction.** It used to be decoded from the
   * engine's own calldata; the released engine's `executeFromAccount` carries no payload, so the
   * commitment lives one layer up — in the KITCHEN's `cook_from_account`, whose `pin` refuses unless
   * the staged bytes hash to it. Read it from that instruction and pass it here.
   *
   * Without it, supplying `bytecode` proves only that YOUR copy is canonical: nothing ties those
   * bytes to the code account this execution actually runs, and the verdict says so rather than
   * calling the execution genuine.
   */
  pin?: Uint8Array;
}

/**
 * How genuineness was established. The verdicts differ in what they actually prove, and the gap
 * between the strongest and the weakest is the whole reason this type is not a boolean.
 *
 * `inline-bytecode` — an `execute`: the program is IN the calldata, and it byte-matches the
 * canonical settle. The bytes verified are the bytes that run, with nothing in between. A pin means
 * nothing on this path (the engine never reads one) and cannot make an inline execution genuine.
 *
 * `bytecode` — an `execute_from_account` where the caller supplied the staged bytes: they match the
 * canonical settle AND the caller's pin ties to them. A pinless calldata commits to nothing, so it
 * is never genuine here however good the bytes are.
 *
 * `caller-asserted-pin` — an `execute_from_account` with no bytecode, whose pin equals
 * `sha256(canonical settle)`. **This is not an on-chain guarantee.** The released engine's
 * `execute_from_account` has no payload, so nothing enforces this pin at execute time; it means
 * "the caller asserts these staged bytes hash to this", and it is only as good as the caller's
 * evidence — a kitchen `cook_from_account` they witnessed. It was named `pin` while documented as
 * engine-enforced, which is precisely the belief that made it dangerous.
 *
 * `none` — no pin and no bytecode. Genuineness cannot be established from structure alone.
 *
 * The instruction's CALLEE is outside every verdict here: an arbitrary program accepting the same
 * discriminator can do whatever it likes — see `ExtractedSvmSettle.target`, whose `program` state a
 * caller must compare against the engine program id it trusts.
 */
export type SvmSettleVerifiedBy = "inline-bytecode" | "bytecode" | "caller-asserted-pin" | "none";

export interface SvmSettleExecutionVerification extends DecodedSvmSettleExecution {
  /** True iff the execution provably runs the genuine `svmSettleSource(escrowCount)` program. */
  genuine: boolean;
  /** How `genuine` was established (or why it could not be). */
  verifiedBy: SvmSettleVerifiedBy;
  /** `sha256(canonical recompiled settle)` === the calldata pin. null iff the calldata carried no pin. */
  pinMatchesCanonical: boolean | null;
  /** Only when `bytecode` was supplied: `sha256(bytecode)` === the calldata pin. null otherwise. */
  pinMatchesBytecode: boolean | null;
  /** Only when `bytecode` was supplied: the bytes byte-match the canonical settle. null otherwise. */
  bytecodeMatchesCanonical: boolean | null;
  /** Present iff not genuine: what failed. */
  mismatch?: string;
}

/**
 * The genuineness check for a settle execution — the crucial companion to `decodeSvmSettleExecution`,
 * whose structural decode alone CANNOT tell a settle from any other staged Sauce execute (an account
 * count is not a signature). This ties the calldata to the SDK's own recompiled canonical settle
 * bytecode, in one of two ways, no partner bytecode required for either verdict:
 *
 *   - `bytecode` supplied → byte-compare it to `compileCanonicalSettle(escrowCount)` AND require the pin
 *     to tie to it (`sha256(bytecode) === pin`). Proves the exact staged bytes ARE the settle and WILL run.
 *     Both halves are load-bearing: calldata with no pin commits to no program at all, so bytes alone —
 *     however genuine — prove nothing about what runs, and the verdict is not genuine.
 *   - no bytecode, but a pin was supplied → check `pin === sha256(canonical settle)`. NOTHING ENFORCES
 *     THIS ON CHAIN: the released engine's `execute_from_account` has no payload, so this is the
 *     caller asserting the staged bytes hash to that value, and it is worth exactly what their
 *     evidence is worth — hence `verifiedBy: 'caller-asserted-pin'`.
 *   - neither → `genuine: false`, `verifiedBy: 'none'` (structure alone is not proof).
 *
 * An `execute` is handled separately and BEFORE any of the above: its program is inline in the
 * calldata, so it is compared directly and a pin cannot make it genuine.
 *
 * Because `minOut`/`splCount` are folded into the bytecode, a `genuine` result also proves the program
 * enforces the `minOut`/`splCount` passed in — leaving only the resolved account identities for the
 * caller to check. Never throws beyond the shared structural decode; reports failures in `mismatch`.
 */
export function verifySvmSettleExecution(
  input: SvmSettleExecutionVerifyInput,
): SvmSettleExecutionVerification {
  const decoded = decodeSvmSettleExecution(input);
  const canonical = compileCanonicalSettle(decoded.escrowCount, input);
  // The CALLER's pin. This instruction has no payload to carry one, and nothing on chain checks it
  // at execute time, so it is an assertion by whoever supplied it — not a guarantee. On the staged
  // path it is the only thing tying the bytes verified here to the bytes that run, which is exactly
  // why the verdict it produces is named `caller-asserted-pin`.
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

  // An inline `execute` carries its program in the calldata, so it is verifiable directly and a pin
  // is irrelevant to it — the engine never reads one. Before this, the branch order below ignored
  // `decoded.instruction` entirely, so an inline execute carrying ARBITRARY bytecode plus
  // `pin = sha256(canonical)` returned `genuine: true`.
  if (decoded.instruction === "execute") {
    const inline = input.instructionData.subarray(8);
    const inlineMatchesCanonical = bytesEqual(inline, canonical);
    const suppliedMatchesInline =
      input.bytecode === undefined ? null : bytesEqual(input.bytecode, inline);

    verifiedBy = "inline-bytecode";
    genuine = inlineMatchesCanonical && suppliedMatchesInline !== false;
    mismatch = !inlineMatchesCanonical
      ? `inline execute bytecode does not byte-match svmSettleSource(${decoded.escrowCount})`
      : suppliedMatchesInline === false
        ? "supplied bytecode does not match the bytecode inline in this execute"
        : undefined;

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

  if (input.bytecode !== undefined) {
    verifiedBy = "bytecode";
    genuine = bytecodeMatchesCanonical === true && pinMatchesBytecode === true;
    mismatch =
      bytecodeMatchesCanonical !== true
        ? `bytecode does not byte-match svmSettleSource(${decoded.escrowCount})`
        : pinMatchesBytecode === false
          ? "calldata pin does not equal sha256(bytecode) — the calldata targets different bytecode"
          : pinMatchesBytecode === null
            ? "calldata carries no pin, so it does not commit to the supplied bytecode — the staged bytes verified here need not be the bytes that run"
            : undefined;
  } else if (pin !== undefined) {
    verifiedBy = "caller-asserted-pin";
    genuine = pinMatchesCanonical === true;
    mismatch = genuine
      ? undefined
      : `pin does not match sha256(svmSettleSource(${decoded.escrowCount})) — not a genuine settle execution`;
  } else {
    verifiedBy = "none";
    genuine = false;
    mismatch =
      "no calldata pin and no bytecode supplied — a staged settle has no structural signature, so genuineness cannot be proven";
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
