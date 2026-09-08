/**
 * meteora-damm-v1-stable adapter units (no engine, no RPC): fixture decode,
 * the pinned mainnet worked example (USDC/USDT pool 32D4..., t=1783175236,
 * 1_000_000_000 uUSDC -> 1_000_605_351 uUSDT), quote gates on doctored
 * fixtures, the documented swap encoding, and fragment compilability.
 */
import { fileURLToPath } from "url";
import { address } from "@solana/kit";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { meteoraDammV1Stable } from "../../../src/svm/venues/meteora-damm-v1-stable/index.js";
import type { MeteoraDammV1StablePoolConfig } from "../../../src/svm/venues/meteora-damm-v1-stable/index.js";
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/meteora-damm-v1-stable/", import.meta.url));

const POOL = address("32D4zRxNc1EssbJieVHfPhZM3rH6CzfUPrWUuWxD9prG");
const A_VAULT = "3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ";
const B_VAULT = "5XCP3oD3JAuQyDpfBFFVUxsBxNjPQojpKuL4aVhHsDok";
const A_VAULT_LP = "24NYE3hHQyUTrHUT4n1CcVrMP9Xy3ULuT1Uurw1HDeck";
const B_VAULT_LP = "Hv5ogVb2BZCF3ET2KnaEYj2seKHN5ffGDazm6BGt5DD9";
const A_TOKEN_VAULT = "C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA";
const B_TOKEN_VAULT = "DQjGWHN9ERn1zSMpWLNvSpTFUSfnxbanBt9A7xyU2bVE";
const A_LP_MINT = "3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC";
const B_LP_MINT = "EZun6G5514FeqYtUv26cBHWLqXjAEdjGuoX6ThBpBtKj";

// Pinned observedState_2026-07-04 worked example.
const CLOCK_T = 1_783_175_236n;
const AMOUNT_IN = 1_000_000_000n;
const PINNED_OUT = 1_000_605_351n;

const fixtures = loadFixtures(FIXTURE_DIR);
const state = fixtureBytesMap(fixtures);

/** Fixture set with `mutate` applied to one account's data. */
function doctored(addr: string, mutate: (data: Uint8Array) => void): AccountFixture[] {
  return fixtures.map((fixture) => {
    if (fixture.address !== addr) return fixture;
    const data = fixtureData(fixture);
    mutate(data);
    return { ...fixture, base64Data: Buffer.from(data).toString("base64") };
  });
}

async function fetchConfig(
  from: AccountFixture[] = fixtures,
): Promise<MeteoraDammV1StablePoolConfig> {
  return (await meteoraDammV1Stable.fetchPoolConfig(
    fixtureLoader(from),
    POOL,
  )) as MeteoraDammV1StablePoolConfig;
}

describe("meteora-damm-v1-stable adapter identity", () => {
  it("declares the slug, stable kind and mainnet program id", () => {
    expect(meteoraDammV1Stable.slug).toBe("meteora-damm-v1-stable");
    expect(meteoraDammV1Stable.kind).toBe("stable");
    expect(meteoraDammV1Stable.programId).toBe("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
  });
});

describe("meteora-damm-v1-stable fetchPoolConfig", () => {
  it("decodes the mainnet USDC/USDT pool fixture (docs/svm-venues.md field values)", async () => {
    const cfg = await fetchConfig();
    expect(cfg.venue).toBe("meteora-damm-v1-stable");
    expect(cfg.pool).toBe(POOL);
    expect(cfg.tokenAMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(cfg.tokenBMint).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
    expect(cfg.aVault).toBe(A_VAULT);
    expect(cfg.bVault).toBe(B_VAULT);
    expect(cfg.aVaultLp).toBe(A_VAULT_LP);
    expect(cfg.bVaultLp).toBe(B_VAULT_LP);
    expect(cfg.protocolTokenAFee).toBe("4Qjrnzp5jXPSBhyv495ApB1SdDbXdZ5Pc9ZSiabf9NmJ");
    // 2-hop fields, read from the two Vault accounts (offsets 19 / 115).
    expect(cfg.aTokenVault).toBe(A_TOKEN_VAULT);
    expect(cfg.bTokenVault).toBe(B_TOKEN_VAULT);
    expect(cfg.aLpMint).toBe(A_LP_MINT);
    expect(cfg.bLpMint).toBe(B_LP_MINT);
    // trade_fee 100/1000000 (0.01%), protocol_trade_fee 0/1000000.
    expect(cfg.tradeFeeNumerator).toBe(100n);
    expect(cfg.tradeFeeDenominator).toBe(1_000_000n);
    expect(cfg.protocolTradeFeeNumerator).toBe(0n);
    expect(cfg.protocolTradeFeeDenominator).toBe(1_000_000n);
    expect(cfg.amp).toBe(8000n);
    expect(cfg.tokenAMultiplier).toBe(1n);
    expect(cfg.tokenBMultiplier).toBe(1n);
    expect(cfg.activationPoint).toBe(0n);
    expect(cfg.activationType).toBe(0);
  });

  it("throws when the pool account is missing", async () => {
    const load = fixtureLoader(fixtures.filter((fixture) => fixture.address !== POOL));
    await expect(meteoraDammV1Stable.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `meteora-damm-v1-stable pool account ${POOL} not found`,
    );
  });

  it("throws on a wrong pool discriminator", async () => {
    const bad = doctored(POOL, (data) => {
      data[0] = 0x00;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable pool account ${POOL} has discriminator 009a6d0411b16dbc, expected f19a6d0411b16dbc`,
    );
  });

  it("gate: throws when the pool is disabled (enabled byte 233 flipped)", async () => {
    const bad = doctored(POOL, (data) => {
      data[233] = 0;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable pool ${POOL} is disabled (enabled = 0)`,
    );
  });

  it("gate: throws on a constant-product pool (curve tag byte 874 flipped)", async () => {
    const bad = doctored(POOL, (data) => {
      data[874] = 0;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable pool ${POOL} curve_type tag is 0, expected 1 (Stable)`,
    );
  });

  it("gate: throws on a depeg pool (depeg_type byte 916 flipped to Marinade)", async () => {
    const bad = doctored(POOL, (data) => {
      data[916] = 1;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable pool ${POOL} depeg_type is 1, expected 0 (None) — depeg pools are out of scope`,
    );
  });

  it("gate: throws on a slot-gated activation point (u64 at 403, activation_type 0)", async () => {
    const bad = doctored(POOL, (data) => {
      data[403] = 42;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable pool ${POOL} has slot-based activation_point 42 — slot-gated pools are out of scope`,
    );
  });

  it("throws on a wrong vault discriminator", async () => {
    const bad = doctored(A_VAULT, (data) => {
      data[0] = 0xff;
    });
    await expect(fetchConfig(bad)).rejects.toThrow(
      `meteora-damm-v1-stable vault a account ${A_VAULT} has discriminator ff08e82b02987577, expected d308e82b02987577`,
    );
  });
});

describe("meteora-damm-v1-stable referenceQuote", () => {
  it("reproduces the pinned worked example exactly (1 USDC -> 1000605351 uUSDT)", async () => {
    const cfg = await fetchConfig();
    expect(meteoraDammV1Stable.referenceQuote(cfg, state, AMOUNT_IN, CLOCK_T)).toBe(PINNED_OUT);
  });

  it("gate: throws when a timestamp activation point is in the future", async () => {
    const bad = doctored(POOL, (data) => {
      data[475] = 1; // activation_type = Timestamp
      new DataView(data.buffer, data.byteOffset).setBigUint64(403, CLOCK_T + 1n, true);
    });
    const cfg = await fetchConfig(bad);
    expect(() =>
      meteoraDammV1Stable.referenceQuote(cfg, fixtureBytesMap(bad), AMOUNT_IN, CLOCK_T),
    ).toThrow(
      `meteora-damm-v1-stable pool ${POOL} is not activated until ${CLOCK_T + 1n} (now ${CLOCK_T})`,
    );
  });

  it("gate: throws when the clock is behind the vault last_report", async () => {
    const cfg = await fetchConfig();
    // vault_a.last_report = 1783173885 (u64 LE at 1211).
    expect(() => meteoraDammV1Stable.referenceQuote(cfg, state, AMOUNT_IN, 1_783_173_884n)).toThrow(
      "meteora-damm-v1-stable clock 1783173884 is behind vault last_report 1783173885",
    );
  });

  it("gate: throws when the quote exceeds the out-vault idle float (strict <)", async () => {
    const cfg = await fetchConfig();
    // Doctor b_token_vault.amount (u64 LE at 64) down to the pinned quote:
    // out == float must already fail the strict < check.
    const bad = doctored(B_TOKEN_VAULT, (data) => {
      new DataView(data.buffer, data.byteOffset).setBigUint64(64, PINNED_OUT, true);
    });
    expect(() =>
      meteoraDammV1Stable.referenceQuote(cfg, fixtureBytesMap(bad), AMOUNT_IN, CLOCK_T),
    ).toThrow(
      `meteora-damm-v1-stable quote ${PINNED_OUT} exceeds vault idle liquidity ${PINNED_OUT}`,
    );
    const justEnough = doctored(B_TOKEN_VAULT, (data) => {
      new DataView(data.buffer, data.byteOffset).setBigUint64(64, PINNED_OUT + 1n, true);
    });
    expect(
      meteoraDammV1Stable.referenceQuote(cfg, fixtureBytesMap(justEnough), AMOUNT_IN, CLOCK_T),
    ).toBe(PINNED_OUT);
  });

  it("charges the minimum trade fee of 1 native unit on dust input", async () => {
    const cfg = await fetchConfig();
    // 100 * 100 / 1000000 floors to 0 -> minimum fee 1 applies; the quote
    // must be strictly below the no-fee stable quote of the same size.
    const dust = meteoraDammV1Stable.referenceQuote(cfg, state, 100n, CLOCK_T);
    expect(dust).toBeGreaterThan(0n);
    expect(dust).toBeLessThan(100n);
  });

  it("throws when a quote account is missing from state", async () => {
    const cfg = await fetchConfig();
    const partial = { ...state };
    delete partial[B_LP_MINT];
    expect(() => meteoraDammV1Stable.referenceQuote(cfg, partial, AMOUNT_IN, CLOCK_T)).toThrow(
      `meteora-damm-v1-stable referenceQuote state is missing b lp mint account ${B_LP_MINT}`,
    );
  });
});

describe("meteora-damm-v1-stable quoteAccounts + emitQuote", () => {
  const refs = (name: string) => `damm1s:${POOL}:${name}`;

  it("attaches the 8 read-only quote accounts with resolved addresses", async () => {
    const cfg = await fetchConfig();
    expect(meteoraDammV1Stable.quoteAccounts(cfg)).toEqual([
      { ref: refs("pool"), address: POOL },
      { ref: refs("a-vault"), address: A_VAULT },
      { ref: refs("b-vault"), address: B_VAULT },
      { ref: refs("a-vault-lp"), address: A_VAULT_LP },
      { ref: refs("b-vault-lp"), address: B_VAULT_LP },
      { ref: refs("a-lp-mint"), address: A_LP_MINT },
      { ref: refs("b-lp-mint"), address: B_LP_MINT },
      { ref: refs("b-token-vault"), address: B_TOKEN_VAULT },
    ]);
  });

  it("emits a q<i> fragment reading the 8 quote accounts via svm.sload, compiling for svm via RS", async () => {
    const cfg = await fetchConfig();
    const fragment = meteoraDammV1Stable.emitQuote(cfg, 3, AMOUNT_IN);
    expect(fragment).toContain("const q3 = ");
    expect(fragment).toContain(`${AMOUNT_IN} * fNum3`);
    expect(fragment).toContain("stableD(");
    expect(fragment).toContain("stableY(");
    // Account model: reads go through main()'s positional acc<k> params (k =
    // quoteAccounts() index), not accountUint string refs, and the Clock is
    // read via ctx.timestamp().
    expect(fragment).not.toContain("accountUint(");
    expect(fragment).not.toContain("block.timestamp");
    expect(fragment).toContain("const t3 = ctx.timestamp();");
    expect(fragment).toContain("svm.sload(acc0, "); // pool
    expect(fragment).toContain("svm.sload(acc7, "); // bTokenVault (last slot)

    // Compile through the RUST compiler with top-level scalar stub doubles for
    // the ladder-generator's out-of-repo stableD/stableY Newton helpers (RS
    // forbids nesting a function in main()); this validates the migrated
    // fragment is real RS SauceScript and manifests exactly the 8 quote
    // accounts in quoteAccounts() order.
    const STUB_HELPERS = [
      "function stableD(amp: Uint256, xa: Uint256, xb: Uint256): Uint256 { return xa + xb; }",
      "function stableY(amp: Uint256, x: Uint256, d: Uint256): Uint256 { return d - x; }",
    ].join("\n");
    const accounts = meteoraDammV1Stable.quoteAccounts(cfg);
    const source = `${STUB_HELPERS}\n${wrapQuoteMain(accounts.length, fragment, "q3")}`;
    const { bytecode, manifest } = compileSvm(source);
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual(
      accounts.map((_, k) => ({ kind: "slot", index: k, name: `acc${k}`, requires: "readonly" })),
    );
    const bound = manifest?.accounts.map((meta) =>
      meta.kind === "slot" ? accounts[meta.index]?.address : undefined,
    );
    expect(bound).toEqual(accounts.map((account) => account.address));
  });

  it("rejects a non-u64 amountIn", async () => {
    const cfg = await fetchConfig();
    expect(() => meteoraDammV1Stable.emitQuote(cfg, 0, 0n)).toThrow(
      "meteora-damm-v1-stable emitQuote amountIn must be a positive u64, got 0",
    );
    expect(() => meteoraDammV1Stable.emitQuote(cfg, 0, 1n << 64n)).toThrow(
      `meteora-damm-v1-stable emitQuote amountIn must be a positive u64, got ${1n << 64n}`,
    );
  });
});

describe("meteora-damm-v1-stable buildSwap", () => {
  const user = { inAta: "user:usdc-ata", outAta: "user:usdt-ata", owner: "user:wallet" };

  it("encodes discriminator f8c69e91e17587c8 || in_amount u64 LE || min_out 1 u64 LE", async () => {
    const cfg = await fetchConfig();
    const swap = meteoraDammV1Stable.buildSwap(cfg, user, AMOUNT_IN);
    expect(swap.programId).toBe("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
    expect(Buffer.from(swap.data).toString("hex")).toBe(
      // sha256("global:swap")[..8] || 1_000_000_000 LE || 1 LE (24 bytes).
      "f8c69e91e17587c8" + "00ca9a3b00000000" + "0100000000000000",
    );
  });

  it("orders the 15 documented account metas with the docs/svm-venues.md flags", async () => {
    const cfg = await fetchConfig();
    const swap = meteoraDammV1Stable.buildSwap(cfg, user, AMOUNT_IN);
    expect(swap.accounts).toEqual([
      { ref: refsFor("pool"), address: POOL, writable: true },
      { ref: user.inAta, writable: true },
      { ref: user.outAta, writable: true },
      { ref: refsFor("a-vault"), address: A_VAULT, writable: true },
      { ref: refsFor("b-vault"), address: B_VAULT, writable: true },
      { ref: refsFor("a-token-vault"), address: A_TOKEN_VAULT, writable: true },
      { ref: refsFor("b-token-vault"), address: B_TOKEN_VAULT, writable: true },
      { ref: refsFor("a-lp-mint"), address: A_LP_MINT, writable: true },
      { ref: refsFor("b-lp-mint"), address: B_LP_MINT, writable: true },
      { ref: refsFor("a-vault-lp"), address: A_VAULT_LP, writable: true },
      { ref: refsFor("b-vault-lp"), address: B_VAULT_LP, writable: true },
      {
        ref: refsFor("protocol-token-a-fee"),
        address: "4Qjrnzp5jXPSBhyv495ApB1SdDbXdZ5Pc9ZSiabf9NmJ",
        writable: true,
      },
      { ref: user.owner, signer: true },
      { ref: "damm1s:vault-program", address: "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi" },
      { ref: "token-program", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    ]);
  });

  it("rejects a non-u64 amountIn", async () => {
    const cfg = await fetchConfig();
    expect(() => meteoraDammV1Stable.buildSwap(cfg, user, -1n)).toThrow(
      "meteora-damm-v1-stable buildSwap amountIn must be a positive u64, got -1",
    );
  });

  function refsFor(name: string): string {
    return `damm1s:${POOL}:${name}`;
  }
});
