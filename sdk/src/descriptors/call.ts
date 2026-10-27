/**
 * `ContractCall` — the value a `Base.<Proto>.<Contract>.<method>(...)` leaf produces. Building one is
 * synchronous and reads nothing: the same posture as `deposit/source.ts`'s pure param-templating
 * call builders, which `toSauceScript` below deliberately mirrors.
 *
 * Its viem helpers run the call against a client the CALLER passes — the SDK embeds no endpoint and
 * reads no environment:
 *   - `read(publicClient)` — an `eth_call` through viem's `readContract`, decoded from the ABI's
 *     outputs: a view's value, or what a state-changing method would return, with nothing sent
 *     (Uniswap's QuoterV2 quotes are `nonpayable` and meant to be read this way);
 *   - `simulate(publicClient, { account })` — a state-changing method as `account`, through
 *     `simulateContract`;
 *   - `write(walletClient)` — sends a state-changing method, through `writeContract`.
 * viem's actions are loaded on the first such call, never when a call is built. Each checks first
 * that the client is on the call's chain: the address is that chain's deployment, so the same
 * calldata anywhere else calls something else, or nothing.
 *
 * The `typeFidelity: "widened"` gate lives here, not in accessors.ts: every production path (`data`,
 * `encode`, `toCall`, `toSauceScript` and the viem helpers) funnels through `assertFidelity`, so a
 * descriptor marked widened can never silently hand out calldata that will not hit the deployed
 * contract. No shipped descriptor is marked any more: the registry declares every contract's
 * deployed types, and `test/registry-abi.test.ts` pins them to the deployed code. The gate and its
 * `allowWidened` opt-out stay because they are public API.
 */
import {
  encodeFunctionData,
  type Abi,
  type AbiStateMutability,
  type Account,
  type Address,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type Hex,
  type ContractFunctionReturnType,
  type SimulateContractReturnType,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { toExactBigInt } from "../numeric.js";
import type { ContractDescriptor, DescriptorMethod } from "./types.js";

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

export interface SimulateOptions {
  /** The sender the call is simulated as. */
  readonly account: Account | Address;
  /** Native value sent with a payable method. Defaults to 0n. */
  readonly value?: bigint;
}

export interface WriteOptions {
  /** The sender. Defaults to the wallet client's own account. */
  readonly account?: Account | Address;
  /** Native value sent with a payable method. Defaults to 0n. */
  readonly value?: bigint;
}

type ReadMutability = "pure" | "view";
type WriteMutability = "nonpayable" | "payable";

/** The names of `TAbi`'s functions with one of the mutabilities `M` — `never` when it has none,
 *  where viem's `ContractFunctionName` widens to `string`. */
type NamesOf<TAbi extends Abi, M extends AbiStateMutability> = Extract<
  TAbi[number],
  { readonly type: "function"; readonly stateMutability: M }
>["name"];

/** What `read` resolves to: the method's ABI outputs, decoded by viem. */
export type ReadResult<TAbi extends Abi, TName extends string, TArgs> =
  TName extends ContractFunctionName<TAbi>
    ? TArgs extends ContractFunctionArgs<TAbi, AbiStateMutability, TName>
      ? ContractFunctionReturnType<TAbi, AbiStateMutability, TName, TArgs>
      : unknown
    : unknown;

/** What `simulate` resolves to: viem's `{ result, request }`, `result` decoded from the outputs. */
export type SimulateResult<TAbi extends Abi, TName extends string, TArgs> = TName extends NamesOf<
  TAbi,
  WriteMutability
> &
  ContractFunctionName<TAbi, WriteMutability>
  ? TArgs extends ContractFunctionArgs<TAbi, WriteMutability, TName>
    ? SimulateContractReturnType<TAbi, TName, TArgs>
    : SimulateContractReturnType
  : SimulateContractReturnType;

export interface ReadActions<TAbi extends Abi, TName extends string, TArgs> {
  /** Runs the method as an `eth_call` through `client` and decodes its outputs. Sends nothing. */
  read(client: Client): Promise<ReadResult<TAbi, TName, TArgs>>;
}

export interface WriteActions<TAbi extends Abi, TName extends string, TArgs> {
  /** Simulates a state-changing method through `client`, as `options.account`. */
  simulate(client: Client, options: SimulateOptions): Promise<SimulateResult<TAbi, TName, TArgs>>;
  /** Sends a state-changing method through a wallet `client`; resolves to the transaction hash. */
  write(client: Client, options?: WriteOptions): Promise<Hash>;
}

/** Every field of a call, whatever its method's mutability. */
export interface ContractCallBase {
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
  /** The call as SauceScript. Its `./protocols/<slug>/<Export>.json` import is one the route
   *  compiler serves, so `source` compiles with no resolver option. */
  toSauceScript(opts?: SauceScriptOptions): {
    readonly imports: readonly string[];
    readonly statement: string;
    readonly source: string;
  };
}

/**
 * A call to one registry method, typed from the method's ABI where the accessor knows it
 * (`Base.UniswapV3.QuoterV2.quoteExactInputSingle(...)`). Every call has `read`; a state-changing
 * one also has `simulate` and `write`. Untyped (`ContractCall`), it carries all three, and
 * `simulate`/`write` on a view or pure method throw.
 */
export type ContractCall<
  TAbi extends Abi = Abi,
  TName extends string = string,
  TArgs = readonly unknown[],
> = ContractCallBase &
  ReadActions<TAbi, TName, TArgs> &
  (Abi extends TAbi
    ? WriteActions<TAbi, TName, TArgs>
    : TName extends NamesOf<TAbi, ReadMutability>
      ? unknown
      : WriteActions<TAbi, TName, TArgs>);

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

/** The chain id each client reports, asked once per client that does not carry its chain. */
const reportedChainIds = new WeakMap<Client, Promise<number>>();

/** The chain id a client without a chain reports, kept per client while the lookup is in flight or has succeeded. */
function reportedChainId(client: Client, fresh: boolean): Promise<number> {
  const kept = fresh ? undefined : reportedChainIds.get(client);
  if (kept !== undefined) return kept;
  const lookup = import("viem/actions").then(({ getChainId }) => getChainId(client));
  // A lookup that fails must not be remembered as the client's answer: drop it, so the next call
  // asks again instead of failing for as long as the client lives. Only this lookup's own entry:
  // a newer one may have replaced it.
  const reported: Promise<number> = lookup.catch((error: unknown) => {
    if (reportedChainIds.get(client) === reported) reportedChainIds.delete(client);
    throw error;
  });
  reportedChainIds.set(client, reported);

  return reported;
}

/**
 * Refuses a client on another chain. A client with no `chain` is asked for its chain id, once and
 * then from memory — unless `fresh`: a wallet can switch network between calls, and viem does not
 * check a chainless client's chain when it sends, so a `write` asks again.
 */
async function assertClientChain(
  client: Client,
  chain: CanonicalChain,
  what: string,
  fresh = false,
): Promise<void> {
  const id = client.chain?.id ?? (await reportedChainId(client, fresh));
  if (id !== chain.id) {
    throw new Error(
      `${what}: the client is on chain ${id}, but this call is ${chain.slug}'s (chain ${chain.id}) — ` +
        `pass a client for ${chain.slug}`,
    );
  }
}

const isRead = (method: DescriptorMethod): boolean =>
  method.stateMutability === "view" || method.stateMutability === "pure";

export function makeContractCall(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  address: Address,
  method: DescriptorMethod,
  args: readonly unknown[],
): ContractCall {
  const fidelity = descriptor.coverage.typeFidelity;
  const caveats = descriptor.coverage.caveats;
  const label = `${descriptor.protocol}.${descriptor.contract}.${method.name}`;
  // What viem is handed, built on the first `read`/`simulate`/`write`. Only this method's ABI entry:
  // viem would otherwise pick an overload by the arguments, and the call must run exactly the
  // overload `method` names.
  const request = () => ({
    address,
    abi: [
      descriptor.abi.find(
        (item) =>
          item.type === "function" &&
          item.name === method.name &&
          item.inputs.length === method.inputs.length,
      )!,
    ] as Abi,
    functionName: method.name,
    args,
  });

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
    return { imports: [importLine], statement, source };
  }

  async function read(client: Client): Promise<unknown> {
    assertFidelity(descriptor, method, undefined);
    await assertClientChain(client, chain, `${label}.read`);
    const { readContract } = await import("viem/actions");
    return readContract(client, request() as never);
  }

  async function simulate(client: Client, options: SimulateOptions): Promise<unknown> {
    assertFidelity(descriptor, method, undefined);
    if (isRead(method)) {
      throw new Error(
        `${label}.simulate: ${method.name} is ${method.stateMutability} — use read(client)`,
      );
    }
    await assertClientChain(client, chain, `${label}.simulate`);
    const { simulateContract } = await import("viem/actions");
    return simulateContract(client, {
      ...request(),
      account: options.account,
      value: options.value,
    } as never);
  }

  async function write(client: Client, options: WriteOptions = {}): Promise<Hash> {
    assertFidelity(descriptor, method, undefined);
    if (isRead(method)) {
      throw new Error(
        `${label}.write: ${method.name} is ${method.stateMutability} — use read(client)`,
      );
    }
    const account = options.account ?? client.account;
    if (account === undefined) {
      throw new Error(`${label}.write: the client has no account — pass one, or { account }`);
    }
    await assertClientChain(client, chain, `${label}.write`, true);
    const { writeContract } = await import("viem/actions");
    return writeContract(client, {
      ...request(),
      account,
      chain: client.chain ?? null,
      value: options.value,
    } as never);
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
    read,
    simulate,
    write,
  } as ContractCall;
}
