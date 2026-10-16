/**
 * An eco-routes intent's lifecycle after it is published, as PLAIN VALUES: where it stands, and
 * every transaction that moves it on, built UNSIGNED — the fill (the approvals, then `fulfill` or
 * `fulfillAndProve` with the prover's fee in its value), the proof, the claim (`withdraw` or
 * `batchWithdraw`), the refund and the cancellation (`cancel` or `cancelAndProve`) — plus the
 * import of intents someone published, from the transaction that published them.
 *
 * The `sauce` command's `fill --send`, `prove`, `claim`, `refund`, `cancel` and `intents` are a
 * layer over these, adding the signer, the prompts and the store under `~/.sauce`; `sauce mcp`
 * calls them as they are. So nothing here signs, prompts, reads a file or the environment, or
 * keeps state: each function takes the intent (an {@link IntentRecord}, the JSON the store keeps
 * and an MCP tool passes) and an endpoint per chain ({@link Endpoints}), reads what it needs, and
 * returns JSON-serialisable values — amounts as decimal strings — with `notes` saying what a person
 * should know. A thing that cannot happen yet is `ready: false` with the reason, never an error.
 *
 * What each transaction does on chain is in `routes/portal.ts`, which builds the calldata and cites
 * the eco-routes source it follows. What this module adds is the reading: which prover proves the
 * intent, and with what fee; what the destination Portal recorded; what the source's prover has
 * proven; the vault's balances; and whether each Portal can cancel (`cancel` in the destination's
 * code) and refuses to pay a cancellation (`CancelledIntent` in the source's, without which a
 * proven cancellation would pay the reward to an address nobody controls).
 */
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  hexToBytes,
  isAddressEqual,
  parseAbi,
  toEventSelector,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain, resolveChain, type CanonicalChain } from "../chains/canonical.js";
import { v12PotAbi } from "../evm/engine.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../deployments/pot.js";
import { PortalABI } from "../protocols/eco-routes/abis.js";
import { ECO_ROUTES_ADDRESSES } from "../protocols/eco-routes/addresses.generated.js";
import { denormalizeToEvm, hashIntent, kindOf, type IntentHashes } from "../routes/encode.js";
import { toUniversalAddress } from "../routes/normalize.js";
import {
  CANCELLED_CLAIMANT,
  CANCELLED_CLAIMANT_BYTES32,
  batchWithdrawTx,
  cancelAndProveTx,
  cancelTx,
  fulfillAndProveTx,
  fulfillApprovalTxs,
  fulfillTx,
  fulfillmentCall,
  hyperlaneProverData,
  intentFromPublished,
  intentHashCall,
  intentVaultAddressCall,
  isIntentFundedCall,
  provenIntentCall,
  proverFeeCall,
  proveTx,
  refundTx,
  rewardStatusCall,
  withdrawTx,
  type PortalReadCall,
  type RewardStatus,
} from "../routes/portal.js";
import { sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import type { Intent } from "../routes/types.js";
import { CliError, UsageError } from "./args.js";
import { connect, kitchenFee, potState, type TxRequest } from "./chain.js";
import { hexQuantity } from "./handoff.js";
import { txLinks } from "./links.js";
import { kitchenAddress } from "./commands.js";
import { formatAmount, tokenInfo, type TokenInfo } from "../evm/effects.js";
import { requireSupported } from "./support.js";
import {
  planSvmFill,
  readSvmDestination,
  rehearseSvm,
  svmCancelTransaction,
  svmFinalizedSlot,
  svmProgramExists,
  svmProveTransaction,
  svmRpc,
  svmSpend,
  type SvmHyperRoute,
  type SvmRpc,
  type SvmTxJson,
} from "./lifecycle-svm.js";
import { svmHyperDispatcherPda, svmKeyOf, universalOfSvmKey } from "../svm/portal.js";
import { svmPublicKey } from "../svm/account-names.js";
import { address as svmAddress } from "@solana/kit";
import {
  ranInstructions,
  readSvmSource,
  svmClaimTransaction,
  svmHyperTrusts,
  svmPublishedIntents,
  svmRefundTransaction,
  svmSourceInstruction,
  type SvmSourceRead,
} from "./lifecycle-svm-source.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { svmVaultPda } from "../svm/portal-source.js";

// ---------------------------------------------------------------------------------------------
// The intent, as JSON
// ---------------------------------------------------------------------------------------------

/** An endpoint per chain: `{ "<chain id>": "<url>" }`. A chain with none is not read. */
export type Endpoints = Readonly<Record<string, string>>;

export interface TokenAmountJson {
  readonly token: Hex;
  readonly amount: string;
}

/** The current record schema. A reader refuses any other, by name. */
export const INTENT_SCHEMA = "sauce.intent/1";

/**
 * An intent in full, as JSON: what the store keeps in `intent.json`, an MCP tool passes, and
 * {@link intentOf} turns back into the SDK's `Intent`. Addresses are 20 bytes where the chain they
 * live on is an EVM chain, 32 otherwise; amounts and deadlines are decimal strings.
 */
export interface IntentRecord {
  readonly schema: typeof INTENT_SCHEMA;
  readonly intentHash: Hex;
  readonly routeHash: Hex;
  readonly rewardHash: Hex;
  /** Where it was published and is funded, claimed and refunded: the Portal that holds its vault. */
  readonly source: { readonly chainId: number; readonly chain: string; readonly portal: Hex };
  /** Where it is fulfilled, through the Portal the route records. */
  readonly destination: { readonly chainId: number; readonly chain: string; readonly portal: Hex };
  /** The reward's escrow on the source chain, as the source Portal derives it. */
  readonly vault?: Hex;
  readonly route: {
    readonly salt: Hex;
    readonly deadline: string;
    readonly portal: Hex;
    readonly nativeAmount: string;
    readonly tokens: readonly TokenAmountJson[];
    readonly calls: ReadonlyArray<{
      readonly target: Hex;
      readonly data: Hex;
      readonly value: string;
    }>;
  };
  readonly reward: {
    readonly deadline: string;
    readonly creator: Hex;
    readonly prover: Hex;
    readonly nativeAmount: string;
    readonly tokens: readonly TokenAmountJson[];
  };
}

/** A universal (32-byte) address as the record writes it: 20 bytes, checksummed, on an EVM chain. */
function shown(address: Hex, chain: CanonicalChain): Hex {
  return chain.kind === "evm" ? getAddress(denormalizeToEvm(address)) : address;
}

/** An EVM chain the record names, refusing one this SDK does not know. */
function chainOf(id: number | bigint, what: string): CanonicalChain {
  const chain = resolveChain(Number(id));
  if (chain === undefined)
    throw new CliError(`the intent's ${what}, chain ${id}, is not one Sauce knows`);

  return chain;
}

/** The record of `intent`, published through `sourcePortal`. */
export function intentRecord(
  intent: Intent,
  options: { readonly sourcePortal: Hex; readonly vault?: Hex },
): IntentRecord {
  const source = chainOf(intent.sourceChainId, "source");
  const destination = chainOf(intent.destination, "destination");
  const hashes = hashIntent(intent);
  const tokens = (list: Intent["route"]["tokens"], chain: CanonicalChain) =>
    list.map((entry) => ({ token: shown(entry.token, chain), amount: entry.amount.toString() }));

  return {
    schema: INTENT_SCHEMA,
    ...hashes,
    source: {
      chainId: source.id,
      chain: source.slug,
      portal: shown(toUniversalAddress(options.sourcePortal), source),
    },
    destination: {
      chainId: destination.id,
      chain: destination.slug,
      portal: shown(intent.route.portal, destination),
    },
    ...(options.vault === undefined
      ? {}
      : { vault: shown(toUniversalAddress(options.vault), source) }),
    route: {
      salt: intent.route.salt,
      deadline: intent.route.deadline.toString(),
      portal: shown(intent.route.portal, destination),
      nativeAmount: intent.route.nativeAmount.toString(),
      tokens: tokens(intent.route.tokens, destination),
      calls: intent.route.calls.map((call) => ({
        target: shown(call.target, destination),
        data: call.data,
        value: call.value.toString(),
      })),
    },
    reward: {
      deadline: intent.reward.deadline.toString(),
      creator: shown(intent.reward.creator, source),
      prover: shown(intent.reward.prover, source),
      nativeAmount: intent.reward.nativeAmount.toString(),
      tokens: tokens(intent.reward.tokens, source),
    },
  };
}

const integer = (value: unknown, what: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new CliError(`the intent's ${what} is not a decimal integer string`);
  }

  return BigInt(value);
};

/**
 * The SDK's `Intent` from its record, checked: the schema is this one, and the route and reward
 * hash to the hashes the record states — so a record edited by hand, or written by something
 * else, is refused rather than acted on.
 */
export function intentOf(record: IntentRecord): Intent {
  if ((record as { schema?: unknown }).schema !== INTENT_SCHEMA) {
    throw new CliError(
      `the intent record's schema is ${JSON.stringify((record as { schema?: unknown }).schema)}, ` +
        `not ${INTENT_SCHEMA}`,
    );
  }
  const address = (value: Hex, what: string) => {
    try {
      return toUniversalAddress(value);
    } catch {
      throw new CliError(`the intent's ${what} is not an address`);
    }
  };
  const intent: Intent = {
    sourceChainId: BigInt(record.source.chainId),
    destination: BigInt(record.destination.chainId),
    route: {
      salt: record.route.salt,
      deadline: integer(record.route.deadline, "route deadline"),
      portal: address(record.route.portal, "route portal"),
      nativeAmount: integer(record.route.nativeAmount, "route native amount"),
      tokens: record.route.tokens.map((entry) => ({
        token: address(entry.token, "route token"),
        amount: integer(entry.amount, "route token amount"),
      })),
      calls: record.route.calls.map((call) => ({
        target: address(call.target, "route call target"),
        data: call.data,
        value: integer(call.value, "route call value"),
      })),
    },
    reward: {
      deadline: integer(record.reward.deadline, "reward deadline"),
      creator: address(record.reward.creator, "creator"),
      prover: address(record.reward.prover, "prover"),
      nativeAmount: integer(record.reward.nativeAmount, "reward native amount"),
      tokens: record.reward.tokens.map((entry) => ({
        token: address(entry.token, "reward token"),
        amount: integer(entry.amount, "reward token amount"),
      })),
    },
  };
  const hashes = hashIntent(intent);
  if (hashes.intentHash !== record.intentHash.toLowerCase()) {
    throw new CliError(
      `the intent record says ${record.intentHash}, but its route and reward hash to ` +
        `${hashes.intentHash}: it was changed after it was written`,
    );
  }

  return intent;
}

/** A transaction to sign and send, as JSON: itself what a wallet's send tool takes (`handoff.ts`). */
export interface TxJson {
  readonly chainId: number;
  readonly chain: string;
  readonly to: Address;
  readonly data: Hex;
  /** Wei, a hex quantity. */
  readonly value: Hex;
  /** What it does, for a person. */
  readonly what: string;
}

const txJson = (chain: CanonicalChain, tx: TxRequest, what: string): TxJson => ({
  chainId: chain.id,
  chain: chain.slug,
  to: getAddress(tx.to),
  data: tx.data,
  value: hexQuantity(tx.value),
  what,
});

/** A transaction a plan returns: an EVM chain's, or Solana's (`transaction`, base64). */
export type AnyTxJson = TxJson | SvmTxJson;

/** A {@link TxJson} as a transaction to send. */
export const txRequest = (tx: TxJson): TxRequest => ({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
});

// ---------------------------------------------------------------------------------------------
// Reading chains
// ---------------------------------------------------------------------------------------------

/** Clients for the chains a call needs, connected once and checked to serve their chain. */
class Chains {
  private readonly clients = new Map<number, Promise<PublicClient>>();

  constructor(private readonly endpoints: Endpoints) {}

  has(chain: CanonicalChain): boolean {
    return this.endpoints[String(chain.id)] !== undefined;
  }

  /** The client for `chain`; `why` says what it is needed for, when there is no endpoint. */
  get(chain: CanonicalChain, why: string): Promise<PublicClient> {
    const url = this.endpoints[String(chain.id)];
    if (url === undefined) {
      throw new UsageError(`${why} needs ${chain.slug}'s endpoint (chain id ${chain.id})`);
    }
    let client = this.clients.get(chain.id);
    if (client === undefined) {
      client = connect(url, chain);
      this.clients.set(chain.id, client);
    }

    return client;
  }

  async maybe(chain: CanonicalChain): Promise<PublicClient | undefined> {
    return this.has(chain) ? this.get(chain, "") : undefined;
  }

  /** A Solana client for `chain` where it has an endpoint. */
  svmMaybe(chain: CanonicalChain): SvmRpc | undefined {
    return this.has(chain) ? this.svm(chain, "") : undefined;
  }

  /** A Solana client for `chain`; `why` says what it is needed for, when there is no endpoint. */
  svm(chain: CanonicalChain, why: string): SvmRpc {
    const url = this.endpoints[String(chain.id)];
    if (url === undefined) {
      throw new UsageError(`${why} needs ${chain.slug}'s endpoint (chain id ${chain.id})`);
    }

    return svmRpc(url);
  }
}

const reasonOf = (error: unknown): string =>
  (error as { shortMessage?: string }).shortMessage ?? "the call reverted";

/** `call` against `client`, decoded; reading failures become a CliError naming `what`. */
async function readCall<T>(
  client: PublicClient,
  call: PortalReadCall<T>,
  what: string,
): Promise<T> {
  let data: Hex | undefined;
  try {
    ({ data } = await client.call({ to: call.to, data: call.data }));
  } catch (error) {
    throw new CliError(`reading ${what} failed: ${reasonOf(error)}`);
  }
  if (data === undefined || data === "0x") {
    throw new CliError(
      `reading ${what} returned nothing: the contract has no code, or no such function`,
    );
  }

  return call.decode(data);
}

/** `fn` read from `client`, or `undefined` when it reverts or the contract has no such function. */
async function tryRead<T>(client: PublicClient, call: PortalReadCall<T>): Promise<T | undefined> {
  try {
    const { data } = await client.call({ to: call.to, data: call.data });
    return data === undefined || data === "0x" ? undefined : call.decode(data);
  } catch {
    return undefined;
  }
}

/** The latest block's timestamp: the clock a deadline is checked against on that chain. */
async function chainTime(client: PublicClient): Promise<bigint> {
  try {
    return (await client.getBlock({ blockTag: "latest" })).timestamp;
  } catch (error) {
    throw new CliError(`reading the latest block failed: ${reasonOf(error)}`);
  }
}

/** Whether `code` dispatches `selector`: a PUSH4 of it, outside push data. */
function dispatches(code: Hex, selector: Hex): boolean {
  return pushes(code).four.has(selector.slice(2).toLowerCase());
}

/** Whether `code` can revert with the custom error `selector`: a PUSH4 of it, or the left-aligned
 *  PUSH32 the optimizer (via-IR) emits for an error's selector. */
function carriesError(code: Hex, selector: Hex): boolean {
  const { four, left } = pushes(code);
  const bare = selector.slice(2).toLowerCase();

  return four.has(bare) || left.has(bare);
}

/** The scans of the last `PUSH_CACHE_SIZE` codes read, least recently used first (a `Map` keeps
 *  insertion order, and a hit is moved to the end), so a long-running caller such as the MCP
 *  server neither grows it without bound nor loses every entry at once. */
const pushCache = new Map<string, { four: Set<string>; left: Set<string> }>();
const PUSH_CACHE_SIZE = 64;

function pushes(code: Hex): { four: Set<string>; left: Set<string> } {
  const cached = pushCache.get(code);
  if (cached !== undefined) {
    pushCache.delete(code);
    pushCache.set(code, cached);

    return cached;
  }
  const four = new Set<string>();
  const left = new Set<string>();
  const hex = code.slice(2).toLowerCase();
  for (let i = 0; i < hex.length; i += 2) {
    const op = Number.parseInt(hex.slice(i, i + 2), 16);
    if (op === 0x63) four.add(hex.slice(i + 2, i + 10));
    if (op === 0x7f && /^0{56}$/.test(hex.slice(i + 10, i + 66)))
      left.add(hex.slice(i + 2, i + 10));
    if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2;
  }
  const found = { four, left };
  pushCache.set(code, found);
  if (pushCache.size > PUSH_CACHE_SIZE) pushCache.delete(pushCache.keys().next().value!);

  return found;
}

async function codeAt(
  client: PublicClient,
  address: Address,
  what: string,
): Promise<Hex | undefined> {
  try {
    const code = await client.getCode({ address });
    return code === undefined || code === "0x" ? undefined : code;
  } catch (error) {
    throw new CliError(`reading ${what}'s code failed: ${reasonOf(error)}`);
  }
}

const CANCEL = toFunctionSelector(getAbiItem({ abi: PortalABI, name: "cancel" }));
const CANCEL_AND_PROVE = toFunctionSelector(getAbiItem({ abi: PortalABI, name: "cancelAndProve" }));
const CANCELLED_INTENT = toFunctionSelector("CancelledIntent(bytes32)");
const COOK = toFunctionSelector(getAbiItem({ abi: v12PotAbi, name: "cook" }));

const PROVER = parseAbi([
  "function PORTAL() view returns (address)",
  "function getProofType() view returns (string)",
  "function isWhitelisted(bytes32) view returns (bool)",
]);

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

/** `fn(args)` on `address`, as a read call. */
const proverRead = <T>(
  address: Address,
  functionName: "PORTAL" | "getProofType" | "isWhitelisted",
  args: readonly unknown[] = [],
): PortalReadCall<T> => ({
  to: address,
  data: encodeFunctionData({ abi: PROVER, functionName, args } as never),
  decode: (result) =>
    decodeFunctionResult({ abi: PROVER, functionName, data: result } as never) as T,
});

// ---------------------------------------------------------------------------------------------
// The prover
// ---------------------------------------------------------------------------------------------

/** How an intent is proven from its destination back to its source. */
export interface ProverPlan {
  /** The reward's prover, on the source chain: where the proof is recorded (an EVM address, or on
   *  Solana a program id). */
  readonly sourceProver: string;
  /** The prover on the destination chain that sends the proof, when one was found: an EVM
   *  address, or on Solana a program id. */
  readonly destinationProver?: string;
  /** Its `getProofType()`: "Hyperlane", "Polymer", "LayerZero", "Metalayer", … */
  readonly kind?: string;
  /** Whether this command can prove through it; `why` says why not. */
  readonly supported: boolean;
  readonly why?: string;
  /** The bridge's id for the source chain, and the prover's message data. */
  readonly sourceDomain?: bigint;
  readonly data?: Hex;
}

/** The registry role (and generation, environment) whose address is `prover` (any width) on
 *  `source`. */
function registryRole(
  source: CanonicalChain,
  prover: Hex,
): { generation: string; environment: string; role: string } | undefined {
  const wanted = toUniversalAddress(prover).toLowerCase();
  for (const [generation, record] of Object.entries(ECO_ROUTES_ADDRESSES)) {
    const environments = (record.chains as Record<string, Record<string, Record<string, string>>>)[
      String(source.id)
    ];
    for (const [environment, roles] of Object.entries(environments ?? {})) {
      for (const [role, address] of Object.entries(roles)) {
        if (/Prover$/.test(role) && toUniversalAddress(address as Hex).toLowerCase() === wanted) {
          return { generation, environment, role };
        }
      }
    }
  }

  return undefined;
}

function registryAddress(
  chain: CanonicalChain,
  where: { generation: string; environment: string; role: string },
): Address | undefined {
  const table = (
    ECO_ROUTES_ADDRESSES as Record<
      string,
      { chains: Record<string, Record<string, Record<string, string>>> }
    >
  )[where.generation]?.chains[String(chain.id)]?.[where.environment]?.[where.role];

  return table === undefined ? undefined : getAddress(table);
}

/**
 * Which prover on the destination proves `intent`, and whether this module can drive it.
 *
 * The reward names the SOURCE chain's prover. Its counterpart on the destination is the registry's
 * address for the same role (the same generation and environment), else the same address; it must
 * answer `PORTAL()` with the destination Portal (a prover takes `prove` only from its own), and,
 * when the source is readable, the source prover must whitelist it (or the proof is refused on
 * arrival). Hyperlane is driven here — its data `abi.encode((sourceChainProver, metadata, hook))`,
 * its domain for an EVM source its chain id, as eco's solver sends (`hyper.prover.ts:40-45`).
 * Polymer's proof is fetched from Polymer's prover API and submitted to the source by a relayer,
 * and LayerZero's and Metalayer's need their own endpoint ids: refused here, saying so.
 */
export async function proverPlan(
  intent: Intent,
  destination: PublicClient,
  source?: PublicClient,
  /** The source's endpoint where it is Solana: its HyperProver's whitelist is read there. */
  svmSource?: SvmRpc,
): Promise<ProverPlan> {
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const destinationChain = requireChain(Number(intent.destination));
  // From Solana the reward names Solana's HyperProver, a program id, and only the registry knows
  // its EVM counterpart.
  const fromSolana = sourceChain.kind === "svm";
  const sourceProver = fromSolana
    ? svmKeyOf(intent.reward.prover)
    : getAddress(denormalizeToEvm(intent.reward.prover));
  const portal = getAddress(denormalizeToEvm(intent.route.portal));
  const role = registryRole(sourceChain, intent.reward.prover);
  const counterpart = role === undefined ? undefined : registryAddress(destinationChain, role);
  const candidates = [
    ...new Set(
      [counterpart, fromSolana ? undefined : (sourceProver as Address)].filter(
        (a) => a !== undefined,
      ),
    ),
  ];
  let found: { address: Address; kind?: string } | undefined;
  const refused: string[] = [];
  for (const candidate of candidates) {
    if ((await codeAt(destination, candidate, "a prover")) === undefined) {
      refused.push(`${candidate} has no code on ${destinationChain.slug}`);
      continue;
    }
    const itsPortal = await tryRead<Address>(destination, proverRead(candidate, "PORTAL"));
    if (itsPortal === undefined || !isAddressEqual(itsPortal, portal)) {
      refused.push(
        `${candidate} on ${destinationChain.slug} serves ${itsPortal ?? "no Portal"}, not the ` +
          `route's Portal ${portal}`,
      );
      continue;
    }
    const kind = await tryRead<string>(destination, proverRead(candidate, "getProofType"));
    found = { address: candidate, ...(kind === undefined ? {} : { kind }) };
    break;
  }
  const base = { sourceProver } as const;
  if (found === undefined) {
    return {
      ...base,
      supported: false,
      why:
        `no prover on ${destinationChain.slug} proves to the reward's prover ${sourceProver}` +
        (refused.length === 0 ? "" : ` (${refused.join("; ")})`),
    };
  }
  const plan = {
    ...base,
    destinationProver: found.address,
    ...(found.kind === undefined ? {} : { kind: found.kind }),
  };
  if (found.kind !== "Hyperlane") {
    const why =
      found.kind === "Polymer"
        ? "a Polymer proof is fetched from Polymer's prover API and submitted to the source " +
          "chain's prover by a relayer, which this command does not do"
        : `this command proves through Hyperlane provers, and ${found.address} is ` +
          `${found.kind === undefined ? "of no proof type it reports" : `a ${found.kind} prover`}`;

    return { ...plan, supported: false, why };
  }
  if (fromSolana && svmSource !== undefined) {
    const trusted = await svmHyperTrusts(
      svmSource,
      svmAddress(sourceProver),
      toUniversalAddress(found.address),
    );
    if (trusted === false) {
      return {
        ...plan,
        supported: false,
        why:
          `the reward's prover ${sourceProver} on ${sourceChain.slug} does not whitelist ` +
          `${found.address}, so it would refuse the proof`,
      };
    }
  }
  if (!fromSolana && source !== undefined) {
    const trusted = await tryRead<boolean>(
      source,
      proverRead(sourceProver as Address, "isWhitelisted", [toUniversalAddress(found.address)]),
    );
    if (trusted === false) {
      return {
        ...plan,
        supported: false,
        why:
          `the reward's prover ${sourceProver} on ${sourceChain.slug} does not whitelist ` +
          `${found.address}, so it would refuse the proof`,
      };
    }
  }

  return {
    ...plan,
    supported: true,
    // A Hyperlane domain is its chain's id, Solana's included (1399811149).
    sourceDomain: BigInt(sourceChain.id),
    data: hyperlaneProverData({ sourceProver: intent.reward.prover }),
  };
}

/** The registry's Solana key (32-byte hex) for `where`, as a program id. */
function registrySvmKey(
  chain: CanonicalChain,
  where: { generation: string; environment: string; role: string },
): string | undefined {
  const table = (
    ECO_ROUTES_ADDRESSES as Record<
      string,
      { chains: Record<string, Record<string, Record<string, string>>> }
    >
  )[where.generation]?.chains[String(chain.id)]?.[where.environment]?.[where.role];

  return table === undefined ? undefined : svmKeyOf(table as Hex);
}

/**
 * Which program on Solana proves `intent` to its EVM source, and whether this module can drive it:
 * the registry's Solana address for the reward prover's role. Only the HyperProver: its message
 * goes through Hyperlane's Mailbox with the gas paid to the IGP in the same transaction
 * (`svm/portal.ts`), its sender the HyperProver's dispatcher, which the source prover must
 * whitelist (checked when the source is readable).
 */
async function svmProverPlan(
  intent: Intent,
  destination: SvmRpc,
  source?: PublicClient,
): Promise<ProverPlan & { readonly hyper?: SvmHyperRoute }> {
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const destinationChain = requireChain(Number(intent.destination));
  const sourceProver = getAddress(denormalizeToEvm(intent.reward.prover));
  const role = registryRole(sourceChain, intent.reward.prover);
  const program = role === undefined ? undefined : registrySvmKey(destinationChain, role);
  const base = { sourceProver } as const;
  if (role === undefined || program === undefined) {
    return {
      ...base,
      supported: false,
      why: `the reward's prover ${sourceProver} is no registry prover with a ${destinationChain.slug} counterpart`,
    };
  }
  const kind = role.role.replace(/Prover$/, "");
  const plan = { ...base, destinationProver: program, kind: kind === "Hyper" ? "Hyperlane" : kind };
  if (role.role !== "HyperProver") {
    return {
      ...plan,
      supported: false,
      why:
        role.role === "PolymerProver"
          ? "a Polymer proof is fetched from Polymer's prover API and submitted to the source " +
            "chain's prover by a relayer, which this command does not do"
          : `this command proves from Solana through the HyperProver, and ${program} is a ${role.role}`,
    };
  }
  if (!(await svmProgramExists(destination, svmAddress(program)))) {
    return {
      ...plan,
      supported: false,
      why: `the HyperProver ${program} is not a program on Solana`,
    };
  }
  if (source !== undefined) {
    const sender = await svmHyperDispatcherPda(svmAddress(program));
    const trusted = await tryRead<boolean>(
      source,
      proverRead(sourceProver, "isWhitelisted", [universalOfSvmKey(sender)]),
    );
    if (trusted === false) {
      return {
        ...plan,
        supported: false,
        why:
          `the reward's prover ${sourceProver} on ${sourceChain.slug} does not whitelist Solana's ` +
          `HyperProver dispatcher ${sender}, so it would refuse the proof`,
      };
    }
  }

  return {
    ...plan,
    supported: true,
    sourceDomain: BigInt(sourceChain.id),
    hyper: {
      hyperProver: svmAddress(program),
      sourceChainId: intent.sourceChainId,
      sourceProver,
    },
  };
}

/** The bridge fee for proving these (intent, claimant) pairs through `plan`'s prover. */
async function proofFee(
  destination: PublicClient,
  plan: ProverPlan,
  destinationChainId: bigint,
  pairs: ReadonlyArray<{ readonly intentHash: Hex; readonly claimant: Hex }>,
): Promise<bigint> {
  return readCall(
    destination,
    proverFeeCall({
      prover: plan.destinationProver! as Address,
      sourceDomain: plan.sourceDomain!,
      destinationChainId,
      pairs,
      data: plan.data!,
    }),
    `the prover's fee (${plan.destinationProver}.fetchFee)`,
  );
}

const proverJson = (plan: ProverPlan) => ({
  sourceProver: plan.sourceProver,
  ...(plan.destinationProver === undefined ? {} : { destinationProver: plan.destinationProver }),
  ...(plan.kind === undefined ? {} : { kind: plan.kind }),
  supported: plan.supported,
  ...(plan.why === undefined ? {} : { why: plan.why }),
  ...(plan.sourceDomain === undefined ? {} : { sourceDomain: plan.sourceDomain.toString() }),
});

// ---------------------------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------------------------

/** One transaction of a fill, and what it is for. */
export interface FillStep extends TxRequest {
  readonly what: string;
  readonly kind: "deploy" | "approve" | "fulfill";
}

/** A token the route delivers: what the fill takes of it, and what the solver holds and approved. */
export interface FillToken {
  readonly token: Address;
  readonly amount: bigint;
  readonly held: bigint;
  readonly standing: bigint;
  readonly info: TokenInfo;
}

/** Everything a fill sends, in order, and what it read to decide it. */
export interface FillPlan {
  readonly chain: CanonicalChain;
  readonly hashes: IntentHashes;
  readonly portal: Address;
  readonly executor: Address;
  /** The shared intent Pot, whether the route cooks on it, and whether it is deployed. */
  readonly pot: Address;
  readonly cooks: boolean;
  readonly deployed: boolean;
  readonly solver: Address;
  readonly claimant: Hex;
  readonly tokens: readonly FillToken[];
  readonly steps: readonly FillStep[];
  /** The fill's value: the route's native amount, plus the prover's fee when it proves. */
  readonly value: bigint;
  /** Whether the fill proves in the same transaction (`fulfillAndProve`). */
  readonly proves: boolean;
  readonly prover: ProverPlan;
  readonly fee: { readonly prover: bigint; readonly kitchen: bigint };
  readonly notes: readonly string[];
}

async function read<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new CliError(`reading ${what} failed: ${reasonOf(error)}`);
  }
}

/**
 * The transactions a solver sends to fill `intent` on its destination, as `client` reads it:
 *
 *   1. `Kitchen.deployPot(executor, 0)`, when the route cooks on the destination's shared intent Pot
 *      and it is not deployed yet (any account may send it; the Pot is the Executor's either way);
 *   2. the solver's approval of the Portal for each route token, reset to zero first where a smaller
 *      allowance stands (USDT refuses to move a nonzero allowance to another);
 *   3. `Portal.fulfillAndProve` with `route.nativeAmount` plus the prover's fee as its value — or
 *      `Portal.fulfill` with the native amount alone, when `prove` is false or (left unset) when the
 *      reward's prover is not one this module drives, which `notes` then says.
 *
 * It checks what the Portal would refuse first and says so in `notes`: a Portal that hashes the
 * intent differently, a cook on an undeployed Pot that is not the shared one, a Kitchen fee the
 * route underpays.
 */
export async function planFill(
  client: PublicClient,
  intent: Intent,
  options: {
    readonly solver: Address;
    readonly claimant?: Hex;
    readonly prove?: boolean;
    readonly source?: PublicClient;
    /** The source's endpoint where it is Solana. */
    readonly svmSource?: SvmRpc;
  },
): Promise<FillPlan> {
  const chain = requireChain(Number(intent.destination));
  if (chain.kind !== "evm") {
    throw new CliError(
      `the intent to ${chain.slug} is fulfilled through Solana's Portal program, which this does ` +
        "not drive: it fills an EVM destination's Portal",
    );
  }
  const portal = getAddress(denormalizeToEvm(intent.route.portal));
  if ((await codeAt(client, portal, "the Portal")) === undefined) {
    throw new CliError(`the Portal the route records, ${portal}, has no code on ${chain.slug}`);
  }
  const executor = await read("the Portal's executor()", () =>
    client.readContract({ address: portal, abi: PortalABI, functionName: "executor" }),
  );
  const notes: string[] = [];
  const hashes = hashIntent(intent);
  if (kindOf(Number(intent.sourceChainId)) === "evm") {
    const check = intentHashCall(intent, { portal });
    const answer = await read("the Portal's getIntentHash", () =>
      client.call({ to: check.to, data: check.data }),
    );
    if (answer.data !== undefined && check.decode(answer.data).intentHash !== hashes.intentHash) {
      notes.push(
        `the Portal on ${chain.slug} hashes this intent to ${check.decode(answer.data).intentHash}, ` +
          `not ${hashes.intentHash}: its fulfill refuses the route as InvalidHash`,
      );
    }
  }

  // The shared intent Pot: the one a route cooks on unless it names another.
  const pot = getAddress(v12PredictPot(executor, SAUCE_INTENT_POT_SALT) as Address);
  const cookTargets = intent.route.calls
    .filter((call) => call.data.startsWith(COOK))
    .map((call) => getAddress(denormalizeToEvm(call.target)));
  const cooks = cookTargets.includes(pot);
  const { deployed } = await potState(client, pot);
  for (const other of new Set(cookTargets.filter((target) => target !== pot))) {
    if (!(await potState(client, other)).deployed) {
      notes.push(
        `the route cooks on Pot ${other}, which is not deployed on ${chain.slug} and is not the ` +
          "shared intent Pot, so the fill cannot deploy it: deploy it first",
      );
    }
  }
  if (cooks && !deployed) {
    notes.push(
      `warning: the shared intent Pot ${pot} is not deployed on ${chain.slug}. The fill ` +
        "deploys it first, as the first solver to fill an intent there must. Any account may " +
        `deploy it: \`sauce pot --owner ${executor} --chain ${chain.slug}\` prints the ` +
        "transaction, and with --deploy and a signer sends it.",
    );
  }
  let kitchen = 0n;
  if (cookTargets.length > 0) {
    const fee = await kitchenFee(client, chain);
    intent.route.calls.forEach((call, index) => {
      if (!call.data.startsWith(COOK)) return;
      kitchen += call.value;
      if (call.value < fee) {
        notes.push(
          `route call ${index + 1} pays the Kitchen ${call.value} wei, and ${chain.slug}'s ` +
            `Kitchen charges ${fee}: its cook reverts with FeeNotPaid. Build the intent with ` +
            `--intent-execution-fee ${fee}.`,
        );
      }
    });
  }

  const solver = getAddress(options.solver);
  const sourceChain = requireChain(Number(intent.sourceChainId));
  if (
    sourceChain.kind === "svm" &&
    (options.claimant === undefined ||
      hexToBytes(options.claimant).length !== 32 ||
      options.claimant.toLowerCase() === CANCELLED_CLAIMANT_BYTES32)
  ) {
    // An EVM address, padded, would be recorded as a Solana key no one holds: the reward lost.
    throw new UsageError(
      `a fill of an intent ${sourceChain.slug} published needs the claimant, the ${sourceChain.slug} ` +
        "key its reward pays (--claimant <key>): an EVM address is not one",
    );
  }
  const claimant = (options.claimant ?? solver) as Hex;
  const steps: FillStep[] = [];
  if (cooks && !deployed) {
    const kitchenAt = kitchenAddress();
    steps.push({
      kind: "deploy",
      what: `Kitchen.deployPot(${executor}, ${SAUCE_INTENT_POT_SALT})`,
      to: kitchenAt,
      data: sauceEvmDeployPotCall({
        kitchen: kitchenAt,
        owner: executor,
        salt: SAUCE_INTENT_POT_SALT,
      }).data,
      value: 0n,
    });
  }
  // Every route token at once: its name, what the solver holds and has approved.
  const tokens = await Promise.all(
    fulfillApprovalTxs(intent).map(async (approval) => {
      const token = getAddress(approval.to);
      const amount = intent.route.tokens
        .filter((entry) => getAddress(denormalizeToEvm(entry.token)) === token)
        .reduce((sum, entry) => sum + entry.amount, 0n);
      const [info, held, standing] = await Promise.all([
        tokenInfo(client, chain, token),
        read(`the solver's ${token} balance`, () =>
          client.readContract({
            address: token,
            abi: ERC20,
            functionName: "balanceOf",
            args: [solver],
          }),
        ),
        read(`the solver's ${token} allowance to the Portal`, () =>
          client.readContract({
            address: token,
            abi: ERC20,
            functionName: "allowance",
            args: [solver, portal],
          }),
        ),
      ]);

      return { approval, token, amount, held, standing, info };
    }),
  );
  // The approvals are planned from the allowance read now. Another transaction of the solver's
  // that moves it before these land (a concurrent fill of a USDT-like token) can make the approve
  // revert: the CLI re-plans after a person approves, and rehearses each transaction just before
  // sending it, so such a race is refused unsent rather than reverting on chain.
  for (const { approval, token, amount, standing, info } of tokens) {
    if (standing >= amount) continue;
    const symbol = info.symbol ?? token;
    const amountText = formatAmount({ tokens: new Map([[token, info]]) }, token, amount);
    if (standing > 0n) {
      steps.push({
        kind: "approve",
        what: `reset the solver's ${symbol} allowance to the Portal`,
        to: token,
        data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [portal, 0n] }),
        value: 0n,
      });
    }
    steps.push({
      kind: "approve",
      what: `approve the Portal for ${amountText}`,
      ...approval,
      to: token,
    });
  }

  const prover = await proverPlan(intent, client, options.source, options.svmSource);
  if (options.prove === true && !prover.supported) {
    throw new CliError(`the fill cannot prove itself: ${prover.why}`);
  }
  const proves = options.prove !== false && prover.supported;
  if (options.prove === undefined && !prover.supported) {
    notes.push(`the fill does not prove itself, so prove it separately once filled: ${prover.why}`);
  }
  const fee = proves
    ? await proofFee(client, prover, intent.destination, [
        { intentHash: hashes.intentHash, claimant },
      ])
    : 0n;
  const fill = proves
    ? fulfillAndProveTx(intent, {
        claimant,
        prover: prover.destinationProver! as Address,
        sourceDomain: prover.sourceDomain!,
        data: prover.data!,
        fee,
      })
    : fulfillTx(intent, { claimant });
  const native =
    `the route's nativeAmount` + (cookTargets.length > 0 ? ", the Kitchen's fee for its cook" : "");
  steps.push({
    kind: "fulfill",
    what: proves
      ? `Portal.fulfillAndProve(${hashes.intentHash}, route, ${hashes.rewardHash}, ${claimant}, ` +
        `${prover.destinationProver}, ${prover.sourceDomain}, data) with ${fill.value} wei: ` +
        `${intent.route.nativeAmount} for ${native}, and ${fee} for the ${prover.kind} proof`
      : `Portal.fulfill(${hashes.intentHash}, route, ${hashes.rewardHash}, ${claimant}) with ` +
        `${fill.value} wei: ${native}`,
    to: getAddress(fill.to),
    data: fill.data,
    value: fill.value,
  });

  return {
    chain,
    hashes,
    portal,
    executor,
    pot,
    cooks,
    deployed,
    solver,
    claimant,
    tokens: tokens.map(({ token, amount, held, standing, info }) => ({
      token,
      amount,
      held,
      standing,
      info,
    })),
    steps,
    value: fill.value,
    proves,
    prover,
    fee: { prover: fee, kitchen },
    notes,
  };
}

/** The source chain's reader, for a check made there: an EVM client, or Solana's. */
async function sourceReaders(
  chains: Chains,
  source: CanonicalChain,
): Promise<{ readonly source?: PublicClient; readonly svmSource?: SvmRpc }> {
  if (!chains.has(source)) return {};

  return source.kind === "svm"
    ? { svmSource: chains.svm(source, "") }
    : { source: await chains.get(source, "") };
}

/** {@link planFill} for an MCP tool: the unsigned transactions, in order, as JSON. */
export async function buildFill(
  record: IntentRecord,
  endpoints: Endpoints,
  options: {
    /** The solver: an EVM address, or for a Solana destination its Solana key. */
    readonly from: string;
    readonly claimant?: Hex;
    readonly prove?: boolean;
    /** A Solana fill too large for one transaction: the lookup table that holds its accounts
     *  already (the one the first build's setup made). */
    readonly lookupTable?: string;
  },
): Promise<{
  readonly from: string;
  readonly transactions: readonly AnyTxJson[];
  /** A Solana fill that takes its accounts through a lookup table: the table, and how many of
   *  `transactions` (the first) create and extend it. */
  readonly lookupTable?: { readonly address: string; readonly setup: number };
  readonly proves: boolean;
  readonly fee: { readonly prover: string; readonly kitchen: string };
  readonly prover: ReturnType<typeof proverJson>;
  readonly delivers: ReadonlyArray<{
    readonly token: string;
    readonly symbol?: string;
    readonly amount: string;
    readonly held: string;
  }>;
  readonly notes: readonly string[];
}> {
  const intent = intentOf(record);
  const chains = new Chains(endpoints);
  const destination = requireChain(Number(intent.destination));
  requireSupported("building a fill", [destination]);
  if (destination.kind === "svm") return buildSvmFill(intent, chains, options);
  const client = await chains.get(destination, "a fill");
  const plan = await planFill(client, intent, {
    solver: getAddress(options.from),
    ...(options.claimant === undefined ? {} : { claimant: options.claimant }),
    ...(options.prove === undefined ? {} : { prove: options.prove }),
    ...(await sourceReaders(chains, requireChain(Number(intent.sourceChainId)))),
  });
  const notes = [...plan.notes];
  for (const token of plan.tokens) {
    if (token.held < token.amount) {
      notes.push(
        `${plan.solver} holds ${formatAmount({ tokens: new Map([[token.token, token.info]]) }, token.token, token.held)}, ` +
          `and the fill delivers ${formatAmount({ tokens: new Map([[token.token, token.info]]) }, token.token, token.amount)}: the fulfill reverts until it holds enough`,
      );
    }
  }

  return {
    from: plan.solver,
    transactions: plan.steps.map((step) => txJson(plan.chain, step, step.what)),
    proves: plan.proves,
    fee: { prover: plan.fee.prover.toString(), kitchen: plan.fee.kitchen.toString() },
    prover: proverJson(plan.prover),
    delivers: plan.tokens.map((token) => ({
      token: token.token,
      ...(token.info.symbol === undefined ? {} : { symbol: token.info.symbol }),
      amount: token.amount.toString(),
      held: token.held.toString(),
    })),
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Where it stands
// ---------------------------------------------------------------------------------------------

/** Whether a step can be taken now: `why` when not, and `at` (unix seconds) when it will be. */
export interface Ability {
  readonly ok: boolean;
  readonly why: string;
  readonly at?: string;
}

export type IntentState =
  | "unfunded"
  | "funded"
  | "filled"
  | "cancelled"
  | "proven"
  | "cancelProven"
  | "claimed"
  | "refunded";

/** An intent's state, read from both chains where an endpoint was given. */
export interface IntentStatus {
  readonly intentHash: Hex;
  readonly state: IntentState;
  readonly source?: {
    readonly chain: string;
    /** An EVM address, or on Solana a program id (and the vault a key). */
    readonly portal: string;
    readonly vault: string;
    readonly rewardStatus: RewardStatus;
    readonly funded: boolean;
    /** What the vault holds of each reward token, and what the reward names. */
    readonly vaultHolds: ReadonlyArray<{
      readonly token: string | "native";
      readonly symbol?: string;
      readonly decimals?: number;
      readonly holds: string;
      readonly reward: string;
    }>;
    readonly proof: { readonly claimant: string; readonly destination: string } | null;
    /** Whether the source Portal's `withdraw` refuses a proven cancellation (`CancelledIntent`). */
    readonly refusesCancelledClaimant: boolean;
    readonly time: string;
  };
  readonly destination?: {
    readonly chain: string;
    /** An EVM address, or Solana's program id. */
    readonly portal: string;
    /** What `claimants[intentHash]` holds: the claimant, `null` while unfilled. */
    readonly claimant: Hex | null;
    readonly cancelled: boolean;
    /** Whether the destination Portal has `cancel` (2.12+). */
    readonly canCancel: boolean;
    readonly time: string;
  };
  readonly deadlines: {
    /** The last second a solver may fill; cancel is allowed strictly after it. */
    readonly route: string;
    /** From when an unproven intent's reward may be refunded. */
    readonly reward: string;
  };
  readonly prover?: ReturnType<typeof proverJson>;
  readonly can: {
    readonly fill: Ability;
    readonly prove: Ability;
    readonly claim: Ability;
    readonly refund: Ability;
    readonly cancel: Ability;
  };
  readonly notes: readonly string[];
}

const iso = (seconds: bigint): string => new Date(Number(seconds) * 1000).toISOString();

const yes = (why: string, at?: bigint): Ability => ({
  ok: true,
  why,
  ...(at === undefined ? {} : { at: at.toString() }),
});
const no = (why: string, at?: bigint): Ability => ({
  ok: false,
  why,
  ...(at === undefined ? {} : { at: at.toString() }),
});

interface SourceRead {
  readonly client: PublicClient;
  readonly portal: Address;
  readonly vault: Address;
  readonly status: RewardStatus;
  readonly funded: boolean;
  readonly holds: Array<{
    token: Address | "native";
    info?: TokenInfo;
    holds: bigint;
    reward: bigint;
  }>;
  readonly proof: { claimant: Address; destination: bigint } | null;
  readonly refusesCancelledClaimant: boolean;
  readonly time: bigint;
}

/** What a status reads of the source, an EVM chain's or Solana's: addresses as each chain
 *  writes them, and the proof with whether it is a cancellation's. */
interface SourceView {
  readonly portal: string;
  readonly vault: string;
  readonly status: RewardStatus;
  readonly funded: boolean;
  readonly holds: ReadonlyArray<{
    readonly token: string | "native";
    readonly symbol?: string;
    readonly decimals?: number;
    readonly holds: bigint;
    readonly reward: bigint;
  }>;
  readonly proof: {
    readonly claimant: string;
    readonly destination: bigint;
    readonly cancelled: boolean;
  } | null;
  readonly refusesCancelledClaimant: boolean;
  readonly time: bigint;
}

const viewOfEvm = (read: SourceRead): SourceView => ({
  portal: read.portal,
  vault: read.vault,
  status: read.status,
  funded: read.funded,
  holds: read.holds.map((entry) => ({
    token: entry.token,
    ...(entry.info?.symbol === undefined ? {} : { symbol: entry.info.symbol }),
    ...(entry.token === "native"
      ? { decimals: 18 }
      : entry.info?.decimals === undefined
        ? {}
        : { decimals: entry.info.decimals }),
    holds: entry.holds,
    reward: entry.reward,
  })),
  proof:
    read.proof === null
      ? null
      : { ...read.proof, cancelled: isAddressEqual(read.proof.claimant, CANCELLED_CLAIMANT) },
  refusesCancelledClaimant: read.refusesCancelledClaimant,
  time: read.time,
});

const viewOfSvm = (read: SvmSourceRead): SourceView => ({
  portal: read.portal,
  vault: read.vault,
  status: read.status,
  funded: read.funded,
  holds: read.holds,
  proof: read.proof,
  refusesCancelledClaimant: read.refusesCancelledClaimant,
  time: read.time,
});

async function readSource(
  client: PublicClient,
  intent: Intent,
  portal: Address,
): Promise<SourceRead> {
  const chain = requireChain(Number(intent.sourceChainId));
  const code = await codeAt(client, portal, "the source Portal");
  if (code === undefined) {
    throw new CliError(`the source Portal ${portal} has no code on ${chain.slug}`);
  }
  const target = { portal };
  const [vault, status, time] = await Promise.all([
    readCall(client, intentVaultAddressCall(intent, target), "the intent's vault"),
    readCall(client, rewardStatusCall(intent, target), "the reward's status"),
    chainTime(client),
  ]);
  const vaultAddress = getAddress(vault);
  const holds = await Promise.all([
    ...(intent.reward.nativeAmount > 0n
      ? [
          read("the vault's balance", () => client.getBalance({ address: vaultAddress })).then(
            (holds) => ({
              token: "native" as const,
              holds,
              reward: intent.reward.nativeAmount,
            }),
          ),
        ]
      : []),
    ...intent.reward.tokens.map(async (entry) => {
      const token = getAddress(denormalizeToEvm(entry.token));
      const [info, holds] = await Promise.all([
        tokenInfo(client, chain, token),
        read(`the vault's ${token} balance`, () =>
          client.readContract({
            address: token,
            abi: ERC20,
            functionName: "balanceOf",
            args: [vaultAddress],
          }),
        ),
      ]);

      return { token, info, holds, reward: entry.amount };
    }),
  ]);
  // Funded two ways: `publishAndFund` (or `fund`) records the status Funded, and a transfer into
  // the vault leaves it Initial with the vault holding the reward, which the Portal's own
  // `isIntentFunded` (what solvers check) counts as funded. Asked of the Portal where it answers;
  // else the vault's balances against the reward.
  const funded =
    status === "Funded" ||
    (status === "Initial" &&
      ((await tryRead(client, isIntentFundedCall(intent, target))) ??
        holds.every((entry) => entry.holds >= entry.reward)));
  // A prover with no code holds no proof: the Portal itself treats it so (`_validateRefund`).
  const prover = getAddress(denormalizeToEvm(intent.reward.prover));
  const proverCode = await codeAt(client, prover, "the reward's prover");
  const proof =
    proverCode === undefined
      ? null
      : await readCall(client, provenIntentCall(intent), "the prover's provenIntents");

  return {
    client,
    portal,
    vault: vaultAddress,
    status,
    funded,
    holds,
    proof: proof === null || proof.claimant === zeroAddress ? null : proof,
    // Necessary, not sufficient: code that can revert `CancelledIntent` is eco-routes 2.12's
    // `withdraw`, which refuses a cancellation's sentinel claimant, and a Portal predating 2.12
    // cannot revert it at all. A different contract carrying the selector would pass; the Portal
    // here is the one the intent itself names, whose source this does not re-verify.
    refusesCancelledClaimant: carriesError(code, CANCELLED_INTENT),
    time,
  };
}

interface DestinationRead {
  /** The Portal: an EVM address, or Solana's program id. */
  readonly portal: string;
  readonly claimant: Hex | null;
  readonly canCancel: boolean;
  readonly time: bigint;
}

async function readDestination(client: PublicClient, intent: Intent): Promise<DestinationRead> {
  const chain = requireChain(Number(intent.destination));
  const portal = getAddress(denormalizeToEvm(intent.route.portal));
  const code = await codeAt(client, portal, "the destination Portal");
  if (code === undefined) {
    throw new CliError(`the Portal the route records, ${portal}, has no code on ${chain.slug}`);
  }
  const [recorded, time] = await Promise.all([
    readCall(client, fulfillmentCall(intent), "what the destination Portal recorded"),
    chainTime(client),
  ]);

  return {
    portal,
    claimant: /^0x0{64}$/.test(recorded) ? null : recorded,
    canCancel: dispatches(code, CANCEL) && dispatches(code, CANCEL_AND_PROVE),
    time,
  };
}

const isCancelled = (claimant: Hex | null): boolean =>
  claimant !== null && claimant.toLowerCase() === CANCELLED_CLAIMANT_BYTES32;

/**
 * Where `record` stands, read from its source chain (the reward's status, the vault, the prover's
 * proof) and its destination (what the Portal recorded) — each only where `endpoints` has the
 * chain — with what can be done next and why not. The state is the furthest one read: refunded or
 * claimed, then a proof (of a fill, or of a cancellation), then the destination's record (filled,
 * cancelled), then the funding.
 */
export async function intentStatus(
  record: IntentRecord,
  endpoints: Endpoints,
): Promise<IntentStatus> {
  const intent = intentOf(record);
  const chains = new Chains(endpoints);
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const destinationChain = requireChain(Number(intent.destination));
  const notes: string[] = [];
  const onSolana = destinationChain.kind === "svm";
  const fromSolana = sourceChain.kind === "svm";
  if (onSolana && fromSolana) {
    throw new CliError("an intent from Solana to Solana is not one this reads");
  }
  const sourceClient = fromSolana ? undefined : await chains.maybe(sourceChain);
  const sourceRpc = fromSolana ? chains.svmMaybe(sourceChain) : undefined;
  const destinationRpc = onSolana ? chains.svmMaybe(destinationChain) : undefined;
  const destinationClient = onSolana ? undefined : await chains.maybe(destinationChain);
  if (sourceClient === undefined && sourceRpc === undefined) {
    notes.push(
      `no ${sourceChain.slug} endpoint: the funding, the proof and the claim are not read`,
    );
  }
  if (destinationClient === undefined && destinationRpc === undefined) {
    notes.push(`no ${destinationChain.slug} endpoint: the fill and the cancellation are not read`);
  }
  const [source, destination] = await Promise.all([
    sourceRpc !== undefined
      ? readSvmSource(sourceRpc, intent, svmKeyOf(record.source.portal)).then(viewOfSvm)
      : sourceClient === undefined
        ? undefined
        : readSource(sourceClient, intent, getAddress(record.source.portal)).then(viewOfEvm),
    destinationRpc !== undefined
      ? readSvmDestination(destinationRpc, intent)
      : destinationClient === undefined
        ? undefined
        : readDestination(destinationClient, intent),
  ]);
  const prover =
    destinationRpc !== undefined
      ? await svmProverPlan(intent, destinationRpc, sourceClient)
      : destinationClient === undefined
        ? undefined
        : await proverPlan(intent, destinationClient, sourceClient, sourceRpc);
  const routeDeadline = intent.route.deadline;
  const rewardDeadline = intent.reward.deadline;
  const proof = source?.proof ?? null;
  const proofHere = proof !== null && proof.destination === intent.destination;
  const cancelProven = proofHere && proof.cancelled;
  const recorded = destination?.claimant ?? null;

  const state: IntentState =
    source?.status === "Refunded"
      ? "refunded"
      : source?.status === "Withdrawn"
        ? "claimed"
        : cancelProven
          ? "cancelProven"
          : proofHere
            ? "proven"
            : isCancelled(recorded)
              ? "cancelled"
              : recorded !== null
                ? "filled"
                : source?.funded === true
                  ? "funded"
                  : "unfunded";
  if (proof !== null && !proofHere) {
    notes.push(
      `the reward's prover records a proof of this intent from chain ${proof.destination}, not ` +
        `${destinationChain.slug}: a claim challenges (deletes) it rather than paying`,
    );
  }

  const fill: Ability =
    destination === undefined
      ? no(`needs ${destinationChain.slug}'s endpoint`)
      : recorded !== null
        ? no(isCancelled(recorded) ? "it was cancelled" : `it was filled, for claimant ${recorded}`)
        : destination.time > routeDeadline
          ? no(`the route's deadline, ${iso(routeDeadline)}, has passed`)
          : source !== undefined && !source.funded
            ? no("the reward is not funded: a solver would fill it for nothing")
            : yes(`until ${iso(routeDeadline)}`, routeDeadline);
  const prove: Ability =
    destination === undefined
      ? no(`needs ${destinationChain.slug}'s endpoint`)
      : recorded === null
        ? no("it is neither filled nor cancelled on the destination yet")
        : proofHere
          ? no("the source has the proof already")
          : prover !== undefined && !prover.supported
            ? no(prover.why!)
            : yes(isCancelled(recorded) ? "prove the cancellation" : "prove the fill");
  const claim: Ability =
    source === undefined
      ? no(`needs ${sourceChain.slug}'s endpoint`)
      : source.status === "Withdrawn"
        ? no("the reward was claimed")
        : source.status === "Refunded"
          ? no("the reward was refunded")
          : cancelProven
            ? no("a proven cancellation pays no claimant: refund it")
            : !proofHere
              ? no(
                  recorded !== null && !isCancelled(recorded)
                    ? "filled, but the source's prover has no proof yet"
                    : "the source's prover has no proof of a fill",
                )
              : yes(`pays ${proof.claimant}`);
  const refund: Ability =
    source === undefined
      ? no(`needs ${sourceChain.slug}'s endpoint`)
      : source.status === "Refunded" && source.holds.every((entry) => entry.holds === 0n)
        ? no("the reward was refunded")
        : // Claimed: its leftovers are refundable at once. Read before the proof, which Solana's
          // Portal closes as it pays.
          source.status === "Withdrawn"
          ? source.holds.some((entry) => entry.holds > 0n)
            ? yes("claimed: the vault's leftovers go back to the creator")
            : no("claimed: the vault holds nothing to refund")
          : cancelProven
            ? yes("the cancellation is proven: refundable now")
            : proofHere
              ? no("proven: the reward is the claimant's")
              : source.time < rewardDeadline
                ? no(`not before the reward's deadline, ${iso(rewardDeadline)}`, rewardDeadline)
                : yes(`the reward's deadline, ${iso(rewardDeadline)}, has passed`);
  const cancel: Ability =
    destination === undefined
      ? no(`needs ${destinationChain.slug}'s endpoint`)
      : !destination.canCancel
        ? no(
            `the destination Portal ${destination.portal} has no cancel (it predates eco-routes ` +
              `2.12): refund after the reward's deadline, ${iso(rewardDeadline)}`,
          )
        : source === undefined
          ? no(
              `needs ${sourceChain.slug}'s endpoint, to check its Portal refuses to pay a cancellation`,
            )
          : !source.refusesCancelledClaimant
            ? no(
                `the source Portal ${source.portal} would pay a proven cancellation to an address ` +
                  `nobody controls (it predates eco-routes 2.12): refund after ${iso(rewardDeadline)}`,
              )
            : isCancelled(recorded)
              ? no("it is cancelled already: prove the cancellation")
              : recorded !== null
                ? no("it was filled")
                : destination.time <= routeDeadline
                  ? no(
                      `not before the route's deadline, ${iso(routeDeadline)}, has passed`,
                      routeDeadline + 1n,
                    )
                  : yes(`the route's deadline, ${iso(routeDeadline)}, has passed`);

  return {
    intentHash: record.intentHash,
    state,
    ...(source === undefined
      ? {}
      : {
          source: {
            chain: sourceChain.slug,
            portal: source.portal,
            vault: source.vault,
            rewardStatus: source.status,
            funded: source.funded,
            vaultHolds: source.holds.map((entry) => ({
              token: entry.token,
              ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
              ...(entry.decimals === undefined ? {} : { decimals: entry.decimals }),
              holds: entry.holds.toString(),
              reward: entry.reward.toString(),
            })),
            proof:
              proof === null
                ? null
                : { claimant: proof.claimant, destination: proof.destination.toString() },
            refusesCancelledClaimant: source.refusesCancelledClaimant,
            time: source.time.toString(),
          },
        }),
    ...(destination === undefined
      ? {}
      : {
          destination: {
            chain: destinationChain.slug,
            portal: destination.portal,
            claimant: recorded,
            cancelled: isCancelled(recorded),
            canCancel: destination.canCancel,
            time: destination.time.toString(),
          },
        }),
    deadlines: { route: routeDeadline.toString(), reward: rewardDeadline.toString() },
    ...(prover === undefined ? {} : { prover: proverJson(prover) }),
    can: { fill, prove, claim, refund, cancel },
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// After the fill
// ---------------------------------------------------------------------------------------------

/** A plan to send, or why there is nothing to send yet. */
export interface Plan {
  readonly ready: boolean;
  readonly why?: string;
  /** In order: EVM transactions (`TxJson`), or Solana's (`SvmTxJson`) for a Solana step. */
  readonly transactions: readonly AnyTxJson[];
  readonly notes: readonly string[];
}

/** What a claim or a refund moves out of the vault. */
export interface VaultMove {
  /** A token's address (on Solana its mint), or the chain's native coin. */
  readonly token: string | "native";
  readonly symbol?: string;
  readonly decimals?: number;
  readonly amount: string;
  /** Who is paid: an EVM address, or a Solana key. */
  readonly to: string;
}

/**
 * The proof of `records` — fills or cancellations recorded on their (one) destination — from the
 * destination's prover to the source's: `Portal.prove(prover, sourceDomain, intentHashes, data)`
 * with the bridge fee as its value. An intent the destination has no record of is refused, and
 * one the source has proven already (where the source is readable) is left out, saying so.
 */
export async function buildProve(
  records: readonly IntentRecord[],
  endpoints: Endpoints,
  options: {
    /** The destination block (on Solana, the slot) each cancelled intent was cancelled in, by
     *  intent hash, where known: its proof waits until that block is final, as eco-routes asks. */
    readonly cancelledIn?: Readonly<Record<string, string>>;
    /** On Solana, the account that pays the proof's fee and gas. */
    readonly from?: string;
  } = {},
): Promise<Plan & { readonly fee?: string; readonly prover?: ReturnType<typeof proverJson> }> {
  if (records.length === 0) throw new UsageError("no intent to prove");
  const intents = records.map(intentOf);
  const chains = new Chains(endpoints);
  const destinationChain = requireChain(Number(intents[0]!.destination));
  const sourceChain = requireChain(Number(intents[0]!.sourceChainId));
  requireSupported(
    "building a proof",
    intents.map((intent) => requireChain(Number(intent.destination))),
  );
  for (const intent of intents) {
    if (
      intent.destination !== intents[0]!.destination ||
      intent.sourceChainId !== intents[0]!.sourceChainId ||
      intent.reward.prover !== intents[0]!.reward.prover
    ) {
      throw new UsageError(
        "one proof carries intents from one destination to one source through one prover: " +
          "prove the others separately",
      );
    }
  }
  if (destinationChain.kind === "svm") return buildSvmProve(intents, chains, options);
  const destination = await chains.get(destinationChain, "a proof");
  const fromSolana = sourceChain.kind === "svm";
  const source = fromSolana ? undefined : await chains.maybe(sourceChain);
  const svmSource = fromSolana ? chains.svmMaybe(sourceChain) : undefined;
  const notes: string[] = [];
  const pairs: Array<{ intent: Intent; intentHash: Hex; claimant: Hex }> = [];
  for (const intent of intents) {
    const { intentHash } = hashIntent(intent);
    const recorded = await readCall(
      destination,
      fulfillmentCall(intent),
      "what the destination Portal recorded",
    );
    if (/^0x0{64}$/.test(recorded)) {
      return {
        ready: false,
        why: `${intentHash} is neither filled nor cancelled on ${destinationChain.slug}: there is nothing to prove`,
        transactions: [],
        notes,
      };
    }
    if (source !== undefined) {
      const proof = await tryRead(source, provenIntentCall(intent));
      if (
        proof !== undefined &&
        proof.claimant !== zeroAddress &&
        proof.destination === intent.destination
      ) {
        notes.push(
          `${intentHash} is proven on ${sourceChain.slug} already, for ${proof.claimant}: left out`,
        );
        continue;
      }
    }
    if (svmSource !== undefined) {
      const portal = svmKeyOf(records[intents.indexOf(intent)]!.source.portal);
      const { proof } = await readSvmSource(svmSource, intent, portal);
      if (proof !== null && proof.destination === intent.destination) {
        notes.push(
          `${intentHash} is proven on ${sourceChain.slug} already, for ${proof.claimant}: left out`,
        );
        continue;
      }
    }
    if (isCancelled(recorded)) {
      // A cancellation is proven once the destination block that recorded it is final: a reorg
      // past the deadline that let a fill in first would leave that solver unpaid (eco-routes'
      // proven-cancellation design, §1).
      const block = options.cancelledIn?.[intentHash];
      if (block === undefined) {
        notes.push(
          `${intentHash} was cancelled in a block this does not know: prove it once that block ` +
            `is final on ${destinationChain.slug}`,
        );
      } else {
        const finalized = await destination
          .getBlock({ blockTag: "finalized" })
          .then((final) => final.number)
          .catch(() => undefined);
        if (finalized === undefined) {
          notes.push(
            `${destinationChain.slug}'s endpoint reports no finalized block: make sure block ` +
              `${block}, which cancelled ${intentHash}, is final`,
          );
        } else if (finalized < BigInt(block)) {
          return {
            ready: false,
            why:
              `${intentHash} was cancelled in block ${block} on ${destinationChain.slug}, which is ` +
              `not final yet (the finalized block is ${finalized}): prove it once it is`,
            transactions: [],
            notes,
          };
        }
      }
    }
    pairs.push({ intent, intentHash, claimant: recorded });
  }
  if (pairs.length === 0) {
    return { ready: false, why: "every intent is proven already", transactions: [], notes };
  }
  const plan = await proverPlan(pairs[0]!.intent, destination, source, svmSource);
  if (!plan.supported) {
    return { ready: false, why: plan.why!, transactions: [], notes, prover: proverJson(plan) };
  }
  const fee = await proofFee(destination, plan, intents[0]!.destination, pairs);
  const tx = proveTx(
    pairs.map((pair) => pair.intent),
    {
      prover: plan.destinationProver! as Address,
      sourceDomain: plan.sourceDomain!,
      data: plan.data!,
      fee,
    },
  );
  const cancelled = pairs.filter((pair) => isCancelled(pair.claimant)).length;

  return {
    ready: true,
    transactions: [
      txJson(
        destinationChain,
        { ...tx, to: getAddress(tx.to) },
        `Portal.prove(${plan.destinationProver}, ${plan.sourceDomain}, [${pairs.map((p) => p.intentHash).join(", ")}], data) ` +
          `with ${fee} wei, the ${plan.kind} fee: carries ${pairs.length - cancelled} fill(s)` +
          (cancelled === 0 ? "" : ` and ${cancelled} cancellation(s)`) +
          ` to ${sourceChain.slug}`,
      ),
    ],
    fee: fee.toString(),
    prover: proverJson(plan),
    notes,
  };
}

/** The vault's balances of the reward, read once for a claim's or a refund's report. */
async function vaultMoves(
  source: SourceRead,
  intent: Intent,
  to: Address,
  all: boolean,
): Promise<VaultMove[]> {
  return source.holds
    .map((entry) => ({
      entry,
      // `Vault.withdraw` pays at most the reward's amount of each; `Vault.refund` everything.
      amount: all ? entry.holds : entry.holds < entry.reward ? entry.holds : entry.reward,
    }))
    .filter(({ amount }) => amount > 0n)
    .map(({ entry, amount }) => ({
      token: entry.token,
      ...(entry.info?.symbol === undefined ? {} : { symbol: entry.info.symbol }),
      ...(entry.token === "native"
        ? { decimals: 18 }
        : entry.info?.decimals === undefined
          ? {}
          : { decimals: entry.info.decimals }),
      amount: amount.toString(),
      to,
    }));
}

/**
 * The claim of `records`' rewards on their (one) source: `withdraw`, or `batchWithdraw` for
 * several, paying each the claimant its prover recorded. An intent that cannot be claimed is left
 * out with the reason in `notes`; with none left, `ready` is false and `why` is the first reason.
 */
export async function buildClaim(
  records: readonly IntentRecord[],
  endpoints: Endpoints,
  options: {
    /** On Solana, the account that pays the claim's fee (anyone may send it). */
    readonly from?: string;
  } = {},
): Promise<
  Plan & {
    readonly claims: ReadonlyArray<{
      readonly intentHash: Hex;
      /** An EVM address, or on Solana a key. */
      readonly claimant: string;
      /** The intent's vault on the source, which pays. */
      readonly vault: string;
      readonly moves: readonly VaultMove[];
    }>;
  }
> {
  if (records.length === 0) throw new UsageError("no intent to claim");
  const intents = records.map(intentOf);
  const sourceChain = requireChain(Number(intents[0]!.sourceChainId));
  requireSupported(
    "building a claim",
    intents.map((intent) => requireChain(Number(intent.sourceChainId))),
  );
  if (sourceChain.kind === "svm") {
    return buildSvmClaim(records, intents, new Chains(endpoints), options.from);
  }
  const portal = getAddress(records[0]!.source.portal);
  if (
    records.some(
      (record) =>
        !isAddressEqual(record.source.portal, portal) || record.source.chainId !== sourceChain.id,
    )
  ) {
    throw new UsageError("one claim withdraws from one source Portal: claim the others separately");
  }
  const chains = new Chains(endpoints);
  const client = await chains.get(sourceChain, "a claim");
  const notes: string[] = [];
  const claims: Array<{
    intent: Intent;
    intentHash: Hex;
    claimant: Address;
    vault: Address;
    moves: VaultMove[];
  }> = [];
  const sources = await Promise.all(intents.map((intent) => readSource(client, intent, portal)));
  for (const [index, intent] of intents.entries()) {
    const { intentHash } = hashIntent(intent);
    const source = sources[index]!;
    const proof = source.proof;
    const reason =
      source.status === "Withdrawn"
        ? "its reward was claimed already"
        : source.status === "Refunded"
          ? "its reward was refunded"
          : proof === null
            ? `the reward's prover ${getAddress(denormalizeToEvm(intent.reward.prover))} has no proof of it yet`
            : proof.destination !== intent.destination
              ? `its proof is from chain ${proof.destination}, not ${intent.destination}: a withdraw would challenge it, not pay`
              : isAddressEqual(proof.claimant, CANCELLED_CLAIMANT)
                ? "its cancellation is proven, which pays no claimant: refund it"
                : undefined;
    if (reason !== undefined) {
      notes.push(`${intentHash}: ${reason}`);
      continue;
    }
    claims.push({
      intent,
      intentHash,
      claimant: proof!.claimant,
      vault: source.vault,
      moves: await vaultMoves(source, intent, proof!.claimant, false),
    });
  }
  if (claims.length === 0) {
    return { ready: false, why: notes[0]!, transactions: [], notes, claims: [] };
  }
  const tx =
    claims.length === 1
      ? withdrawTx(claims[0]!.intent, { portal })
      : batchWithdrawTx(
          claims.map((claim) => claim.intent),
          { portal },
        );

  return {
    ready: true,
    transactions: [
      txJson(
        sourceChain,
        { ...tx, to: getAddress(tx.to) },
        claims.length === 1
          ? `Portal.withdraw(${claims[0]!.intent.destination}, routeHash, reward): pays ${claims[0]!.claimant}`
          : `Portal.batchWithdraw(${claims.length} intents): pays each its claimant`,
      ),
    ],
    claims: claims.map(({ intentHash, claimant, vault, moves }) => ({
      intentHash,
      claimant,
      vault,
      moves,
    })),
    notes,
  };
}

/**
 * The refund of `record`'s reward to its creator, on the source: `refund`, which anyone may send,
 * once the Portal allows it — at once after a proven cancellation, from the reward's deadline for
 * an intent no one proved, and for a claimed one only its leftovers.
 */
export async function buildRefund(
  record: IntentRecord,
  endpoints: Endpoints,
  options: {
    /** On Solana, the account that pays the refund's fee (anyone may send it). */
    readonly from?: string;
  } = {},
): Promise<
  Plan & {
    /** An EVM address, or on Solana a key. */
    readonly refundee: string;
    readonly vault: string;
    readonly moves: readonly VaultMove[];
  }
> {
  const intent = intentOf(record);
  const sourceChain = requireChain(Number(intent.sourceChainId));
  requireSupported("building a refund", [sourceChain]);
  const chains = new Chains(endpoints);
  if (sourceChain.kind === "svm") return buildSvmRefund(record, intent, chains, options.from);
  const client = await chains.get(sourceChain, "a refund");
  const portal = getAddress(record.source.portal);
  const source = await readSource(client, intent, portal);
  const creator = getAddress(denormalizeToEvm(intent.reward.creator));
  const proof = source.proof;
  const proofHere = proof !== null && proof.destination === intent.destination;
  const cancelProven = proofHere && isAddressEqual(proof.claimant, CANCELLED_CLAIMANT);
  const moves = await vaultMoves(source, intent, creator, true);
  const deadline = intent.reward.deadline;
  const why =
    proofHere && !cancelProven && source.status !== "Withdrawn"
      ? `it is proven, for ${proof.claimant}: the reward is the claimant's to claim, not the creator's`
      : !proofHere && source.time < deadline
        ? `not before the reward's deadline, ${iso(deadline)} (${deadline - source.time}s from ` +
          `${sourceChain.slug}'s latest block)` +
          (requireChain(Number(intent.destination)).kind === "evm"
            ? "; a 2.12+ destination can cancel it sooner, once the route's deadline has passed"
            : "")
        : moves.length === 0
          ? source.status === "Refunded"
            ? "it was refunded already, and the vault holds nothing more"
            : "the vault holds nothing to refund"
          : undefined;
  if (why !== undefined)
    return {
      ready: false,
      why,
      transactions: [],
      notes: [],
      refundee: creator,
      vault: source.vault,
      moves,
    };
  const tx = refundTx(intent, { portal });

  return {
    ready: true,
    transactions: [
      txJson(
        sourceChain,
        { ...tx, to: getAddress(tx.to) },
        `Portal.refund(${intent.destination}, routeHash, reward): returns the vault's ${source.vault} holdings to the creator ${creator}`,
      ),
    ],
    refundee: creator,
    vault: source.vault,
    moves,
    notes: cancelProven
      ? ["the cancellation is proven: refundable before the reward's deadline"]
      : [],
  };
}

/**
 * The cancellation of `record` on its destination, after the route's deadline: `cancel`, or
 * `cancelAndProve` with `prove` (its fee in the value). Refused where the destination Portal has no
 * `cancel`, and where the SOURCE Portal would pay a proven cancellation — the sentinel claimant —
 * instead of refusing it, since that would burn the reward.
 */
export async function buildCancel(
  record: IntentRecord,
  endpoints: Endpoints,
  options: {
    readonly prove?: boolean;
    /** On Solana, the account that pays the cancellation's fee (and, proving, its gas). */
    readonly from?: string;
  } = {},
): Promise<Plan & { readonly fee?: string; readonly prover?: ReturnType<typeof proverJson> }> {
  const intent = intentOf(record);
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const destinationChain = requireChain(Number(intent.destination));
  requireSupported("building a cancellation", [destinationChain]);
  const chains = new Chains(endpoints);
  if (destinationChain.kind === "svm") return buildSvmCancel(record, intent, chains, options);
  const destination = await chains.get(destinationChain, "a cancellation");
  const why = "a cancellation (to check the source Portal refuses to pay a cancellation)";
  const fromSolana = sourceChain.kind === "svm";
  const sourceClient = fromSolana ? undefined : await chains.get(sourceChain, why);
  const sourceRpc = fromSolana ? chains.svm(sourceChain, why) : undefined;
  const [there, here] = await Promise.all([
    readDestination(destination, intent),
    sourceRpc !== undefined
      ? readSvmSource(sourceRpc, intent, svmKeyOf(record.source.portal)).then(viewOfSvm)
      : readSource(sourceClient!, intent, getAddress(record.source.portal)).then(viewOfEvm),
  ]);
  const deadline = intent.route.deadline;
  const notReady = (why: string) => ({ ready: false, why, transactions: [], notes: [] });
  if (!there.canCancel) {
    return notReady(
      `the destination Portal ${there.portal} on ${destinationChain.slug} has no cancel (it ` +
        `predates eco-routes 2.12): refund after the reward's deadline, ${iso(intent.reward.deadline)}`,
    );
  }
  if (!here.refusesCancelledClaimant) {
    return notReady(
      `the source Portal ${here.portal} on ${sourceChain.slug} would pay a proven cancellation to ` +
        `${CANCELLED_CLAIMANT}, an address nobody controls (it predates eco-routes 2.12), so it ` +
        `is not cancelled: refund after the reward's deadline, ${iso(intent.reward.deadline)}`,
    );
  }
  if (isCancelled(there.claimant)) {
    return notReady("it is cancelled already: prove the cancellation, then refund");
  }
  if (there.claimant !== null) return notReady(`it was filled, for claimant ${there.claimant}`);
  if (there.time <= deadline) {
    return notReady(
      `not before the route's deadline, ${iso(deadline)}, has passed (${deadline + 1n - there.time}s ` +
        `from ${destinationChain.slug}'s latest block)`,
    );
  }
  if (here.status === "Refunded" || here.status === "Withdrawn") {
    return notReady(
      `its reward was ${here.status === "Refunded" ? "refunded" : "claimed"} already`,
    );
  }
  if (options.prove !== true) {
    const tx = cancelTx(intent);

    return {
      ready: true,
      transactions: [
        txJson(
          destinationChain,
          { ...tx, to: getAddress(tx.to) },
          `Portal.cancel(${hashIntent(intent).intentHash}, route, rewardHash): records the intent cancelled`,
        ),
      ],
      notes: [
        "Once the cancel is final on the destination, prove it (`sauce intent prove`), then refund " +
          "(`sauce intent refund`): eco-routes asks for the proof to wait for finality.",
      ],
    };
  }
  const plan = await proverPlan(intent, destination, sourceClient, sourceRpc);
  if (!plan.supported) return { ...notReady(plan.why!), prover: proverJson(plan) };
  const fee = await proofFee(destination, plan, intent.destination, [
    { intentHash: hashIntent(intent).intentHash, claimant: CANCELLED_CLAIMANT_BYTES32 },
  ]);
  const tx = cancelAndProveTx(intent, {
    prover: plan.destinationProver! as Address,
    sourceDomain: plan.sourceDomain!,
    data: plan.data!,
    fee,
  });

  return {
    ready: true,
    transactions: [
      txJson(
        destinationChain,
        { ...tx, to: getAddress(tx.to) },
        `Portal.cancelAndProve(${hashIntent(intent).intentHash}, route, rewardHash, ${plan.destinationProver}, ` +
          `${plan.sourceDomain}, data) with ${fee} wei, the ${plan.kind} fee`,
      ),
    ],
    fee: fee.toString(),
    prover: proverJson(plan),
    notes: [
      "warning: this proves the cancellation before the destination is final. eco-routes asks a " +
        "refund service to cancel, wait for finality, then prove: a reorg past the deadline that " +
        "re-includes a fill would leave that solver unpaid.",
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// An intent to Solana
// ---------------------------------------------------------------------------------------------

/** A claimant on the source chain as the 32 bytes Solana's Portal records: an EVM address, padded. */
function claimant32(claimant: Hex | undefined, chain: CanonicalChain): Hex {
  if (claimant === undefined) {
    throw new UsageError(
      `a fill on ${chain.slug} needs the claimant, an address on the intent's source chain that the ` +
        "reward pays (--claimant <address>): the Solana key that fills it is not one",
    );
  }
  const bytes = hexToBytes(claimant);
  if (bytes.length !== 20 && bytes.length !== 32) {
    throw new UsageError(`the claimant ${claimant} is neither an address nor 32 bytes`);
  }

  return toUniversalAddress(claimant);
}

/** The Solana fee payer a step is sent from: `from`, a Solana key. */
function svmPayer(from: string | undefined, what: string): ReturnType<typeof svmAddress> {
  if (from === undefined) {
    throw new UsageError(
      `${what} on Solana needs the account that pays its fee (--keypair <path>)`,
    );
  }
  // In base58, or as the 32 bytes of hex the command prints a Solana key in too.
  const key = svmPublicKey(from);
  if (key === undefined) {
    throw new UsageError(
      `${from} is not a Solana key: ${what} on Solana is paid by a Solana account`,
    );
  }

  return key;
}

async function buildSvmFill(
  intent: Intent,
  chains: Chains,
  options: {
    readonly from: string;
    readonly claimant?: Hex;
    readonly prove?: boolean;
    readonly lookupTable?: string;
  },
): ReturnType<typeof buildFill> {
  const destination = requireChain(Number(intent.destination));
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const rpc = chains.svm(destination, "a fill");
  const solver = svmPayer(options.from, "a fill");
  const claimant = claimant32(options.claimant, destination);
  const source = await chains.maybe(sourceChain);
  const [there, prover] = await Promise.all([
    readSvmDestination(rpc, intent),
    svmProverPlan(intent, rpc, source),
  ]);
  if (options.prove === true && !prover.supported) {
    throw new CliError(`the fill cannot prove itself: ${prover.why}`);
  }
  const proves = options.prove !== false && prover.supported;
  const plan = await planSvmFill(rpc, destination, intent, {
    solver,
    claimant,
    ...(options.lookupTable === undefined ? {} : { lookupTable: svmAddress(options.lookupTable) }),
  });
  const notes = [...plan.notes];
  if (plan.setup.length > 0) {
    notes.push(
      `The fill is too large for one transaction as it is, so it takes its accounts through the ` +
        `lookup table ${plan.lookupTable!.address}, which the first ${plan.setup.length} ` +
        "transaction(s) create and extend, the solver paying its rent. Send them, then the fill " +
        "from the next slot: a table is usable the slot after it is extended. Close the table " +
        "once the fill has landed to take its rent back (sauce reclaim --chain solana).",
    );
  }
  if (there.claimant !== null) {
    notes.push(
      isCancelled(there.claimant)
        ? "it is cancelled on Solana: the fulfill fails"
        : `it is filled already on Solana, for claimant ${there.claimant}: the fulfill fails`,
    );
  }
  if (options.prove === undefined && !prover.supported) {
    notes.push(`it is filled without its proof: ${prover.why}`);
  }
  const { intentHash } = hashIntent(intent);
  const transactions: AnyTxJson[] = [...plan.setup, plan.transaction];
  if (proves) {
    transactions.push(
      await svmProveTransaction(
        rpc,
        destination,
        svmAddress(there.portal),
        [intentHash],
        prover.hyper!,
        solver,
        `Portal.prove(${prover.destinationProver}, ${sourceChain.id}, [${intentHash}]) through ` +
          `Hyperlane to ${sourceChain.slug}, the IGP's gas paid`,
      ),
    );
    notes.push(
      "The last transaction proves the fill, so send it once the fill has landed. It shares " +
        "the fill's blockhash, which lasts about a minute; past that, build the proof again " +
        "(`sauce intent prove`).",
    );
  }

  return {
    from: solver,
    transactions,
    ...(plan.lookupTable === undefined
      ? {}
      : { lookupTable: { address: plan.lookupTable.address, setup: plan.setup.length } }),
    proves,
    fee: { prover: "0", kitchen: "0" },
    prover: proverJson(prover),
    delivers: plan.tokens.map((token) => ({
      token: token.mint,
      amount: token.amount.toString(),
      held: token.held.toString(),
    })),
    notes,
  };
}

async function buildSvmProve(
  intents: readonly Intent[],
  chains: Chains,
  options: { readonly cancelledIn?: Readonly<Record<string, string>>; readonly from?: string },
): ReturnType<typeof buildProve> {
  const destinationChain = requireChain(Number(intents[0]!.destination));
  const sourceChain = requireChain(Number(intents[0]!.sourceChainId));
  const rpc = chains.svm(destinationChain, "a proof");
  const source = await chains.maybe(sourceChain);
  const payer = svmPayer(options.from, "a proof");
  const notes: string[] = [];
  const pairs: Array<{ intent: Intent; intentHash: Hex; claimant: Hex }> = [];
  let portal: string | undefined;
  // What the destination recorded for every intent, read at once.
  const recorded = await Promise.all(intents.map((intent) => readSvmDestination(rpc, intent)));
  for (const [index, intent] of intents.entries()) {
    const { intentHash } = hashIntent(intent);
    const there = recorded[index]!;
    portal = there.portal;
    if (there.claimant === null) {
      return {
        ready: false,
        why: `${intentHash} is neither filled nor cancelled on ${destinationChain.slug}: there is nothing to prove`,
        transactions: [],
        notes,
      };
    }
    if (source !== undefined) {
      const proof = await tryRead(source, provenIntentCall(intent));
      if (
        proof !== undefined &&
        proof.claimant !== zeroAddress &&
        proof.destination === intent.destination
      ) {
        notes.push(
          `${intentHash} is proven on ${sourceChain.slug} already, for ${proof.claimant}: left out`,
        );
        continue;
      }
    }
    if (isCancelled(there.claimant)) {
      // As on an EVM destination: the cancellation is proven once the slot that recorded it is
      // final (eco-routes' proven-cancellation design, §1).
      const slot = options.cancelledIn?.[intentHash];
      if (slot === undefined) {
        notes.push(
          `${intentHash} was cancelled in a slot this does not know: prove it once that slot is ` +
            `final on ${destinationChain.slug}`,
        );
      } else {
        const finalized = await svmFinalizedSlot(rpc);
        if (finalized < BigInt(slot)) {
          return {
            ready: false,
            why:
              `${intentHash} was cancelled in slot ${slot} on ${destinationChain.slug}, which is ` +
              `not final yet (the finalized slot is ${finalized}): prove it once it is`,
            transactions: [],
            notes,
          };
        }
      }
    }
    pairs.push({ intent, intentHash, claimant: there.claimant });
  }
  if (pairs.length === 0) {
    return { ready: false, why: "every intent is proven already", transactions: [], notes };
  }
  const plan = await svmProverPlan(pairs[0]!.intent, rpc, source);
  if (!plan.supported) {
    return { ready: false, why: plan.why!, transactions: [], notes, prover: proverJson(plan) };
  }
  const cancelled = pairs.filter((pair) => isCancelled(pair.claimant)).length;
  const tx = await svmProveTransaction(
    rpc,
    destinationChain,
    svmAddress(portal!),
    pairs.map((pair) => pair.intentHash),
    plan.hyper!,
    payer,
    `Portal.prove(${plan.destinationProver}, ${sourceChain.id}, [${pairs.map((pair) => pair.intentHash).join(", ")}]) ` +
      `through Hyperlane, the IGP's gas paid: carries ${pairs.length - cancelled} fill(s)` +
      (cancelled === 0 ? "" : ` and ${cancelled} cancellation(s)`) +
      ` to ${sourceChain.slug}`,
  );
  const rehearsal = await rehearseSvm(rpc, tx, [payer]);
  if (!rehearsal.ok) {
    return {
      ready: false,
      why: `the proof fails on ${destinationChain.slug}: ${rehearsal.reason}`,
      transactions: [],
      notes,
      prover: proverJson(plan),
    };
  }
  const spend = await svmSpend(rpc, payer, tx, rehearsal);

  return {
    ready: true,
    transactions: [{ ...tx, value: spend.toString() }],
    fee: spend.toString(),
    prover: proverJson(plan),
    notes,
  };
}

async function buildSvmCancel(
  record: IntentRecord,
  intent: Intent,
  chains: Chains,
  options: { readonly prove?: boolean; readonly from?: string },
): ReturnType<typeof buildCancel> {
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const destinationChain = requireChain(Number(intent.destination));
  const rpc = chains.svm(destinationChain, "a cancellation");
  const sourceClient = await chains.get(
    sourceChain,
    "a cancellation (to check the source Portal refuses to pay a cancellation)",
  );
  const payer = svmPayer(options.from, "a cancellation");
  const [there, here] = await Promise.all([
    readSvmDestination(rpc, intent),
    readSource(sourceClient, intent, getAddress(record.source.portal)),
  ]);
  const deadline = intent.route.deadline;
  const notReady = (why: string) => ({ ready: false, why, transactions: [], notes: [] });
  if (!there.canCancel) {
    return notReady(
      `the destination Portal ${there.portal} on ${destinationChain.slug} has no cancel: refund ` +
        `after the reward's deadline, ${iso(intent.reward.deadline)}`,
    );
  }
  if (!here.refusesCancelledClaimant) {
    return notReady(
      `the source Portal ${here.portal} on ${sourceChain.slug} would pay a proven cancellation to ` +
        `${CANCELLED_CLAIMANT}, an address nobody controls (it predates eco-routes 2.12), so it ` +
        `is not cancelled: refund after the reward's deadline, ${iso(intent.reward.deadline)}`,
    );
  }
  if (isCancelled(there.claimant)) {
    return notReady("it is cancelled already: prove the cancellation, then refund");
  }
  if (there.claimant !== null) return notReady(`it was filled, for claimant ${there.claimant}`);
  if (there.time <= deadline) {
    return notReady(
      `not before the route's deadline, ${iso(deadline)}, has passed (${deadline + 1n - there.time}s ` +
        `by ${destinationChain.slug}'s clock)`,
    );
  }
  if (here.status === "Refunded" || here.status === "Withdrawn") {
    return notReady(
      `its reward was ${here.status === "Refunded" ? "refunded" : "claimed"} already`,
    );
  }
  const { intentHash } = hashIntent(intent);
  const plan = options.prove === true ? await svmProverPlan(intent, rpc, sourceClient) : undefined;
  if (plan !== undefined && !plan.supported) {
    return { ...notReady(plan.why!), prover: proverJson(plan) };
  }
  const tx = await svmCancelTransaction(
    rpc,
    destinationChain,
    intent,
    payer,
    plan?.hyper,
    plan === undefined
      ? `Portal.cancel(${intentHash}, route, rewardHash) on ${destinationChain.slug}: records the intent cancelled`
      : `Portal.cancel(${intentHash}, route, rewardHash), then Portal.prove(${plan.destinationProver}, ` +
          `${sourceChain.id}, [${intentHash}]) through Hyperlane, the IGP's gas paid`,
  );
  const rehearsal = await rehearseSvm(rpc, tx, [payer]);
  if (!rehearsal.ok) {
    return notReady(`the cancellation fails on ${destinationChain.slug}: ${rehearsal.reason}`);
  }
  const spend = await svmSpend(rpc, payer, tx, rehearsal);

  return {
    ready: true,
    transactions: [{ ...tx, value: plan === undefined ? "0" : spend.toString() }],
    ...(plan === undefined ? {} : { fee: spend.toString(), prover: proverJson(plan) }),
    notes:
      plan === undefined
        ? [
            "Once the cancel is final on the destination, prove it (`sauce intent prove`), then " +
              "refund (`sauce intent refund`): eco-routes asks for the proof to wait for finality.",
          ]
        : [
            "warning: this proves the cancellation before the destination is final. eco-routes " +
              "asks a refund service to cancel, wait for finality, then prove: a rollback past the " +
              "deadline that re-includes a fill would leave that solver unpaid.",
          ],
  };
}

// ---------------------------------------------------------------------------------------------
// An intent from Solana
// ---------------------------------------------------------------------------------------------

/** What a claim or refund on Solana moves: at most the reward of each leg for a claim, all of it
 *  for a refund. */
function svmVaultMoves(read: SvmSourceRead, to: string, all: boolean): VaultMove[] {
  return read.holds
    .map((entry) => ({
      entry,
      amount: all ? entry.holds : entry.holds < entry.reward ? entry.holds : entry.reward,
    }))
    .filter(({ amount }) => amount > 0n)
    .map(({ entry, amount }) => ({
      token: entry.token,
      ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
      ...(entry.decimals === undefined ? {} : { decimals: entry.decimals }),
      amount: amount.toString(),
      to,
    }));
}

async function buildSvmClaim(
  records: readonly IntentRecord[],
  intents: readonly Intent[],
  chains: Chains,
  from: string | undefined,
): ReturnType<typeof buildClaim> {
  const sourceChain = requireChain(Number(intents[0]!.sourceChainId));
  const rpc = chains.svm(sourceChain, "a claim");
  const payer = svmPayer(from, "a claim");
  const notes: string[] = [];
  const claims: Array<{
    intentHash: Hex;
    claimant: string;
    vault: string;
    moves: VaultMove[];
  }> = [];
  const transactions: AnyTxJson[] = [];
  for (const [index, intent] of intents.entries()) {
    const { intentHash } = hashIntent(intent);
    const read = await readSvmSource(rpc, intent, svmKeyOf(records[index]!.source.portal));
    const proof = read.proof;
    const reason =
      read.status === "Withdrawn"
        ? "its reward was claimed already"
        : read.status === "Refunded"
          ? "its reward was refunded"
          : proof === null
            ? `the reward's prover ${svmKeyOf(intent.reward.prover)} has no proof of it yet`
            : proof.destination !== intent.destination
              ? `its proof is from chain ${proof.destination}, not ${intent.destination}: a withdraw refuses it`
              : proof.cancelled
                ? "its cancellation is proven, which pays no claimant: refund it"
                : undefined;
    if (reason !== undefined) {
      notes.push(`${intentHash}: ${reason}`);
      continue;
    }
    const claimant = svmAddress(proof!.claimant);
    transactions.push(await svmClaimTransaction(rpc, sourceChain, intent, read, claimant, payer));
    claims.push({
      intentHash,
      claimant,
      vault: read.vault,
      moves: svmVaultMoves(read, claimant, false),
    });
  }
  if (claims.length === 0) {
    return { ready: false, why: notes[0]!, transactions: [], notes, claims: [] };
  }

  return { ready: true, transactions, claims, notes };
}

async function buildSvmRefund(
  record: IntentRecord,
  intent: Intent,
  chains: Chains,
  from: string | undefined,
): ReturnType<typeof buildRefund> {
  const sourceChain = requireChain(Number(intent.sourceChainId));
  const rpc = chains.svm(sourceChain, "a refund");
  const read = await readSvmSource(rpc, intent, svmKeyOf(record.source.portal));
  const creator = svmKeyOf(intent.reward.creator);
  const proof = read.proof;
  const proofHere = proof !== null && proof.destination === intent.destination;
  const cancelProven = proofHere && proof.cancelled;
  const moves = svmVaultMoves(read, creator, true);
  const deadline = intent.reward.deadline;
  const why =
    proofHere && !cancelProven && read.status !== "Withdrawn"
      ? `it is proven, for ${proof.claimant}: the reward is the claimant's to claim, not the creator's`
      : !proofHere && read.status !== "Withdrawn" && read.time < deadline
        ? `not before the reward's deadline, ${iso(deadline)} (${deadline - read.time}s by ` +
          `${sourceChain.slug}'s clock); its destination can cancel it sooner, once the route's ` +
          "deadline has passed"
        : moves.length === 0
          ? read.status === "Refunded"
            ? "it was refunded already, and the vault holds nothing more"
            : "the vault holds nothing to refund"
          : undefined;
  const base = { refundee: creator, vault: read.vault, moves };
  if (why !== undefined) return { ready: false, why, transactions: [], notes: [], ...base };
  const notes: string[] = [];
  if (cancelProven && read.time < deadline) {
    const unopened = read.holds.filter((entry) => entry.token !== "native" && !entry.open);
    if (unopened.length > 0) {
      notes.push(
        `the vault never held ${unopened.map((entry) => entry.symbol ?? entry.token).join(", ")}: ` +
          "before the reward's deadline a cancelled intent's refund must sweep every reward token, " +
          `so it fails until ${iso(deadline)}`,
      );
    }
  }
  const tx = await svmRefundTransaction(rpc, sourceChain, intent, read, svmPayer(from, "a refund"));

  return {
    ready: true,
    transactions: [tx],
    ...base,
    notes: cancelProven
      ? ["the cancellation is proven: refundable before the reward's deadline", ...notes]
      : notes,
  };
}

/** `DispatchId(bytes32 indexed messageId)`: a Hyperlane Mailbox's record of a message it sent. */
const DISPATCH_ID = toEventSelector("DispatchId(bytes32)");

/** The Hyperlane messages a transaction dispatched, from its receipt's logs: what a proof travels
 *  as, and what the Hyperlane explorer finds it by. */
export function dispatchedMessages(
  logs: ReadonlyArray<{ readonly address: Address; readonly topics: readonly Hex[] }>,
): Array<{ readonly mailbox: Address; readonly id: Hex }> {
  return logs
    .filter((log) => log.topics[0]?.toLowerCase() === DISPATCH_ID && log.topics[1] !== undefined)
    .map((log) => ({ mailbox: getAddress(log.address), id: log.topics[1]! }));
}

/** What the Eco API gateway says of an intent: its own status word, beside the chains' state. */
export interface GatewayStatus {
  /** `pending`, `filled`, `settled`, `refundable`, `refunded`, … as the gateway words it. */
  readonly status: string;
  readonly destinationTx?: Hex;
  readonly updatedAt?: string;
}

/**
 * The gateway's status of `intentHash` from `GET <api>/v1/intents/status?intentHash=…` — an
 * OPTIONAL second source, at a URL the caller gives (none is built in), beside the on-chain reads
 * that are the truth. `apiKey`, when given, goes in `x-api-key`. `undefined` when the gateway has no
 * entry for the intent; a failure is an error naming the status, never the URL or the key.
 */
export async function gatewayStatus(
  api: string,
  intentHash: Hex,
  apiKey?: string,
): Promise<GatewayStatus | undefined> {
  const url = `${api.replace(/\/+$/, "")}/v1/intents/status?${new URLSearchParams({ intentHash })}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(apiKey === undefined ? {} : { "x-api-key": apiKey }),
      },
    });
  } catch {
    throw new CliError("the gateway (--api) could not be reached");
  }
  if (!response.ok) {
    throw new CliError(
      `the gateway (--api) answered ${response.status}` +
        (response.status === 401 || response.status === 403
          ? ": it needs an API key (--api-key-file)"
          : ""),
    );
  }
  const page = (await response.json().catch(() => ({}))) as {
    results?: ReadonlyArray<{
      intentHashes?: readonly string[];
      status?: string;
      destinationTx?: { txHash?: string };
      updatedAt?: string | number;
    }>;
  };
  const wanted = intentHash.toLowerCase();
  const entry = (page.results ?? []).find((result) =>
    (result.intentHashes ?? []).some((hash) => hash.toLowerCase() === wanted),
  );
  if (entry?.status === undefined) return undefined;

  return {
    status: entry.status,
    ...(entry.destinationTx?.txHash === undefined
      ? {}
      : { destinationTx: entry.destinationTx.txHash as Hex }),
    ...(entry.updatedAt === undefined ? {} : { updatedAt: String(entry.updatedAt) }),
  };
}

// ---------------------------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------------------------

/** One intent a transaction published. */
export interface PublishedIntent {
  readonly record: IntentRecord;
  /** The transaction: an EVM hash, or a Solana signature. */
  readonly txHash: string;
  /** The transaction's explorer page and its trace, for a person to open. */
  readonly explorer?: string;
  readonly trace?: string;
  readonly block: string;
  readonly time: string;
  readonly logIndex: number;
  /** Whether it was funded completely when published: the same transaction's
   *  `IntentFunded(…, complete)`, or a vault the Portal counted funded (`isIntentFunded`) at that
   *  block, as a transfer before `publish` leaves it. */
  readonly funded: boolean;
}

const INTENT_FUNDED_TOPIC = toEventSelector(
  PortalABI.find((item) => item.type === "event" && item.name === "IntentFunded")!,
);

/**
 * The intents `logs` record funded completely, as `portal:intentHash` keys: each
 * `IntentFunded(intentHash, funder, complete)` decoded strictly with the registry's declaration,
 * and keyed by the contract that emitted it, so another contract's log of the same shape funds
 * nothing. A log that does not decode is not a funding.
 */
export function fundedIntents(
  logs: ReadonlyArray<{
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
  }>,
): Set<string> {
  const funded = new Set<string>();
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== INTENT_FUNDED_TOPIC) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: PortalABI,
        eventName: "IntentFunded",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "IntentFunded" || !decoded.args.complete) continue;
    funded.add(`${getAddress(log.address)}:${decoded.args.intentHash.toLowerCase()}`);
  }

  return funded;
}

/**
 * The intents `logs` — a transaction's, mined in `at.blockNumber` on `chain` — announce with
 * `IntentPublished`, rebuilt and recorded with the vault each one's Portal derives, and whether the
 * same transaction funded each completely. None is an empty list, not an error.
 */
export async function publishedIntents(
  client: PublicClient,
  chain: CanonicalChain,
  logs: ReadonlyArray<{
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
  }>,
  at: { readonly txHash: Hex; readonly blockNumber: bigint },
): Promise<PublishedIntent[]> {
  const indexed = logs.map((log, index) => ({ log, index }));
  const published = indexed.flatMap(({ log, index }) => {
    const intent = intentFromPublished({ topics: log.topics, data: log.data }, BigInt(chain.id));

    return intent === undefined ? [] : [{ ...intent, portal: getAddress(log.address), index }];
  });
  if (published.length === 0) return [];
  const block = await read("its block", () => client.getBlock({ blockNumber: at.blockNumber }));
  const funded = fundedIntents(logs);

  return Promise.all(
    published.map(async ({ intent, intentHash, portal, index }) => {
      const vault = await tryRead(client, intentVaultAddressCall(intent, { portal }));
      // Funded by a transfer into the vault before `publish`: no `IntentFunded`, so asked of the
      // Portal as of the block that published it.
      const logged = funded.has(`${portal}:${intentHash.toLowerCase()}`);
      const query = isIntentFundedCall(intent, { portal });
      const held =
        logged ||
        (await client
          .call({ to: query.to, data: query.data, blockNumber: at.blockNumber })
          .then(({ data }) => (data === undefined || data === "0x" ? false : query.decode(data)))
          .catch(() => false));

      return {
        record: intentRecord(intent, {
          sourcePortal: portal,
          ...(vault === undefined ? {} : { vault }),
        }),
        txHash: at.txHash,
        ...txLinks(chain, at.txHash),
        block: at.blockNumber.toString(),
        time: block.timestamp.toString(),
        logIndex: index,
        funded: held,
      };
    }),
  );
}

/**
 * The intents the transaction `txHash` on `chain` published, rebuilt from its `IntentPublished`
 * logs (`routes/portal.ts#intentFromPublished`, which checks each one's hash), with the vault each
 * one's Portal derives. `index` picks one of several. The Portal is the log's emitter: an intent
 * is claimed and refunded where it was published.
 */
export async function importIntents(
  ref: { readonly txHash: string; readonly chain: number | string; readonly index?: number },
  endpoints: Endpoints,
): Promise<{ readonly intents: readonly PublishedIntent[]; readonly notes: readonly string[] }> {
  const chain = requireChain(ref.chain);
  const found =
    chain.kind === "svm"
      ? await importSvmIntents(ref.txHash, chain, new Chains(endpoints))
      : await importEvmIntents(ref.txHash as Hex, chain, new Chains(endpoints));
  if (ref.index !== undefined) {
    const one = found[ref.index];
    if (one === undefined) {
      throw new UsageError(
        `${ref.txHash} published ${found.length} intent(s): index ${ref.index} is not one`,
      );
    }

    return { intents: [one], notes: [] };
  }

  return { intents: found, notes: [] };
}

/** The intents a Solana transaction published through Solana's registry Portal: each `publish`
 *  it ran (or a program of it invoked), rebuilt and checked against the hash the Portal logged, with
 *  its vault, and funded where the same transaction's `fund` funded it. */
async function importSvmIntents(
  signature: string,
  chain: CanonicalChain,
  chains: Chains,
): Promise<PublishedIntent[]> {
  const rpc = chains.svm(chain, "an import");
  const portal = svmKeyOf(ecoRoutesPortal(chain));
  let landed;
  try {
    landed = await rpc
      .getTransaction(signature as Parameters<SvmRpc["getTransaction"]>[0], {
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
  } catch (error) {
    throw new CliError(`reading ${signature} on ${chain.slug} failed: ${reasonOf(error)}`);
  }
  if (landed === null) throw new CliError(`${signature} is no transaction ${chain.slug} has`);
  if (landed.meta?.err !== null && landed.meta?.err !== undefined) {
    throw new CliError(`${signature} failed on ${chain.slug}: it published nothing`);
  }
  const instructions = ranInstructions(
    (landed.transaction as unknown as readonly [string, string])[0],
    landed.meta?.loadedAddresses ?? undefined,
    (landed.meta?.innerInstructions ?? undefined) as Parameters<typeof ranInstructions>[2],
  );
  const logs = landed.meta?.logMessages ?? [];
  const intents = svmPublishedIntents(instructions, portal, logs);
  if (intents.length === 0) {
    throw new CliError(
      `${signature} on ${chain.slug} ran no publish of Solana's Portal ${portal}: it published no intent`,
    );
  }
  const funded = new Set(
    instructions
      .filter((instruction) => instruction.program === portal)
      .map((instruction) => svmSourceInstruction(instruction.data))
      .filter((acted) => acted?.event === "funded")
      .map((acted) => acted!.intentHash.toLowerCase()),
  );
  const time = landed.blockTime === null ? undefined : BigInt(landed.blockTime);

  return Promise.all(
    intents.map(async (intent, index) => {
      const { intentHash } = hashIntent(intent);
      const vault = await svmVaultPda(portal, intentHash);
      // Funded by this transaction's `fund`, or (Solana keeps no history to ask at its slot) by a
      // vault that holds the reward now.
      const held =
        funded.has(intentHash.toLowerCase()) || (await readSvmSource(rpc, intent, portal)).funded;

      return {
        record: intentRecord(intent, {
          sourcePortal: universalOfSvmKey(portal),
          vault: universalOfSvmKey(vault),
        }),
        txHash: signature,
        ...txLinks(chain, signature),
        block: landed.slot.toString(),
        time: (time ?? BigInt(Math.floor(Date.now() / 1000))).toString(),
        logIndex: index,
        funded: held,
      };
    }),
  );
}

async function importEvmIntents(
  txHash: Hex,
  chain: CanonicalChain,
  chains: Chains,
): Promise<PublishedIntent[]> {
  const ref = { txHash };
  const client = await chains.get(chain, "an import");
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: ref.txHash });
  } catch (error) {
    throw new CliError(
      `reading the receipt of ${ref.txHash} on ${chain.slug} failed: ${reasonOf(error)}`,
    );
  }
  if (receipt.status !== "success") {
    throw new CliError(`${ref.txHash} reverted on ${chain.slug}: it published nothing`);
  }
  const found = await publishedIntents(
    client,
    chain,
    receipt.logs.map((log) => ({
      address: getAddress(log.address),
      topics: log.topics as readonly Hex[],
      data: log.data,
    })),
    { txHash: ref.txHash, blockNumber: receipt.blockNumber },
  );
  if (found.length === 0) {
    throw new CliError(
      `${ref.txHash} on ${chain.slug} logged no IntentPublished: it published no intent`,
    );
  }

  return found;
}
