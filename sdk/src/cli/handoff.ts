/**
 * What a wallet's own tool takes, so an agent passes a result to it whole: no hex to convert, no
 * chain to name.
 *
 * - Each unsigned EVM transaction a result carries is itself the input of a wallet's
 *   send-transaction tool: `{ chainId, to, data, value, gas? }` (beside labels such as `what`),
 *   `value` and `gas` hex quantities ({@link hexQuantity}), as eth_sendTransaction takes them and as
 *   Phantom's MCP tool `evm_send` requires (`send_evm_transaction` in its documentation;
 *   `@phantom/cli`'s `SendEvmTransactionSchema` refuses a decimal value, takes a numeric chain id,
 *   and drops the fields it does not know). Each command writes its transactions so.
 * - `sendCalls` on the result: `{ chain, calls: [{ to, value, data }] }`, every transaction below
 *   it in order — the input of Coinbase's Wallet MCP tool `send_calls`, which runs them as one
 *   atomic batch after one approval (EIP-5792). {@link handoff} adds it, on the outermost object
 *   whose transactions are all on one chain that tool names, and only there; a result that spans
 *   chains carries one on each part that does not.
 *
 * Solana transactions are left as they are: `transaction`, standard base64 with the fee payer's
 * signature empty and every other one present, is already what a wallet's Solana tool takes
 * (Phantom's `solana_send`).
 *
 * A result is read the way `wallet-send.ts#plannedTransactions` reads one — a transaction, a list,
 * `transactions`, `intents[].transactions`, `transaction` — so whatever `sauce_wallet_send` sends,
 * a wallet's tool can too. Nothing here reaches the network.
 */
import { isAddress, type Address, type Hex } from "viem";

/** The chain names Coinbase's `send_calls` takes, by chain id: those of its chains Sauce knows. */
const SEND_CALLS_CHAINS: Readonly<Record<number, string>> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanche",
};

/** An amount as a transaction for a wallet writes it: a hex quantity, `0x0` for none. */
export const hexQuantity = (amount: bigint): Hex => `0x${amount.toString(16)}`;

/** One call of a `send_calls` batch. */
export interface SendCall {
  readonly to: Address;
  readonly value: Hex;
  readonly data: Hex;
}

/** A `send_calls` batch: the chain by Coinbase's name for it, and the calls in order. */
export interface SendCalls {
  readonly chain: string;
  readonly calls: readonly SendCall[];
}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const AMOUNT = /^(?:\d+|0x[0-9a-fA-F]+)$/;
const DECIMAL = /^\d+$/;

/** An unsigned EVM transaction's fields, as a result writes them. */
interface EvmTx {
  readonly chainId?: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/**
 * `fields` as an unsigned EVM transaction, or `undefined`: one sent carries its hash, and one
 * simulated its status.
 */
function evmTx(fields: Record<string, unknown>, chainId: number | undefined): EvmTx | undefined {
  const { to, data, value = "0x0", hash, status } = fields;
  if (hash !== undefined || status !== undefined) return undefined;
  if (typeof to !== "string" || !isAddress(to, { strict: false })) return undefined;
  if (typeof data !== "string" || !HEX.test(data)) return undefined;
  if (typeof value !== "string" || !AMOUNT.test(value)) return undefined;

  return {
    ...(chainId === undefined ? {} : { chainId }),
    to: to as Address,
    data: data as Hex,
    value: BigInt(value),
  };
}

/** What a part of a result carries: its EVM transactions, in order, and whether it has others. */
interface Carried {
  readonly evm: readonly EvmTx[];
  /** A Solana transaction, or an EVM one with no chain: no batch holds it. */
  readonly other: boolean;
}

const NOTHING: Carried = { evm: [], other: false };

const joined = (parts: readonly Carried[]): Carried => ({
  evm: parts.flatMap((part) => part.evm),
  other: parts.some((part) => part.other),
});

/** The `send_calls` batch of `carried`, when it is one chain's EVM transactions `send_calls` takes. */
function batchOf(carried: Carried): SendCalls | undefined {
  if (carried.other || carried.evm.length === 0) return undefined;
  const ids = new Set(carried.evm.map((tx) => tx.chainId));
  const [id] = ids;
  if (ids.size !== 1 || id === undefined) return undefined;
  const chain = SEND_CALLS_CHAINS[id];
  if (chain === undefined) return undefined;

  return {
    chain,
    calls: carried.evm.map((tx) => ({ to: tx.to, value: hexQuantity(tx.value), data: tx.data })),
  };
}

const chainIdOf = (raw: unknown, inherited: number | undefined): number | undefined => {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === "string" && DECIMAL.test(raw)) return Number(raw);

  return inherited;
};

/** What `value` carries, read as `plannedTransactions` reads it, and whether it holds the
 *  transactions itself (a transaction, `transactions`, an intent, …): where a batch may sit. */
function carried(value: unknown, inherited: number | undefined): Carried & { holder: boolean } {
  if (Array.isArray(value)) {
    return { ...joined(value.map((each) => carried(each, inherited))), holder: false };
  }
  if (value === null || typeof value !== "object") return { ...NOTHING, holder: false };
  const fields = value as Record<string, unknown>;
  // Nothing to send yet: no batch is held up by it.
  if (fields.ready === false) return { ...NOTHING, holder: false };
  const chainId = chainIdOf(fields.chainId, inherited);
  if (typeof fields.transaction === "string") return { evm: [], other: true, holder: false };
  const tx = evmTx(fields, chainId);
  if (tx !== undefined) {
    return tx.chainId === undefined
      ? { evm: [], other: true, holder: true }
      : { evm: [tx], other: false, holder: true };
  }
  if (Array.isArray(fields.transactions)) {
    return { ...carried(fields.transactions, chainId), holder: true };
  }
  if (Array.isArray(fields.intents)) {
    const parts = fields.intents.map((intent) =>
      intent !== null && typeof intent === "object" && "transactions" in intent
        ? carried(intent, chainId)
        : NOTHING,
    );

    return { ...joined(parts), holder: true };
  }
  if (fields.transaction !== null && typeof fields.transaction === "object") {
    return { ...carried(fields.transaction, chainId), holder: true };
  }

  return { ...NOTHING, holder: false };
}

/**
 * `sendCalls` on `value` when its transactions are one batch, else on each intent below it that
 * is: a result whose intents fill on two chains carries one batch per intent.
 */
function placeBatches(value: unknown, inherited: number | undefined): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const fields = value as Record<string, unknown>;
  const found = carried(fields, inherited);
  if (!found.holder) return value;
  const batch = batchOf(found);
  if (batch !== undefined) return { ...fields, sendCalls: batch };
  if (!Array.isArray(fields.intents)) return value;
  const chainId = chainIdOf(fields.chainId, inherited);

  return {
    ...fields,
    intents: fields.intents.map((intent) =>
      intent !== null && typeof intent === "object" && "transactions" in intent
        ? placeBatches(intent, chainId)
        : intent,
    ),
  };
}

/** `sauce pot`'s reading of the chain, saying the Pot has code. */
const deployedPot = (deployment: unknown): boolean =>
  deployment !== null &&
  typeof deployment === "object" &&
  (deployment as { pot?: { deployed?: unknown } }).pot?.deployed === true;

/**
 * `json` with `sendCalls`, the `send_calls` batch of the unsigned EVM transactions it carries, where
 * they are one chain's. Idempotent: a batch already there is replaced by the same one. A result
 * with no unsigned EVM transaction, or only a deployment of a Pot that is there already, comes back
 * unchanged.
 */
export function handoff<T extends Record<string, unknown>>(
  json: T,
): T & { readonly sendCalls?: SendCalls } {
  // A Pot that is there already: its deployment is not to be sent.
  if (json.deployed === true || deployedPot(json.deployment)) return json;
  if (carried(json, undefined).evm.length === 0) return json;

  return placeBatches(json, undefined) as T;
}
