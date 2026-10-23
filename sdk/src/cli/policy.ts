/**
 * What a wallet may send: its policy, `<name>.policy.json` beside it in the wallet directory, and
 * the ledger of what it sent, `<name>.ledger.jsonl`. With no policy file a wallet sends anything
 * its signer could, and every result says no limits are set.
 *
 * A policy (every field optional, every amount a string — whole tokens, `"1.5"`, or base units
 * ending in `n`, `"1500000n"`, as `--fund` takes them):
 *
 *     {
 *       "chains": ["base", "ethereum"],
 *       "to": ["0x…"],
 *       "native": { "perTransaction": "0.01", "perDay": "0.05" },
 *       "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
 *     }
 *
 *  - `chains`: the only chains it sends on (slugs, aliases or ids).
 *  - `to`: the only addresses a transaction may be sent to — on Solana, the programs its
 *    instructions call (the compute-budget program aside). The released Kitchen's `deployPot` of
 *    the wallet's own Pot, with no value, counts as a transaction to that Pot: deploying a Pot the
 *    policy lets the wallet cook on grants nothing cooking on it does not, so a command that
 *    deploys the Pot it is about to cook on is allowed whenever the cook is.
 *  - `native`: the chain's native coin, in its own units (ETH, SOL, Arc's USDC), leaving the wallet
 *    or the Pot a transaction cooks on; on Solana the fee and any rent it pays are included.
 *  - `tokens`: by registry symbol or by address (an EVM token, a Solana mint); what leaves the
 *    wallet or the Pot it cooks on, and any approval it grants above what is left of the limit
 *    (Permit2 aside, which moves nothing without the wallet's signature in a later cook). A token
 *    the policy does not name is not limited. Where the native coin is also an ERC-20 (Arc's USDC,
 *    one balance), what leaves as either counts against `native` and that token's limit both.
 *  - `perDay` is the last 24 hours, every chain together, counted from the ledger.
 *
 * What a transaction moves is MEASURED, not read from its calldata: an EVM transaction is rehearsed
 * by `eth_simulateV1` with transfers traced, and the ERC-20 Transfer and Approval logs and native
 * transfers out of the wallet and its Pot are what count; a Solana one is simulated with the
 * accounts it writes reported, and the wallet's and its Pot's lamports and token accounts compared
 * before and after. What cannot be measured — an endpoint without `eth_simulateV1`, a cook whose
 * native transfers are not traced, or a Solana lookup table that cannot be read — is refused
 * wherever a limit would need it.
 *
 * Every wallet unlocked is GUARDED, policy or not: {@link guardWallet} registers it by address, and
 * the two places every send of this command passes — `chain.ts#sendAndWait` on an EVM chain,
 * `solana.ts`'s `sendAndConfirm` on Solana — ask {@link guardOf} for the sender's guard before
 * sending. A check and its reservation in the ledger happen under a lock file, so two processes
 * cannot both spend the last of a day's limit; the outcome is appended after.
 *
 * NODE-ONLY, like the rest of `cli/`.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";

import {
  address as solanaAddress,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  isAddress as isSolanaAddress,
  type Address as SvmAddress,
  type AddressesByLookupTableAddress,
  type createSolanaRpc,
  type Transaction,
} from "@solana/kit";
import {
  decodeAbiParameters,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { nativeErc20 } from "../chains/index.js";
import { v12KitchenAddress, v12SvmKitchenProgramId } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { addressOn, getDescriptor } from "../descriptors/query.js";
import { v12PotAbi } from "../evm/engine.js";
import { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "../routes/token-registry.js";
import { fetchAlt, KITCHEN_DISCRIMINATORS, svmPublicKey } from "../svm/index.js";
import { CliError, UsageError } from "./args.js";
import type { TxRequest } from "./chain.js";
import { nativeOnce, nativeSymbol, tokenInfo, wordsOf } from "../evm/effects.js";
import { requireSupported } from "./support.js";
import { accountsNow, messageAccounts, movedBy, writableAccounts } from "./svm-effects.js";
import type { WalletInfo } from "./wallets.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

// ---------------------------------------------------------------------------------------------
// The policy file
// ---------------------------------------------------------------------------------------------

/** An amount as a policy writes it: whole tokens (`"1.5"`), or base units (`"1500000n"`). */
type Amount = { readonly units: string } | { readonly base: bigint };

interface Limit {
  readonly perTransaction?: Amount;
  readonly perDay?: Amount;
}

export interface Policy {
  readonly path: string;
  readonly chains?: readonly CanonicalChain[];
  /** Lowercase 0x hex, or a base58 Solana address as written. */
  readonly to?: readonly string[];
  readonly native?: Limit;
  /** By the key the file names it with: a symbol (uppercase) or an address. */
  readonly tokens: ReadonlyMap<string, Limit>;
  /** What is said of it: a limit that reads like base units (`"1500000"` USDC, 1.5 million). */
  readonly notes: readonly string[];
}

/** A policy refused: which limit, and why, in one sentence. */
export class PolicyRefusal extends CliError {
  constructor(
    /** The limit, as the policy file spells its path: `tokens.USDC.perDay`, `chains`, `to`. */
    readonly limit: string,
    message: string,
  ) {
    super(message);
  }
}

const AMOUNT = /^(?:\d+(?:\.\d+)?|\d+n)$/;

/**
 * The decimals a policy's token key has wherever the registry records it — a symbol or an address,
 * on any chain — when they agree; `undefined` for the native coin (18 on an EVM chain, 9 on Solana)
 * or a token the registry does not record.
 */
function keyDecimals(key: string | undefined): number | undefined {
  if (key === undefined) return undefined;
  const named = (row: { readonly symbol: string }) => row.symbol.toUpperCase() === key;
  const decimals = new Set(
    [
      ...Object.values(TOKEN_REGISTRY)
        .flat()
        .filter((row) => named(row) || row.address.toLowerCase() === key),
      ...Object.values(SVM_TOKEN_REGISTRY)
        .flat()
        .filter((row) => named(row) || row.mint === key),
    ].map((row) => row.decimals),
  );

  return decimals.size === 1 ? [...decimals][0] : undefined;
}

/**
 * A limit's amount: whole tokens (`"1.5"`), or base units with a trailing `n` (`"1500000n"`).
 * `notes` gets what a bare integer of whole tokens that reads like base units says: at or above
 * 10^decimals, where the registry gives the token's decimals.
 */
function amountOf(raw: unknown, where: string, key: string | undefined, notes: string[]): Amount {
  if (typeof raw !== "string" || !AMOUNT.test(raw)) {
    throw new UsageError(
      `${where} is not an amount: a string of whole tokens ("1.5") or of base units ending in n ` +
        '("1500000n")',
    );
  }
  if (raw.endsWith("n")) return { base: BigInt(raw.slice(0, -1)) };
  const decimals = keyDecimals(key);
  if (
    !raw.includes(".") &&
    decimals !== undefined &&
    decimals > 0 &&
    BigInt(raw) >= 10n ** BigInt(decimals)
  ) {
    notes.push(`${where}: "${raw}" is ${wordsOf(raw)} ${key}; for base units write "${raw}n"`);
  }

  return { units: raw };
}

function limitOf(raw: unknown, where: string, key: string | undefined, notes: string[]): Limit {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UsageError(`${where} is not { "perTransaction": …, "perDay": … }`);
  }
  const extra = Object.keys(raw).find((key) => key !== "perTransaction" && key !== "perDay");
  if (extra !== undefined) {
    throw new UsageError(`${where}.${extra} is not a limit: perTransaction or perDay`);
  }
  const { perTransaction, perDay } = raw as Record<string, unknown>;

  return {
    ...(perTransaction === undefined
      ? {}
      : { perTransaction: amountOf(perTransaction, `${where}.perTransaction`, key, notes) }),
    ...(perDay === undefined ? {} : { perDay: amountOf(perDay, `${where}.perDay`, key, notes) }),
  };
}

const POLICY_KEYS = new Set(["chains", "to", "native", "tokens"]);

/** A policy file's text, checked whole: an unknown field is an error, never ignored. */
export function parsePolicy(text: string, path: string): Policy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`${path} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`${path} is not a JSON object`);
  }
  const fields = parsed as Record<string, unknown>;
  const unknown = Object.keys(fields).find((key) => !POLICY_KEYS.has(key));
  if (unknown !== undefined) {
    throw new UsageError(`${path}: ${unknown} is not a policy field (chains, to, native, tokens)`);
  }
  const list = (key: string): unknown[] | undefined => {
    const value = fields[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new UsageError(`${path}: ${key} is not a list`);

    return value;
  };
  const chains = list("chains")?.map((raw) => {
    try {
      return requireChain(typeof raw === "number" ? raw : String(raw));
    } catch {
      throw new UsageError(`${path}: chains names ${JSON.stringify(raw)}, which is not a chain`);
    }
  });
  const to = list("to")?.map((raw) => {
    if (typeof raw === "string" && isAddress(raw, { strict: false })) return raw.toLowerCase();
    const key = typeof raw === "string" ? svmPublicKey(raw) : undefined;
    if (key !== undefined) return key;
    throw new UsageError(`${path}: to names ${JSON.stringify(raw)}, which is not an address`);
  });
  const notes: string[] = [];
  const tokens = new Map<string, Limit>();
  if (fields.tokens !== undefined) {
    if (
      fields.tokens === null ||
      typeof fields.tokens !== "object" ||
      Array.isArray(fields.tokens)
    ) {
      throw new UsageError(`${path}: tokens is not an object of token to limit`);
    }
    for (const [key, raw] of Object.entries(fields.tokens)) {
      const named = isAddress(key, { strict: false })
        ? key.toLowerCase()
        : (svmPublicKey(key) ??
          (/^[A-Za-z][A-Za-z0-9.]{0,15}$/.test(key) ? key.toUpperCase() : undefined));
      if (named === undefined) {
        throw new UsageError(`${path}: tokens.${key} is neither a token symbol nor an address`);
      }
      tokens.set(named, limitOf(raw, `${path}: tokens.${key}`, named, notes));
    }
  }

  return {
    path,
    ...(chains === undefined ? {} : { chains }),
    ...(to === undefined ? {} : { to }),
    ...(fields.native === undefined
      ? {}
      : { native: limitOf(fields.native, `${path}: native`, undefined, notes) }),
    tokens,
    notes,
  };
}

/**
 * The wallet's policy, `undefined` when it has none. A file that others may write is refused: they
 * could loosen it.
 */
export function readPolicy(info: WalletInfo): Policy | undefined {
  let stats: Stats;
  try {
    stats = statSync(info.policyPath);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw new CliError(`${info.policyPath} is unreadable`);
  }
  if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
    throw new CliError(
      `${info.policyPath} can be written by others (mode ${(stats.mode & 0o777).toString(8)}), ` +
        `who could loosen it: \`chmod 600 ${info.policyPath}\``,
    );
  }

  return parsePolicy(readFileSync(info.policyPath, "utf8"), info.policyPath);
}

/** What a send result says of a wallet with no policy. */
export const noPolicyNote = (info: WalletInfo): string =>
  `wallet ${info.name} has no policy, so no limits are set on what it sends: ${info.policyPath} ` +
  "sets them (per transaction and per day, by chain, by recipient, native and per token)";

// ---------------------------------------------------------------------------------------------
// Amounts, compared across chains
// ---------------------------------------------------------------------------------------------

/** Every amount is compared at 36 decimals: exact for any token with up to 36 of its own. */
const SCALE = 36;

const scaled = (amount: bigint, decimals: number): bigint =>
  amount * 10n ** BigInt(SCALE - Math.min(decimals, SCALE));

const limitScaled = (limit: Amount, decimals: number): bigint =>
  "base" in limit ? scaled(limit.base, decimals) : parseUnits(limit.units, SCALE);

/** `value` at {@link SCALE}, as whole units for a person. */
const whole = (value: bigint): string => formatUnits(value, SCALE);

// ---------------------------------------------------------------------------------------------
// What a transaction moves
// ---------------------------------------------------------------------------------------------

/** One asset leaving the wallet's accounts. */
interface Outflow {
  /** An EVM token's checksummed address, a Solana mint, or "native". */
  readonly token: string;
  readonly symbol?: string;
  readonly decimals?: number;
  /**
   * The decimals a limit written in base units (`"1500000n"`) counts in, where they are not
   * `decimals`: Arc's USDC leaving as the native coin is measured in its 18, to the wei, and its
   * token limit is written in the ERC-20's 6.
   */
  readonly limitDecimals?: number;
  readonly amount: bigint;
}

interface Approval extends Outflow {
  readonly spender: string;
}

/** What one transaction spends, as measured. */
export interface Measured {
  readonly chain: CanonicalChain;
  /** Where it goes: an EVM `to`, or the programs a Solana transaction calls. */
  readonly to: readonly string[];
  /** The wallet's own Pot it deploys through the released Kitchen, which `to` counts it as. */
  readonly deploysPot?: string;
  readonly native: Outflow;
  readonly tokens: readonly Outflow[];
  readonly approvals: readonly Approval[];
  /** Why native or token movements could not be measured, when they could not. */
  readonly unmeasured: { readonly native?: string; readonly tokens?: string };
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
/** Where `traceTransfers` reports native transfers, as ERC-20 Transfer logs. */
const NATIVE_EMITTER = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
/** `Kitchen.deployPot(owner, salt)`, as `sauce run` and `sauce tx` send it. */
const DEPLOY_POT = toFunctionSelector("function deployPot(address owner, bytes32 salt)");

/**
 * The Pot `call` deploys, when it is the released Kitchen's `deployPot` of `wallet`'s own Pot with
 * no value; `undefined` for any other call. The Pot is the one cooking on it would reach: the
 * CREATE2 address over (wallet, salt) that `v12PredictPot` gives, and the Kitchen derives.
 */
export function ownPotDeployed(call: TxRequest, wallet: Address): Address | undefined {
  if (call.value !== 0n || getAddress(call.to) !== getAddress(v12KitchenAddress()))
    return undefined;
  if (call.data.slice(0, 10).toLowerCase() !== DEPLOY_POT) return undefined;
  try {
    const [owner, salt] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      `0x${call.data.slice(10)}`,
    );
    if (getAddress(owner) !== getAddress(wallet)) return undefined;

    return getAddress(v12PredictPot(owner, salt) as Address);
  } catch {
    return undefined;
  }
}

const COOK = toFunctionSelector(
  v12PotAbi.find((item) => item.type === "function" && item.name === "cook")!,
);

/** A log as `eth_simulateV1` returns it. */
interface Log {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

const topicAddress = (topic: Hex): Address => getAddress(`0x${topic.slice(26)}`);
const wordOf = (data: Hex): bigint | undefined =>
  data.length === 66 ? decodeAbiParameters([{ type: "uint256" }], data)[0] : undefined;

/** The token's registry symbol and decimals on `chain`, else its own decimals. */
async function evmToken(
  client: PublicClient,
  chain: CanonicalChain,
  token: Address,
): Promise<{ symbol?: string; decimals?: number }> {
  const row = (TOKEN_REGISTRY[chain.id] ?? []).find((entry) => getAddress(entry.address) === token);
  if (row !== undefined) return { symbol: row.symbol, decimals: row.decimals };
  const info = await tokenInfo(client, chain, token);

  return info.decimals === undefined ? {} : { decimals: info.decimals };
}

/** One call's outcome in a rehearsal of a plan: whether it succeeded, and its logs. */
export interface Rehearsed {
  readonly status: "success" | "failure";
  readonly logs: readonly Log[];
  /** What it returned, or reverted with. */
  readonly data: Hex;
}

/**
 * `calls` rehearsed in order from `wallet` in one `eth_simulateV1` block, state carried from each to
 * the next and native transfers traced; `undefined` where the endpoint does not run it.
 */
export async function rehearsePlan(
  client: PublicClient,
  wallet: Address,
  calls: readonly TxRequest[],
): Promise<readonly Rehearsed[] | undefined> {
  try {
    const [block] = await client.simulateBlocks({
      blocks: [
        {
          calls: calls.map((call) => ({
            account: wallet,
            to: call.to,
            data: call.data,
            value: call.value,
          })),
        },
      ],
      traceTransfers: true,
      validation: false,
    });

    return (block?.calls ?? []).map((call) => ({
      status: call.status === "success" ? "success" : "failure",
      logs: (call.logs ?? []).map((log) => ({
        address: getAddress(log.address),
        topics: log.topics as readonly Hex[],
        data: log.data,
      })),
      data: call.data,
    }));
  } catch {
    return undefined;
  }
}

/**
 * What `calls`, sent in order from `wallet`, move out of the wallet and the Pot each cooks on: one
 * {@link Measured} per call, from `rehearsed` (a {@link rehearsePlan} of them; rehearsed here when
 * not given). Where the endpoint does not run `eth_simulateV1` the movements are unmeasured; a call
 * that fails is refused, as a send would be.
 */
export async function measureEvm(
  client: PublicClient,
  chain: CanonicalChain,
  wallet: Address,
  calls: readonly TxRequest[],
  rehearsed?: readonly Rehearsed[],
): Promise<Measured[]> {
  const results = rehearsed ?? (await rehearsePlan(client, wallet, calls));
  const measured: Measured[] = [];
  for (const [index, call] of calls.entries()) {
    const cook = call.data.slice(0, 10).toLowerCase() === COOK ? getAddress(call.to) : undefined;
    const ours = new Set<string>([getAddress(wallet), ...(cook === undefined ? [] : [cook])]);
    const deploysPot = ownPotDeployed(call, wallet);
    const base = {
      chain,
      to: [(deploysPot ?? call.to).toLowerCase()],
      ...(deploysPot === undefined ? {} : { deploysPot }),
      approvals: [] as Approval[],
    };
    const nativeOf = (amount: bigint): Outflow => ({
      token: "native",
      symbol: nativeSymbol(chain),
      decimals: 18,
      amount,
    });
    const result = results?.[index];
    if (result === undefined) {
      measured.push({
        ...base,
        native: nativeOf(call.value),
        tokens: [],
        unmeasured: {
          tokens: "the endpoint did not run eth_simulateV1, which shows what a transaction moves",
          ...(cook === undefined
            ? {}
            : {
                native:
                  "the endpoint did not run eth_simulateV1, so what the cook moves from the Pot is not known",
              }),
        },
      });
      continue;
    }
    if (result.status !== "success") {
      throw new CliError(
        `transaction ${index + 1} of ${calls.length} would revert in the simulation, so nothing was sent`,
      );
    }
    // One log per native movement, however the node or the chain said it.
    const { logs, logged } = nativeOnce(chain, result.logs ?? []);
    const traced =
      logged || (result.logs ?? []).some((log) => getAddress(log.address) === NATIVE_EMITTER);
    let native = 0n;
    const tokens = new Map<string, bigint>();
    const approvals: Array<{ token: Address; spender: Address; amount: bigint }> = [];
    for (const log of logs) {
      const [topic, one, two] = log.topics;
      const amount = wordOf(log.data);
      if (amount === undefined || log.topics.length !== 3) continue;
      const emitter = getAddress(log.address);
      if (topic?.toLowerCase() === TRANSFER) {
        const from = topicAddress(one!);
        const to = topicAddress(two!);
        if (!ours.has(from) || ours.has(to)) continue;
        if (emitter === NATIVE_EMITTER) native += amount;
        else tokens.set(emitter, (tokens.get(emitter) ?? 0n) + amount);
      } else if (topic?.toLowerCase() === APPROVAL && ours.has(topicAddress(one!))) {
        approvals.push({ token: emitter, spender: topicAddress(two!), amount });
      }
    }
    // An account's own native leaves only as a transaction's value, which a trace shows; with no
    // trace, the value is what the wallet sends, and a cook's Pot is not seen. (What `native` holds
    // then is what left through the native coin's ERC-20, where it has one.)
    const untraced = !traced && (call.value > 0n || cook !== undefined);
    const nativeOut = untraced ? call.value + native : native;
    // Where the native coin is also an ERC-20 (Arc's USDC), it is one balance: whatever leaves as
    // either is held to the token's limit as well as to the native one.
    const erc20 = nativeErc20(chain.id);
    const known = new Map<string, { symbol?: string; decimals?: number }>();
    const info = async (token: Address) => {
      if (!known.has(token)) known.set(token, await evmToken(client, chain, token));

      return known.get(token)!;
    };
    measured.push({
      ...base,
      native: nativeOf(nativeOut),
      tokens: [
        ...(await Promise.all(
          [...tokens].map(async ([token, amount]) => ({
            token,
            ...(await info(token as Address)),
            amount,
          })),
        )),
        ...(erc20 === undefined || nativeOut === 0n
          ? []
          : [
              {
                token: getAddress(erc20.address),
                symbol: (await info(getAddress(erc20.address))).symbol ?? nativeSymbol(chain),
                decimals: 18,
                limitDecimals: erc20.decimals,
                amount: nativeOut,
              },
            ]),
      ],
      approvals: await Promise.all(
        approvals.map(async (approval) => ({
          token: approval.token,
          ...(await info(approval.token)),
          amount: approval.amount,
          spender: approval.spender,
        })),
      ),
      unmeasured:
        untraced && cook !== undefined
          ? {
              native:
                "the endpoint does not trace native transfers, so what the cook moves from the Pot is not known",
              // Nor, where the native coin is also an ERC-20, what leaves as that token.
              ...(erc20 === undefined
                ? {}
                : {
                    tokens: `the endpoint does not trace native transfers, and ${nativeSymbol(chain)} is ${chain.name}'s native coin`,
                  }),
            }
          : {},
    });
  }

  return measured;
}

/** The Kitchen's cooks and the Pot's index among each one's accounts. */
const KITCHEN_COOKS = [
  { head: KITCHEN_DISCRIMINATORS.cook, pot: 2 },
  { head: KITCHEN_DISCRIMINATORS.cookFromAccount, pot: 4 },
];
/** The compute-budget program: a transaction's plumbing, not where it goes. */
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/**
 * A program the transaction calls through another (a CPI), as a simulation reports it. Mainnet
 * nodes answer `simulateTransaction` with every inner instruction keyed by `programId`: parsed
 * (`parsed`, `program`; no `accounts` or `data`) for a program they parse, such as System and SPL
 * Token, and otherwise partially decoded, with `accounts` by address and `data` in base58 — the
 * Kitchen's and the engine's. `programIdIndex` and index `accounts` are the unparsed form a
 * transaction's own report uses, taken here too.
 */
type InnerInstruction = Readonly<{
  programId?: string;
  programIdIndex?: number;
  accounts?: readonly (string | number)[];
  data?: string;
}>;

/**
 * What a signed Solana `transaction` moves out of `wallet` and the Pots it cooks on, as a
 * simulation that reports its writable accounts shows it; a transaction that would fail is refused.
 * A cook counts wherever it runs: called by the transaction, or by a program it calls (a signer's
 * signature passes through a CPI, and the Kitchen takes a cook at any depth).
 */
export async function measureSvm(
  rpc: Rpc,
  chain: CanonicalChain,
  wallet: SvmAddress,
  transaction: Transaction,
): Promise<Measured> {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    staticAccounts: readonly SvmAddress[];
    instructions: ReadonlyArray<{
      programAddressIndex: number;
      accountIndices?: readonly number[];
      data?: Uint8Array;
    }>;
    addressTableLookups?: readonly unknown[];
  };
  const kitchen = solanaAddress(v12SvmKitchenProgramId());
  const programs = new Set<string>();
  for (const instruction of message.instructions) {
    const program = message.staticAccounts[instruction.programAddressIndex]!;
    if (program !== COMPUTE_BUDGET) programs.add(program);
  }
  const base = { chain, to: [...programs] };
  const native = (amount: bigint): Outflow => ({
    token: "native",
    symbol: "SOL",
    decimals: 9,
    amount,
  });
  // The accounts it loads through lookup tables, read from the tables: a staged cook's.
  const tables: AddressesByLookupTableAddress = {};
  try {
    for (const { lookupTableAddress } of (message.addressTableLookups ?? []) as readonly {
      lookupTableAddress: SvmAddress;
    }[]) {
      Object.assign(tables, await fetchAlt(rpc, lookupTableAddress));
    }
  } catch {
    return {
      ...base,
      native: native(0n),
      tokens: [],
      approvals: [],
      unmeasured: {
        native: "a lookup table it loads accounts from could not be read",
        tokens: "a lookup table it loads accounts from could not be read",
      },
    };
  }
  // Measure the Pot the cook names, not the salt's canonical PDA. The Kitchen checks that account
  // against the owner, salt and supplied bump before signing; any off-curve bump can select it.
  const accounts = messageAccounts(transaction, tables);
  /** The Pot `program` signs for with `data` on `keys` (its accounts in order): the Kitchen's cook
   *  by `wallet`, else nothing. */
  const cookPot = (
    program: string | undefined,
    data: Uint8Array,
    keys: readonly (string | undefined)[],
  ): string | undefined => {
    const cook = KITCHEN_COOKS.find(({ head }) => head.every((byte, at) => data[at] === byte));

    return program === kitchen && cook !== undefined && keys[0] === wallet
      ? keys[cook.pot]
      : undefined;
  };
  const pots: string[] = [];
  for (const instruction of message.instructions) {
    const pot = cookPot(
      accounts[instruction.programAddressIndex],
      instruction.data ?? new Uint8Array(),
      (instruction.accountIndices ?? []).map((at) => accounts[at]),
    );
    if (pot !== undefined) pots.push(pot);
  }
  const tracked = writableAccounts(transaction, tables);
  const before = await accountsNow(rpc, tracked);
  const wire = getBase64EncodedWireTransaction(transaction);
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      innerInstructions: true,
      accounts: { addresses: tracked, encoding: "base64" },
    })
    .send();
  if (value.err !== null) {
    throw new CliError("the transaction would fail in the simulation, so nothing was sent");
  }
  // The cooks its programs make: each inner instruction, at any depth, that calls the Kitchen.
  const inner: readonly Readonly<{ instructions: readonly InnerInstruction[] }>[] | null =
    value.innerInstructions ?? null;
  let unseen: string | undefined =
    inner === null
      ? "the endpoint did not report the programs its programs call, so a cook among them is not seen"
      : undefined;
  for (const each of (inner ?? []).flatMap((group) => group.instructions)) {
    const program =
      each.programId ??
      (each.programIdIndex === undefined ? undefined : accounts[each.programIdIndex]);
    if (program === undefined) {
      unseen = "the endpoint reported a program its programs call that cannot be named";
      continue;
    }
    if (program !== kitchen) continue;
    const keys = (each.accounts ?? []).map((key) =>
      typeof key === "number" ? accounts[key] : key,
    );
    let data: Uint8Array | undefined;
    try {
      data =
        each.data === undefined ? undefined : new Uint8Array(getBase58Encoder().encode(each.data));
    } catch {
      data = undefined;
    }
    if (data === undefined || keys.some((key) => key === undefined)) {
      unseen =
        "one of its programs calls the Kitchen, and the endpoint's report of that call cannot be read";
      continue;
    }
    // A cook reported without its owner or Pot account (a truncated report) is not "not a cook":
    // whether it is the wallet's, and which Pot it signs for, cannot be read, so it is refused.
    const cook = KITCHEN_COOKS.find(({ head }) => head.every((byte, at) => data[at] === byte));
    if (
      cook !== undefined &&
      keys.length <= cook.pot &&
      (keys.length === 0 || keys[0] === wallet)
    ) {
      unseen =
        "one of its programs calls the Kitchen, and the endpoint's report of that call cannot be read";
      continue;
    }
    const pot = cookPot(program, data, keys);
    if (pot !== undefined) pots.push(pot);
  }
  const after = (value.accounts ?? []).map((account) =>
    account === null
      ? null
      : {
          lamports: BigInt(account.lamports),
          owner: account.owner,
          data: new Uint8Array(getBase64Encoder().encode(account.data[0])),
          executable: account.executable,
        },
  );
  const moved = await movedBy(rpc, chain, tracked, before, after, new Map(), wallet);
  const ours = new Set<string>([wallet, ...pots]);
  const lamports = moved.lamports
    .filter((change) => ours.has(change.account))
    .reduce((sum, change) => sum + change.before - change.after, 0n);
  const byMint = new Map<string, { amount: bigint; symbol?: string; decimals?: number }>();
  for (const change of moved.tokens) {
    if (!ours.has(change.owner)) continue;
    const seen = byMint.get(change.mint) ?? {
      amount: 0n,
      ...(change.symbol === undefined ? {} : { symbol: change.symbol }),
      ...(change.decimals === undefined ? {} : { decimals: change.decimals }),
    };
    byMint.set(change.mint, { ...seen, amount: seen.amount + change.before - change.after });
  }

  return {
    ...base,
    native: native(lamports > 0n ? lamports : 0n),
    tokens: [...byMint]
      .filter(([, out]) => out.amount > 0n)
      .map(([token, out]) => ({ token, ...out })),
    approvals: [],
    unmeasured: unseen === undefined ? {} : { native: unseen, tokens: unseen },
  };
}

// ---------------------------------------------------------------------------------------------
// Checking, and the ledger
// ---------------------------------------------------------------------------------------------

/** One line of the ledger. */
type LedgerLine =
  | {
      readonly v: 1;
      readonly id: string;
      readonly state: "reserved";
      readonly time: string;
      readonly chain: string;
      /** Per limit (`native`, `tokens.USDC`): what this transaction counts against it. */
      readonly spend: Readonly<
        Record<string, { readonly amount: string; readonly decimals: number }>
      >;
    }
  | {
      readonly v: 1;
      readonly id: string;
      readonly state: "sent";
      readonly time: string;
      readonly tx: string;
    }
  | {
      readonly v: 1;
      readonly id: string;
      readonly state: "released";
      readonly time: string;
      readonly why: string;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each limit's total over the last 24 hours, at {@link SCALE}: every reservation not released. */
function dayTotals(path: string, now: number): Map<string, bigint> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return new Map();
    throw new CliError(`${path} is unreadable`);
  }
  const reserved = new Map<string, Extract<LedgerLine, { state: "reserved" }>>();
  const released = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: LedgerLine;
    try {
      entry = JSON.parse(line) as LedgerLine;
    } catch {
      // A line cut short by a crash: what it reserved is not known, so the policy cannot be held.
      throw new CliError(
        `${path} has a line that is not JSON: the day's spending cannot be counted. Look at the ` +
          "file, and remove the broken line",
      );
    }
    if (entry.state === "reserved") reserved.set(entry.id, entry);
    else if (entry.state === "released") released.add(entry.id);
  }
  const totals = new Map<string, bigint>();
  for (const [id, entry] of reserved) {
    if (released.has(id) || now - Date.parse(entry.time) >= DAY_MS) continue;
    for (const [limit, spent] of Object.entries(entry.spend)) {
      totals.set(limit, (totals.get(limit) ?? 0n) + scaled(BigInt(spent.amount), spent.decimals));
    }
  }

  return totals;
}

/** Appends `line` to the ledger in one write, 0600. */
function appendLine(path: string, line: LedgerLine): void {
  const fd = openSync(path, "a", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
  } finally {
    closeSync(fd);
  }
}

/** Runs `body` holding the wallet's lock file, so a check and its reservation are one step. */
async function locked<T>(path: string, body: () => T): Promise<T> {
  for (const started = Date.now(); ;) {
    try {
      closeSync(openSync(path, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      // A lock older than a minute is a process that died holding it.
      const age = Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 60_000) {
        unlinkSync(path);
        continue;
      }
      if (Date.now() - started > 15_000) {
        throw new CliError(`${path} has been held for 15s by another send: try again`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return body();
  } finally {
    unlinkSync(path);
  }
}

/** Whether the policy's token key `key` names `outflow` on its chain. */
function names(key: string, outflow: Outflow): boolean {
  if (outflow.token === "native") return false;
  if (key.startsWith("0x")) return outflow.token.toLowerCase() === key;
  if (isSolanaAddress(key)) return outflow.token === key;

  return outflow.symbol?.toUpperCase() === key;
}

const shown = (amount: bigint, outflow: Pick<Outflow, "decimals" | "symbol" | "token">): string =>
  `${outflow.decimals === undefined ? `${amount} base units` : formatUnits(amount, outflow.decimals)} ${outflow.symbol ?? outflow.token}`;

/** The registry's Permit2 on `chain`, lowercase; `undefined` where it has none. */
function permit2Of(chain: CanonicalChain): string | undefined {
  const descriptor = getDescriptor("permit2", "Permit2");

  return descriptor === undefined ? undefined : addressOn(descriptor, chain)?.toLowerCase();
}

/** What `measured` counts against each of `policy`'s limits; a refusal naming the first it breaks. */
function spendOf(
  wallet: string,
  policy: Policy,
  measured: Measured,
  totals: ReadonlyMap<string, bigint>,
): Record<string, { amount: string; decimals: number }> {
  const refuse = (limit: string, why: string): never => {
    throw new PolicyRefusal(
      limit,
      `refused by the policy of wallet ${wallet} (${policy.path}): ${why}`,
    );
  };
  const { chain } = measured;
  if (policy.chains !== undefined && !policy.chains.some((each) => each.id === chain.id)) {
    refuse(
      "chains",
      `chains allows ${policy.chains.map((each) => each.slug).join(", ")}, and this transaction is on ${chain.slug}`,
    );
  }
  if (policy.to !== undefined) {
    const off = measured.to.find((to) => !policy.to!.includes(to));
    if (off !== undefined) {
      refuse(
        "to",
        measured.deploysPot === undefined
          ? `to allows ${policy.to.length} address(es), and this transaction goes to ${off}`
          : `to allows ${policy.to.length} address(es), and this transaction deploys the ` +
              `wallet's Pot ${measured.deploysPot}, which is not one of them: add it to to, as ` +
              "cooking on it needs",
      );
    }
  }
  const spend: Record<string, { amount: string; decimals: number }> = {};
  const hold = (
    limitName: string,
    limit: Limit,
    amount: bigint,
    unit: Pick<Outflow, "decimals" | "limitDecimals" | "symbol" | "token">,
  ): void => {
    if (unit.decimals === undefined) {
      refuse(
        limitName,
        `the decimals of ${unit.symbol ?? unit.token} could not be read, so it cannot be held to the limit`,
      );
    }
    const value = scaled(amount, unit.decimals!);
    const text = (at: bigint) => `${whole(at)} ${unit.symbol ?? unit.token}`;
    if (limit.perTransaction !== undefined) {
      const cap = limitScaled(limit.perTransaction, unit.limitDecimals ?? unit.decimals!);
      if (value > cap) {
        refuse(
          `${limitName}.perTransaction`,
          `${limitName}.perTransaction is ${text(cap)}, and this transaction sends ${shown(amount, unit)}`,
        );
      }
    }
    if (limit.perDay !== undefined) {
      const cap = limitScaled(limit.perDay, unit.limitDecimals ?? unit.decimals!);
      const before = totals.get(limitName) ?? 0n;
      if (before + value > cap) {
        refuse(
          `${limitName}.perDay`,
          `${limitName}.perDay is ${text(cap)}; ${text(before)} went in the last 24 hours, and ` +
            `this transaction sends ${shown(amount, unit)}`,
        );
      }
    }
    if (amount > 0n) spend[limitName] = { amount: amount.toString(), decimals: unit.decimals! };
  };
  if (policy.native !== undefined) {
    if (measured.unmeasured.native !== undefined) {
      refuse("native", `native is limited, and ${measured.unmeasured.native}`);
    }
    hold("native", policy.native, measured.native.amount, measured.native);
  }
  for (const [key, limit] of policy.tokens) {
    if (measured.unmeasured.tokens !== undefined) {
      refuse(`tokens.${key}`, `tokens.${key} is limited, and ${measured.unmeasured.tokens}`);
    }
    const matching = measured.tokens.filter((outflow) => names(key, outflow));
    for (const outflow of matching) hold(`tokens.${key}`, limit, outflow.amount, outflow);
    const permit2 = permit2Of(chain);
    for (const approval of measured.approvals.filter((each) => names(key, each))) {
      if (approval.spender.toLowerCase() === permit2 || approval.decimals === undefined) continue;
      const value = scaled(approval.amount, approval.decimals);
      const caps = [
        limit.perTransaction === undefined
          ? undefined
          : limitScaled(limit.perTransaction, approval.decimals),
        limit.perDay === undefined
          ? undefined
          : limitScaled(limit.perDay, approval.decimals) - (totals.get(`tokens.${key}`) ?? 0n),
      ].filter((cap): cap is bigint => cap !== undefined);
      const cap = caps.length === 0 ? undefined : caps.reduce((a, b) => (a < b ? a : b));
      if (cap !== undefined && value > cap) {
        refuse(
          `tokens.${key}`,
          `this transaction approves ${approval.spender} for ${shown(approval.amount, approval)}, ` +
            `more than the ${whole(cap > 0n ? cap : 0n)} ${approval.symbol ?? approval.token} tokens.${key} leaves room for`,
        );
      }
    }
  }

  return spend;
}

/** A reservation in the ledger, closed once the transaction is sent or is not. */
export interface Reservation {
  sent(tx: string): void;
  released(why: string): void;
}

const NOTHING: Reservation = { sent: () => undefined, released: () => undefined };

/**
 * The release's chain gate (`support.ts#requireSupported`), for every send a wallet makes: wallets
 * send only where the release sends at all, so a raw transaction a wallet is handed is held to it
 * as a built one is — refused on a preview chain before anything is measured, signed or sent.
 */
const releaseGate = (chain: CanonicalChain): void =>
  requireSupported("sending from a wallet", [chain]);

/** A wallet's guard: its policy (if any), and the ledger and lock beside it. */
export class SendGuard {
  readonly wallet: WalletInfo;
  readonly policy: Policy | undefined;
  private readonly ledger: string;
  private readonly lock: string;

  constructor(wallet: WalletInfo, policy: Policy | undefined) {
    this.wallet = wallet;
    this.policy = policy;
    const dir = wallet.policyPath.slice(0, -`${wallet.name}.policy.json`.length);
    this.ledger = join(dir, `${wallet.name}.ledger.jsonl`);
    this.lock = join(dir, `${wallet.name}.lock`);
  }

  /** Every check before a send that does not need what the transaction moves. */
  gate(chain: CanonicalChain): void {
    releaseGate(chain);
  }

  /**
   * Checks a plan's transactions against the policy before any is sent: each one's limits, and
   * the day's totals with the earlier ones counted. Nothing is reserved; each is again when sent.
   */
  async preflight(measured: readonly Measured[]): Promise<void> {
    for (const each of measured) this.gate(each.chain);
    const policy = this.policy;
    if (policy === undefined) return;
    await locked(this.lock, () => {
      const totals = dayTotals(this.ledger, Date.now());
      for (const each of measured) {
        for (const [limit, spent] of Object.entries(
          spendOf(this.wallet.name, policy, each, totals),
        )) {
          totals.set(
            limit,
            (totals.get(limit) ?? 0n) + scaled(BigInt(spent.amount), spent.decimals),
          );
        }
      }
    });
  }

  /** Checks one transaction and reserves what it spends, in one step under the lock. */
  private async reserve(policy: Policy, measured: Measured): Promise<Reservation> {
    const id = randomUUID();
    const ledger = this.ledger;
    const close = (line: LedgerLine) => appendLine(ledger, line);

    return locked(this.lock, () => {
      const spend = spendOf(this.wallet.name, policy, measured, dayTotals(ledger, Date.now()));
      close({
        v: 1,
        id,
        state: "reserved",
        time: new Date().toISOString(),
        chain: measured.chain.slug,
        spend,
      });

      return {
        sent: (tx) => close({ v: 1, id, state: "sent", time: new Date().toISOString(), tx }),
        released: (why) =>
          close({ v: 1, id, state: "released", time: new Date().toISOString(), why }),
      };
    });
  }

  /** Measures and reserves one EVM transaction, just before it is sent. */
  async evm(client: PublicClient, tx: TxRequest): Promise<Reservation> {
    const chain = requireChain(await client.getChainId());
    this.gate(chain);
    if (this.policy === undefined) return NOTHING;
    const [measured] = await measureEvm(client, chain, getAddress(this.wallet.address), [tx]);

    return this.reserve(this.policy, measured!);
  }

  /** Measures and reserves one signed Solana transaction, just before it is sent. */
  async svm(rpc: Rpc, transaction: Transaction): Promise<Reservation> {
    const chain = requireChain("solana");
    this.gate(chain);
    if (this.policy === undefined) return NOTHING;
    const measured = await measureSvm(rpc, chain, solanaAddress(this.wallet.address), transaction);

    return this.reserve(this.policy, measured);
  }
}

/** Every wallet this process has unlocked, by address: the guard its sends pass. */
const guards = new Map<string, SendGuard>();

/** Guards the wallet `info`: from now on every send from its address passes its policy. */
export function guardWallet(info: WalletInfo, policy: Policy | undefined): SendGuard {
  const guard = new SendGuard(info, policy);
  guards.set(keyOf(info.address), guard);

  return guard;
}

const keyOf = (address: string): string =>
  address.startsWith("0x") ? address.toLowerCase() : address;

/** The guard of the wallet at `address`, if this process unlocked one there. */
export const guardOf = (address: string): SendGuard | undefined => guards.get(keyOf(address));
