/**
 * The compiler seam's data contract, owned by the SDK.
 *
 * `compileSauceRoute` reaches the compiler through one seam (`rs-compile.ts`), and the shapes below
 * are what that seam produces and consumes. Owning them here is what lets `sdk/src` name a route's
 * compile inputs and outputs without importing the compiler's own type surface — which is a wasm
 * package loaded at runtime, not something the SDK's public types should be pinned to.
 */

export interface AbiParameter {
  name?: string;
  type: string;
  components?: AbiParameter[];
  indexed?: boolean;
}

export interface AbiFunction {
  type: "function";
  name: string;
  inputs: AbiParameter[];
  outputs?: AbiParameter[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
}

export type AbiItem =
  | AbiFunction
  | { type: "event"; name: string; inputs: AbiParameter[] }
  | { type: "error"; name: string; inputs: AbiParameter[] }
  | { type: "constructor"; inputs: AbiParameter[] }
  | { type: "fallback" }
  | { type: "receive" };

export type Abi = readonly AbiItem[];

export interface ContractConfig {
  abi: Abi;
}

/**
 * Contract bindings by local name, holding a PARSED ABI in memory — never a filesystem path.
 * `protocol-rewrite.ts` synthesizes these, and `rs-compile.ts` maps them onto the RS compiler's
 * `inlineContracts` (its path-based `contracts` option expects a `resolve()`-able path, which this
 * seam never has).
 */
export type ContractsConfig = Record<string, ContractConfig>;

/**
 * Bytecode target: `'v1'` (prefix, Solidity interpreter), `'v12'` (postfix, Huff runtime) or
 * `'svm'` (postfix v12 dialect for the Solana engine). The RS compiler collapses `'v1'`/`'v12'`
 * onto its single `'evm'` backend (see `rs-compile.ts#mapTarget`).
 */
export type CompileTarget = "v1" | "v12" | "svm";

/**
 * What a route compile yields. `bytecode` is a list of SEGMENTS — `compileSauceRoute` slots
 * `bytecode[0]` as the one `Call` a cook executes (see `sauce-route.ts`'s "ONE COOK = ONE PROGRAM").
 */
export interface CompileResult {
  /** Present when the program was compiled for compact-v1 entry arguments — the schema its argument
   *  payload must be encoded against. */
  entrySchema?: Uint8Array;
  bytecode: Uint8Array[];
  warnings: string[];
}
