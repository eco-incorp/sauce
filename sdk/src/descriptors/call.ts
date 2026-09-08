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
import { encodeFunctionData, type Address, type Hex } from "viem";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CanonicalChain } from "../chains/canonical.js";
import { toExactBigInt } from "../numeric.js";
import type { ContractDescriptor, DescriptorMethod } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `baseDirs` for compiling a `toSauceScript()` program — same two-entry
 * shape (dist root + shipped `sdk/src`) and rationale as
 * `deposit/source.ts`'s `DEPOSIT_BASE_DIRS`: a contract's `.json` import
 * resolves against the SDK's protocol registry, not the engine-vendored
 * `dist/artifacts`.
 */
export const CONTRACT_BASE_DIRS: readonly string[] = [
  join(__dirname, ".."),
  join(__dirname, "..", "..", "src"),
];

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

function widenedRealSelectorHint(descriptor: ContractDescriptor): string {
  return descriptor.coverage.caveats.length > 0
    ? descriptor.coverage.caveats.join("; ")
    : "vendored types differ from the deployed contract";
}

function assertFidelity(
  descriptor: ContractDescriptor,
  method: DescriptorMethod,
  allowWidened: boolean | undefined,
): void {
  if (descriptor.coverage.typeFidelity !== "widened") return;
  if (allowWidened) return;
  throw new Error(
    `${descriptor.protocol}.${descriptor.contract}.${method.name}: this descriptor's ABI is WIDENED (${widenedRealSelectorHint(descriptor)}) — ` +
      `selector ${method.selector} will NOT match the deployed contract. Pass { allowWidened: true } to encode anyway.`,
  );
}

const renderBigintArg = (value: bigint): string => `${value.toString()}n`;

/** Renders one JS value as a SauceScript literal expression, or throws a named error for a shape
 *  `toSauceScript` can't spell yet (a caller should reach for `encode()`/`toCall()` instead).
 *
 *  Every numeric literal is rendered from a `bigint`: a `number` past 2^53-1 would stringify to a
 *  DIFFERENT rounded value than `BigInt()` gives it, and this text becomes compiled bytecode. A
 *  non-integer is rejected here rather than by `toExactBigInt` because the fix is a different call
 *  (`encode()`), not a different literal type. */
function renderSauceArg(value: unknown, methodName: string): string {
  if (typeof value === "bigint") return renderBigintArg(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(
        `toSauceScript: cannot render non-integer number argument for ${methodName} — use encode()/toCall() instead`,
      );
    }
    return renderBigintArg(
      toExactBigInt(value, `toSauceScript: number argument for ${methodName}`),
    );
  }
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return renderBigintArg(BigInt(value));
    throw new Error(
      `toSauceScript: cannot render string argument "${value}" for ${methodName} (only a 20-byte address literal is supported) — use encode()/toCall() instead`,
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderSauceArg(v, methodName)).join(", ")}]`;
  }
  if (value instanceof Uint8Array) {
    return `Uint8Array.from([${Array.from(value).join(", ")}])`;
  }
  throw new Error(
    `toSauceScript: cannot render argument of type ${typeof value} for ${methodName} — use encode()/toCall() instead`,
  );
}

export function makeContractCall(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  address: Address,
  method: DescriptorMethod,
  args: readonly unknown[],
): ContractCall {
  const fidelity = descriptor.coverage.typeFidelity;
  const caveats = descriptor.coverage.caveats;

  function encode(opts: EncodeOptions = {}): Hex {
    assertFidelity(descriptor, method, opts.allowWidened);
    return encodeFunctionData({
      abi: descriptor.abi,
      functionName: method.name,
      args: args as readonly unknown[],
    });
  }

  function toCall(opts: EncodeOptions = {}): { target: Address; data: Hex; value: bigint } {
    return { target: address, data: encode(opts), value: opts.value ?? 0n };
  }

  function toSauceScript(opts: SauceScriptOptions = {}) {
    assertFidelity(descriptor, method, undefined);
    if (descriptor.abiExport === undefined) {
      throw new Error(
        `toSauceScript: ${descriptor.protocol}.${descriptor.contract} has no vendored abiExport — use encode()/toCall() instead`,
      );
    }
    const binding = opts.binding ?? descriptor.contract;
    const importLine = `import { ${binding} } from "./protocols/${descriptor.protocol}/${descriptor.abiExport}.json";`;
    const renderedArgs = args.map((a) => renderSauceArg(a, method.name)).join(", ");
    const statement = `${binding}.at(${address.length > 0 ? `${BigInt(address).toString()}n` : "0n"}).${method.name}(${renderedArgs});`;
    const source = [importLine, "", "function main() {", `  ${statement}`, "}", ""].join("\n");
    return { imports: [importLine], statement, source, baseDirs: CONTRACT_BASE_DIRS };
  }

  return {
    chain,
    protocol: descriptor.protocol,
    contract: descriptor.contract,
    address,
    method,
    args,
    fidelity,
    caveats,
    get data(): Hex {
      return encode();
    },
    encode,
    toCall,
    toSauceScript,
  };
}
