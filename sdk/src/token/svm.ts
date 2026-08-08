/**
 * The SPL Token arm — statement/expression builders for the universal token interface's SVM
 * lowering. Reuses the shipped SPL knowledge in `sdk/src/svm/venues/scale-common.ts` and the
 * `svmSettleSource`/`settle.sauce.ts` idiom (`contract.call(program, data, accounts)`,
 * `accountData`/`accountUint`, the `le8` u64 byteswap helper) rather than reinventing it.
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
  type TokenTransferSpec,
} from "./types.js";
import { ownerRef, tokenProgramRef } from "./params.js";

const ADDRESS_ENCODER = getAddressEncoder();

function addressToBigint(addr: string): bigint {
  const bytes = new Uint8Array(ADDRESS_ENCODER.encode(addr as never));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Well-known SPL program ids, converted once to the bigint literal `contract.call`'s target wants. */
export const TOKEN_PROGRAM_BIGINT: bigint = addressToBigint(TOKEN_PROGRAM);
export const TOKEN_2022_PROGRAM_BIGINT: bigint = addressToBigint(TOKEN_2022_PROGRAM);

/** The SauceScript expression for a `SvmTokenProgramInput` CPI-target VALUE. Defaults to `"spl"`. */
export function tokenProgramValueExpr(input: SvmTokenProgramInput | undefined): string {
  if (input === undefined || input === "spl") return formatBigint(TOKEN_PROGRAM_BIGINT);
  if (input === "token-2022") return formatBigint(TOKEN_2022_PROGRAM_BIGINT);
  if (typeof input === "bigint") return formatBigint(input);
  return input.arg;
}

/**
 * Per-program emission state: tracks which `tokenProgram` refs have already been interned (via
 * `accountData(ref, 0, 0)`) and whether `le8` has already been emitted — both are load-bearing but
 * must appear AT MOST ONCE per ref / per program, mirroring `svmSettleSource`'s own dedup rules.
 */
export interface SvmEmitState {
  internedTokenPrograms: Set<string>;
}

export function newSvmEmitState(): SvmEmitState {
  return { internedTokenPrograms: new Set() };
}

export const LE8_HELPER_SOURCE = [
  "/** 64-bit byte swap: the LE image of a u64 amount, MSTORE'd big-endian by abi.encode. */",
  "function le8(x) {",
  "  return ((x & 255) << 56) | ((x & 65280) << 40) | ((x & 16711680) << 24) | ((x & 4278190080) << 8)",
  "    | ((x >> 8) & 4278190080) | ((x >> 24) & 16711680) | ((x >> 40) & 65280) | (x >> 56);",
  "}",
].join("\n");

function amountLe8Expr(amount: bigint | number | "balance", sourceRef: string): string {
  const inner =
    amount === "balance" ? `accountUint("${sourceRef}", ${SPL_AMOUNT_OFFSET}, 8)` : formatBigint(typeof amount === "bigint" ? amount : BigInt(amount));
  return `le8(${inner})`;
}

/** `accountData("<ref>", 0, 0)` — interned at most once per ref per program (load-bearing CPI-target
 *  attach; see `settle.sauce.ts`'s header comment for why this can't be dropped). */
function tokenProgramIntern(ref: string, state: SvmEmitState): string | undefined {
  if (state.internedTokenPrograms.has(ref)) return undefined;
  state.internedTokenPrograms.add(ref);
  return `accountData("${ref}", 0, 0);`;
}

/**
 * `contract.call(...)` block for a `TransferChecked`/`ApproveChecked` CPI — `index` disambiguates
 * the bound-local names (`dec0`, `amt0`, ...) across a multi-op program.
 */
function checkedCallLines(opts: {
  index: number;
  discriminant: number;
  refs: SvmTokenRefs;
  amount: bigint | number | "balance";
  tokenProgram: SvmTokenProgramInput | undefined;
  destOrDelegateRef: string;
  destOrDelegateWritable: boolean;
  state: SvmEmitState;
}): readonly string[] {
  const { index, discriminant, refs, amount, tokenProgram, destOrDelegateRef, destOrDelegateWritable, state } = opts;
  const mintRef = refs.mint!;
  const sourceRef = refs.source;
  const ownerName = ownerRef(refs);
  const tpRef = tokenProgramRef(refs);

  const lines: string[] = [];
  const intern = tokenProgramIntern(tpRef, state);
  if (intern !== undefined) lines.push(intern);

  lines.push(
    `const dec${index} = accountUint("${mintRef}", ${MINT_DECIMALS_OFFSET}, 1);`,
    `const amt${index} = abi.encode(${amountLe8Expr(amount, sourceRef)}).slice(24, 32);`,
    `const dcb${index} = abi.encode(dec${index}).slice(31, 32);`,
    `const data${index} = Uint8Array.from([${discriminant}]).concat(amt${index}).concat(dcb${index});`,
    `contract.call(${tokenProgramValueExpr(tokenProgram)}, data${index}, [`,
    `  { ref: "${sourceRef}", writable: true },`,
    `  { ref: "${mintRef}" },`,
    `  { ref: "${destOrDelegateRef}"${destOrDelegateWritable ? ", writable: true" : ""} },`,
    `  { ref: "${ownerName}", signer: true }`,
    `]);`,
  );
  return lines;
}

export function svmTransferLines(spec: TokenTransferSpec, index: number, state: SvmEmitState): readonly string[] {
  const refs = spec.svm!;
  return checkedCallLines({
    index,
    discriminant: SPL_TRANSFER_CHECKED,
    refs,
    amount: spec.amount,
    tokenProgram: spec.tokenProgram,
    destOrDelegateRef: refs.dest!,
    destOrDelegateWritable: true,
    state,
  });
}

export function svmApproveLines(spec: TokenApproveSpec, index: number, state: SvmEmitState): readonly string[] {
  const refs = spec.svm!;
  return checkedCallLines({
    index,
    discriminant: SPL_APPROVE_CHECKED,
    refs,
    amount: spec.amount,
    tokenProgram: spec.tokenProgram,
    destOrDelegateRef: refs.delegate!,
    destOrDelegateWritable: false,
    state,
  });
}

export function svmBalanceExpression(spec: TokenBalanceSpec): string {
  const refs = spec.svm!;
  return `accountUint("${refs.source}", ${SPL_AMOUNT_OFFSET}, 8)`;
}

/** The AccountPlan refs, in intern order, for `transfer`/`approve` with the given (defaulted) refs. */
export function accountRefsForTransfer(refs: SvmTokenRefs): readonly string[] {
  return [tokenProgramRef(refs), refs.mint!, refs.source, refs.dest!, ownerRef(refs)];
}
export function accountRefsForApprove(refs: SvmTokenRefs): readonly string[] {
  return [tokenProgramRef(refs), refs.mint!, refs.source, refs.delegate!, ownerRef(refs)];
}
