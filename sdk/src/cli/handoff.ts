/**
 * What a wallet's own tool takes, written into a result that carries unsigned EVM transactions, so
 * an agent passes one field to it whole: no hex to convert, no chain to name. Two shapes, beside
 * the transactions' own fields (which stay as they are, amounts in decimal):
 *
 * - `sendTransaction` on each EVM transaction: `{ chainId, to, data, value, gas? }`, every amount a
 *   hex quantity — the eth_sendTransaction object (less its `from`), which is the input of Phantom's
 *   MCP tool `evm_send` (`send_evm_transaction` in its documentation; `@phantom/cli`'s
 *   `SendEvmTransactionSchema` refuses a decimal value, and reads a hex chain id).
 * - `sendCalls` on the result: `{ chain, calls: [{ to, value, data }] }`, every transaction below
 *   it in order, `value` hex — the input of Coinbase's Wallet MCP tool `send_calls`, which runs them
 *   as one atomic batch after one approval (EIP-5792). It sits on the outermost object whose
 *   transactions are all on one chain that tool names, and only there; a result that spans chains
 *   carries one on each part that does not.
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

/** One transaction as eth_sendTransaction takes it: every amount a hex quantity. */
export interface SendTransaction {
  readonly chainId: Hex;
  readonly to: Address;
  readonly data: Hex;
  readonly value: Hex;
  readonly gas?: Hex;
}

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

/** The chain name `send_calls` takes for `chainId`, if it takes one. */
export const sendCallsChain = (chainId: number): string | undefined => SEND_CALLS_CHAINS[chainId];

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const DECIMAL = /^\d+$/;

const hexQuantity = (amount: string | number): Hex => `0x${BigInt(amount).toString(16)}`;

/** An unsigned EVM transaction's fields, as a result writes them. */
interface EvmTx {
  readonly chainId?: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
  readonly gas?: string;
}

/**
 * `fields` as an unsigned EVM transaction, or `undefined`: one sent carries its hash, and one
 * simulated its status.
 */
function evmTx(fields: Record<string, unknown>, chainId: number | undefined): EvmTx | undefined {
  const { to, data, value = "0", gas, hash, status } = fields;
  if (hash !== undefined || status !== undefined) return undefined;
  if (typeof to !== "string" || !isAddress(to, { strict: false })) return undefined;
  if (typeof data !== "string" || !HEX.test(data)) return undefined;
  if (typeof value !== "string" || !DECIMAL.test(value)) return undefined;
  if (gas !== undefined && (typeof gas !== "string" || !DECIMAL.test(gas))) return undefined;

  return {
    ...(chainId === undefined ? {} : { chainId }),
    to: to as Address,
    data: data as Hex,
    value,
    ...(gas === undefined ? {} : { gas: gas as string }),
  };
}

/** The `evm_send` input for `tx`. */
const sendTransactionOf = (tx: EvmTx & { readonly chainId: number }): SendTransaction => ({
  chainId: hexQuantity(tx.chainId),
  to: tx.to,
  data: tx.data,
  value: hexQuantity(tx.value),
  ...(tx.gas === undefined ? {} : { gas: hexQuantity(tx.gas) }),
});

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
  const chain = sendCallsChain(id);
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

/** A part of a result with its hand-offs, and what it carries. */
interface Walked {
  readonly value: unknown;
  readonly carried: Carried;
  /** Whether `value` holds the transactions itself (a list, `transactions`, an intent, …): where a
   *  batch may sit. */
  readonly holder: boolean;
}

/** `value` with `sendTransaction` on each EVM transaction, read as `plannedTransactions` reads it. */
function walk(value: unknown, inherited: number | undefined): Walked {
  if (Array.isArray(value)) {
    const parts = value.map((each) => walk(each, inherited));

    return {
      value: parts.map((part) => part.value),
      carried: joined(parts.map((part) => part.carried)),
      holder: false,
    };
  }
  if (value === null || typeof value !== "object") {
    return { value, carried: NOTHING, holder: false };
  }
  const fields = value as Record<string, unknown>;
  // Nothing to send yet: no batch is held up by it.
  if (fields.ready === false) return { value, carried: NOTHING, holder: false };
  const chainId = chainIdOf(fields.chainId, inherited);
  if (typeof fields.transaction === "string") {
    return { value, carried: { evm: [], other: true }, holder: false };
  }
  const tx = evmTx(fields, chainId);
  if (tx !== undefined) {
    if (tx.chainId === undefined) return { value, carried: { evm: [], other: true }, holder: true };

    return {
      value: { ...fields, sendTransaction: sendTransactionOf({ ...tx, chainId: tx.chainId }) },
      carried: { evm: [tx], other: false },
      holder: true,
    };
  }
  if (Array.isArray(fields.transactions)) {
    const inner = walk(fields.transactions, chainId);

    return {
      value: { ...fields, transactions: inner.value },
      carried: inner.carried,
      holder: true,
    };
  }
  if (Array.isArray(fields.intents)) {
    const parts = fields.intents.map((intent) =>
      intent !== null && typeof intent === "object" && "transactions" in intent
        ? walk(intent, chainId)
        : { value: intent, carried: NOTHING, holder: false },
    );

    return {
      value: { ...fields, intents: parts.map((part) => part.value) },
      carried: joined(parts.map((part) => part.carried)),
      holder: true,
    };
  }
  if (fields.transaction !== null && typeof fields.transaction === "object") {
    const inner = walk(fields.transaction, chainId);

    return { value: { ...fields, transaction: inner.value }, carried: inner.carried, holder: true };
  }

  return { value, carried: NOTHING, holder: false };
}

/**
 * `sendCalls` on the outermost holder whose transactions are one batch, else on each intent below
 * it that is: a result whose intents fill on two chains carries one batch per intent.
 */
function placeBatches(walked: Walked): unknown {
  const { value } = walked;
  if (!walked.holder || value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const fields = value as Record<string, unknown>;
  const batch = batchOf(walked.carried);
  if (batch !== undefined) return { ...fields, sendCalls: batch };
  if (!Array.isArray(fields.intents)) return value;
  const chainId = chainIdOf(fields.chainId, undefined);

  return {
    ...fields,
    intents: fields.intents.map((intent) => {
      if (intent === null || typeof intent !== "object" || !("transactions" in intent)) {
        return intent;
      }
      // Walked again from what is already decorated: `sendTransaction` is a field it never reads.
      return placeBatches(walk(intent, chainId));
    }),
  };
}

/** `sauce pot`'s reading of the chain, saying the Pot has code. */
const deployedPot = (deployment: unknown): boolean =>
  deployment !== null &&
  typeof deployment === "object" &&
  (deployment as { pot?: { deployed?: unknown } }).pot?.deployed === true;

/**
 * `json` with what a wallet's own tool takes beside each unsigned EVM transaction it carries
 * (`sendTransaction`) and on the result (`sendCalls`). Idempotent: a field already there is
 * replaced by the same value. A result with no unsigned EVM transaction comes back unchanged.
 */
export function handoff<T extends Record<string, unknown>>(
  json: T,
): T & { readonly sendTransaction?: SendTransaction; readonly sendCalls?: SendCalls } {
  // A Pot that is there already: its deployment is not to be sent.
  if (json.deployed === true || deployedPot(json.deployment)) return json;
  const walked = walk(json, undefined);
  if (walked.carried.evm.length === 0) return json;

  return placeBatches(walked) as T;
}
