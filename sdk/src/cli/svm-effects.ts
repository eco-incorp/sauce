/**
 * What a simulated Solana cook moved: each writable account of the transaction read before it and
 * as the simulation leaves it (`simulateTransaction`'s `accounts`, through the SDK client's
 * `simulate`), and the difference — the SPL token balances of the token accounts among them, and
 * every account's lamports. The Solana counterpart of `effects.ts`, which reads an EVM cook's logs;
 * an SPL transfer logs nothing a client can decode, so the accounts themselves are the record.
 */
import {
  getAddressDecoder,
  getAddressEncoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Address,
  type AddressesByLookupTableAddress,
  type createSolanaRpc,
  type Transaction,
} from "@solana/kit";
import { bytesToHex, formatUnits } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { sourceGlobals } from "../routes/source-globals.js";
import type { SimulatedAccount } from "../svm/index.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

/** SPL Token and Token-2022: the programs whose accounts hold a token balance. */
const TOKEN_PROGRAMS = new Set<string>([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
/** An SPL token account's base layout: mint, owner, amount (u64 LE), and 165 bytes in all. */
const TOKEN_ACCOUNT_SIZE = 165;
/** Token-2022 marks an extended account's kind at byte 165: 2 is a token account, 1 a mint. */
const ACCOUNT_TYPE_TOKEN = 2;
/** A mint's decimals: after its optional authority (4 + 32 bytes) and its supply (8). */
const MINT_DECIMALS_AT = 44;

export interface LamportChange {
  readonly account: Address;
  readonly before: bigint;
  readonly after: bigint;
}

export interface TokenChange {
  readonly account: Address;
  readonly mint: Address;
  /** Whose token account it is (its SPL owner, the authority that may move it). */
  readonly owner: Address;
  readonly before: bigint;
  readonly after: bigint;
  readonly decimals?: number;
  readonly symbol?: string;
}

export interface SvmMoved {
  readonly tokens: readonly TokenChange[];
  readonly lamports: readonly LamportChange[];
  readonly labels: ReadonlyMap<string, string>;
  /** The transaction's fee payer, whose lamports include the fee. */
  readonly payer: Address;
}

/**
 * The writable accounts of `transaction`'s message, in its order: everything a cook can change —
 * its own, then those it loads writable from `lookupTables` (each table's addresses, as the
 * message was compressed against).
 */
export function writableAccounts(
  transaction: Transaction,
  lookupTables: AddressesByLookupTableAddress = {},
): Address[] {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    header?: {
      numSignerAccounts: number;
      numReadonlySignerAccounts: number;
      numReadonlyNonSignerAccounts: number;
    };
    staticAccounts?: readonly Address[];
    addressTableLookups?: readonly {
      lookupTableAddress: Address;
      writableIndexes: readonly number[];
    }[];
  };
  const { header, staticAccounts } = message;
  if (header === undefined || staticAccounts === undefined) return [];
  const signers = header.numSignerAccounts;
  const loaded = (message.addressTableLookups ?? []).flatMap(
    ({ lookupTableAddress, writableIndexes }) =>
      writableIndexes.flatMap((index) => lookupTables[lookupTableAddress]?.[index] ?? []),
  );

  return [
    ...staticAccounts.filter((_, index) =>
      index < signers
        ? index < signers - header.numReadonlySignerAccounts
        : index < staticAccounts.length - header.numReadonlyNonSignerAccounts,
    ),
    ...loaded,
  ];
}

const bytesOf = (base64: string): Uint8Array => new Uint8Array(getBase64Encoder().encode(base64));

/** `addresses` as they are now, `null` where an account does not exist. */
export async function accountsNow(
  rpc: Rpc,
  addresses: readonly Address[],
): Promise<(SimulatedAccount | null)[]> {
  if (addresses.length === 0) return [];
  const { value } = await rpc.getMultipleAccounts([...addresses], { encoding: "base64" }).send();

  return value.map((account) =>
    account === null
      ? null
      : {
          lamports: BigInt(account.lamports),
          owner: account.owner,
          data: bytesOf(account.data[0]),
          executable: account.executable,
        },
  );
}

/** A token account's mint, owner and amount, or `undefined` for any other account. */
function tokenAccount(
  account: SimulatedAccount | null,
): { mint: Address; owner: Address; amount: bigint } | undefined {
  if (account === null || !TOKEN_PROGRAMS.has(account.owner)) return undefined;
  const { data } = account;
  if (
    data.length < TOKEN_ACCOUNT_SIZE ||
    (data.length > TOKEN_ACCOUNT_SIZE && data[TOKEN_ACCOUNT_SIZE] !== ACCOUNT_TYPE_TOKEN)
  ) {
    return undefined;
  }
  const decoder = getAddressDecoder();

  return {
    mint: decoder.decode(data.subarray(0, 32)),
    owner: decoder.decode(data.subarray(32, 64)),
    amount: new DataView(data.buffer, data.byteOffset).getBigUint64(64, true),
  };
}

/** The registry's row for `mint` among `tokens`, matched by base58 or by its 32 bytes in hex. */
function registryRow(
  tokens: ReturnType<typeof sourceGlobals>["tokens"],
  mint: Address,
): { readonly symbol: string; readonly decimals?: number } | undefined {
  const hex = bytesToHex(new Uint8Array(getAddressEncoder().encode(mint))).toLowerCase();

  return tokens.find(
    (token) => token.address === mint || String(token.address).toLowerCase() === hex,
  );
}

/**
 * What changed between `before` and `after` for each of `tracked`: the token accounts' balances
 * (a token account the cook created starts at 0, one it closed ends at 0), and every account's
 * lamports. Each mint's decimals are read from the cluster, else taken from the registry, which
 * also names a mint it records.
 */
export async function movedBy(
  rpc: Rpc,
  chain: CanonicalChain,
  tracked: readonly Address[],
  before: readonly (SimulatedAccount | null)[],
  after: readonly (SimulatedAccount | null)[],
  labels: ReadonlyMap<string, string>,
  payer: Address,
): Promise<SvmMoved> {
  const tokens: Array<Omit<TokenChange, "decimals" | "symbol">> = [];
  const lamports: LamportChange[] = [];
  tracked.forEach((account, index) => {
    const was = before[index] ?? null;
    const is = after[index] ?? null;
    const lamportsBefore = was?.lamports ?? 0n;
    const lamportsAfter = is?.lamports ?? 0n;
    if (lamportsBefore !== lamportsAfter) {
      lamports.push({ account, before: lamportsBefore, after: lamportsAfter });
    }
    const held = tokenAccount(was);
    const holds = tokenAccount(is);
    const seen = holds ?? held;
    if (seen === undefined) return;
    const amountBefore = held?.amount ?? 0n;
    const amountAfter = holds?.amount ?? 0n;
    if (amountBefore !== amountAfter) {
      tokens.push({
        account,
        mint: seen.mint,
        owner: seen.owner,
        before: amountBefore,
        after: amountAfter,
      });
    }
  });
  const mints = [...new Set(tokens.map((change) => change.mint))];
  const decimals = new Map<string, number>();
  if (mints.length > 0) {
    const read = await accountsNow(rpc, mints).catch(() => mints.map(() => null));
    read.forEach((account, index) => {
      if (account !== null && account.data.length > MINT_DECIMALS_AT) {
        decimals.set(mints[index]!, account.data[MINT_DECIMALS_AT]!);
      }
    });
  }

  const registered = tokens.length === 0 ? [] : sourceGlobals(chain).tokens;

  return {
    tokens: tokens.map((change) => {
      const row = registryRow(registered, change.mint);
      const places = decimals.get(change.mint) ?? row?.decimals;
      const symbol = row?.symbol;

      return {
        ...change,
        ...(places === undefined ? {} : { decimals: places }),
        ...(symbol === undefined ? {} : { symbol }),
      };
    }),
    lamports,
    labels,
    payer,
  };
}

const named = (moved: SvmMoved, account: Address): string => {
  const label = moved.labels.get(account);

  return label === undefined ? account : `${account} (${label})`;
};

const signed = (amount: bigint, decimals: number | undefined, unit: string): string => {
  const size = amount < 0n ? -amount : amount;
  const text =
    decimals === undefined
      ? `${size} ${unit} (base units)`
      : `${formatUnits(size, decimals)} ${unit}`;

  return `${amount < 0n ? "-" : "+"}${text}`;
};

/** What moved, for a person. */
export function svmMovedLines(moved: SvmMoved): string[] {
  const lines: string[] = [];
  if (moved.tokens.length > 0) {
    lines.push("Token balance changes:");
    for (const change of moved.tokens) {
      const unit = change.symbol ?? `of mint ${change.mint}`;
      lines.push(
        `  ${named(moved, change.account)}, owned by ${named(moved, change.owner)}: ` +
          signed(change.after - change.before, change.decimals, unit),
      );
    }
  }
  if (moved.lamports.length > 0) {
    lines.push("Lamport changes:");
    for (const change of moved.lamports) {
      const delta = change.after - change.before;
      lines.push(
        `  ${named(moved, change.account)}: ${delta < 0n ? "" : "+"}${delta} lamports` +
          (change.account === moved.payer ? ", the transaction's fee included" : ""),
      );
    }
  }
  if (lines.length === 0) lines.push("It changed no token balance and no account's lamports.");

  return lines;
}

/** What moved, for a program: amounts in base units as decimal strings. */
export function svmMovedJson(moved: SvmMoved): Record<string, unknown> {
  const label = (account: Address) => {
    const name = moved.labels.get(account);

    return name === undefined ? {} : { label: name };
  };

  return {
    tokenChanges: moved.tokens.map((change) => ({
      account: change.account,
      ...label(change.account),
      mint: change.mint,
      ...(change.symbol === undefined ? {} : { symbol: change.symbol }),
      owner: change.owner,
      before: change.before.toString(),
      after: change.after.toString(),
      delta: (change.after - change.before).toString(),
      ...(change.decimals === undefined
        ? {}
        : {
            decimals: change.decimals,
            formatted: formatUnits(change.after - change.before, change.decimals),
          }),
    })),
    lamportChanges: moved.lamports.map((change) => ({
      account: change.account,
      ...label(change.account),
      before: change.before.toString(),
      after: change.after.toString(),
      delta: (change.after - change.before).toString(),
    })),
  };
}
