/**
 * What a simulated Solana cook moved: each writable account of the transaction read before it and
 * as the simulation leaves it (`simulateTransaction`'s `accounts`, through the SDK client's
 * `simulate`), and the difference — the SPL token balances of the token accounts among them, and
 * every account's lamports. The Solana counterpart of `effects.ts`, which reads an EVM cook's logs;
 * an SPL transfer logs nothing a client can decode, so the accounts themselves are the record.
 */
import {
  address,
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
import { POT_HOLDS } from "../evm/effects.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

/** SPL Token and Token-2022: the programs whose accounts hold a token balance. */
const TOKEN_PROGRAMS = new Set<string>([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
/**
 * An SPL token account's base layout, which a Token-2022 account shares at its start, 165 bytes in
 * all: mint (32), owner (32), amount (u64 LE), delegate (a u32 tag, then a key), state (1),
 * is_native (a u32 tag, then the rent it keeps as a u64), delegated amount (u64), close authority
 * (a u32 tag, then a key). A tag is 1 where the value is there.
 */
const TOKEN_ACCOUNT_SIZE = 165;
const DELEGATE_AT = 72;
const IS_NATIVE_AT = 109;
const DELEGATED_AMOUNT_AT = 121;
const CLOSE_AUTHORITY_AT = 129;
/** Token-2022 marks an extended account's kind at byte 165: 2 is a token account, 1 a mint. */
const ACCOUNT_TYPE_TOKEN = 2;
/** A mint's decimals: after its optional authority (4 + 32 bytes) and its supply (8). */
const MINT_DECIMALS_AT = 44;
/** The System program, which owns wallets and durable nonce accounts. */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/**
 * A durable nonce account (the System program's, 80 bytes): its version (u32), its state (u32, 1
 * once initialized), then its authority, the key that may withdraw from it or name another.
 */
const NONCE_ACCOUNT_SIZE = 80;
const NONCE_INITIALIZED = 1;
const NONCE_AUTHORITY_AT = 8;
/**
 * A stake account (the Stake program's): its state (u32: 1 initialized, 2 delegated), its rent
 * reserve (u64), its staker, then its withdrawer, the key that may withdraw from it or name another.
 */
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const STAKE_WITHDRAWER_AT = 44;

export interface LamportChange {
  readonly account: Address;
  readonly before: bigint;
  readonly after: bigint;
}

export interface TokenChange {
  readonly account: Address;
  readonly mint: Address;
  /**
   * Whose token account it was before the transaction (its SPL owner, the authority that may move
   * it), and so whose balance changed; whose it is, for one the transaction created.
   */
  readonly owner: Address;
  /** Whose it is after the transaction, where the transaction handed it to another key. */
  readonly ownerAfter?: Address;
  readonly before: bigint;
  readonly after: bigint;
  readonly decimals?: number;
  readonly symbol?: string;
}

/** A token account as its program records it, in either program. */
export interface TokenAccountState {
  /** The token program that owns it: SPL Token or Token-2022. */
  readonly program: Address;
  readonly mint: Address;
  /** Its SPL owner: who may move it, approve a delegate, hand it over and close it. */
  readonly owner: Address;
  readonly amount: bigint;
  /** Who else may move up to `delegatedAmount` of it, if anyone. */
  readonly delegate?: Address;
  readonly delegatedAmount: bigint;
  /** Who may close it in the owner's stead, if anyone: closing it pays its lamports out. */
  readonly closeAuthority?: Address;
  /** Wrapped SOL: its amount is lamports it holds above its rent. */
  readonly isNative: boolean;
}

/**
 * One address's token account before and after a transaction, as the same asset: where the
 * transaction closed it and made another at that address (another mint, or the other token
 * program), the one before is gone (`was` alone counts it) and the one after is new (`is`, with no
 * `was`). An amount compared across that would net one asset against another.
 */
export interface TokenTransition {
  /** The account before, of the same asset as `is` when both are there. */
  readonly was?: TokenAccountState;
  /** The account after. */
  readonly is?: TokenAccountState;
  /** The account before, where the transaction replaced it with one of another asset. */
  readonly replaced?: TokenAccountState;
}

/** `before` and `after` of one address as a {@link TokenTransition}. */
export function tokenTransition(
  before: SimulatedAccount | null,
  after: SimulatedAccount | null,
): TokenTransition {
  const was = tokenAccount(before);
  const is = tokenAccount(after);
  if (
    was !== undefined &&
    is !== undefined &&
    (was.mint !== is.mint || was.program !== is.program)
  ) {
    return { replaced: was, is };
  }

  return {
    ...(was === undefined ? {} : { was }),
    ...(is === undefined ? {} : { is }),
  };
}

/**
 * What a first run pays before the cook, which a simulation in a local copy does for nothing: rent
 * for an account the run creates (the Pot, a token account, a code buffer, a lookup table), and
 * the fees of the transactions that come before the cook.
 */
export interface SvmSetupCost {
  /** What it pays for, for a person. */
  readonly what: string;
  readonly lamports: bigint;
  /** Rent that comes back, and when: the code buffer's, closed after the cook. */
  readonly back?: string;
}

export interface SvmMoved {
  readonly tokens: readonly TokenChange[];
  readonly lamports: readonly LamportChange[];
  readonly labels: ReadonlyMap<string, string>;
  /** The transaction's fee payer, whose lamports include the fee. */
  readonly payer: Address;
  /** What the payer pays before the cook, where the simulation did it for nothing. */
  readonly setup?: readonly SvmSetupCost[];
}

/** What the payer pays in all: what the cook took from it, and everything before the cook. */
const payerTotal = (moved: SvmMoved): bigint => {
  const cook = moved.lamports.find((change) => change.account === moved.payer);
  const spent = cook === undefined ? 0n : cook.before - cook.after;

  return spent + (moved.setup ?? []).reduce((sum, cost) => sum + cost.lamports, 0n);
};

/** Lamports as SOL, for a person. */
const sol = (lamports: bigint): string => `${formatUnits(lamports, 9)} SOL`;

/**
 * Every account of `transaction`'s message, in the order a transaction error's `account_index`
 * counts them: its own, then those it loads from `lookupTables`, writable before read-only.
 */
export function messageAccounts(
  transaction: Transaction,
  lookupTables: AddressesByLookupTableAddress = {},
): Address[] {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    staticAccounts?: readonly Address[];
    addressTableLookups?: readonly {
      lookupTableAddress: Address;
      writableIndexes: readonly number[];
      readonlyIndexes: readonly number[];
    }[];
  };
  const lookups = message.addressTableLookups ?? [];
  const loaded = (pick: "writableIndexes" | "readonlyIndexes") =>
    lookups.flatMap((lookup) =>
      lookup[pick].flatMap((index) => lookupTables[lookup.lookupTableAddress]?.[index] ?? []),
    );

  return [
    ...(message.staticAccounts ?? []),
    ...loaded("writableIndexes"),
    ...loaded("readonlyIndexes"),
  ];
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

/** `account` as a token account of either program, or `undefined` for any other account. */
export function tokenAccount(account: SimulatedAccount | null): TokenAccountState | undefined {
  if (account === null || !TOKEN_PROGRAMS.has(account.owner)) return undefined;
  const { data } = account;
  if (
    data.length < TOKEN_ACCOUNT_SIZE ||
    (data.length > TOKEN_ACCOUNT_SIZE && data[TOKEN_ACCOUNT_SIZE] !== ACCOUNT_TYPE_TOKEN)
  ) {
    return undefined;
  }
  const decoder = getAddressDecoder();
  const view = new DataView(data.buffer, data.byteOffset);
  const key = (at: number): Address | undefined =>
    view.getUint32(at, true) === 1 ? decoder.decode(data.subarray(at + 4, at + 36)) : undefined;
  const delegate = key(DELEGATE_AT);
  const closeAuthority = key(CLOSE_AUTHORITY_AT);

  return {
    program: account.owner,
    mint: decoder.decode(data.subarray(0, 32)),
    owner: decoder.decode(data.subarray(32, 64)),
    amount: view.getBigUint64(64, true),
    ...(delegate === undefined ? {} : { delegate }),
    delegatedAmount: view.getBigUint64(DELEGATED_AMOUNT_AT, true),
    ...(closeAuthority === undefined ? {} : { closeAuthority }),
    isNative: view.getUint32(IS_NATIVE_AT, true) === 1,
  };
}

/**
 * The keys that may take `account`'s lamports, where its layout names them: a token account's
 * owner, and its close authority where it has one (closing it pays them out); a durable nonce
 * account's authority; a stake account's withdrawer. `undefined` for an account of any other
 * layout, whose lamports only its own program knows who may move.
 */
export function lamportKeys(account: SimulatedAccount | null): readonly Address[] | undefined {
  if (account === null) return undefined;
  const token = tokenAccount(account);
  if (token !== undefined) {
    return token.closeAuthority === undefined ? [token.owner] : [token.owner, token.closeAuthority];
  }
  const { data } = account;
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const keyAt = (at: number) => getAddressDecoder().decode(data.subarray(at, at + 32));
  if (
    account.owner === SYSTEM_PROGRAM &&
    data.length === NONCE_ACCOUNT_SIZE &&
    view.getUint32(4, true) === NONCE_INITIALIZED
  ) {
    return [keyAt(NONCE_AUTHORITY_AT)];
  }
  if (account.owner === STAKE_PROGRAM && data.length >= STAKE_WITHDRAWER_AT + 32) {
    const state = view.getUint32(0, true);
    if (state === 1 || state === 2) return [keyAt(STAKE_WITHDRAWER_AT)];
  }

  return undefined;
}

/**
 * Whether `account` is held under a layout {@link lamportKeys} does not read, by a program other
 * than the System program (which moves a data-less account's lamports only on its own signature),
 * and names one of `keys` anywhere in its data: an account whose lamports one of them might command.
 */
export function namesAnyOf(account: SimulatedAccount, keys: readonly string[]): boolean {
  if (account.owner === SYSTEM_PROGRAM || lamportKeys(account) !== undefined) return false;
  const { data } = account;
  const encoder = getAddressEncoder();

  return keys.some((key) => {
    const bytes = encoder.encode(address(key));
    for (let at = data.indexOf(bytes[0]!); at !== -1 && at + 32 <= data.length;) {
      if (bytes.every((byte, offset) => data[at + offset] === byte)) return true;
      at = data.indexOf(bytes[0]!, at + 1);
    }

    return false;
  });
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

/** A mint's decimals and the registry's symbol for it, where they are known. */
export interface MintFacts {
  readonly decimals?: number;
  readonly symbol?: string;
}

/**
 * Each of `mints`' decimals and the registry's symbol for it. The decimals are read from the mint
 * as `images` holds it (what a simulation leaves of an account the transaction writes, which a mint
 * it creates has nowhere else), else from the cluster, else taken from the registry.
 */
export async function mintFacts(
  rpc: Rpc,
  chain: CanonicalChain,
  mints: readonly Address[],
  images: ReadonlyMap<string, SimulatedAccount | null> = new Map(),
): Promise<Map<string, MintFacts>> {
  const facts = new Map<string, MintFacts>();
  const unique = [...new Set(mints)];
  if (unique.length === 0) return facts;
  const read = await accountsNow(rpc, unique).catch(() => unique.map(() => null));
  const registered = sourceGlobals(chain).tokens;
  unique.forEach((mint, index) => {
    const account = images.get(mint) ?? read[index] ?? null;
    const row = registryRow(registered, mint);
    const decimals =
      account !== null && account.data.length > MINT_DECIMALS_AT
        ? account.data[MINT_DECIMALS_AT]!
        : row?.decimals;
    facts.set(mint, {
      ...(decimals === undefined ? {} : { decimals }),
      ...(row?.symbol === undefined ? {} : { symbol: row.symbol }),
    });
  });

  return facts;
}

/**
 * What changed between `before` and `after` for each of `tracked`: the token accounts' balances
 * (a token account the cook created starts at 0, one it closed ends at 0, and one it closed and
 * made again at the same address for another asset is both), and every account's lamports. A
 * balance change counts for whose the account was before (the transaction may hand it to another
 * key after moving what it holds), and each mint's decimals and symbol are {@link mintFacts}'.
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
    const lamportsBefore = before[index]?.lamports ?? 0n;
    const lamportsAfter = after[index]?.lamports ?? 0n;
    if (lamportsBefore !== lamportsAfter) {
      lamports.push({ account, before: lamportsBefore, after: lamportsAfter });
    }
    const { was, is, replaced } = tokenTransition(before[index] ?? null, after[index] ?? null);
    if (replaced !== undefined && replaced.amount > 0n) {
      tokens.push({
        account,
        mint: replaced.mint,
        owner: replaced.owner,
        before: replaced.amount,
        after: 0n,
      });
    }
    const seen = was ?? is;
    if (seen === undefined) return;
    const amountBefore = was?.amount ?? 0n;
    const amountAfter = is?.amount ?? 0n;
    if (amountBefore !== amountAfter) {
      tokens.push({
        account,
        mint: seen.mint,
        owner: seen.owner,
        ...(is === undefined || is.owner === seen.owner ? {} : { ownerAfter: is.owner }),
        before: amountBefore,
        after: amountAfter,
      });
    }
  });
  const facts = await mintFacts(
    rpc,
    chain,
    tokens.map((change) => change.mint),
    new Map(tracked.map((account, index) => [account, after[index] ?? null])),
  );

  return {
    tokens: tokens.map((change) => ({ ...change, ...facts.get(change.mint) })),
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
        `  ${named(moved, change.account)}, owned by ${named(moved, change.owner)}` +
          (change.ownerAfter === undefined
            ? ""
            : `, handed to ${named(moved, change.ownerAfter)} by the transaction`) +
          `: ${signed(change.after - change.before, change.decimals, unit)}`,
      );
    }
  }
  if (moved.lamports.length > 0 || (moved.setup ?? []).length > 0) {
    lines.push("Lamport changes:");
    for (const change of moved.lamports) {
      const delta = change.after - change.before;
      lines.push(
        `  ${named(moved, change.account)}: ${delta < 0n ? "" : "+"}${delta} lamports` +
          (change.account === moved.payer ? ", the transaction's fee included" : ""),
      );
    }
  }
  if ((moved.setup ?? []).length > 0) {
    const setup = moved.setup!;
    lines.push(`Before the cook, ${named(moved, moved.payer)} also pays:`);
    for (const cost of setup) {
      lines.push(
        `  ${cost.what}: -${cost.lamports} lamports` +
          (cost.back === undefined ? "" : `, back ${cost.back}`),
      );
    }
    const total = payerTotal(moved);
    const back = setup.reduce(
      (sum, cost) => sum + (cost.back === undefined ? 0n : cost.lamports),
      0n,
    );
    lines.push(
      `In all, ${named(moved, moved.payer)} pays ${total} lamports (${sol(total)})` +
        (back === 0n ? "" : `, ${back} of them (${sol(back)}) back once the run is done`),
    );
  }
  if (lines.length === 0) lines.push("It changed no token balance and no account's lamports.");

  return lines;
}

/** The Pot's token accounts the cook changed and leaves holding something: what the cook leaves in
 *  the Pot, not in the owner's wallet. An account it hands the Pot counts; one it hands away does
 *  not. */
export const svmLeftInPot = (moved: SvmMoved, pot: Address): TokenChange[] =>
  moved.tokens.filter((change) => (change.ownerAfter ?? change.owner) === pot && change.after > 0n);

const amountOf = (change: TokenChange, amount: bigint): string =>
  change.decimals === undefined
    ? `${amount} ${change.symbol ?? `of mint ${change.mint}`} (base units)`
    : `${formatUnits(amount, change.decimals)} ${change.symbol ?? `of mint ${change.mint}`}`;

/**
 * What the cook leaves in the Pot, for a person: the lines that lead the report, so nobody looks
 * for it in their wallet. None for a cook that leaves the Pot nothing.
 */
export function svmLeftInPotLines(left: readonly TokenChange[], wallet: string): string[] {
  if (left.length === 0) return [];

  return [
    `Left in the Pot, not in ${wallet}:`,
    ...left.map(
      (change) =>
        `  ${amountOf(change, change.after)}, in ${change.account}` +
        (change.before === 0n ? "" : ` (it held ${amountOf(change, change.before)} before)`),
    ),
    `  ${POT_HOLDS}`,
  ];
}

/** What the cook leaves in the Pot, for a program (`leftInPot`): each token account of the Pot's
 *  that ends holding something, with what it held before. */
export const svmLeftInPotJson = (left: readonly TokenChange[]): Array<Record<string, unknown>> =>
  left.map((change) => ({
    account: change.account,
    mint: change.mint,
    ...(change.symbol === undefined ? {} : { symbol: change.symbol }),
    amount: change.after.toString(),
    ...(change.decimals === undefined
      ? {}
      : { decimals: change.decimals, formatted: formatUnits(change.after, change.decimals) }),
    before: change.before.toString(),
  }));

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
      ...(change.ownerAfter === undefined ? {} : { ownerAfter: change.ownerAfter }),
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
    ...(moved.setup === undefined
      ? {}
      : {
          setupCosts: moved.setup.map((cost) => ({
            what: cost.what,
            lamports: cost.lamports.toString(),
            ...(cost.back === undefined ? {} : { back: cost.back }),
          })),
          payerPays: payerTotal(moved).toString(),
        }),
  };
}
