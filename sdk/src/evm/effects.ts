/**
 * What a rehearsed cook did, read back from the logs `eth_simulateV1` returns: the ERC-20
 * transfers and approvals (by registry symbol, in whole units), the native-currency transfers the
 * node traced (`traceTransfers`), and each address's net change. Nothing here reaches past the logs
 * except to name a token the registry does not: its own `symbol()` and `decimals()`.
 */
import {
  decodeAbiParameters,
  formatUnits,
  getAddress,
  hexToString,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chains } from "../chains/index.js";
import { sourceGlobals } from "../routes/source-globals.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";

/** A log as the node returned it. */
export interface RawLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
/** WETH9's `Deposit(address indexed dst, uint wad)` and `Withdrawal(address indexed src, uint wad)`:
 *  wrapping mints without a Transfer, unwrapping burns without one. */
const DEPOSIT = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
const WITHDRAWAL = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
/** Where a node's `traceTransfers` reports native-currency transfers, as ERC-20 Transfer logs. */
const NATIVE_EMITTER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** A token, as the output names it. `undefined` decimals print base units. */
export interface TokenInfo {
  readonly address: Address | "native";
  readonly symbol?: string;
  readonly decimals?: number;
}

export interface Movement {
  readonly token: Address | "native";
  readonly from: Address;
  readonly to: Address;
  readonly amount: bigint;
  /** A wrap or unwrap of the wrapped native token, which logs no Transfer. */
  readonly kind: "transfer" | "wrap" | "unwrap";
}

export interface ApprovalEvent {
  readonly token: Address;
  readonly owner: Address;
  readonly spender: Address;
  readonly amount: bigint;
}

export interface BalanceChange {
  readonly address: Address;
  readonly deltas: ReadonlyArray<{ readonly token: Address | "native"; readonly amount: bigint }>;
}

export interface Effects {
  /** Every token and native movement, in the order the logs record them. */
  readonly moves: readonly Movement[];
  readonly transfers: readonly Movement[];
  readonly approvals: readonly ApprovalEvent[];
  /** Native-currency transfers, or `undefined` when the node did not trace them. */
  readonly native?: readonly Movement[];
  readonly changes: readonly BalanceChange[];
  /** Every other log, undecoded. */
  readonly other: readonly RawLog[];
  readonly tokens: ReadonlyMap<string, TokenInfo>;
  readonly labels: ReadonlyMap<string, string>;
}

const topicAddress = (topic: Hex): Address => getAddress(`0x${topic.slice(26)}`);
const amountOf = (data: Hex): bigint | undefined =>
  data.length === 66 ? decodeAbiParameters([{ type: "uint256" }], data)[0] : undefined;

/** The native currency's symbol on `chain` (`ETH` where the chain record does not say). */
export const nativeSymbol = (chain: CanonicalChain): string =>
  chains[chain.id]?.nativeCurrency.symbol ?? "ETH";

/** Names for the addresses a cook on `chain` is likely to touch: the registry's tokens and protocol
 *  contracts, then `known` (the Pot, its owner, the Kitchen), which win. */
export function addressLabels(
  chain: CanonicalChain,
  known: ReadonlyArray<readonly [Address, string]>,
): Map<string, string> {
  const labels = new Map<string, string>();
  const globals = sourceGlobals(chain);
  for (const ns of [...globals.protocols].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "protocol" ? -1 : 1,
  )) {
    for (const contract of ns.contracts) {
      const key = getAddress(contract.address);
      if (!labels.has(key)) labels.set(key, `${ns.namespace}.${contract.name}`);
    }
  }
  for (const token of globals.tokens) labels.set(getAddress(token.address), token.symbol);
  for (const [address, label] of known) labels.set(getAddress(address), label);

  return labels;
}

const METADATA = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const SYMBOL_BYTES32 = parseAbi(["function symbol() view returns (bytes32)"]);

/** A token's symbol and decimals: the registry's, else its own; either may be missing. */
export async function tokenInfo(
  client: PublicClient,
  chain: CanonicalChain,
  token: Address,
): Promise<TokenInfo> {
  const row = (TOKEN_REGISTRY[chain.id] ?? []).find((entry) => getAddress(entry.address) === token);
  if (row !== undefined) return { address: token, symbol: row.symbol, decimals: row.decimals };
  const [symbol, decimals] = await Promise.all([
    client
      .readContract({ address: token, abi: METADATA, functionName: "symbol" })
      .catch(() =>
        client
          .readContract({ address: token, abi: SYMBOL_BYTES32, functionName: "symbol" })
          .then((raw) => hexToString(raw).replace(/\0+$/, "")),
      )
      .then((text) => (/^[\x20-\x7e]{1,32}$/.test(text) ? text : undefined))
      .catch(() => undefined),
    client
      .readContract({ address: token, abi: METADATA, functionName: "decimals" })
      .then(Number)
      .catch(() => undefined),
  ]);

  return {
    address: token,
    ...(symbol === undefined ? {} : { symbol }),
    ...(decimals === undefined ? {} : { decimals }),
  };
}

/** The cook's logs, decoded. `traced` says whether the node reported native transfers. */
export async function effectsOf(
  client: PublicClient,
  chain: CanonicalChain,
  logs: readonly RawLog[],
  traced: boolean,
  labels: ReadonlyMap<string, string>,
): Promise<Effects> {
  const native = nativeSymbol(chain);
  const wrapped = new Set(
    (TOKEN_REGISTRY[chain.id] ?? [])
      .filter((row) => row.symbol === `W${native}` || row.symbol === "WETH")
      .map((row) => getAddress(row.address)),
  );
  const moves: Movement[] = [];
  const transfers: Movement[] = [];
  const nativeMoves: Movement[] = [];
  const approvals: ApprovalEvent[] = [];
  const other: RawLog[] = [];
  for (const log of logs) {
    const emitter = getAddress(log.address);
    const [topic0, one, two] = log.topics;
    const amount = amountOf(log.data);
    const topic = topic0?.toLowerCase();
    if (topic === TRANSFER && log.topics.length === 3 && amount !== undefined) {
      const parties = { from: topicAddress(one!), to: topicAddress(two!), amount };
      const move: Movement =
        emitter === NATIVE_EMITTER
          ? { ...parties, token: "native", kind: "transfer" }
          : { ...parties, token: emitter, kind: "transfer" };
      (emitter === NATIVE_EMITTER ? nativeMoves : transfers).push(move);
      moves.push(move);
    } else if (topic === APPROVAL && log.topics.length === 3 && amount !== undefined) {
      approvals.push({
        token: emitter,
        owner: topicAddress(one!),
        spender: topicAddress(two!),
        amount,
      });
    } else if (
      (topic === DEPOSIT || topic === WITHDRAWAL) &&
      log.topics.length === 2 &&
      amount !== undefined &&
      wrapped.has(emitter)
    ) {
      const holder = topicAddress(one!);
      const move: Movement =
        topic === DEPOSIT
          ? { token: emitter, from: zeroAddress, to: holder, amount, kind: "wrap" }
          : { token: emitter, from: holder, to: zeroAddress, amount, kind: "unwrap" };
      transfers.push(move);
      moves.push(move);
    } else {
      other.push(log);
    }
  }

  const tokens = new Map<string, TokenInfo>([
    ["native", { address: "native", symbol: native, decimals: 18 }],
  ]);
  const addresses = [
    ...new Set([...transfers, ...approvals].map((event) => event.token as Address)),
  ];
  for (const info of await Promise.all(addresses.map((token) => tokenInfo(client, chain, token)))) {
    tokens.set(info.address, info);
  }

  // Each address's net change, in the order it first appears; the zero address (mints, burns) is
  // where tokens come from and go, not a holder.
  const net = new Map<string, Map<string, bigint>>();
  const add = (holder: Address, token: string, amount: bigint): void => {
    if (holder === zeroAddress) return;
    const deltas = net.get(holder) ?? new Map<string, bigint>();
    deltas.set(token, (deltas.get(token) ?? 0n) + amount);
    net.set(holder, deltas);
  };
  for (const move of [...transfers, ...nativeMoves]) {
    add(move.from, move.token, -move.amount);
    add(move.to, move.token, move.amount);
  }
  const changes = [...net]
    .map(([address, deltas]) => ({
      address: address as Address,
      deltas: [...deltas]
        .filter(([, amount]) => amount !== 0n)
        .map(([token, amount]) => ({ token: token as Address | "native", amount })),
    }))
    .filter((change) => change.deltas.length > 0);

  return {
    moves,
    transfers,
    approvals,
    ...(traced ? { native: nativeMoves } : {}),
    changes,
    other,
    tokens,
    labels,
  };
}

/** `amount` of `token` in whole units with its symbol, or in base units when its decimals are not
 *  known. */
export function formatAmount(
  effects: Pick<Effects, "tokens">,
  token: Address | "native",
  amount: bigint,
): string {
  const info = effects.tokens.get(token);
  const symbol = info?.symbol ?? (token === "native" ? "native" : token);
  if (info?.decimals === undefined) return `${amount} ${symbol} (base units)`;

  return `${formatUnits(amount, info.decimals)} ${symbol}`;
}

/** A whole-token amount in words: `1500000` is "1.5 million". */
export const wordsOf = (whole: string): string =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "long",
    maximumSignificantDigits: 6,
  }).format(Number(whole));

/** An address with what it is, when that is known: `0x… (the Pot)`. */
export const labelled = (labels: ReadonlyMap<string, string>, address: Address): string => {
  const label = labels.get(getAddress(address));

  return label === undefined ? address : `${address} (${label})`;
};

const signed = (effects: Effects, token: Address | "native", amount: bigint): string =>
  `${amount > 0n ? "+" : "-"}${formatAmount(effects, token, amount < 0n ? -amount : amount)}`;

/** What a holder held of one token before a cook, and after it. */
export interface Held {
  readonly token: Address | "native";
  readonly before: bigint;
  readonly after: bigint;
}

/**
 * What `holder` held, before the cook and after it, of each token the cook moved to or from it.
 * `read` gives its balance of a token on one side of the cook (`side`, before by default); the
 * other side is that plus or minus the cook's net change. A token `read` cannot answer for
 * (`undefined`) is left out.
 */
export async function heldAround(
  effects: Effects,
  holder: Address,
  read: (token: Address | "native") => Promise<bigint | undefined>,
  side: "before" | "after" = "before",
): Promise<Held[]> {
  const tokens = new Set<Address | "native">();
  for (const move of [...effects.transfers, ...(effects.native ?? [])]) {
    if (move.from === holder || move.to === holder) tokens.add(move.token);
  }
  const deltas = effects.changes.find((change) => change.address === holder)?.deltas ?? [];
  // Every balance at once: they are independent reads of one state.
  const held = await Promise.all(
    [...tokens].map(async (token) => {
      const known = await read(token);
      if (known === undefined) return undefined;
      const delta = deltas.find((entry) => entry.token === token)?.amount ?? 0n;

      return side === "before"
        ? { token, before: known, after: known + delta }
        : { token, before: known - delta, after: known };
    }),
  );

  return held.filter((each): each is Held => each !== undefined);
}

/** What a report says of a Pot's holdings after a cook: who can move them, and how a program
 *  delivers them instead. */
export const POT_HOLDS =
  "Only another cook moves it out. To end in a wallet, the program must send it there, or name " +
  "the wallet as the recipient of the call that produces it.";

/**
 * What the Pot ends holding of the tokens a cook moved, for a person: the lines that lead the
 * report, so nobody looks for them in their wallet. None for a cook that leaves the Pot nothing.
 * `wallet` names the wallet they are not in: "the owner's wallet", "your wallet".
 */
export function leftInPotLines(effects: Effects, held: readonly Held[], wallet: string): string[] {
  const left = held.filter((each) => each.after > 0n);
  if (left.length === 0) return [];

  return [
    `Left in the Pot, not in ${wallet}:`,
    ...left.map(
      (each) =>
        `  ${formatAmount(effects, each.token, each.after)}` +
        (each.before === 0n
          ? ""
          : ` (it held ${formatAmount(effects, each.token, each.before)} before)`),
    ),
    `  ${POT_HOLDS}`,
  ];
}

/** `0x0305…262a`: an address short enough for a column, the full one in `--json`. */
export const shortAddress = (address: Address): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * What `address` is in a cook, for a person: the command's own label for it, said as a role (the
 * owner, or the signer, is the `wallet`; `the Pot` is the `Pot`), a name the registry gives it, or
 * the symbol of a token it is. `undefined` for an address nothing names.
 */
export function roleOf(
  effects: Pick<Effects, "labels" | "tokens">,
  address: Address,
): string | undefined {
  const label = effects.labels.get(getAddress(address));
  if (label !== undefined) {
    const role = label.replace(/^the /, "");

    return role === "owner" || role === "you" ? "wallet" : role;
  }

  return effects.tokens.get(getAddress(address))?.symbol;
}

/** Why a move happened, where the command knows: the cook's value, the Kitchen's fee, a wrap. */
function moveNote(move: Movement, from: string | undefined, to: string | undefined): string {
  if (move.kind === "wrap") return "wrapped";
  if (move.kind === "unwrap") return "unwrapped";
  if (move.token !== "native") return "";
  if (from === "wallet" && to === "Pot") return "the cook's value";
  if (to === "Kitchen") return "the Kitchen's fee";

  return "";
}

/**
 * Every move of the cook as a numbered flow, in the order it happened: who sent, who received,
 * what, and why where the command knows. Each party is its role (`wallet`, `Pot`, `Kitchen`, a
 * registry name, a token's symbol) with its short address the first time it appears, `mint` or
 * `burn` for the zero address, and its short address alone when nothing names it.
 */
export function flowLines(effects: Effects): string[] {
  const seen = new Set<string>();
  const party = (address: Address, zero: "mint" | "burn"): string => {
    if (address === zeroAddress) return zero;
    const role = roleOf(effects, address);
    if (role === undefined) return shortAddress(address);
    if (seen.has(address)) return role;
    seen.add(address);

    return `${role} ${shortAddress(address)}`;
  };
  const rows = effects.moves.map((move, index) => {
    const from = party(move.from, "mint");
    const to = party(move.to, "burn");

    return {
      number: `[${index + 1}]`,
      from,
      to,
      amount: formatAmount(effects, move.token, move.amount),
      note: moveNote(move, roleOf(effects, move.from), roleOf(effects, move.to)),
    };
  });
  const width = (pick: (row: (typeof rows)[number]) => string): number =>
    Math.max(0, ...rows.map((row) => pick(row).length));
  const [numbers, froms, tos, amounts] = [
    width((row) => row.number),
    width((row) => row.from),
    width((row) => row.to),
    width((row) => row.amount),
  ];

  return rows
    .map(
      (row) =>
        `  ${row.number.padEnd(numbers)} ${row.from.padEnd(froms)} -> ${row.to.padEnd(tos)}  ` +
        (row.note === "" ? row.amount : `${row.amount.padEnd(amounts)}  ${row.note}`),
    )
    .map((line) => line.trimEnd());
}

/** The effects as lines for a person. */
export function effectLines(effects: Effects): string[] {
  const at = (address: Address): string => {
    const name =
      effects.labels.get(getAddress(address)) ?? effects.tokens.get(getAddress(address))?.symbol;

    return name === undefined ? address : `${address} (${name})`;
  };
  const lines: string[] = [];
  if (effects.moves.length > 0) lines.push("What moved, in order:", ...flowLines(effects));
  if (effects.approvals.length > 0) {
    lines.push("Approvals:");
    for (const approval of effects.approvals) {
      lines.push(
        `  ${at(approval.owner)} lets ${at(approval.spender)} spend ` +
          `${formatAmount(effects, approval.token, approval.amount)}`,
      );
    }
  }
  if (effects.changes.length > 0) {
    lines.push("Net balance changes:");
    for (const change of effects.changes) {
      lines.push(
        `  ${at(change.address)}: ` +
          change.deltas.map((delta) => signed(effects, delta.token, delta.amount)).join(", "),
      );
    }
  }
  if (effects.native === undefined) {
    lines.push("Native transfers: not reported (the endpoint did not trace them)");
  }
  if (effects.other.length > 0) {
    const emitters = new Map<string, number>();
    for (const log of effects.other) {
      const key = getAddress(log.address);
      emitters.set(key, (emitters.get(key) ?? 0) + 1);
    }
    lines.push(
      `Other events: ${effects.other.length}, from ` +
        [...emitters].map(([address, count]) => `${at(address as Address)} x${count}`).join(", ") +
        " (--json lists them)",
    );
  }
  if (lines.length === 0) lines.push("It moved no tokens and logged nothing.");

  return lines;
}

const tokenJson = (effects: Effects, token: Address | "native") => {
  const info = effects.tokens.get(token);

  return {
    token,
    ...(info?.symbol === undefined ? {} : { symbol: info.symbol }),
    ...(info?.decimals === undefined ? {} : { decimals: info.decimals }),
  };
};

const units = (effects: Effects, token: Address | "native", amount: bigint) => {
  const decimals = effects.tokens.get(token)?.decimals;

  return decimals === undefined ? {} : { formatted: formatUnits(amount, decimals) };
};

/** What the Pot ends holding of the tokens a cook moved, for `--json` (`leftInPot`): each token it
 *  holds after the cook, with what it held before. Empty for a cook that leaves the Pot nothing. */
export const leftInPotJson = (
  effects: Effects,
  held: readonly Held[],
): Array<Record<string, unknown>> =>
  held
    .filter((each) => each.after > 0n)
    .map((each) => ({
      ...tokenJson(effects, each.token),
      amount: each.after.toString(),
      ...units(effects, each.token, each.after),
      before: each.before.toString(),
    }));

/** One move for `--json` (`moves`): its parties with their roles where the command knows them. */
export interface MoveJson {
  readonly from: Address;
  /** `wallet`, `Pot`, `Kitchen`, a registry name, a token's symbol, or `mint`. */
  readonly fromRole?: string;
  readonly to: Address;
  /** The same, or `burn`. */
  readonly toRole?: string;
  readonly token: Address | "native";
  readonly symbol?: string;
  readonly decimals?: number;
  readonly kind: Movement["kind"];
  /** Base units, as a decimal string; `formatted` in whole units where the decimals are known. */
  readonly amount: string;
  readonly formatted?: string;
  /** Why it moved, where the command knows: the cook's value, the Kitchen's fee, a wrap. */
  readonly note?: string;
}

/** The effects for `--json`: amounts in base units as decimal strings, with whole units beside. */
export function effectsJson(effects: Effects): Record<string, unknown> {
  const label = (address: Address) => {
    const name = effects.labels.get(getAddress(address));

    return name === undefined ? {} : { label: name };
  };

  const role = (address: Address, zero: "mint" | "burn") =>
    address === zeroAddress ? zero : roleOf(effects, address);

  return {
    moves: effects.moves.map((move): MoveJson => {
      const fromRole = role(move.from, "mint");
      const toRole = role(move.to, "burn");
      const note = moveNote(move, fromRole, toRole);

      return {
        from: move.from,
        ...(fromRole === undefined ? {} : { fromRole }),
        to: move.to,
        ...(toRole === undefined ? {} : { toRole }),
        ...tokenJson(effects, move.token),
        kind: move.kind,
        amount: move.amount.toString(),
        ...units(effects, move.token, move.amount),
        ...(note === "" ? {} : { note }),
      };
    }),
    transfers: effects.transfers.map((move) => ({
      ...tokenJson(effects, move.token),
      kind: move.kind,
      from: move.from,
      to: move.to,
      amount: move.amount.toString(),
      ...units(effects, move.token, move.amount),
    })),
    approvals: effects.approvals.map((approval) => ({
      ...tokenJson(effects, approval.token),
      owner: approval.owner,
      spender: approval.spender,
      amount: approval.amount.toString(),
      ...units(effects, approval.token, approval.amount),
    })),
    nativeTransfers:
      effects.native === undefined
        ? null
        : effects.native.map((move) => ({
            from: move.from,
            to: move.to,
            amount: move.amount.toString(),
            ...units(effects, "native", move.amount),
          })),
    balanceChanges: effects.changes.map((change) => ({
      address: change.address,
      ...label(change.address),
      deltas: change.deltas.map((delta) => ({
        ...tokenJson(effects, delta.token),
        amount: delta.amount.toString(),
        ...units(effects, delta.token, delta.amount),
      })),
    })),
    otherLogs: effects.other.map((log) => ({
      address: getAddress(log.address),
      topics: log.topics,
      data: log.data,
    })),
  };
}
