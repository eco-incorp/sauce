/**
 * `Token` — the runtime value behind the DEFAULT GLOBAL `Token` (see `sdk/src/routes/globals.ts`).
 * A plain, inert builder: `Token.transfer(spec)`/`.approve(spec)`/`.balanceOf(spec)` return a
 * `TokenCall`, synchronous, no RPC, no compiler import — the same posture as
 * `descriptors/call.ts`'s `ContractCall`.
 */
import { type Hex } from "viem";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { ata } from "../svm/venues/scale-common.js";
import { type TokenApproveSpec, type TokenBalanceSpec, type TokenSpec, type TokenTarget, type TokenTransferSpec } from "./types.js";
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
    toCall(): {
        readonly target: `0x${string}`;
        readonly data: Hex;
        readonly value: bigint;
    };
    /** SVM only: the AccountPlan refs this op interns, in order. Throws for an EVM-target spec. */
    accountRefs(): readonly string[];
}
export interface TokenApi {
    transfer(spec: TokenTransferSpec): TokenCall;
    approve(spec: TokenApproveSpec): TokenCall;
    balanceOf(spec: TokenBalanceSpec): TokenCall;
    /** N ops in ONE `main()` — because `V12Pot.cook`/an SVM program executes `ingredients[0]` only. */
    program(specs: readonly TokenSpec[], opts: {
        target: TokenTarget;
    }): string;
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
export declare const Token: TokenApi;
//# sourceMappingURL=api.d.ts.map