/**
 * The SPL Token arm — statement/expression builders for the universal token interface's SVM
 * lowering. Reuses the shipped SPL knowledge in `sdk/src/svm/venues/scale-common.ts`.
 *
 * ACCOUNT MODEL. Every account a program touches is a `main` PARAMETER, declared in the order the
 * caller must attach them; the compiler reports that order back as the account manifest, and a slot
 * carries the role its annotation asserts (`Account<Writable>`, `Account<Signer>`). So a ref name
 * here becomes an identifier in the emitted source rather than a string, an account read is
 * `svm.sload(ref, off, len).toLe()`, and a CPI is `svm.call(program, [accounts], data)` where the
 * program is itself one of those params.
 *
 * That collapses three things the string-ref form needed:
 *   - the `accountData(ref, 0, 0)` zero-length read whose only job was to force the CPI target into
 *     an account slot — a param already is one;
 *   - the split between the CPI target as a baked VALUE and as a separate account ref, and with it
 *     the "two independent bindings a caller must keep in sync" hazard: there is now one binding;
 *   - the `le8` byteswap helper and the `abi.encode(...).slice(...)` dance, replaced by
 *     `.toBytesLe(width)` (and `abi.encode` is not available on the svm target anyway).
 *
 * Because `svm.call` invokes whatever account occupies the program slot, each concrete token program
 * is pinned with `require(<ref> == <pubkey>)`. The baked-value form got that check for free (the
 * engine resolved the CPI by scanning the attached accounts for the baked pubkey); this restores it
 * explicitly.
 */
import { getAddressEncoder } from "@solana/kit";

import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../svm/venues/scale-common.js";
import { formatBigint } from "../deposit/format.js";
import {
  MINT_DECIMALS_OFFSET,
  SPL_AMOUNT_OFFSET,
  SPL_APPROVE_CHECKED,
  SPL_TRANSFER_CHECKED,
  type SvmTokenProgramInput,
  type SvmTokenRefs,
  type TokenApproveSpec,
  type TokenBalanceSpec,
  type TokenSpec,
  type TokenTransferSpec,
} from "./types.js";
import { ownerRef, toAmountBigint, tokenProgramRef } from "./params.js";

const ADDRESS_ENCODER = getAddressEncoder();

/** A ref becomes a `main` parameter name, so it has to be spellable as one. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function addressToBigint(addr: string): bigint {
  const bytes = new Uint8Array(ADDRESS_ENCODER.encode(addr as never));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Well-known SPL program ids, converted once to the bigint literal the identity check wants. */
export const TOKEN_PROGRAM_BIGINT: bigint = addressToBigint(TOKEN_PROGRAM);
export const TOKEN_2022_PROGRAM_BIGINT: bigint = addressToBigint(TOKEN_2022_PROGRAM);

/** The SauceScript expression for a `SvmTokenProgramInput` CPI-target VALUE. Defaults to `"spl"`. */
export function tokenProgramValueExpr(input: SvmTokenProgramInput | undefined): string {
  if (input === undefined || input === "spl") return formatBigint(TOKEN_PROGRAM_BIGINT);
  if (input === "token-2022") return formatBigint(TOKEN_2022_PROGRAM_BIGINT);
  return formatBigint(input);
}

export function assertRefIsIdentifier(ref: string, label: string): void {
  if (!IDENTIFIER_RE.test(ref)) {
    throw new Error(
      `${label}: svm ref '${ref}' must be a valid identifier — it becomes a main() account parameter`,
    );
  }
}

/** Per-program emission state: a token program is pinned at most once per ref per program. */
export interface SvmEmitState {
  /** token-program ref -> the program value it was pinned to, so a second op cannot repoint it. */
  pinnedTokenPrograms: Map<string, string>;
}

export function newSvmEmitState(): SvmEmitState {
  return { pinnedTokenPrograms: new Map() };
}

// ── account parameters ──

interface Role {
  writable: boolean;
  signer: boolean;
}

/** One `main` account parameter: the ref name and the role its annotation asserts. */
export interface SvmAccountParam {
  ref: string;
  writable: boolean;
  signer: boolean;
}

/** `Account`, `Account<Writable>`, `Account<Signer>` or `Account<Writable, Signer>`. */
export function accountParamType({ writable, signer }: Role): string {
  const args = [...(writable ? ["Writable"] : []), ...(signer ? ["Signer"] : [])];

  return args.length > 0 ? `Account<${args.join(", ")}>` : "Account";
}

/** The refs one spec needs, in attach order, each with the role that spec demands of it. */
function specParams(spec: TokenSpec): readonly SvmAccountParam[] {
  if (spec.op === "balanceOf") {
    return [{ ref: spec.svm!.source, writable: false, signer: false }];
  }

  const refs = spec.svm!;
  const counterparty =
    spec.op === "transfer"
      ? { ref: (refs as SvmTokenRefs).dest!, writable: true, signer: false }
      : { ref: (refs as SvmTokenRefs).delegate!, writable: false, signer: false };

  return [
    { ref: tokenProgramRef(refs), writable: false, signer: false },
    { ref: refs.mint!, writable: false, signer: false },
    { ref: refs.source, writable: true, signer: false },
    counterparty,
    { ref: ownerRef(refs), writable: false, signer: true },
  ];
}

/**
 * Every account the program's specs touch, in FIRST-USE order — the order a caller attaches them
 * and the order the manifest reports. A ref shared across ops (`owner`/`tokenProgram` by design)
 * appears once, holding the strongest role any op demanded of it.
 */
export function svmAccountParams(specs: readonly TokenSpec[]): readonly SvmAccountParam[] {
  const byRef = new Map<string, SvmAccountParam>();

  for (const spec of specs) {
    for (const param of specParams(spec)) {
      assertRefIsIdentifier(param.ref, "tokenSource");
      const seen = byRef.get(param.ref);
      if (seen === undefined) {
        byRef.set(param.ref, { ...param });
        continue;
      }
      seen.writable = seen.writable || param.writable;
      seen.signer = seen.signer || param.signer;
    }
  }

  return [...byRef.values()];
}

/** The `main(...)` parameter list for `specs`, annotated with each slot's required role. */
export function svmAccountParamList(specs: readonly TokenSpec[]): string {
  return svmAccountParams(specs)
    .map((param) => `${param.ref}: ${accountParamType(param)}`)
    .join(", ");
}

// ── statements ──

function amountExpr(amount: bigint | number | "balance", sourceRef: string, label: string): string {
  if (amount === "balance") return `svm.sload(${sourceRef}, ${SPL_AMOUNT_OFFSET}, 8).toLe()`;

  // formatBigint takes a bigint, so a `number` amount CANNOT be stringified into the emitted
  // source without going through toAmountBigint first.
  return formatBigint(toAmountBigint(amount, label));
}

/**
 * `require(<ref> == <pubkey>)`, emitted once per (ref, program) pair. A ref names ONE attached
 * account, so two ops pinning the same ref to different programs cannot both be satisfied -- the
 * second would silently execute against the first's program. Distinct programs need distinct refs.
 */
function tokenProgramPin(
  ref: string,
  tokenProgram: SvmTokenProgramInput | undefined,
  state: SvmEmitState,
): string | undefined {
  const value = tokenProgramValueExpr(tokenProgram);
  const pinned = state.pinnedTokenPrograms.get(ref);
  if (pinned === value) return undefined;
  if (pinned !== undefined) {
    throw new Error(
      `svm token: ref '${ref}' is pinned to ${pinned} and cannot also be ${value} -- one ref is one ` +
        `attached account. Give the ops distinct svm.tokenProgram refs.`,
    );
  }
  state.pinnedTokenPrograms.set(ref, value);

  return `require(${ref} == ${value});`;
}

/**
 * `svm.call(...)` block for a `TransferChecked`/`ApproveChecked` CPI. `index` disambiguates the
 * bound-local names (`dec0`, `amtv0`, ...) across a multi-op program; a method call on a literal is
 * outside the compiler's supported subset, so each operand is bound to a const first.
 */
function checkedCallLines(opts: {
  index: number;
  discriminant: number;
  refs: SvmTokenRefs;
  amount: bigint | number | "balance";
  tokenProgram: SvmTokenProgramInput | undefined;
  counterpartyRef: string;
  /** Names the op in an amount error — `amountExpr` validates before it formats. */
  label: string;
  state: SvmEmitState;
}): readonly string[] {
  const { index, discriminant, refs, amount, tokenProgram, counterpartyRef, label, state } = opts;
  const mintRef = refs.mint!;
  const sourceRef = refs.source;
  const ownerName = ownerRef(refs);
  const tpRef = tokenProgramRef(refs);

  const lines: string[] = [];
  const pin = tokenProgramPin(tpRef, tokenProgram, state);
  if (pin !== undefined) lines.push(pin);

  lines.push(
    `const disc${index} = hex\`${discriminant.toString(16).padStart(2, "0")}\`;`,
    `const amtv${index} = ${amountExpr(amount, sourceRef, label)};`,
    `const dec${index} = svm.sload(${mintRef}, ${MINT_DECIMALS_OFFSET}, 1).toLe();`,
    `const data${index} = disc${index}.concat(amtv${index}.toBytesLe(8)).concat(dec${index}.toBytesLe(1));`,
    `svm.call(${tpRef}, [${sourceRef}, ${mintRef}, ${counterpartyRef}, ${ownerName}], data${index});`,
  );

  return lines;
}

export function svmTransferLines(
  spec: TokenTransferSpec,
  index: number,
  state: SvmEmitState,
): readonly string[] {
  const refs = spec.svm!;

  return checkedCallLines({
    index,
    discriminant: SPL_TRANSFER_CHECKED,
    refs,
    amount: spec.amount,
    tokenProgram: spec.tokenProgram,
    counterpartyRef: refs.dest!,
    label: "Token.transfer amount",
    state,
  });
}

export function svmApproveLines(
  spec: TokenApproveSpec,
  index: number,
  state: SvmEmitState,
): readonly string[] {
  const refs = spec.svm!;

  return checkedCallLines({
    index,
    discriminant: SPL_APPROVE_CHECKED,
    refs,
    amount: spec.amount,
    tokenProgram: spec.tokenProgram,
    counterpartyRef: refs.delegate!,
    label: "Token.approve amount",
    state,
  });
}

export function svmBalanceExpression(spec: TokenBalanceSpec): string {
  const refs = spec.svm!;

  return `svm.sload(${refs.source}, ${SPL_AMOUNT_OFFSET}, 8).toLe()`;
}

/** The account manifest refs, in attach order, for `transfer`/`approve` with the given refs. */
export function accountRefsForTransfer(refs: SvmTokenRefs): readonly string[] {
  return [tokenProgramRef(refs), refs.mint!, refs.source, refs.dest!, ownerRef(refs)];
}
export function accountRefsForApprove(refs: SvmTokenRefs): readonly string[] {
  return [tokenProgramRef(refs), refs.mint!, refs.source, refs.delegate!, ownerRef(refs)];
}
