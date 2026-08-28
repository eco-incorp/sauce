/**
 * `ContractCall` — the inert value a `Base.<Proto>.<Contract>.<method>(...)`
 * leaf produces. Synchronous, no RPC, no compiler import: the same posture
 * as `swap/source.ts`/`deposit/source.ts`'s pure param-templating call
 * builders, which `toSauceScript` below deliberately mirrors.
 *
 * The `typeFidelity: "widened"` gate lives here, not in accessors.ts: every
 * production path (`data`, `encode`, `toCall`, `toSauceScript`) funnels
 * through `assertFidelity`, so a widened descriptor (three uniswap-v3
 * entries, uniswap-v4's PoolManager) can never silently hand out calldata
 * that will not hit the deployed contract — see links.ts's own caveats for
 * why each one is widened.
 */
import { type Address, type Hex } from "viem";
import type { CanonicalChain } from "../chains/canonical.js";
import type { ContractDescriptor, DescriptorMethod } from "./types.js";
/**
 * `baseDirs` for compiling a `toSauceScript()` program — same two-entry
 * shape (dist root + shipped `sdk/src`) and rationale as
 * `deposit/source.ts`'s `DEPOSIT_BASE_DIRS`: a contract's `.json` import
 * resolves against the SDK's protocol registry, not the engine-vendored
 * `dist/artifacts`.
 */
export declare const CONTRACT_BASE_DIRS: readonly string[];
export interface EncodeOptions {
    /** Opts past the widened-selector refusal — see the module doc comment. */
    readonly allowWidened?: boolean;
    /** Defaults to 0n. */
    readonly value?: bigint;
}
export interface SauceScriptOptions {
    /** Local binding name for the `.json` import. Defaults to the descriptor's `contract` name. */
    readonly binding?: string;
}
export interface ContractCall {
    readonly chain: CanonicalChain;
    readonly protocol: string;
    readonly contract: string;
    readonly address: Address;
    readonly method: DescriptorMethod;
    readonly args: readonly unknown[];
    readonly fidelity: "exact" | "widened";
    readonly caveats: readonly string[];
    /** `encode()` with no options — throws under the same widened gate. */
    readonly data: Hex;
    encode(opts?: EncodeOptions): Hex;
    toCall(opts?: EncodeOptions): {
        readonly target: Address;
        readonly data: Hex;
        readonly value: bigint;
    };
    toSauceScript(opts?: SauceScriptOptions): {
        readonly imports: readonly string[];
        readonly statement: string;
        readonly source: string;
        readonly baseDirs: readonly string[];
    };
}
export declare function makeContractCall(descriptor: ContractDescriptor, chain: CanonicalChain, address: Address, method: DescriptorMethod, args: readonly unknown[]): ContractCall;
//# sourceMappingURL=call.d.ts.map