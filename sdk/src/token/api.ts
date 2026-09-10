/**
 * `Token` — the runtime value behind the DEFAULT GLOBAL `Token` (see `sdk/src/routes/globals.ts`).
 * A plain, inert builder: `Token.transfer(spec)`/`.approve(spec)`/`.balanceOf(spec)` return a
 * `TokenCall`, synchronous, no RPC, no compiler import — the same posture as
 * `descriptors/call.ts`'s `ContractCall`.
 */
import { encodeFunctionData, type Hex } from "viem";

import { ERC20ABI } from "../protocols/erc20/abis.js";
import { ata } from "../svm/venues/scale-common.js";
import {
  toAddressBigint,
  toAmountBigint,
  validateApproveSpec,
  validateBalanceSpec,
  validateTransferSpec,
} from "./params.js";
import {
  tokenAccountRefs,
  tokenExpression,
  TOKEN_BASE_DIRS,
  tokenCallStatement,
  tokenImportLines,
  tokenSource,
} from "./source.js";
import { TOKEN_PROGRAM_BIGINT, TOKEN_2022_PROGRAM_BIGINT } from "./svm.js";
import {
  MINT_DECIMALS_OFFSET,
  SPL_AMOUNT_OFFSET,
  SPL_APPROVE_CHECKED,
  SPL_TRANSFER_CHECKED,
  type AddressInput,
  type TokenApproveSpec,
  type TokenBalanceSpec,
  type TokenSpec,
  type TokenTarget,
  type TokenTransferSpec,
} from "./types.js";

export interface TokenSauceScript {
  readonly imports: readonly string[];
  readonly statement: string;
  readonly source: string;
  readonly baseDirs: readonly string[];
  readonly accountRefs?: readonly string[];
}

export interface TokenCall {
  readonly spec: TokenSpec;
  /** A complete, compilable one-op `function main() { ... }` program. */
  source(target: TokenTarget): string;
  /** The bare statement (transfer/approve), for splicing into a larger program. Throws for `balanceOf`. */
  statement(target: TokenTarget): string;
  /** The bare expression (balanceOf only). Throws for transfer/approve. */
  expression(target: TokenTarget): string;
  toSauceScript(target: TokenTarget): TokenSauceScript;
  /** EVM only: `{ target, data, value }` via `viem`'s `encodeFunctionData`. Throws for an svm spec. */
  toCall(): { readonly target: `0x${string}`; readonly data: Hex; readonly value: bigint };
  /** SVM only: the AccountPlan refs this op interns, in order. Throws for an EVM-target spec. */
  accountRefs(): readonly string[];
}

function makeTokenCall(spec: TokenSpec): TokenCall {
  return {
    spec,
    source: (target) => tokenSource(spec, target),
    statement: (target) => tokenCallStatement(spec, target),
    expression: (target) => tokenExpression(spec, target),
    toSauceScript: (target) => {
      const imports = tokenImportLines([spec], target);
      const src = tokenSource(spec, target);
      const isBalance = spec.op === "balanceOf";
      const statement = isBalance
        ? `${tokenExpression(spec, target)};`
        : tokenCallStatement(spec, target);
      return {
        imports,
        statement,
        source: src,
        baseDirs: TOKEN_BASE_DIRS,
        ...(target === "svm" ? { accountRefs: tokenAccountRefsSafe(spec, target) } : {}),
      };
    },
    toCall: () => {
      if (spec.svm !== undefined) {
        throw new Error(
          `TokenCall.toCall: Token.${spec.op} is an SVM spec — use accountRefs()/toSauceScript('svm') instead`,
        );
      }
      if (spec.op === "balanceOf") {
        validateBalanceSpec(spec, "evm");
        if (spec.owner === "self") {
          throw new Error(
            "TokenCall.toCall: Token.balanceOf('self') has no fixed calldata — compile it instead",
          );
        }
        return {
          target: hexAddress(spec.token, "token"),
          data: encodeFunctionData({
            abi: ERC20ABI,
            functionName: "balanceOf",
            args: [hexAddress(spec.owner, "owner")],
          }),
          value: 0n,
        };
      }
      if (spec.op === "transfer") validateTransferSpec(spec, "evm");
      else validateApproveSpec(spec, "evm");
      if (spec.amount === "balance") {
        throw new Error(
          `TokenCall.toCall: Token.${spec.op} with amount: "balance" has no fixed calldata — compile it instead`,
        );
      }
      if (spec.op === "transfer") {
        return {
          target: hexAddress(spec.token, "token"),
          data: encodeFunctionData({
            abi: ERC20ABI,
            functionName: "transfer",
            args: [hexAddress(spec.to, "to"), toAmountBigint(spec.amount, "Token.transfer amount")],
          }),
          value: 0n,
        };
      }
      return {
        target: hexAddress(spec.token, "token"),
        data: encodeFunctionData({
          abi: ERC20ABI,
          functionName: "approve",
          args: [
            hexAddress(spec.spender, "spender"),
            toAmountBigint(spec.amount, "Token.approve amount"),
          ],
        }),
        value: 0n,
      };
    },
    accountRefs: () => tokenAccountRefsSafe(spec, "svm"),
  };
}

function tokenAccountRefsSafe(spec: TokenSpec, target: TokenTarget): readonly string[] {
  return tokenAccountRefs(spec, target);
}

function hexAddress(value: TokenTransferSpec["token"], label: string): `0x${string}` {
  if (value === undefined) throw new Error(`TokenCall.toCall: ${label} is required`);
  const big = toAddressBigint(value, label);
  return `0x${big.toString(16).padStart(40, "0")}`;
}

/**
 * What `Token(<addr>)` yields **inside a route body** — the wrapper form, not the runtime API.
 *
 * Route-body calls are positional (`Token(a).approve(spender, amt)`) where the runtime
 * [`TokenApi`] takes a spec object, because the body is compiled to Sauce bytecode rather than
 * executed: `token-rewrite.ts#rewriteTokenFactory` replaces the callee with `IERC20.at` before the
 * compiler sees it, and these signatures are what let a **typed closure** body typecheck on the way
 * there. Nothing calls these at run time, which is why they live here rather than on `TokenApi`.
 */
export interface TokenBinding {
  transfer(to: AddressInput, amount: bigint): void;
  approve(spender: AddressInput, amount: bigint): void;
  balanceOf(owner: AddressInput): bigint;
}

/**
 * The call signature the **ambient** `Token` global carries, intersected onto [`TokenApi`] by
 * `gen-route-globals.mjs` — the same way each chain global is `ChainGlobals[...] & ChainContracts`.
 *
 * Deliberately NOT on `TokenApi` itself: the runtime `Token` export is a frozen object and is not
 * callable, so typing it as callable would promise something that throws. The ambient declaration
 * describes what is legal in a route body, where the call never survives to run.
 */
export interface TokenFactory {
  (address: AddressInput): TokenBinding;
}

export interface TokenApi {
  transfer(spec: TokenTransferSpec): TokenCall;
  approve(spec: TokenApproveSpec): TokenCall;
  balanceOf(spec: TokenBalanceSpec): TokenCall;
  /** N ops in ONE `main()` — because `V12Pot.cook`/an SVM program executes ONE program. */
  program(specs: readonly TokenSpec[], opts: { target: TokenTarget }): string;
  readonly ata: typeof ata;
  readonly TOKEN_PROGRAM: bigint;
  readonly TOKEN_2022_PROGRAM: bigint;
  readonly ERC20ABI: typeof ERC20ABI;
  readonly SPL_TRANSFER_CHECKED: number;
  readonly SPL_APPROVE_CHECKED: number;
  readonly SPL_AMOUNT_OFFSET: number;
  readonly MINT_DECIMALS_OFFSET: number;
}

/**
 * The universal token interface — ERC20 on an EVM compile target, SPL Token on `svm`. See
 * `sdk/src/token/index.ts` for the module overview. Installed as the DEFAULT GLOBAL `Token` (zero
 * import) by `sdk/src/routes/globals.ts`; also available as the named export `token.Token`.
 */
export const Token: TokenApi = Object.freeze({
  transfer: (spec: TokenTransferSpec): TokenCall => makeTokenCall({ op: "transfer", ...spec }),
  approve: (spec: TokenApproveSpec): TokenCall => makeTokenCall({ op: "approve", ...spec }),
  balanceOf: (spec: TokenBalanceSpec): TokenCall => makeTokenCall({ op: "balanceOf", ...spec }),
  program: (specs: readonly TokenSpec[], opts: { target: TokenTarget }): string =>
    tokenSource(specs, opts.target),
  ata,
  TOKEN_PROGRAM: TOKEN_PROGRAM_BIGINT,
  TOKEN_2022_PROGRAM: TOKEN_2022_PROGRAM_BIGINT,
  ERC20ABI,
  SPL_TRANSFER_CHECKED,
  SPL_APPROVE_CHECKED,
  SPL_AMOUNT_OFFSET,
  MINT_DECIMALS_OFFSET,
});
