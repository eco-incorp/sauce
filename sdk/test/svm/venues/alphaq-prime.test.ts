/**
 * `primeAlphaqStatsAccounts` ingests `getProgramAccounts` output from a caller-chosen RPC into a
 * module-global overlay, so it must hold what it accepts to the one shape a stats account has
 * (336 bytes, a 16-byte ASCII `BASE-QUOTE` symbol), never let an entry displace the static table,
 * stay bounded, and not memoise a failure.
 *
 * FAILING-FIRST: before the fix the loop decoded every payload whole, took any non-empty symbol,
 * had no cap, let an overlay entry shadow nothing only because the static table is read first, and
 * `primePromise` kept the first rejection forever.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  __alphaqRuntimeStatsForTest,
  __resetAlphaqStatsAccountsForTest,
  primeAlphaqStatsAccounts,
  type AlphaqStatsRpc,
} from "../../../src/svm/venues/alphaq/index.js";

const STATS_SIZE = 336;
const OVERLAY_CAP = 1024;
// A symbol the static table (`ALPHAQ_STATS_ACCOUNTS`) names.
const STATIC_SYMBOL = "ANDURI-USDC";
const SOME_ADDRESS = address("11111111111111111111111111111112");

/** A stats account as an RPC returns it: base64 of `size` bytes led by the symbol. */
function statsAccount(
  symbol: string | Uint8Array,
  options: { size?: number; encoding?: string; pubkey?: Address } = {},
): { pubkey: Address; account: { data: [string, string] } } {
  const bytes = new Uint8Array(options.size ?? STATS_SIZE);
  const symbolBytes = typeof symbol === "string" ? new TextEncoder().encode(symbol) : symbol;
  bytes.set(symbolBytes.subarray(0, Math.min(16, bytes.length)), 0);
  return {
    pubkey: options.pubkey ?? SOME_ADDRESS,
    account: { data: [Buffer.from(bytes).toString("base64"), options.encoding ?? "base64"] },
  };
}

function rpcReturning(
  accounts: readonly { pubkey: Address; account: { data: [string, string] } }[],
): AlphaqStatsRpc {
  return { getProgramAccounts: () => ({ send: async () => accounts }) };
}

/** A distinct pubkey per index. */
function pubkeyAt(index: number): Address {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, index + 1);
  return getAddressDecoder().decode(bytes);
}

beforeEach(() => __resetAlphaqStatsAccountsForTest());
afterAll(() => __resetAlphaqStatsAccountsForTest());

describe("primeAlphaqStatsAccounts: bounded, validated overlay", () => {
  it("accepts a well-formed 336-byte stats account", async () => {
    const pubkey = pubkeyAt(1);
    await primeAlphaqStatsAccounts(rpcReturning([statsAccount("NEWTOK-USDC", { pubkey })]));
    expect(__alphaqRuntimeStatsForTest().get("NEWTOK-USDC")).toBe(pubkey);
  });

  it("rejects an oversized, undersized or non-base64-encoded payload", async () => {
    await primeAlphaqStatsAccounts(
      rpcReturning([
        statsAccount("BIG-USDC", { size: STATS_SIZE + 1 }),
        statsAccount("HUGE-USDC", { size: 4 * 1024 * 1024 }),
        statsAccount("SMALL-USDC", { size: STATS_SIZE - 1 }),
        statsAccount("TINY-USDC", { size: 8 }),
        statsAccount("ENC-USDC", { encoding: "base58" }),
        {
          pubkey: SOME_ADDRESS,
          account: { data: ["!".repeat(448), "base64"] },
        },
      ]),
    );
    expect(__alphaqRuntimeStatsForTest().size).toBe(0);
  });

  it("rejects malformed symbols", async () => {
    await primeAlphaqStatsAccounts(
      rpcReturning([
        statsAccount(""), // blank
        statsAccount("NODASH"),
        statsAccount("lower-usdc"),
        statsAccount("-USDC"),
        statsAccount("TOK-"),
        statsAccount("A-B-C"),
        statsAccount("TOK USDC"),
        statsAccount("TOK-US\u00dcDC"),
        statsAccount(Uint8Array.from([0xc1, 0x42, 0x2d, 0x55])), // high bit set: not ASCII
        statsAccount("A".repeat(16)), // no terminator and no dash
      ]),
    );
    expect(__alphaqRuntimeStatsForTest().size).toBe(0);
  });

  it("never lets a runtime entry shadow a static-table symbol", async () => {
    await primeAlphaqStatsAccounts(
      rpcReturning([
        statsAccount(STATIC_SYMBOL, { pubkey: SOME_ADDRESS }),
        statsAccount("NEWTOK-USDC", { pubkey: pubkeyAt(2) }),
      ]),
    );
    const overlay = __alphaqRuntimeStatsForTest();
    expect(overlay.has(STATIC_SYMBOL)).toBe(false);
    expect(overlay.has("NEWTOK-USDC")).toBe(true);
  });

  it("caps the overlay at 1024 entries however many valid accounts come back", async () => {
    const accounts = Array.from({ length: OVERLAY_CAP + 500 }, (_, i) =>
      statsAccount(`T${i}-USDC`, { pubkey: pubkeyAt(i) }),
    );
    await primeAlphaqStatsAccounts(rpcReturning(accounts));
    const overlay = __alphaqRuntimeStatsForTest();
    expect(overlay.size).toBe(OVERLAY_CAP);
    expect(overlay.has("T0-USDC")).toBe(true);
    expect(overlay.has(`T${OVERLAY_CAP + 499}-USDC`)).toBe(false);
  });

  it("does not memoise a failed prime: the next call retries", async () => {
    let calls = 0;
    const flaky: AlphaqStatsRpc = {
      getProgramAccounts: () => ({
        send: async () => {
          calls += 1;
          if (calls === 1) throw new Error("rpc down");
          return [statsAccount("NEWTOK-USDC", { pubkey: pubkeyAt(3) })];
        },
      }),
    };
    await expect(primeAlphaqStatsAccounts(flaky)).rejects.toThrow("rpc down");
    await primeAlphaqStatsAccounts(flaky);
    expect(calls).toBe(2);
    expect(__alphaqRuntimeStatsForTest().get("NEWTOK-USDC")).toBe(pubkeyAt(3));
  });

  it("still memoises a successful prime", async () => {
    let calls = 0;
    const rpc: AlphaqStatsRpc = {
      getProgramAccounts: () => ({
        send: async () => {
          calls += 1;
          return [];
        },
      }),
    };
    await primeAlphaqStatsAccounts(rpc);
    await primeAlphaqStatsAccounts(rpc);
    expect(calls).toBe(1);
  });
});
