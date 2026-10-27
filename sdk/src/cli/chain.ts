/**
 * What the `sauce` command asks of a chain: which endpoint, that it is the chain named, the
 * Kitchen's fee, a Pot's state, a dry run, and a transaction sent and waited for — with a revert
 * reported as its decoded reason rather than as viem's error dump.
 *
 * The endpoint comes from `--rpc-url`, else from the chain's entry in a `--config` file, else from
 * the built-in public endpoints (`public-endpoints.ts`). No message here repeats it: a provider URL
 * often carries a key.
 */
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeAbiParameters,
  decodeErrorResult,
  getAddress,
  hexToBytes,
  http,
  numberToHex,
  parseAbi,
  RpcRequestError,
  TransactionReceiptNotFoundError,
  toFunctionSelector,
  zeroAddress,
  type Abi,
  type Address,
  type ContractFunctionParameters,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { getTransactionError } from "viem/utils";

import kitchenArtifact from "../artifacts/V12Kitchen.json" with { type: "json" };
import potArtifact from "../artifacts/V12Pot.json" with { type: "json" };
import routerArtifact from "../artifacts/Router.json" with { type: "json" };
import { resolveChain, type CanonicalChain } from "../chains/canonical.js";
import {
  sdkCompilerVersion,
  v12EngineAddress,
  v12KitchenAddress,
  v12ReleaseSet,
} from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { v12KitchenAbi, v12Pot } from "../evm/engine.js";
import { kitchenExecutionFee } from "../evm/execution-fee.js";
import { Permit2ABI } from "../protocols/permit2/abis.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { UsageError } from "./args.js";
import { CliError } from "./args.js";
import { guardOf } from "./policy.js";
import { keepLanded, keptPots, sayKept } from "./keep.js";
import type { PotKind, PotRecord } from "./pot-store.js";
import {
  answered,
  evmKitchenRelease,
  evmPotRelease,
  evmPotsDeployed,
  evmRelease,
  ownerPotsText,
  ownReleasePot,
  pairedSdkReleases,
  releaseText,
} from "./pots.js";

/** A transaction to send or simulate. */
export interface TxRequest {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/**
 * A transaction as it is signed: its call, the gas it may use and what it pays per gas. A program
 * reads both (its gas left, the price it pays), so a simulation that measures what the transaction
 * does runs with them, where they are set.
 */
export interface SignedCall extends TxRequest {
  readonly gas?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
  readonly gasPrice?: bigint;
}

/**
 * The endpoint for `chain`: `--rpc-url`, else the `--config` file's `rpcUrls` entry for the chain's
 * id; `undefined` when the file has none for it. `config` is the file's path and text, when one was
 * given.
 */
export function endpointFor(
  chain: CanonicalChain,
  rpcUrl: string | undefined,
  config: { readonly path: string; readonly text: string } | undefined,
): string | undefined {
  if (rpcUrl !== undefined) return rpcUrl;
  if (config === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(config.text);
  } catch {
    throw new UsageError(`--config ${config.path}: not JSON`);
  }
  const urls = (parsed as { rpcUrls?: unknown } | null)?.rpcUrls;
  if (urls === null || typeof urls !== "object" || Array.isArray(urls)) {
    throw new UsageError(
      `--config ${config.path}: expected { "rpcUrls": { "<chain id>": "<url>" } }`,
    );
  }
  const url = (urls as Record<string, unknown>)[String(chain.id)];
  if (url === undefined) return undefined;
  if (typeof url !== "string" || /^<.*>$/.test(url)) {
    throw new UsageError(
      `--config ${config.path}: rpcUrls["${chain.id}"] is not a URL; replace the placeholder`,
    );
  }

  return url;
}

/** viem's one-line reason for a failed request, never its details, which repeat the URL. */
export const reasonOf = (error: unknown): string =>
  (error as { shortMessage?: string }).shortMessage ?? "the request failed";

/**
 * Why the endpoint refused to broadcast a signed transaction: viem's reading of the node's error,
 * as `sendTransaction` gives it (a nonce too low, funds short of the cost, a fee below the base
 * fee), else the node's own words, where it answered with an error of its own (a replacement
 * underpriced, which viem has no name for), else {@link reasonOf}. The node's message is its own,
 * never the URL.
 */
export function broadcastRefusal(
  error: unknown,
  envelope: SignedCall & { readonly nonce?: number },
): string {
  if (!(error instanceof BaseError)) return reasonOf(error);
  const decoded = getTransactionError(error, { ...envelope, account: null, chain: undefined });
  // A node error viem knows: its explanation.
  if (decoded.cause !== error) return reasonOf(decoded);
  const answered = error.walk((cause) => cause instanceof RpcRequestError);

  return answered instanceof RpcRequestError && answered.details !== ""
    ? answered.details
    : reasonOf(error);
}

async function request<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CliError(`reading ${what} failed: ${reasonOf(error)}`);
  }
}

/** A client for `url`, checked to serve `chain`. */
export async function connect(url: string, chain: CanonicalChain): Promise<PublicClient> {
  const client: PublicClient = createPublicClient({ transport: http(url) });
  const chainId = await request("the chain id", () => client.getChainId());
  if (chainId !== chain.id) {
    throw new CliError(
      `the RPC endpoint serves chain ${chainId}, but ${chain.slug} is ${chain.id}`,
    );
  }

  return client;
}

/** One view call for {@link readAll}: a contract, an ABI holding the function, and its arguments. */
export interface ViewCall {
  readonly address: Address;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args?: readonly unknown[];
}

/** What one {@link ViewCall} answered: its decoded result, or why it has none. */
export type ViewResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/**
 * How many calls one {@link readAll} `eth_call` carries. A deployless call returns its answers as
 * the code of a contract it creates, which may not pass 24,576 bytes (EIP-170): about 64 of a V3
 * pool's eight-word `ticks()`. A Slipstream tick is ten words, so this leaves room.
 */
const CALLS_PER_REQUEST = 32;

/**
 * `calls` through Multicall3's `aggregate3`, sent deployless (the call carries the contract's
 * code), so nothing needs to be deployed on the chain: one `eth_call` per
 * {@link CALLS_PER_REQUEST} calls, all sent at once. A call that reverts, or reaches an address
 * with no code, fails alone; a request that fails fails the command, naming `what` it was reading.
 */
export async function readAll(
  client: PublicClient,
  what: string,
  calls: readonly ViewCall[],
): Promise<ViewResult[]> {
  const chunks = Array.from({ length: Math.ceil(calls.length / CALLS_PER_REQUEST) }, (_, index) =>
    calls.slice(index * CALLS_PER_REQUEST, (index + 1) * CALLS_PER_REQUEST),
  );
  const answered = await Promise.all(
    chunks.map(
      (chunk) =>
        request(what, () =>
          client.multicall({
            contracts: chunk as unknown as ContractFunctionParameters[],
            allowFailure: true,
            deployless: true,
            // The chunk is the batch: viem's own splits by calldata size, not by what comes back.
            batchSize: 0,
          }),
        ) as Promise<
          ReadonlyArray<
            | { readonly status: "success"; readonly result: unknown }
            | { readonly status: "failure"; readonly error: Error }
          >
        >,
    ),
  );

  return answered.flat().map((result): ViewResult => {
    if (result.status === "success") return { ok: true, value: result.result };
    // The aggregate call itself failed — the endpoint, not one of the calls in it.
    if ((result.error as { functionName?: string }).functionName === "aggregate3") {
      throw new CliError(`reading ${what} failed: ${reasonOf(result.error)}`);
    }

    return { ok: false, error: reasonOf(result.error) };
  });
}

/** Where each state-reading method takes its block, among its parameters. */
const BLOCK_PARAM: Readonly<Record<string, number>> = {
  eth_call: 1,
  eth_estimateGas: 1,
  eth_simulateV1: 1,
  eth_createAccessList: 1,
  eth_getBalance: 1,
  eth_getCode: 1,
  eth_getTransactionCount: 1,
  eth_getStorageAt: 2,
  eth_getProof: 2,
};

const MOVING = new Set(["latest", "pending", "safe", "finalized"]);

/** `params` of `method` with its block, where the request names a moving one (or none), pinned. */
export function pinnedParams(method: string, params: unknown, block: Hex): unknown {
  const at = BLOCK_PARAM[method];
  if (at === undefined || !Array.isArray(params)) return params;
  const pinned = [...(params as unknown[])];
  const given = pinned[at];
  if (given === undefined || given === null || (typeof given === "string" && MOVING.has(given))) {
    while (pinned.length < at) pinned.push(null);
    pinned[at] = block;
  }

  return pinned;
}

/** The block `--block` names: a number (decimal or 0x hex) or a tag; the latest when none. */
async function blockNumberOf(client: PublicClient, given: string | undefined): Promise<bigint> {
  if (given === undefined || given === "latest") {
    return request("the latest block", () => client.getBlockNumber({ cacheTime: 0 }));
  }
  if (/^(\d+|0x[0-9a-fA-F]+)$/.test(given)) return BigInt(given);
  if (given === "safe" || given === "finalized" || given === "earliest") {
    const block = await request(`the ${given} block`, () => client.getBlock({ blockTag: given }));

    return block.number;
  }
  throw new UsageError(
    `--block: '${given}' is not a block number or a tag (latest, safe, finalized, earliest)`,
  );
}

/**
 * The chain `url` serves, read as of one block: every state read the client sends (`eth_call`,
 * `eth_simulateV1`, balances, code, storage, gas estimates) at `block`, so a rehearsal and what it
 * reads first agree, and say which block they saw. `block` is `--block`'s text; without it, the
 * latest block when the command starts.
 */
export async function connectAt(
  url: string,
  chain: CanonicalChain,
  block: string | undefined,
): Promise<{ readonly client: PublicClient; readonly block: bigint }> {
  const free = await connect(url, chain);
  const number = await blockNumberOf(free, block);
  const tag = numberToHex(number);
  const client: PublicClient = createPublicClient({
    transport: custom({
      request: ({ method, params }: { method: string; params?: unknown }) =>
        free.request({ method, params: pinnedParams(method, params, tag) } as never),
    }),
  });

  return { client, block: number };
}

/**
 * A transaction's receipt, or `undefined` while it has none (pending, or dropped). Any other failure
 * to read it is an error, not a pending transaction.
 */
export async function receiptOf(
  client: PublicClient,
  hash: Hex,
): Promise<TransactionReceipt | undefined> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return undefined;
    throw new CliError(`reading the transaction's receipt failed: ${reasonOf(error)}`);
  }
}

/** The canonical chain `url` serves, for a command given an endpoint and no `--chain`. */
export async function chainServedBy(url: string): Promise<CanonicalChain> {
  const client: PublicClient = createPublicClient({ transport: http(url) });
  const chainId = await request("the chain id", () => client.getChainId());
  const chain = resolveChain(chainId);
  if (chain === undefined) {
    throw new CliError(
      `the RPC endpoint serves chain ${chainId}, which is not a chain Sauce knows`,
    );
  }

  return chain;
}

/** The released Kitchen's current execution fee on the connected chain. */
export async function kitchenFee(client: PublicClient, chain: CanonicalChain): Promise<bigint> {
  const fee = kitchenExecutionFee();
  const answer = await request("the Kitchen's executionFee()", () =>
    client.call({ to: fee.to, data: fee.data }),
  );
  if (answer.data === undefined || answer.data === "0x") {
    throw new CliError(
      `the Kitchen ${getAddress(fee.to)} has no code on ${chain.slug}: the released Sauce ` +
        "contracts are not deployed there",
    );
  }

  return fee.decode(answer.data);
}

/** Whether the released Sauce contracts a cook needs are on a chain, and its Kitchen's fee. */
export interface Released {
  readonly engine: { readonly address: Address; readonly deployed: boolean };
  readonly kitchen: {
    readonly address: Address;
    readonly deployed: boolean;
    /** The fee a cook pays, read where the Kitchen is there. */
    readonly executionFee?: bigint;
  };
}

/** Whether `address` has code, as the endpoint shows it; `what` names it where the read fails. */
async function hasCode(client: PublicClient, address: Address, what: string): Promise<boolean> {
  const code = await request(what, () => client.getCode({ address }));

  return code !== undefined && code !== "0x";
}

/** The released engine and Kitchen on the connected chain: whether each has code, and the fee. */
export async function releasedContracts(client: PublicClient): Promise<Released> {
  const engine = getAddress(v12EngineAddress());
  const kitchen = getAddress(v12KitchenAddress());
  const [engineThere, kitchenThere] = await Promise.all([
    hasCode(client, engine, "the engine's code"),
    hasCode(client, kitchen, "the Kitchen's code"),
  ]);
  let executionFee: bigint | undefined;
  if (kitchenThere) {
    const fee = kitchenExecutionFee(kitchen);
    const answer = await request("the Kitchen's executionFee()", () =>
      client.call({ to: fee.to, data: fee.data }),
    );
    executionFee = answer.data === undefined ? undefined : fee.decode(answer.data);
  }

  return {
    engine: { address: engine, deployed: engineThere },
    kitchen: {
      address: kitchen,
      deployed: kitchenThere,
      ...(executionFee === undefined ? {} : { executionFee }),
    },
  };
}

/** The refusal of a released contract with no code on `chain`: the release is not deployed there. */
const notDeployed = (
  name: "engine" | "Kitchen",
  address: Address,
  chain: CanonicalChain,
): CliError =>
  new CliError(
    `the released ${name} ${address} is not deployed on ${chain.slug}: this SDK's cook cannot ` +
      "run there",
  );

/** Refuses an online cook without its released engine and Kitchen, returning the Kitchen's fee. */
export async function requireCookContracts(
  client: PublicClient,
  chain: CanonicalChain,
): Promise<bigint> {
  const released = await releasedContracts(client);
  for (const [name, contract] of [
    ["engine", released.engine],
    ["Kitchen", released.kitchen],
  ] as const) {
    if (!contract.deployed) throw notDeployed(name, contract.address, chain);
  }

  return released.kitchen.executionFee ?? kitchenFee(client, chain);
}

/** What every refusal of a Pot says last. */
const NOTHING_SENT = "Nothing was simulated, built or sent.";
/** What a refusal of a deployment the chain already has says last instead: it was sent, and what
 *  comes after it is not. */
const NOTHING_AFTER = "Nothing after it was sent.";

/** Why no private Pot of the zero address can be: what every refusal of one says. */
const NO_OWNER =
  `Kitchen.deployPot reverts for the owner ${zeroAddress}: a Pot with no owner is a Shared Pot, ` +
  "which Kitchen.deploySharedPot(salt) deploys.";

/**
 * Refuses a private Pot of the zero address given as its owner (`--owner`, a tool's `owner`),
 * before anything about it is read or built: `Kitchen.deployPot` reverts for that owner, and no
 * other call puts code where this SDK has the Pot (`deploySharedPot` derives another address), so its
 * deployment, a transfer into it and a cook on it all reach no Pot. A Pot with no owner is a Shared
 * Pot. It reads no chain, so it holds offline as well; and as a value the owner cannot take, it is a
 * {@link UsageError}. A signed deployment of that Pot is refused by {@link requireKitchenPredicts}.
 */
export function requirePotOwner(owner: Address): void {
  if (getAddress(owner) === zeroAddress) throw new UsageError(`${NO_OWNER} ${NOTHING_SENT}`);
}

/** `paired` SDK releases (`pots.ts#pairedSdkReleases`) pair with a release: one, or several. */
const pairWith = (paired: string): string =>
  `@eco-incorp/sauce ${paired} ${/[ ,]/.test(paired) ? "pair" : "pairs"} with`;

/**
 * Which release the deployed Kitchen mints, as a refusal says it: the release whose Kitchen and Pot
 * init-code hash it reports (`potInitCodeHash()`), by its compiler and components and the SDK
 * releases that pinned it; for a hash no release this SDK knows records, that the Kitchen is newer
 * than this SDK and to upgrade it.
 */
async function kitchenRelease(client: PublicClient, chain: CanonicalChain): Promise<string> {
  const kitchen = getAddress(v12KitchenAddress());
  const it = `The Kitchen ${kitchen} on ${chain.slug}`;
  let hash: Hex;
  try {
    hash = await client.readContract({
      address: kitchen,
      abi: v12KitchenAbi,
      functionName: "potInitCodeHash",
    });
  } catch (error) {
    // No answer because no code: the release is not deployed on the chain at all.
    if (answered(error) && !(await hasCode(client, kitchen, "the Kitchen's code"))) {
      return `The released Kitchen ${kitchen} is not deployed on ${chain.slug}.`;
    }
    return (
      `${it} does not say which release it mints (its potInitCodeHash() ` +
      `${answered(error) ? "answers nothing" : `could not be read: ${reasonOf(error)}`}). If it ` +
      "is newer than this SDK, upgrade @eco-incorp/sauce (sauce update)."
    );
  }
  const family = evmKitchenRelease(kitchen, hash);
  if (family === undefined) {
    return (
      `${it} mints Pots under init-code hash ${hash.toLowerCase()}, which no release this SDK ` +
      "knows records: the Kitchen is newer than this SDK. Upgrade @eco-incorp/sauce (sauce update)."
    );
  }
  if (family.sets.some((set) => set.compiler === sdkCompilerVersion())) {
    return `${it} mints Pots of ${releaseText(evmRelease(v12ReleaseSet()))}, the release this SDK pins.`;
  }
  const release = evmRelease(family.sets[0]!);
  const paired = pairedSdkReleases(release);

  return paired === undefined
    ? `${it} mints Pots of ${releaseText(release)}, which no SDK release this one knows pinned.`
    : `${it} mints Pots of ${releaseText(release)}, which ${pairWith(paired)}.`;
}

/**
 * A refusal of a Pot: `headline`, which release the deployed Kitchen mints, and, for a Pot whose
 * owner and salt are known, where this SDK deploys that Pot under the release it pins and, where the
 * scope keeps the Pot store (`keep.ts#keptPots`: the command, a local MCP server; never the HTTP
 * server), the owner's other Pots there, each with its release. It ends with `closing`.
 */
async function potRefusal(
  client: PublicClient,
  chain: CanonicalChain,
  headline: string,
  of?: {
    readonly owner: Address;
    readonly salt: Hex;
    readonly kind: PotKind;
    readonly pot: Address;
  },
  closing: string = NOTHING_SENT,
): Promise<CliError> {
  const said = [headline, await kitchenRelease(client, chain)];
  const store = keptPots();
  let listed: string | undefined;
  if (of !== undefined) {
    said.push(
      `Under its release, ${releaseText(evmRelease(v12ReleaseSet()))}, this SDK deploys the ` +
        `${of.kind === "shared" ? `Shared Pot of salt ${of.salt}` : `Pot of owner ${of.owner} and salt ${of.salt}`} ` +
        `at ${ownReleasePot(of.owner, of.salt, of.kind)}.`,
    );
    if (store !== undefined && of.owner !== zeroAddress) {
      listed = ownerPotsText(store, chain, of.owner, of.pot);
    }
  }
  said.push(closing);

  return new CliError([said.join(" "), ...(listed === undefined ? [] : [listed])].join("\n"));
}

/**
 * Refuses a Pot not deployed yet that the deployed Kitchen does not put where this SDK deploys it:
 * the Kitchen's own `predictPot(owner, salt)` (`predictPot(owner, salt, true)` for a fixed-router
 * Pot, `predictSharedPot(salt)` for a Shared one) must be where this SDK has the Pot. A Kitchen
 * upgraded to other Pot code derives another address; an SDK that still predicts the old one would
 * send its cook to an address with no code, which "succeeds", runs nothing, and keeps the cook's
 * value. A private Pot of the zero address is refused first, as {@link requirePotOwner} refuses it
 * given as an owner: here it is a deployment's, a refusal of the chain's and not of the invocation.
 * A refusal ends with `closing`.
 */
export async function requireKitchenPredicts(
  client: PublicClient,
  chain: CanonicalChain,
  owner: Address,
  salt: Hex,
  kind: PotKind = "private",
  closing: string = NOTHING_SENT,
): Promise<void> {
  const kitchen = getAddress(v12KitchenAddress());
  if (kind !== "shared" && getAddress(owner) === zeroAddress) {
    throw new CliError(`${NO_OWNER} ${closing}`);
  }
  const sdk = ownReleasePot(owner, salt, kind);
  const of = { owner: getAddress(owner), salt, kind, pot: sdk } as const;
  const at = { address: kitchen, abi: v12KitchenAbi } as const;
  const predict = kind === "shared" ? "predictSharedPot" : "predictPot";
  const whose =
    kind === "shared"
      ? `the Shared Pot of salt ${salt}`
      : `the Pot of owner ${owner} and salt ${salt}`;
  let live: Address;
  try {
    live = getAddress(
      kind === "shared"
        ? await client.readContract({ ...at, functionName: "predictSharedPot", args: [salt] })
        : kind === "private-fixed-router"
          ? await client.readContract({
              ...at,
              functionName: "predictPot",
              args: [owner, salt, true],
            })
          : await client.readContract({ ...at, functionName: "predictPot", args: [owner, salt] }),
    );
  } catch (error) {
    if (!answered(error)) {
      throw new CliError(`reading the Kitchen's ${predict}() failed: ${reasonOf(error)}`);
    }
    // No answer because no code: the release is not deployed on the chain, which is no mismatch.
    if (!(await hasCode(client, kitchen, "the Kitchen's code"))) {
      throw notDeployed("Kitchen", kitchen, chain);
    }
    throw await potRefusal(
      client,
      chain,
      `the Kitchen ${kitchen} on ${chain.slug} does not answer ${predict}() for ${whose}, which ` +
        `this SDK has at ${sdk}: this SDK does not match the deployed Kitchen.`,
      of,
      closing,
    );
  }
  if (live !== sdk) {
    throw await potRefusal(
      client,
      chain,
      `the Kitchen ${kitchen} on ${chain.slug} puts ${whose} at ${live}, but this SDK has it at ` +
        `${sdk}: this SDK does not match the deployed Kitchen, and a cook it sends goes where the ` +
        "Kitchen puts no Pot.",
      of,
      closing,
    );
  }
}

/**
 * Refuses code at `pot` that is not a Pot of the release this SDK pins, told from the chain as
 * `pots.ts` tells a Pot's release: its owner, salt and Kitchen read off it, its address that
 * Kitchen's CREATE2 under a release's Pot init-code hash (`evmPotRelease`). Compiler output pairs
 * with an engine by exact version, so a Pot of another release cannot run this SDK's programs; one
 * no release this SDK knows minted is refused too. A Pot of this release is taken whatever the
 * deployed Kitchen mints now: its engine is its release's. Its code is not compared with the
 * release's: a contract at a Pot's address that answers as the Pot would needs a dishonest
 * endpoint (a fork, or an RPC that lies), and the guard trusts the endpoint as every read does.
 */
export async function requireReleasePot(
  client: PublicClient,
  chain: CanonicalChain,
  pot: Address,
): Promise<void> {
  const read = async <T>(
    functionName: "owner" | "userSalt" | "kitchen",
  ): Promise<T | undefined> => {
    try {
      return (await client.readContract({ address: pot, abi: v12Pot.abi, functionName })) as T;
    } catch (error) {
      if (answered(error)) return undefined;
      throw new CliError(`reading the Pot's ${functionName}() failed: ${reasonOf(error)}`);
    }
  };
  const [owner, salt, kitchen] = await Promise.all([
    read<Address>("owner"),
    read<Hex>("userSalt"),
    read<Address>("kitchen"),
  ]);
  if (owner === undefined || salt === undefined || kitchen === undefined) {
    throw await potRefusal(
      client,
      chain,
      `${pot} on ${chain.slug} has code, but is not a Pot: it does not answer a Pot's owner(), ` +
        "userSalt() and kitchen().",
    );
  }
  const found = evmPotRelease({ kitchen, owner, salt, pot });
  if (found?.family.sets.some((set) => set.compiler === sdkCompilerVersion())) return;
  const of = {
    owner: getAddress(owner),
    salt,
    kind: found?.kind ?? (owner === zeroAddress ? "shared" : "private"),
    pot: getAddress(pot),
  } as const;
  if (found === undefined) {
    throw await potRefusal(
      client,
      chain,
      `${pot} on ${chain.slug} has code, but no release this SDK knows minted a Pot there: it says ` +
        `it is Kitchen ${kitchen}'s, for owner ${owner} and salt ${salt}.`,
      of,
    );
  }
  const release = evmRelease(found.family.sets[0]!);
  const paired = pairedSdkReleases(release);
  throw await potRefusal(
    client,
    chain,
    `${pot} on ${chain.slug} is a Pot of ${releaseText(release)}` +
      `${paired === undefined ? "" : `, which ${pairWith(paired)}`}, as its address under Kitchen ` +
      `${kitchen} shows: this SDK compiles with compiler ${sdkCompilerVersion()}, whose programs ` +
      "that Pot's engine does not run.",
    of,
  );
}

/**
 * The Pot a cook, a Pot deployment or a signed cook names, checked against the chain before
 * anything is simulated, built or sent: code there must be a Pot of the release this SDK pins
 * ({@link requireReleasePot}); with none, the Kitchen must put the owner's Pot where this SDK
 * deploys it ({@link requireKitchenPredicts}). A Pot with no code and no owner known is the caller's
 * to refuse.
 */
export async function requirePot(
  client: PublicClient,
  chain: CanonicalChain,
  input: {
    readonly pot: Address;
    readonly deployed: boolean;
    readonly owner?: Address;
    readonly salt?: Hex;
  },
): Promise<void> {
  if (input.deployed) return requireReleasePot(client, chain, input.pot);
  if (input.owner !== undefined && input.salt !== undefined) {
    await requireKitchenPredicts(client, chain, input.owner, input.salt);
  }
}

/** A cook's selectors on a Pot: `cook` and `cookSigned`. */
const COOKS = new Set<string>(
  v12Pot.abi
    .filter(
      (item) => item.type === "function" && (item.name === "cook" || item.name === "cookSigned"),
    )
    .map((item) => toFunctionSelector(item)),
);
/** The Kitchen's deployments: `deployPot(owner, salt)`, the one every command sends, with
 *  `routerFixed`, and a Shared Pot's: each held to the Kitchen's prediction, so a cook on the Pot a
 *  plan's deployment makes is not exempt from the check. */
const DEPLOY_POT = toFunctionSelector("function deployPot(address owner, bytes32 salt)");
const DEPLOY_POT_FIXED = toFunctionSelector(
  "function deployPot(address owner, bytes32 salt, bool routerFixed)",
);
const DEPLOY_SHARED_POT = toFunctionSelector("function deploySharedPot(bytes32 salt)");

/** A transaction's selector, as the guard compares them. */
const selectorOf = (tx: TxRequest): string => tx.data.slice(0, 10).toLowerCase();

/** The refusal of a Kitchen deployment whose calldata carries nothing the guard can read it by. */
function unreadable(tx: TxRequest): string {
  const shared = selectorOf(tx) === DEPLOY_SHARED_POT;

  return (
    `Kitchen.${shared ? "deploySharedPot" : "deployPot"}'s calldata carries no ` +
    `${shared ? "salt" : "owner and salt"} it can be read from, so where it puts the Pot cannot ` +
    "be checked. Nothing was sent"
  );
}

/**
 * The Pot a call to the released Kitchen deploys, as the release this SDK pins places it, and its
 * kind, which the guard holds to the Kitchen's prediction (`deployPot(owner, salt)`, with or without
 * `routerFixed`, and `deploySharedPot(salt)`); `"unreadable"` for such a call when its calldata
 * carries no owner and salt; `undefined` for any other call.
 */
function deploymentOf(
  tx: TxRequest,
):
  | { readonly owner: Address; readonly salt: Hex; readonly pot: Address; readonly kind: PotKind }
  | "unreadable"
  | undefined {
  if (getAddress(tx.to) !== getAddress(v12KitchenAddress())) return undefined;
  const selector = selectorOf(tx);
  const args = `0x${tx.data.slice(10)}` as Hex;
  try {
    if (selector === DEPLOY_POT) {
      const [owner, salt] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }], args);

      return { owner, salt, pot: getAddress(v12PredictPot(owner, salt)), kind: "private" };
    }
    if (selector === DEPLOY_POT_FIXED) {
      const [owner, salt, fixed] = decodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
        args,
      );
      const kind = fixed ? "private-fixed-router" : "private";

      return { owner, salt, pot: ownReleasePot(owner, salt, kind), kind };
    }
    if (selector === DEPLOY_SHARED_POT) {
      const [salt] = decodeAbiParameters([{ type: "bytes32" }], args);

      return {
        owner: zeroAddress,
        salt,
        pot: ownReleasePot(zeroAddress, salt, "shared"),
        kind: "shared",
      };
    }
  } catch {
    return selector === DEPLOY_POT ||
      selector === DEPLOY_POT_FIXED ||
      selector === DEPLOY_SHARED_POT
      ? "unreadable"
      : undefined;
  }

  return undefined;
}

/** One transaction of a plan, as the guard reads it. */
export interface PlanStep {
  readonly tx: TxRequest;
  /** How a refusal names it in a plan of more than one: `transaction 2 of 3 (cook on Pot 0x…)`. */
  readonly what: string;
  /** On the chain already (`sauce send` reads it back): not held to the guard again, and a Pot it
   *  deploys is there for the steps after it — once that Pot has code; until then the deployment is
   *  held to the Kitchen's prediction as one still to send. */
  readonly sent?: boolean;
}

/** A step of a plan the guard refuses, before any step of it is sent: which, and why. */
export class PlanRefusal extends CliError {
  /** The refused step, by its index in the plan. */
  readonly step: number;
  /** Why, as a refusal of that step alone says it. */
  readonly reason: string;

  constructor(step: number, reason: string, message: string) {
    super(message);
    this.step = step;
    this.reason = reason;
  }
}

/**
 * Holds every step of a plan that reaches a Pot to the guard at once, before the first is sent, so a
 * plan never sends its first steps (an approval, a transfer into the Pot) only for a later one to be
 * refused. A cook must go to a Pot of the release this SDK pins ({@link requireReleasePot}) — never to
 * an address with no code, unless a step before it deploys the Pot there — and each of the released
 * Kitchen's deployments, `deployPot(owner, salt)` with or without `routerFixed` and
 * `deploySharedPot(salt)`, must put its Pot where this SDK predicts it
 * ({@link requireKitchenPredicts}). Every deployment is read first, before the chain is: one whose
 * calldata carries no owner and salt is refused. Steps already `sent` are not checked again, but for
 * a deployment whose Pot has no code yet (pending, or landed where this SDK has no Pot), which is held
 * as one still to send. A refusal is a {@link PlanRefusal}, its message prefixed with the step's
 * `what` in a plan of more than one. What is checked is the chain as the endpoint shows it now, so
 * each send checks its own step again ({@link requireSendable}).
 */
export async function requirePlanSendable(
  client: PublicClient,
  steps: readonly PlanStep[],
): Promise<void> {
  const deployments = steps.map((step) => deploymentOf(step.tx));
  const refuse = (index: number, reason: string): PlanRefusal => {
    const step = steps[index]!;
    const deployment = deployments[index];

    return new PlanRefusal(
      index,
      reason,
      // A deployment the chain already has is said to have landed, as it did, and where it left
      // no Pot; the refusal itself then ends with nothing after it being sent.
      step.sent === true && typeof deployment === "object" && reason.endsWith(NOTHING_AFTER)
        ? `${step.what} landed and left no Pot at ${deployment.pot}, where this SDK expects one: ` +
            reason
        : steps.length === 1
          ? reason
          : `${step.what}: ${reason}`,
    );
  };
  for (const [index, step] of steps.entries()) {
    if (!step.sent && deployments[index] === "unreadable") {
      throw refuse(index, unreadable(step.tx));
    }
  }
  const reaches = steps.some(
    (step, index) =>
      deployments[index] !== undefined || (!step.sent && COOKS.has(selectorOf(step.tx))),
  );
  if (!reaches) return;
  const chainId = await request("the chain id", () => client.getChainId());
  const chain = resolveChain(chainId);
  if (chain === undefined) {
    throw new CliError(
      `the RPC endpoint serves chain ${chainId}, which is not a chain Sauce knows`,
    );
  }
  // The Pots the plan's own deployments make, there for the cooks after them.
  const deploying = new Set<Address>();
  for (const [index, step] of steps.entries()) {
    const deployment = deployments[index];
    try {
      if (typeof deployment === "object") {
        // A deployment the chain already has is there when its Pot has code, and a cook on it is
        // checked as on any Pot; one it has not landed (pending, or landed elsewhere) is held to the
        // prediction like one still to send, since the Pot the cooks after it name is this SDK's.
        if (step.sent && (await hasCode(client, deployment.pot, "the Pot's code"))) continue;
        await requireKitchenPredicts(
          client,
          chain,
          deployment.owner,
          deployment.salt,
          deployment.kind,
          step.sent === true ? NOTHING_AFTER : NOTHING_SENT,
        );
        deploying.add(deployment.pot);
      } else if (!step.sent && COOKS.has(selectorOf(step.tx))) {
        const pot = getAddress(step.tx.to);
        if (deploying.has(pot)) continue;
        if (!(await hasCode(client, pot, "the Pot's code"))) {
          throw new CliError(
            `the cook goes to ${pot}, which has no code on ${chain.slug}: no Pot is there to run ` +
              "it, and the value it carries would stay at that address. Nothing was sent",
          );
        }
        await requireReleasePot(client, chain, pot);
      }
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      throw refuse(index, error.message);
    }
  }
}

/**
 * {@link requirePlanSendable} for one transaction, at its send: by {@link sendAndWait}, and by
 * `sauce send` for what another signer signed. A step checked with its plan is checked again here,
 * on the state it is sent on.
 */
export const requireSendable = (client: PublicClient, tx: TxRequest): Promise<void> =>
  requirePlanSendable(client, [{ tx, what: "" }]);

/** What a command says where it reads no chain, so the Pot's address is taken on trust. */
export const POT_UNCHECKED =
  "The Pot's address is NOT checked against the deployed Kitchen: no RPC endpoint was given. A " +
  "Kitchen of another release puts the Pot elsewhere, and a cook sent to an address with no code " +
  "succeeds, runs nothing and keeps its value. Pass an RPC endpoint to check.";

/** Whether `pot` is deployed, and whose it is. */
export async function potState(
  client: PublicClient,
  pot: Address,
): Promise<{ readonly deployed: boolean; readonly owner?: Address }> {
  const code = await request("the Pot's code", () => client.getCode({ address: pot }));
  if (code === undefined || code === "0x") return { deployed: false };
  const owner = await request("the Pot's owner()", () =>
    client.readContract({ address: pot, abi: v12Pot.abi, functionName: "owner" }),
  );

  return { deployed: true, owner };
}

/**
 * Waits, briefly, until the endpoint's latest block is `block` or later — so what the command
 * reads next (an allowance it just approved, a Pot it just deployed) is read from state that has
 * the transaction in it. It never fails: a node that stays behind is caught by the read that
 * depends on it (`awaitPot`), or by the rehearsal of the transaction after it.
 */
export async function caughtUp(
  client: PublicClient,
  block: bigint,
  wait: { readonly tries: number; readonly delayMs: number } = POT_WAIT,
): Promise<void> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    const latest = await client.getBlockNumber({ cacheTime: 0 }).catch(() => undefined);
    if (latest !== undefined && latest >= block) return;
    await new Promise((resolve) => setTimeout(resolve, wait.delayMs));
  }
}

/** How long {@link awaitPot} waits for a lagging endpoint, and how often it asks. */
export const POT_WAIT = { tries: 30, delayMs: 500 };

/**
 * Waits until the endpoint's latest state has `pot`'s code, after a deployment that succeeded in
 * `block`. A receipt is not proof the node answering the next request has that block: behind a
 * load balancer, the node that served the receipt and the one asked for the code can differ, so
 * an immediate `getCode` may read a Pot that is there as missing — and a cook simulated on that
 * state "succeeds" on an address without code. This asks again until it sees the code, and fails,
 * saying so, when it never does.
 */
export async function awaitPot(
  client: PublicClient,
  pot: Address,
  block: bigint,
  wait: { readonly tries: number; readonly delayMs: number } = POT_WAIT,
): Promise<void> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    // A node behind the deployment fails or answers empty: both mean "not yet".
    const code = await client.getCode({ address: pot }).catch(() => undefined);
    if (code !== undefined && code !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, wait.delayMs));
  }
  throw new CliError(
    `the Pot ${pot} was deployed in block ${block}, but the endpoint still shows no code there ` +
      `after ${(wait.tries * wait.delayMs) / 1000}s: it is behind the chain. Run the command again ` +
      "once it has caught up; the deployment is not repeated.",
  );
}

/** ERC-20's standard errors (EIP-6093), which OpenZeppelin's tokens revert with. */
const ERC20_ERRORS = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
]);

/** The errors a cook can revert with by name: the Pot's, the Kitchen's, the Pot's Router's (which
 *  `@sauce/router` swaps through), Permit2's (which `--fund` pulls through), and ERC-20's standard
 *  ones. */
const ERRORS = [
  ...potArtifact.abi,
  ...kitchenArtifact.abi,
  ...routerArtifact.abi,
  ...Permit2ABI,
  ...ERC20_ERRORS,
].filter((item) => item.type === "error") as Abi;

/**
 * What a pool's short revert string means. A Uniswap V3 pool reverts with a code of a few letters,
 * and so do its forks (PancakeSwap V3, Aerodrome Slipstream and the rest keep the strings), the
 * `TransferHelper` they pay through, and Uniswap's periphery.
 */
const POOL_REVERTS: Readonly<Record<string, string>> = {
  SPL:
    "a V3-style pool's price-limit check: the limit is on the wrong side of the pool's current " +
    "price, or at or past a bound (it must lie strictly between MIN_SQRT_RATIO and " +
    "MAX_SQRT_RATIO); `sauce price` gives the limit for a price",
  AS: "a V3-style pool's check that the amount is not zero",
  LOK: "a V3-style pool's lock: the pool is not initialized, or was re-entered mid-swap",
  IIA: "a V3-style pool's check that its swap callback paid all the input it asked for",
  TF: "a V3-style pool could not transfer the output token out",
  STF: "a token's transferFrom failed: the payer's allowance or balance is short",
  ST: "a token's transfer failed: the sender's balance is short",
  SA: "a token's approve failed",
  STE: "a native transfer failed",
  "Too little received": "the swap's output is below its minimum",
  "Too much requested": "the swap needs more input than its maximum",
  "Transaction too old": "the swap's deadline has passed",
};

/** What a V2-style pair's `<Name>: REASON` means (UniswapV2, Pancake and the other forks). */
const PAIR_REVERTS: Readonly<Record<string, string>> = {
  K: "the pair's constant-product check: it was paid too little input for the output taken (or a fee stated too low)",
  INSUFFICIENT_OUTPUT_AMOUNT: "the pair was asked for no output",
  INSUFFICIENT_INPUT_AMOUNT: "the pair received no input before the swap",
  INSUFFICIENT_LIQUIDITY: "the pair's reserves cannot pay the output asked for",
  LOCKED: "the pair was re-entered mid-swap",
  TRANSFER_FAILED: "the pair could not transfer the output token out",
};

/** What the Pot's Router's own errors mean. */
const ROUTER_REVERTS: Readonly<Record<string, string>> = {
  InputTokenMismatch: "the input token does not match the pool key and swap direction",
  InputExceedsAuthorized: "the pool asked the Router for more input than the exact input offered",
};

/** A short revert string's meaning, when it is a pool's, a pair's or a token helper's. */
export function poolRevertMeaning(message: string): string | undefined {
  // A pair's own `UniswapV2: K`; a router's `UniswapV2Router: …` is the router's, and means other things.
  const pair = /^(\w+): ([A-Z_]+)$/.exec(message);
  const fromPair = pair !== null && !/Router/.test(pair[1]!);

  return POOL_REVERTS[message] ?? (fromPair ? PAIR_REVERTS[pair[2]!] : undefined);
}

/** The revert data somewhere in viem's error chain, if the node returned any. */
function revertData(error: unknown): Hex | undefined {
  for (let at: unknown = error; at !== undefined && at !== null;) {
    const data = (at as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data) && data.length > 2) {
      return data as Hex;
    }
    if (data !== null && typeof data === "object") {
      const inner = (data as { data?: unknown }).data;
      if (typeof inner === "string" && /^0x[0-9a-fA-F]+$/.test(inner)) return inner as Hex;
    }
    at = (at as { cause?: unknown }).cause;
  }

  return undefined;
}

/** `data` as the text a program's `throw "…"` reverts with — its UTF-8 bytes, nothing else — or
 *  `undefined` when it is not printable text. */
function thrownText(data: Hex): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(data));

    return /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why a call reverted: the Pot's, Kitchen's and Permit2's errors by name (`FeeNotPaid(1234, 0)`,
 * `NotOwner()`, `InvalidNonce()`), a contract's `require` message, a panic as its code, the message a program
 * `throw`s — else the raw data, else viem's own one line.
 */
export function revertReason(error: unknown): string {
  const data = revertData(error);
  if (data === undefined) return reasonOf(error);
  try {
    const decoded = decodeErrorResult({ abi: ERRORS, data });
    const args = (decoded.args ?? []).map((arg) => String(arg));
    if (decoded.errorName === "Error") {
      const message = args[0] ?? "";
      const meaning = poolRevertMeaning(message);

      return `${JSON.stringify(message)}${meaning === undefined ? "" : ` (${meaning})`}`;
    }
    const meaning = ROUTER_REVERTS[decoded.errorName];

    return `${decoded.errorName}(${args.join(", ")})${meaning === undefined ? "" : ` (${meaning})`}`;
  } catch {
    // A program's `throw "message"` reverts with the message's bytes as they are.
    const thrown = thrownText(data);

    return thrown === undefined
      ? `revert data ${data}`
      : `the program threw ${JSON.stringify(thrown)}`;
  }
}

/**
 * A dry run of `tx` from `from`: what it returns and the gas it needs, or why it reverts. The gas it
 * needs is estimated from the call alone. Where `tx` carries the gas and fees it was signed with, the
 * call runs with them, as the signed transaction will (a program can read both); a signed gas limit
 * below the estimate is left out of the call, which would only run out of gas, so the caller can
 * refuse it naming both.
 */
export async function simulate(
  client: PublicClient,
  from: Address,
  tx: SignedCall,
): Promise<
  | { readonly ok: true; readonly returns: Hex; readonly gas: bigint }
  | { readonly ok: false; readonly reason: string }
> {
  const plain = { account: from, to: tx.to, data: tx.data, value: tx.value };
  try {
    const gas = await client.estimateGas(plain);
    const fees =
      tx.gasPrice !== undefined
        ? { gasPrice: tx.gasPrice }
        : {
            ...(tx.maxFeePerGas === undefined ? {} : { maxFeePerGas: tx.maxFeePerGas }),
            ...(tx.maxPriorityFeePerGas === undefined
              ? {}
              : { maxPriorityFeePerGas: tx.maxPriorityFeePerGas }),
          };
    const { data } = await client.call({
      ...plain,
      ...(tx.gas !== undefined && tx.gas >= gas ? { gas: tx.gas } : {}),
      ...fees,
    } as Parameters<PublicClient["call"]>[0]);

    return { ok: true, returns: data ?? "0x", gas };
  } catch (error) {
    return { ok: false, reason: revertReason(error) };
  }
}

export interface Sent {
  readonly hash: Hex;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly blockNumber: bigint;
  /** The logs it emitted, as the receipt holds them. */
  readonly logs: ReadonlyArray<{
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
  }>;
  /** When it reverted: why, replayed at its block. */
  readonly reason?: string;
  /** The receipt it landed with: what it cost, and its logs. */
  readonly receipt?: TransactionReceipt;
  /** The Pots it deployed, as `pots.ts` records them: from the Kitchen's `PotDeployed`. */
  readonly pots?: readonly PotRecord[];
}

/**
 * Signs `tx` as `account`, sends it through `url`, and waits for its receipt. A cook or a Pot's
 * deployment is first held to the deployed Kitchen (`requireSendable`): a cook goes only to a Pot
 * of this release, and a deployment only where this SDK predicts the Pot. It is simulated next, so
 * a transaction that would revert is refused with its reason and never sent. Then it is
 * made whole as it will be signed (its gas, fees, nonce and chain), and from a wallet (`--wallet`)
 * that whole transaction is held to the wallet's policy (`policy.ts`), measured with the gas and fees
 * it carries, and what it spends is reserved in the wallet's ledger. What is signed is exactly what
 * was measured: nothing of it is filled in or changed after.
 */
export async function sendAndWait(
  client: PublicClient,
  url: string,
  account: PrivateKeyAccount,
  tx: TxRequest,
): Promise<Sent> {
  await requireSendable(client, tx);
  const rehearsal = await simulate(client, account.address, tx);
  if (!rehearsal.ok) throw new CliError(`not sent — it would revert: ${rehearsal.reason}`);
  const wallet = createWalletClient({ account, transport: http(url) });
  let envelope: TxRequest & Parameters<PrivateKeyAccount["signTransaction"]>[0];
  try {
    envelope = (await wallet.prepareTransactionRequest({
      account,
      chain: null,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: (rehearsal.gas * 12n) / 10n,
    })) as typeof envelope;
  } catch (error) {
    throw new CliError(`preparing the transaction failed: ${reasonOf(error)}`);
  }
  const reservation = await guardOf(account.address)?.evm(client, envelope);
  let hash: Hex;
  try {
    hash = await wallet.sendRawTransaction({
      serializedTransaction: await account.signTransaction(envelope),
    });
  } catch (error) {
    reservation?.released("sending failed");
    throw new CliError(`sending failed: ${broadcastRefusal(error, envelope)}`);
  }
  return landed(client, hash, account.address, tx, (status) =>
    status === "success" ? reservation?.sent(hash) : reservation?.released(`${hash} reverted`),
  );
}

/**
 * Waits for the receipt of `hash`, sent from `from` as `tx`, and reads it as {@link sendAndWait}
 * reports it: what it emitted and cost, and, reverted, why — replayed at the block before it. Once
 * it succeeded, waits until the endpoint's latest state has it, reads the Pots it deployed
 * (`pots.ts`), and hands it to the stores the command keeps (`keep.ts`). `seen` is told its status
 * first.
 */
export async function landed(
  client: PublicClient,
  hash: Hex,
  from: Address,
  tx: { readonly to?: Address | undefined; readonly data: Hex; readonly value: bigint },
  seen?: (status: "success" | "reverted") => void,
): Promise<Sent> {
  const receipt = await request(`the receipt of ${hash}`, () =>
    client.waitForTransactionReceipt({ hash }),
  );
  seen?.(receipt.status);
  const sent = {
    hash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((log) => ({
      address: getAddress(log.address),
      topics: log.topics as readonly Hex[],
      data: log.data,
    })),
    receipt,
  };
  if (receipt.status === "success") {
    await caughtUp(client, receipt.blockNumber);
    // What it deployed, kept as it lands: whatever the command does next, the Pot is there. A
    // record that cannot be made never fails a transaction that landed; the scope says so.
    const pots = await evmPotsDeployed(
      client,
      { ...sent, blockHash: receipt.blockHash },
      from,
    ).catch((error: unknown) => {
      sayKept(
        `warning: ${hash} deployed a Pot, whose record could not be made: ` +
          ((error as { shortMessage?: string }).shortMessage ??
            (error instanceof Error ? error.message : String(error))),
      );

      return [];
    });
    const kept = pots.length === 0 ? sent : { ...sent, pots };
    await keepLanded({ kind: "evm", client, sent: kept, from });

    return kept;
  }
  const replay = await client
    .call({ account: from, ...tx, blockNumber: receipt.blockNumber - 1n })
    .then(
      () => "it succeeds when replayed, so the state it ran on changed",
      (error: unknown) => revertReason(error),
    );

  return { ...sent, reason: replay };
}

const BALANCE_OF = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/**
 * A reader of `holder`'s balance of a token, or of the native currency, at `blockNumber` (the
 * client's block when absent); `undefined` where it could not be read.
 */
export const balanceReader =
  (client: PublicClient, holder: Address, blockNumber?: bigint) =>
  (token: Address | "native"): Promise<bigint | undefined> =>
    (token === "native"
      ? client.getBalance({
          address: holder,
          ...(blockNumber === undefined ? {} : { blockNumber }),
        })
      : client.readContract({
          address: token,
          abi: BALANCE_OF,
          functionName: "balanceOf",
          args: [holder],
          ...(blockNumber === undefined ? {} : { blockNumber }),
        })
    ).catch(() => undefined);

/** One registered token's balance; `null` where the token could not be read on this chain. */
export interface RegisteredBalance {
  readonly symbol: string;
  readonly address: Address;
  readonly decimals: number;
  readonly balance: bigint | null;
}

/**
 * `holder`'s native balance, and its balance of every token `chain` registers by symbol but its
 * tokenized stocks: Ethereum has over a thousand, one `balanceOf` each.
 */
export async function registeredBalances(
  client: PublicClient,
  chain: CanonicalChain,
  holder: Address,
): Promise<{ readonly native: bigint; readonly tokens: readonly RegisteredBalance[] }> {
  const native = await request("the native balance", () => client.getBalance({ address: holder }));
  const tokens = await Promise.all(
    (TOKEN_REGISTRY[chain.id] ?? [])
      .filter((row) => row.stock === undefined)
      .map(async (row) => {
        const token = getAddress(row.address);
        const balance = await client
          .readContract({
            address: token,
            abi: BALANCE_OF,
            functionName: "balanceOf",
            args: [holder],
          })
          .catch(() => null);

        return { symbol: row.symbol, address: token, decimals: row.decimals, balance };
      }),
  );

  return { native, tokens };
}
