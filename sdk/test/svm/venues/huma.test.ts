/**
 * Huma adapter units (no engine, no RPC): fetchPoolConfig decodes the real
 * mainnet Genesis-pool fixture (poolConfig 28hFhD21..., snapshot
 * 2026-07-31), referenceQuote reproduces a worked example computed
 * INDEPENDENTLY (plain Python bigint arithmetic over the same fixture bytes,
 * never derived from the adapter's own source) at three deposit sizes and
 * three withdraw sizes — the largest withdraw size deliberately exceeds the
 * instant_withdrawal_reserve_limit cap, proving the cap clamp fires. Every
 * scope/cap gate is checked against a doctored fixture, buildSwap emits the
 * deposit/instant_withdraw wire bytes + ordered metas for both directions,
 * and emitQuote's fragment compiles as target-'svm' SauceScript.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { huma, humaFeeBpsFor } from "../../../src/svm/venues/huma/index.js";
import type { HumaPoolConfig } from "../../../src/svm/venues/huma/index.js";
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";

const CLASSIC_MODE_CONFIG = address("3FhoMDyKzQqxtGxnz9DfysfoGQKvgDnSFjoDGgguDCQN");
const POOL_CONFIG = address("28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS");
const POOL_STATE = address("iFgP2EbzHUZzMjqbjaagJQ8zmn6as3Hw95aVUKm67od");
const CLASSIC_MODE_MINT = address("59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw");
const POOL_UNDERLYING_TOKEN = address("6Xh2Jg9sWJE16VQGppJFTHvQ8Vii3ABUvUF8Pwcwy7Vq");
const UNDERLYING_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

// Independently computed (plain Python bigint) from the SAME fixture bytes —
// see the sauce-recipes PR's research notes for the derivation script.
const ASSETS = 217_296_740_441_685n;
const LIQUIDITY_CAP = 300_000_000_000_000n;
const MIN_DEPOSIT = 1_000_000n;
const RESERVE_LIMIT = 100_000_000_000n; // 100,000 USDC
const RATIO_BPS = 1608n; // (LIQUID + DEPLOYED - DISBURSED) * 10000 / ASSETS
const FEE_BPS = 20n; // the 1200-2000 bps bucket

const DEPOSIT_CASES: [bigint, bigint][] = [
  [100_000_000n, 89_176_222n], //     100 USDC ->    89.176222 shares
  [10_000_000_000n, 8_917_622_258n], //  10,000 USDC ->  8917.622258 shares
  [1_000_000_000_000n, 891_762_225_854n], // 1,000,000 USDC -> 891762.225854 shares
];

const WITHDRAW_CASES: [bigint, bigint][] = [
  [100_000_000n, 111_913_240n], //         100 shares ->      111.913240 USDC
  [10_000_000_000n, 11_191_323_999n], //  10,000 shares ->   11191.323999 USDC
  [1_000_000_000_000n, RESERVE_LIMIT], // 1,000,000 shares -> capped at the 100,000 USDC reserve limit
];

const FIXTURE_DIR = resolve(process.cwd(), "test", "svm", "fixtures", "huma");
const fixtures = loadFixtures(FIXTURE_DIR);

const fetchConfig = (
  direction: "deposit" | "withdraw" = "deposit",
  from: AccountFixture[] = fixtures,
): Promise<HumaPoolConfig> =>
  huma
    .fetchPoolConfig(fixtureLoader(from), CLASSIC_MODE_CONFIG)
    .then((cfg) => ({ ...(cfg as HumaPoolConfig), direction }));

function doctored(target: Address, patch: (data: Uint8Array) => void): AccountFixture[] {
  return fixtures.map((fixture) => {
    if (fixture.address !== target) return fixture;
    const data = fixtureData(fixture);
    patch(data);
    return { ...fixture, base64Data: Buffer.from(data).toString("base64") };
  });
}

const user = { inAta: "user-in", outAta: "user-out", owner: "user-owner" };

describe("huma adapter identity", () => {
  it("declares the mainnet program id", () => {
    expect(huma.slug).toBe("huma");
    expect(huma.programId).toBe("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");
  });

  it("rejects a config produced by another venue", () => {
    expect(() => huma.quoteAccounts({ venue: "other-venue", pool: CLASSIC_MODE_CONFIG })).toThrow(
      "huma adapter got a config for venue 'other-venue'",
    );
  });

  it("rejects an unknown mode_config (not in the curated instrument table)", async () => {
    await expect(
      huma.fetchPoolConfig(
        fixtureLoader(fixtures),
        address("So11111111111111111111111111111111111111112"),
      ),
    ).rejects.toThrow(/not in the curated instrument table/);
  });
});

describe("huma fetchPoolConfig", () => {
  it("decodes the mainnet Genesis-pool fixture (Classic mode)", async () => {
    const cfg = await fetchConfig();
    expect(cfg.venue).toBe("huma");
    expect(cfg.pool).toBe(CLASSIC_MODE_CONFIG);
    expect(cfg.poolConfigAccount).toBe(POOL_CONFIG);
    expect(cfg.poolState).toBe(POOL_STATE);
    expect(cfg.modeMint).toBe(CLASSIC_MODE_MINT);
    expect(cfg.poolUnderlyingToken).toBe(POOL_UNDERLYING_TOKEN);
    expect(cfg.underlyingMint).toBe(UNDERLYING_MINT);
    expect(cfg.liquidityCap).toBe(LIQUIDITY_CAP);
    expect(cfg.minDepositAmount).toBe(MIN_DEPOSIT);
    expect(cfg.reserveLimit).toBe(RESERVE_LIMIT);
    expect(cfg.feeTiers.length).toBe(8);
    expect(cfg.feeTiers[0]).toEqual({ ltBps: 500n, feeBps: 10000n });
    expect(cfg.feeTiers[cfg.feeTiers.length - 1]).toEqual({ ltBps: 10000n, feeBps: 5n });
  });

  it("refuses a pool that is not On", async () => {
    const doctoredFixtures = doctored(POOL_STATE, (data) => {
      data[9] = 0; // PoolStatus::Off
    });
    await expect(fetchConfig("deposit", doctoredFixtures)).rejects.toThrow(/is not On/);
  });

  it("referenceQuote throws when the pool turned Off after prepare", async () => {
    const cfg = await fetchConfig("withdraw");
    const doctoredFixtures = doctored(POOL_STATE, (data) => {
      data[9] = 0; // PoolStatus::Off
    });
    expect(() =>
      huma.referenceQuote(cfg, fixtureBytesMap(doctoredFixtures), 100_000_000n, 0n),
    ).toThrow(/is not On/);
  });

  it.each(["deposit", "withdraw"] as const)(
    "emitQuote (%s) quotes 0 unless the live status byte is On",
    async (direction) => {
      const cfg = await fetchConfig(direction);
      const fragment = huma.emitQuote(cfg, 0, 100_000_000n);
      expect(fragment).toContain("const humaStatus0 = svm.sload(acc0, 9, 1).toLe();");
      expect(fragment).toContain("if (humaStatus0 === 1) {");
    },
  );
});

describe("huma referenceQuote — deposit direction (worked examples)", () => {
  it.each(DEPOSIT_CASES)("assets in %s -> shares out %s", async (amountIn, expected) => {
    const cfg = await fetchConfig("deposit");
    const out = huma.referenceQuote(cfg, fixtureBytesMap(fixtures), amountIn, 0n);
    expect(out).toBe(expected);
  });

  it("caps deposit input at the liquidity_cap headroom (flat past the cap, never negative)", async () => {
    const cfg = await fetchConfig("deposit");
    const room = LIQUIDITY_CAP - ASSETS;
    const atCap = huma.referenceQuote(cfg, fixtureBytesMap(fixtures), room, 0n);
    const overCap = huma.referenceQuote(cfg, fixtureBytesMap(fixtures), room * 2n, 0n);
    expect(overCap).toBe(atCap); // flat beyond the cap — monotone, never a cliff
  });
});

describe("huma referenceQuote — withdraw direction (worked examples)", () => {
  it.each(WITHDRAW_CASES)("shares in %s -> assets out %s", async (amountIn, expected) => {
    const cfg = await fetchConfig("withdraw");
    const out = huma.referenceQuote(cfg, fixtureBytesMap(fixtures), amountIn, 0n);
    expect(out).toBe(expected);
  });

  it("the reserve-limit cap is exact (never exceeded, even far past it)", async () => {
    const cfg = await fetchConfig("withdraw");
    const wayOver = huma.referenceQuote(cfg, fixtureBytesMap(fixtures), 50_000_000_000_000n, 0n);
    expect(wayOver).toBe(RESERVE_LIMIT);
  });
});

describe("humaFeeBpsFor — the tiered step function", () => {
  const cfg = [
    { ltBps: 500n, feeBps: 10000n },
    { ltBps: 600n, feeBps: 180n },
    { ltBps: 800n, feeBps: 150n },
    { ltBps: 1000n, feeBps: 100n },
    { ltBps: 1200n, feeBps: 75n },
    { ltBps: 1500n, feeBps: 30n },
    { ltBps: 2000n, feeBps: 20n },
    { ltBps: 10000n, feeBps: 5n },
  ];

  it("matches the measured mainnet ratio -> fee (1608 bps -> 20 bps)", () => {
    expect(humaFeeBpsFor(RATIO_BPS, cfg)).toBe(FEE_BPS);
  });

  it("is a monotone NON-INCREASING function of the ratio (more liquidity, less or equal fee)", () => {
    const grid = [
      0n,
      100n,
      499n,
      500n,
      599n,
      799n,
      999n,
      1199n,
      1499n,
      1999n,
      9999n,
      10000n,
      20000n,
    ];
    let prevFee: bigint | undefined;
    for (const ratio of grid) {
      const fee = humaFeeBpsFor(ratio, cfg);
      if (prevFee !== undefined) expect(fee).toBeLessThanOrEqual(prevFee);
      prevFee = fee;
    }
  });

  it("is 0 at/above the highest threshold (fully liquid)", () => {
    expect(humaFeeBpsFor(10000n, cfg)).toBe(0n);
    expect(humaFeeBpsFor(50000n, cfg)).toBe(0n);
  });
});

describe("huma buildSwap", () => {
  it("deposit: encodes the discriminator + assets u64 LE + NO_COMMITMENT string + false, in the right account order", async () => {
    const cfg = await fetchConfig("deposit");
    const swap = huma.buildSwap(cfg, user, 100_000_000n);
    expect(swap.programId).toBe("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");
    expect([...swap.data.slice(0, 8)]).toEqual([242, 35, 198, 137, 82, 225, 242, 182]);
    expect(new DataView(swap.data.buffer, swap.data.byteOffset).getBigUint64(8, true)).toBe(
      100_000_000n,
    );
    const commitmentLen = new DataView(swap.data.buffer, swap.data.byteOffset).getUint32(16, true);
    expect(commitmentLen).toBe("NO_COMMITMENT".length);
    expect(Buffer.from(swap.data.slice(20, 20 + commitmentLen)).toString("utf8")).toBe(
      "NO_COMMITMENT",
    );
    expect(swap.data[20 + commitmentLen]).toBe(0); // commitment_auto_renewal = false
    expect(swap.accounts[0]).toEqual({ ref: user.owner, signer: true });
    expect(swap.accounts.at(-2)).toEqual({
      ref: expect.stringContaining("underlying-token-program"),
      address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    });
    const inAtaEntry = swap.accounts.find((a) => a.ref === user.inAta);
    const outAtaEntry = swap.accounts.find((a) => a.ref === user.outAta);
    expect(inAtaEntry).toEqual({ ref: user.inAta, writable: true });
    expect(outAtaEntry).toEqual({ ref: user.outAta, writable: true });
  });

  it("instant_withdraw: encodes the discriminator + shares u64 LE + permissive max_fee_bps, with the lender_state ref UNRESOLVED", async () => {
    const cfg = await fetchConfig("withdraw");
    const swap = huma.buildSwap(cfg, user, 100_000_000n);
    expect([...swap.data.slice(0, 8)]).toEqual([171, 49, 145, 176, 48, 101, 112, 162]);
    expect(new DataView(swap.data.buffer, swap.data.byteOffset).getBigUint64(8, true)).toBe(
      100_000_000n,
    );
    expect(new DataView(swap.data.buffer, swap.data.byteOffset).getUint16(16, true)).toBe(10000);
    const lenderState = swap.accounts.find((a) => a.ref.endsWith("lender-state"));
    expect(lenderState).toBeDefined();
    expect(lenderState!.address).toBeUndefined(); // owner-dependent PDA — the caller must resolve it
    expect(lenderState!.writable).toBe(true);
  });
});

describe("huma emitQuote compiles as target-svm SauceScript (Account model)", () => {
  // Account model: reads go through main()'s ordered `acc<k>` params (k = the ref's
  // index in quoteAccounts) — [pool-state=acc0, mode-mint=acc1, pool-underlying=acc2].
  // wrapQuoteMain declares one param per quoteAccounts entry, so the manifest slots
  // come back in that order (the deposit fragment leaves acc2 an unread param).
  it("deposit fragment compiles and manifests the quote accounts in param order", async () => {
    const cfg = await fetchConfig("deposit");
    const fragment = huma.emitQuote(cfg, 0, 100_000_000n);
    expect(fragment).not.toContain("accountUint(");
    const accounts = huma.quoteAccounts(cfg);
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, "q0"));
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual(
      accounts.map((_, k) => ({ kind: "slot", index: k, name: "acc" + k, requires: "readonly" })),
    );
  });

  it("withdraw fragment compiles and manifests the quote accounts in param order", async () => {
    const cfg = await fetchConfig("withdraw");
    const fragment = huma.emitQuote(cfg, 0, 100_000_000n);
    expect(fragment).not.toContain("accountUint(");
    const accounts = huma.quoteAccounts(cfg);
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, "q0"));
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual(
      accounts.map((_, k) => ({ kind: "slot", index: k, name: "acc" + k, requires: "readonly" })),
    );
  });
});
