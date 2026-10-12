/**
 * Jupiter's swap aggregator (v6) on Solana: the program its Swap API's instructions call, and the
 * two of its instructions a route is built as.
 *
 * Program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, the id Jupiter's own documentation and
 * every `/swap/v1/swap-instructions` answer give for its swap instruction. Not a pool: it routes
 * through the pools of other programs, so it has no adapter in `registry.ts`; this module records
 * the program and reads what an instruction of it says.
 *
 * `route` and `shared_accounts_route` (Anchor discriminators: sha256 of `global:<name>`, first 8
 * bytes) end with the same four fields, after the variable-length route plan:
 * `in_amount: u64, quoted_out_amount: u64, slippage_bps: u16, platform_fee_bps: u8`, little-endian
 * — the last 19 bytes of the data. Jupiter refuses an output below
 * `quoted_out_amount * (10000 - slippage_bps) / 10000`.
 *
 * Accounts at fixed positions, before the route's own:
 *   - `route`: 0 token program, 1 user transfer authority (the signer), 2 user source token
 *     account, 3 user destination token account, 4 destination token account, 5 destination mint,
 *     6 platform fee account, 7 event authority, 8 program.
 *   - `shared_accounts_route`: 0 token program, 1 program authority, 2 user transfer authority (the
 *     signer), 3 source token account, 4 program source token account, 5 program destination token
 *     account, 6 destination token account, 7 source mint, 8 destination mint, 9 platform fee
 *     account, 10 Token-2022 program, 11 event authority, 12 program.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";

/** Jupiter's aggregator program (v6). */
export const JUPITER_AGGREGATOR_PROGRAM_ID: Address = address(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);

/** `route`'s Anchor discriminator. */
export const JUPITER_ROUTE_DISCRIMINATOR = Uint8Array.from([
  0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a,
]);

/** `shared_accounts_route`'s Anchor discriminator. */
export const JUPITER_SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR = Uint8Array.from([
  0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81,
]);

/** Where an instruction's own accounts sit: the signer, the user's two token accounts, and the
 *  destination mint. */
export interface JupiterRouteAccounts {
  readonly authority: number;
  readonly source: number;
  readonly destination: number;
  readonly destinationMint: number;
}

/** What a `route` or `shared_accounts_route` instruction's data says, and where. */
export interface JupiterRouteData {
  readonly instruction: "route" | "shared_accounts_route";
  readonly accounts: JupiterRouteAccounts;
  readonly inAmount: bigint;
  readonly quotedOutAmount: bigint;
  readonly slippageBps: number;
  readonly platformFeeBps: number;
  /** Byte offsets of `in_amount` and `quoted_out_amount` (u64), and `slippage_bps` (u16). */
  readonly offsets: {
    readonly inAmount: number;
    readonly quotedOutAmount: number;
    readonly slippageBps: number;
  };
}

const ROUTE_ACCOUNTS: JupiterRouteAccounts = {
  authority: 1,
  source: 2,
  destination: 3,
  destinationMint: 5,
};

const SHARED_ACCOUNTS_ROUTE_ACCOUNTS: JupiterRouteAccounts = {
  authority: 2,
  source: 3,
  destination: 6,
  destinationMint: 8,
};

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean =>
  data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

const u64At = (data: Uint8Array, at: number): bigint =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(at, true);

/**
 * What a Jupiter swap instruction's data says, or `undefined` when it is neither `route` nor
 * `shared_accounts_route` (an exact-out route, a token-ledger route, anything else).
 */
export function jupiterRouteData(data: Uint8Array): JupiterRouteData | undefined {
  const instruction = startsWith(data, JUPITER_SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR)
    ? "shared_accounts_route"
    : startsWith(data, JUPITER_ROUTE_DISCRIMINATOR)
      ? "route"
      : undefined;
  // The discriminator, a route plan of at least its length, and the 19-byte tail.
  if (instruction === undefined || data.length < 8 + 4 + 19) return undefined;
  const tail = data.length - 19;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    instruction,
    accounts: instruction === "route" ? ROUTE_ACCOUNTS : SHARED_ACCOUNTS_ROUTE_ACCOUNTS,
    inAmount: u64At(data, tail),
    quotedOutAmount: u64At(data, tail + 8),
    slippageBps: view.getUint16(tail + 16, true),
    platformFeeBps: data[tail + 18]!,
    offsets: { inAmount: tail, quotedOutAmount: tail + 8, slippageBps: tail + 16 },
  };
}
