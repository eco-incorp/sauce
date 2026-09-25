/**
 * saber-stableswap adapter units (no engine, no RPC): SwapInfo fixture decode
 * with the swap-authority derivation, the pinned mainnet worked example
 * (1.0 USDC -> 1.000603 USDT), gate errors on doctored fixtures, the swap
 * instruction encoding (tag 0x01, 17 bytes, 9 accounts), and the emitted
 * quote fragment. Fixtures are the real USDC/USDT pool
 * YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe dumped from mainnet; all pinned
 * expectations were computed with an independent bigint implementation of the
 * quote recipe in the historical venue investigation, not with the adapter under test.
 *
 * Original venue investigation (historical):
 * https://github.com/eco-incorp/sauce/blob/d3686430ee308994f95309a8c9b2d5930d71cf5d/docs/svm-venues.md
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { saberStableswap } from "../../../src/svm/venues/saber-stableswap/index.js";
import type { SaberPoolConfig } from "../../../src/svm/venues/saber-stableswap/index.js";
import type { AccountBytesMap, AccountLoader } from "../../../src/svm/index.js";
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";

const POOL = address("YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe");
const SWAP_AUTHORITY = "5C1k9yV7y4CjMnKv8eGYDgWND8P89Pdfj79Trk2qmfGo";
const VAULT_A = "CfWX7o2TswwbxusJ4hCaPobu2jLCb1hfXuXJQjVq3jQF";
const VAULT_B = "EnTrdMMpdhugeH6Ban6gYZWXughWxKtVGfCwFn78ZmY3";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const ADMIN_FEE_A = "2kc8pwM79bnFuwuz5UiZL9AJx4dMF9wJ8v4xLoYu6Kno";
const ADMIN_FEE_B = "4Bf4PFW6gBcUHoG2tja3aA82pwB1etXh2YoJXP4Cm41A";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Fixture amp state: initial 8000 -> target 5000, ramp 1747460323..1747719515
// (finished 2025-05-20) — any later timestamp quotes at amp = 5000.
const START_RAMP_TS = 1747460323n;
const STOP_RAMP_TS = 1747719515n;
const NOW = 1_751_500_000n;

const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/saber-stableswap"));
const load = fixtureLoader(fixtures);
const poolFixture = fixtures.find((fixture) => fixture.address === POOL)!;

let cfg: SaberPoolConfig;
beforeAll(async () => {
  cfg = (await saberStableswap.fetchPoolConfig(load, POOL)) as SaberPoolConfig;
});

/** Loader serving a mutated copy of the pool fixture (other accounts untouched). */
function doctoredLoader(mutate: (data: Uint8Array) => Uint8Array | void): AccountLoader {
  let data = fixtureData(poolFixture);
  data = mutate(data) ?? data;
  return async (addr) => (addr === POOL ? data : load(addr));
}

function writeU64LE(data: Uint8Array, offset: number, value: bigint): void {
  new DataView(data.buffer, data.byteOffset).setBigUint64(offset, value, true);
}

/** Fixture state with both vault balances overwritten (u64 LE @64). */
function stateWithReserves(srcReserve: bigint, dstReserve: bigint): AccountBytesMap {
  const state = fixtureBytesMap(fixtures);
  writeU64LE(state[VAULT_A], 64, srcReserve);
  writeU64LE(state[VAULT_B], 64, dstReserve);
  return state;
}

describe("saber-stableswap fetchPoolConfig", () => {
  it("decodes the mainnet USDC/USDT SwapInfo fixture", () => {
    expect(cfg.venue).toBe("saber-stableswap");
    expect(cfg.pool).toBe(POOL);
    expect(cfg.nonce).toBe(255);
    expect(cfg.initialAmpFactor).toBe(8000n);
    expect(cfg.targetAmpFactor).toBe(5000n);
    expect(cfg.startRampTs).toBe(START_RAMP_TS);
    expect(cfg.stopRampTs).toBe(STOP_RAMP_TS);
    expect(cfg.vaultA).toBe(VAULT_A);
    expect(cfg.vaultB).toBe(VAULT_B);
    expect(cfg.mintA).toBe(USDC_MINT);
    expect(cfg.mintB).toBe(USDT_MINT);
    expect(cfg.adminFeeA).toBe(ADMIN_FEE_A);
    expect(cfg.adminFeeB).toBe(ADMIN_FEE_B);
    // trade_fee 1/10000 (1 bps), admin_trade_fee 0/10000000.
    expect(cfg.tradeFeeNumerator).toBe(1n);
    expect(cfg.tradeFeeDenominator).toBe(10000n);
    expect(cfg.adminTradeFeeNumerator).toBe(0n);
    expect(cfg.adminTradeFeeDenominator).toBe(10_000_000n);
  });

  it("derives the swap authority with the STORED nonce (create_program_address)", () => {
    expect(cfg.swapAuthority).toBe(SWAP_AUTHORITY);
  });

  it("throws when the pool account does not exist", async () => {
    const empty: AccountLoader = async () => null;
    await expect(saberStableswap.fetchPoolConfig(empty, POOL)).rejects.toThrow(
      `saber-stableswap pool account ${POOL} not found`,
    );
  });

  it("gates on the SwapInfo size", async () => {
    const truncated = doctoredLoader((data) => data.subarray(0, 394));
    await expect(saberStableswap.fetchPoolConfig(truncated, POOL)).rejects.toThrow(
      `saber-stableswap pool ${POOL} data must be 395 bytes (SwapInfo), got 394`,
    );
  });

  it("gates on is_initialized == 1 (byte 0)", async () => {
    const uninitialized = doctoredLoader((data) => {
      data[0] = 0;
    });
    await expect(saberStableswap.fetchPoolConfig(uninitialized, POOL)).rejects.toThrow(
      `saber-stableswap pool ${POOL} is not initialized (is_initialized = 0)`,
    );
  });

  it("gates on is_paused == 0 (byte 1)", async () => {
    const paused = doctoredLoader((data) => {
      data[1] = 1;
    });
    await expect(saberStableswap.fetchPoolConfig(paused, POOL)).rejects.toThrow(
      `saber-stableswap pool ${POOL} is paused (is_paused = 1)`,
    );
  });

  it("gates on a zero trade_fee_denominator (u64 LE @371)", async () => {
    const zeroDenominator = doctoredLoader((data) => {
      writeU64LE(data, 371, 0n);
    });
    await expect(saberStableswap.fetchPoolConfig(zeroDenominator, POOL)).rejects.toThrow(
      `saber-stableswap pool ${POOL} trade_fee_denominator must be positive`,
    );
  });
});

describe("saber-stableswap referenceQuote", () => {
  it("reproduces the pinned mainnet worked example: 1.0 USDC -> 1.000603 USDT", () => {
    // Fixture reserves 203694923631 / 905506529186, amp 5000, fee 1/10000:
    // D = 1109127433350, y = 905505528482, dy = 1000703, fee = 100.
    const state = fixtureBytesMap(fixtures);
    expect(saberStableswap.referenceQuote(cfg, state, 1_000_000n, NOW)).toBe(1_000_603n);
  });

  it("uses the target amp from the exact end of the ramp window onward", () => {
    const state = fixtureBytesMap(fixtures);
    expect(saberStableswap.referenceQuote(cfg, state, 1_000_000n, STOP_RAMP_TS)).toBe(1_000_603n);
  });

  it("interpolates the amp mid-ramp (floor division)", () => {
    // now = start + 100000, range 259192: amp = 8000 - 3000*100000/259192
    // = 8000 - 1157 = 6843 -> 1000413 (independently computed).
    const state = fixtureBytesMap(fixtures);
    expect(saberStableswap.referenceQuote(cfg, state, 1_000_000n, START_RAMP_TS + 100_000n)).toBe(
      1_000_413n,
    );
  });

  it("quotes a synthetic imbalanced pool (Newton far from the converged start)", () => {
    // 1,000 USDC vs 50,000 USDT at amp 5000, 250 USDC in: D = 50939006083,
    // y = 49737061938, dy = 262938061, fee = 26293 -> 262911768.
    const state = stateWithReserves(1_000_000_000n, 50_000_000_000n);
    expect(saberStableswap.referenceQuote(cfg, state, 250_000_000n, NOW)).toBe(262_911_768n);
  });

  it("quotes 0 for amount_in == 0 (on-chain no-op) and for a paused pool", () => {
    const state = fixtureBytesMap(fixtures);
    expect(saberStableswap.referenceQuote(cfg, state, 0n, NOW)).toBe(0n);

    state[POOL][1] = 1; // live is_paused byte — the fragment reads it too
    expect(saberStableswap.referenceQuote(cfg, state, 1_000_000n, NOW)).toBe(0n);
  });

  it("rejects negative amounts and state missing a quoted account", () => {
    const state = fixtureBytesMap(fixtures);
    expect(() => saberStableswap.referenceQuote(cfg, state, -1n, NOW)).toThrow(
      "saber-stableswap amountIn must be non-negative, got -1",
    );

    delete state[VAULT_B];
    expect(() => saberStableswap.referenceQuote(cfg, state, 1_000_000n, NOW)).toThrow(
      `saber-stableswap referenceQuote state is missing vault ${VAULT_B}`,
    );
  });

  it("refuses to quote an empty reserve (on-chain CalculationFailure)", () => {
    const state = stateWithReserves(0n, 50_000_000_000n);
    expect(() => saberStableswap.referenceQuote(cfg, state, 1_000_000n, NOW)).toThrow(
      `saber-stableswap pool ${POOL} has an empty reserve`,
    );
  });
});

describe("saber-stableswap quoteAccounts", () => {
  it("attaches pool + both vaults read-only, refs = addresses", () => {
    expect(saberStableswap.quoteAccounts(cfg)).toEqual([
      { ref: POOL, address: POOL },
      { ref: VAULT_A, address: VAULT_A },
      { ref: VAULT_B, address: VAULT_B },
    ]);
  });
});

describe("saber-stableswap buildSwap", () => {
  const user = { outAta: "userOut", inAta: "userIn", owner: "owner" };

  it("encodes tag 0x01 | amount_in u64 LE | minimum_amount_out = 1", () => {
    const swap = saberStableswap.buildSwap(cfg, user, 1_000_000n);
    expect(swap.programId).toBe("SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ");
    // 17 bytes: 01 | 40420f0000000000 (1000000 LE) | 0100000000000000.
    expect(Array.from(swap.data)).toEqual([
      0x01, 0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ]);
  });

  it("orders the 9 accounts exactly as the swap instruction expects", () => {
    const swap = saberStableswap.buildSwap(cfg, user, 1_000_000n);
    expect(swap.accounts).toEqual([
      { ref: POOL, address: POOL },
      { ref: SWAP_AUTHORITY, address: SWAP_AUTHORITY },
      { ref: "owner", signer: true },
      { ref: "userIn", writable: true },
      { ref: VAULT_A, address: VAULT_A, writable: true },
      { ref: VAULT_B, address: VAULT_B, writable: true },
      { ref: "userOut", writable: true },
      { ref: ADMIN_FEE_B, address: ADMIN_FEE_B, writable: true },
      { ref: TOKEN_PROGRAM, address: TOKEN_PROGRAM },
    ]);
  });

  it("accepts the u64 maximum and rejects amounts outside (0, 2^64)", () => {
    const max = saberStableswap.buildSwap(cfg, user, (1n << 64n) - 1n);
    expect(Array.from(max.data.subarray(1, 9))).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);

    expect(() => saberStableswap.buildSwap(cfg, user, 0n)).toThrow(
      "saber-stableswap amountIn must be positive, got 0",
    );
    expect(() => saberStableswap.buildSwap(cfg, user, 1n << 64n)).toThrow(
      `saber-stableswap amountIn must fit u64, got ${1n << 64n}`,
    );
  });
});

describe("saber-stableswap emitQuote — Account model (svm.sload) via RS", () => {
  // Account model: quoteAccounts() attaches [pool, vaultA, vaultB], so the pool
  // is slot 0 (acc0), vaultA slot 1 (acc1) and vaultB slot 2 (acc2); every read
  // is `svm.sload(acc<k>, off, w).toLe()` over main()'s positional params,
  // compiled through the Rust compiler. The real Newton curve helpers are the
  // ladder-generator's (out-of-repo) — this fragment only CALLS `stableD`/
  // `stableY`, so the compile test declares them at TOP LEVEL as scalar test
  // doubles (RS forbids a nested function, so they cannot live inside main());
  // their bodies are irrelevant to what this proves: that the migrated fragment
  // is valid RS SauceScript and manifests its three reads in quoteAccounts order.
  const STUB_HELPERS = [
    "function stableD(amp: Uint256, xa: Uint256, xb: Uint256): Uint256 { return amp + xa + xb; }",
    "function stableY(amp: Uint256, x: Uint256, d: Uint256): Uint256 { return amp + x + d; }",
  ].join("\n");

  const compileFragment = (i: number, amountIn: bigint) => {
    const fragment = saberStableswap.emitQuote(cfg, i, amountIn);
    const accounts = saberStableswap.quoteAccounts(cfg);
    const source = `${STUB_HELPERS}\n${wrapQuoteMain(accounts.length, fragment, `q${i}`)}`;
    return { fragment, accounts, ...compileSvm(source) };
  };

  it("reads the live pause byte and both vault balances via svm.sload on acc0/acc1/acc2", () => {
    const fragment = saberStableswap.emitQuote(cfg, 0, 1_000_000n);
    expect(fragment).toContain("const paused0 = svm.sload(acc0, 1, 1).toLe();");
    expect(fragment).toContain("const srcRes0 = svm.sload(acc1, 64, 8).toLe();");
    expect(fragment).toContain("const dstRes0 = svm.sload(acc2, 64, 8).toLe();");
    expect(fragment).not.toContain("accountUint(");
  });

  it("bakes the down-ramp amp interpolation behind a ctx.timestamp() check", () => {
    const fragment = saberStableswap.emitQuote(cfg, 0, 1_000_000n);
    expect(fragment).toContain("let amp0 = 5000;");
    // range = 1747719515 - 1747460323 = 259192; down-ramp 8000 -> 5000.
    expect(fragment).toContain(
      "if (ctx.timestamp() < 1747719515) { amp0 = 8000 - Math.mulDiv(3000, ctx.timestamp() - 1747460323, 259192) }",
    );
    expect(fragment).not.toContain("block.timestamp");
  });

  it("computes q<i> through the shared stable helpers with the dy-1 buffer and output fee", () => {
    const fragment = saberStableswap.emitQuote(cfg, 3, 1_000_000n);
    expect(fragment).toContain("const d3 = stableD(amp3, srcRes3, dstRes3);");
    expect(fragment).toContain("const y3 = stableY(amp3, srcRes3 + 1000000, d3);");
    expect(fragment).toContain("let q3 = 0;");
    expect(fragment).toContain("if (paused3 === 0 && dstRes3 > y3) {");
    expect(fragment).toContain("const dy3 = dstRes3 - y3 - 1;");
    expect(fragment).toContain("q3 = dy3 - Math.mulDiv(dy3, 1, 10000);");
  });

  it("is a main-body fragment: indented lines, strict equality, no loose comparisons", () => {
    const fragment = saberStableswap.emitQuote(cfg, 0, 1_000_000n);
    for (const line of fragment.split("\n")) {
      expect(line).toMatch(/^ {2}/);
    }
    expect(fragment).toContain("===");
    expect(fragment).not.toMatch(/[^=!<>]==[^=]/); // no loose ==
    expect(fragment).not.toMatch(/!=[^=]/); // no loose !=
  });

  it("compiles for the svm target and manifests the three reads in quoteAccounts order", () => {
    const { bytecode, manifest, accounts } = compileFragment(0, 1_000_000n);
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual([
      { kind: "slot", index: 0, name: "acc0", requires: "readonly" },
      { kind: "slot", index: 1, name: "acc1", requires: "readonly" },
      { kind: "slot", index: 2, name: "acc2", requires: "readonly" },
    ]);
    const bound = manifest?.accounts.map((meta) =>
      meta.kind === "slot" ? accounts[meta.index]?.address : undefined,
    );
    expect(bound).toEqual([POOL, VAULT_A, VAULT_B]);
  });

  it("rejects bad pool indices and non-u64 amounts", () => {
    expect(() => saberStableswap.emitQuote(cfg, -1, 1_000_000n)).toThrow(
      "saber-stableswap emitQuote pool index must be a non-negative integer, got -1",
    );
    expect(() => saberStableswap.emitQuote(cfg, 1.5, 1_000_000n)).toThrow(
      "saber-stableswap emitQuote pool index must be a non-negative integer, got 1.5",
    );
    expect(() => saberStableswap.emitQuote(cfg, 0, 0n)).toThrow(
      "saber-stableswap amountIn must be positive, got 0",
    );
    expect(() => saberStableswap.emitQuote(cfg, 0, 1n << 64n)).toThrow(
      `saber-stableswap amountIn must fit u64, got ${1n << 64n}`,
    );
  });
});
