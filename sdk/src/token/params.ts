/**
 * Normalization + guards for the universal token interface. Mirrors `swap/params.ts`'s posture:
 * throws (never emits a program that would revert on-chain) rather than guessing.
 */
import type {
  AddressInput,
  SvmTokenRefs,
  TokenApproveSpec,
  TokenBalanceSpec,
  TokenSpec,
  TokenTarget,
  TokenTransferSpec,
} from "./types.js";

export function isEvmTarget(target: TokenTarget): boolean {
  return target === "evm" || target === "v1" || target === "v12";
}

export function toAddressBigint(value: AddressInput, label: string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

const U64_MAX = 2n ** 64n - 1n;

/** Any literal (non-`"balance"`) amount destined for SVM must fit the SPL u64 `amount` field. */
export function assertU64Range(amount: bigint, label: string): void {
  if (amount < 0n || amount > U64_MAX) {
    throw new Error(`${label}: amount must be a u64 (0..${U64_MAX}), got ${amount}`);
  }
}

export function toAmountBigint(amount: bigint | number, label: string): bigint {
  if (typeof amount === "bigint") return amount;
  if (!Number.isInteger(amount)) throw new Error(`${label}: expected an integer, got ${amount}`);
  return BigInt(amount);
}

function requireEvmField<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is required on an EVM target`);
  }
  return value;
}

function requireSvmRefs(spec: { svm?: SvmTokenRefs }, label: string): SvmTokenRefs {
  if (spec.svm === undefined) {
    throw new Error(`${label}: svm refs are required on target 'svm'`);
  }
  return spec.svm;
}

/** `owner`/`tokenProgram` default names — shared/reused across ops in one program by design (the
 *  SPL CPI-target intern is meant to dedupe across ops, unlike per-op instance refs). */
export function ownerRef(refs: SvmTokenRefs): string {
  return refs.owner ?? "owner";
}
export function tokenProgramRef(refs: SvmTokenRefs): string {
  return refs.tokenProgram ?? "tokenProgram";
}

export function validateTransferSpec(spec: TokenTransferSpec, target: TokenTarget): void {
  if (isEvmTarget(target)) {
    requireEvmField(spec.token, "token");
    requireEvmField(spec.to, "to");
    return;
  }
  const refs = requireSvmRefs(spec, "Token.transfer");
  if (refs.mint === undefined) throw new Error("Token.transfer: svm.mint is required on target 'svm'");
  if (refs.dest === undefined) throw new Error("Token.transfer: svm.dest is required on target 'svm'");
  if (spec.amount !== "balance") {
    assertU64Range(toAmountBigint(spec.amount, "Token.transfer amount"), "Token.transfer amount");
  }
}

export function validateApproveSpec(spec: TokenApproveSpec, target: TokenTarget): void {
  if (isEvmTarget(target)) {
    requireEvmField(spec.token, "token");
    requireEvmField(spec.spender, "spender");
    return;
  }
  const refs = requireSvmRefs(spec, "Token.approve");
  if (refs.mint === undefined) throw new Error("Token.approve: svm.mint is required on target 'svm'");
  if (refs.delegate === undefined) throw new Error("Token.approve: svm.delegate is required on target 'svm'");
  if (spec.amount !== "balance") {
    assertU64Range(toAmountBigint(spec.amount, "Token.approve amount"), "Token.approve amount");
  }
}

export function validateBalanceSpec(spec: TokenBalanceSpec, target: TokenTarget): void {
  if (isEvmTarget(target)) {
    requireEvmField(spec.token, "token");
    requireEvmField(spec.owner, "owner");
    return;
  }
  requireSvmRefs(spec, "Token.balanceOf");
}

/** The per-op INSTANCE refs (source/mint/dest/delegate) — everything EXCEPT the intentionally
 *  shared `owner`/`tokenProgram` defaults, which are meant to dedupe/reuse across ops. */
function instanceRefs(spec: TokenSpec): readonly string[] {
  if (spec.svm === undefined) return [];
  const refs = spec.svm as SvmTokenRefs;
  return [refs.source, refs.mint, refs.dest, refs.delegate].filter((r): r is string => typeof r === "string");
}

/**
 * Rejects a duplicate SVM instance ref name across DIFFERENT ops in one `Token.program(...)` call —
 * a collision would silently merge two distinct AccountPlan slots. `owner`/`tokenProgram` are
 * exempt (shared by design).
 */
export function assertNoDuplicateSvmRefs(specs: readonly TokenSpec[]): void {
  const seen = new Map<string, number>();
  specs.forEach((spec, specIndex) => {
    for (const ref of instanceRefs(spec)) {
      const prior = seen.get(ref);
      if (prior !== undefined && prior !== specIndex) {
        throw new Error(
          `Token.program: svm ref "${ref}" is reused across specs [${prior}, ${specIndex}] — ` +
            `give each op's source/mint/dest/delegate a distinct name`,
        );
      }
      seen.set(ref, specIndex);
    }
  });
}
