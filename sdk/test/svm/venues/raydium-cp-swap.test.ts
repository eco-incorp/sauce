/**
 * Raydium CP-Swap adapter units (no engine, no RPC): the fixture set is the
 * real mainnet WSOL/USDC pool 7Juw... snapshot of 2026-07-04, and every pinned
 * constant below comes from docs/svm-venues.md, source-verified for program
 * CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C (or is hand-derived from its
 * quote formula, with the derivation spelled out at the assertion).
 */
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { address, getAddressCodec } from "@solana/kit";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { raydiumCpSwap } from "../../../src/svm/venues/raydium-cp-swap/index.js";
import { readUintLE } from "../../../src/svm/index.js";
import { fixtureBytesMap, fixtureLoader, loadFixtures } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "raydium-cp-swap",
);

// Mainnet fixture addresses (docs/svm-venues.md worked example).
const POOL = address("7JuwJuNU88gurFnyWeiyGKbFmExMWcmRZntn9imEzdny");
const AMM_CONFIG = "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2";
const VAULT0 = "7VLUXrnSSDo9BfCa4NWaQs68g7ddDY1sdXBKW6Xswj9Y";
const VAULT1 = "3rzbbW5Q8MA7sCaowf28hNgACNPecdS2zceWy7Ptzua9";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OBSERVATION = "4MYrPgjgFceyhtwhG1ZX8UVb4wn1aQB5wzMimtFqg7U8";
const AUTHORITY = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";
const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// Any instant at/after the pool's open_time 1715746443; this one is the
// fixture snapshot date, 2026-07-04.
const NOW = 1_783_123_200n;

const fixtures = loadFixtures(FIXTURE_DIR);
const fetchCfg = (fx: AccountFixture[] = fixtures) =>
  raydiumCpSwap.fetchPoolConfig(fixtureLoader(fx), POOL);

/** Clone the fixture set with `target`'s data mutated in place. */
function doctored(
  fx: AccountFixture[],
  target: string,
  mutate: (data: Uint8Array) => void,
): AccountFixture[] {
  let found = false;
  const out = fx.map((fixture) => {
    if (fixture.address !== target) return fixture;
    found = true;
    const data = new Uint8Array(Buffer.from(fixture.base64Data, "base64"));
    mutate(data);
    return { ...fixture, base64Data: Buffer.from(data).toString("base64") };
  });
  if (!found) throw new Error(`no fixture for ${target}`);
  return out;
}

function setU64(data: Uint8Array, offset: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[offset + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}

const pubkeyBytes = (addr: string): Uint8Array =>
  new Uint8Array(getAddressCodec().encode(address(addr)));

/**
 * Synthetic token-2022 mint: 82-byte base padded to 165, account-type byte 1
 * (Mint) at 165, then one TLV entry [type u16 LE, length u16 LE, value].
 * TransferFeeConfig is extension type 1 (108-byte body).
 */
function token2022Mint(extensionType: number): AccountFixture {
  const data = new Uint8Array(166 + 4 + 108);
  data[165] = 1;
  data[166] = extensionType & 0xff;
  data[167] = extensionType >> 8;
  data[168] = 108;
  return { address: WSOL, owner: TOKEN_2022, base64Data: Buffer.from(data).toString("base64") };
}

describe("raydium-cp-swap adapter identity", () => {
  it("exposes the venue slug, kind, and mainnet program id", () => {
    expect(raydiumCpSwap.slug).toBe("raydium-cp-swap");
    expect(raydiumCpSwap.kind).toBe("constant-product");
    expect(raydiumCpSwap.programId).toBe("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
  });
});

describe("raydium-cp-swap fixtures", () => {
  it("pin the 2026-07-04 snapshot values from docs/svm-venues.md", () => {
    const state = fixtureBytesMap(fixtures);
    // SPL vault amounts (u64 LE @64).
    expect(readUintLE(state[VAULT0], 64, 8)).toBe(1_927_052_254n);
    expect(readUintLE(state[VAULT1], 64, 8)).toBe(146_870_650n);
    // PoolState fee accumulators: protocol @341/@349, fund @357/@365, creator @397/@405.
    expect(readUintLE(state[POOL], 341, 8)).toBe(69_220_427n);
    expect(readUintLE(state[POOL], 349, 8)).toBe(869_850n);
    expect(readUintLE(state[POOL], 357, 8)).toBe(86_140_625n);
    expect(readUintLE(state[POOL], 365, 8)).toBe(1_264_457n);
    expect(readUintLE(state[POOL], 397, 8)).toBe(0n);
    expect(readUintLE(state[POOL], 405, 8)).toBe(0n);
  });
});

describe("raydium-cp-swap fetchPoolConfig", () => {
  it("decodes the mainnet WSOL/USDC pool fixture", async () => {
    const cfg = await fetchCfg();
    expect(cfg.venue).toBe("raydium-cp-swap");
    expect(cfg.pool).toBe(POOL);
    expect(cfg.ammConfig).toBe(AMM_CONFIG);
    expect(cfg.token0Vault).toBe(VAULT0);
    expect(cfg.token1Vault).toBe(VAULT1);
    expect(cfg.token0Mint).toBe(WSOL);
    expect(cfg.token1Mint).toBe(USDC);
    expect(cfg.token0Program).toBe(TOKENKEG);
    expect(cfg.token1Program).toBe(TOKENKEG);
    expect(cfg.observation).toBe(OBSERVATION);
    expect(cfg.status).toBe(0);
    expect(cfg.openTime).toBe(1_715_746_443n);
    expect(cfg.creatorFeeOn).toBe(0);
    expect(cfg.enableCreatorFee).toBe(false);
    expect(cfg.tradeFeeRate).toBe(2500n);
    expect(cfg.creatorFeeRate).toBe(500n);
    expect(cfg.inputIsToken0).toBe(true);
  });

  it("rejects a pool with the swap-disabled status bit set", async () => {
    // status is the u8 at offset 329; bit 2 (value 4) disables swaps.
    const fx = doctored(fixtures, POOL, (data) => {
      data[329] |= 4;
    });
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap pool ${POOL} swap is disabled (status 4 has bit 2 set)`,
    );
  });

  it("rejects a pool that has not reached its open_time", async () => {
    const fx = doctored(fixtures, POOL, (data) => setU64(data, 373, 1n << 62n));
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap pool ${POOL} is not open yet (open_time ${1n << 62n}`,
    );
  });

  it("rejects an account without the PoolState discriminator", async () => {
    const fx = doctored(fixtures, POOL, (data) => {
      data[0] ^= 0xff;
    });
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap pool ${POOL} has a wrong discriminator (not a PoolState account)`,
    );
  });

  it("rejects a pool account of the wrong size", async () => {
    const truncated = fixtures.map((fixture) =>
      fixture.address === POOL
        ? {
            ...fixture,
            base64Data: Buffer.from(
              Buffer.from(fixture.base64Data, "base64").subarray(0, 636),
            ).toString("base64"),
          }
        : fixture,
    );
    await expect(fetchCfg(truncated)).rejects.toThrow(
      `raydium-cp-swap pool ${POOL} data is 636 bytes, expected 637`,
    );
  });

  it("rejects a missing pool account", async () => {
    const fx = fixtures.filter((fixture) => fixture.address !== POOL);
    await expect(fetchCfg(fx)).rejects.toThrow(`raydium-cp-swap pool ${POOL} not found`);
  });

  it("rejects a missing amm config account", async () => {
    const fx = fixtures.filter((fixture) => fixture.address !== AMM_CONFIG);
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap amm config ${AMM_CONFIG} not found`,
    );
  });

  it("rejects an amm config without the AmmConfig discriminator", async () => {
    const fx = doctored(fixtures, AMM_CONFIG, (data) => {
      data[0] ^= 0xff;
    });
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap amm config ${AMM_CONFIG} has a wrong discriminator (not an AmmConfig account)`,
    );
  });

  it("rejects a vault whose mint disagrees with the pool", async () => {
    const fx = doctored(fixtures, VAULT0, (data) => data.set(pubkeyBytes(USDC), 0));
    await expect(fetchCfg(fx)).rejects.toThrow(
      `raydium-cp-swap vault ${VAULT0} holds mint ${USDC}, expected ${WSOL}`,
    );
  });

  it("rejects a missing vault account", async () => {
    const fx = fixtures.filter((fixture) => fixture.address !== VAULT1);
    await expect(fetchCfg(fx)).rejects.toThrow(`raydium-cp-swap vault ${VAULT1} not found`);
  });

  describe("token-2022 transfer-fee gate", () => {
    // Point token_0_program (offset 232) at Token-2022 so the gate inspects
    // the token_0 mint's extension TLV.
    const withToken2022Program = (fx: AccountFixture[]) =>
      doctored(fx, POOL, (data) => data.set(pubkeyBytes(TOKEN_2022), 232));

    it("rejects a token-2022 mint carrying a transfer-fee extension", async () => {
      const fx = [...withToken2022Program(fixtures), token2022Mint(1)];
      await expect(fetchCfg(fx)).rejects.toThrow(
        `raydium-cp-swap token_0 mint ${WSOL} has a token-2022 transfer-fee extension (wire amounts diverge from the quote)`,
      );
    });

    it("accepts a token-2022 mint whose extensions exclude transfer fees", async () => {
      // Extension type 3 = MintCloseAuthority: harmless for quoting.
      const fx = [...withToken2022Program(fixtures), token2022Mint(3)];
      const cfg = await raydiumCpSwap.fetchPoolConfig(fixtureLoader(fx), POOL);
      expect(cfg.token0Program).toBe(TOKEN_2022);
    });

    it("rejects when the token-2022 mint cannot be loaded for the check", async () => {
      await expect(fetchCfg(withToken2022Program(fixtures))).rejects.toThrow(
        `raydium-cp-swap token_0 mint ${WSOL} is token-2022 but could not be loaded to check transfer-fee extensions`,
      );
    });
  });
});

describe("raydium-cp-swap referenceQuote", () => {
  const state = fixtureBytesMap(fixtures);

  it("reproduces the docs/svm-venues.md worked example: 1_000_000 WSOL lamports -> 81443 USDC", async () => {
    // reserve_in = 1927052254 - 69220427 - 86140625 - 0 = 1771691202
    // reserve_out = 146870650 - 869850 - 1264457 - 0 = 144736343
    // fee = ceil(1e6 * 2500 / 1e6) = 2500, out = floor(997500 * rOut / (rIn + 997500)) = 81443
    const cfg = await fetchCfg();
    expect(raydiumCpSwap.referenceQuote(cfg, state, 1_000_000n, NOW)).toBe(81_443n);
  });

  it("quotes the OneForZero direction over the swapped reserves", async () => {
    // Same snapshot, USDC -> WSOL: fee = ceil(1e6 * 2500 / 1e6) = 2500,
    // out = floor(997500 * 1771691202 / (144736343 + 997500)) = 12126640.
    const cfg = { ...(await fetchCfg()), inputIsToken0: false };
    expect(raydiumCpSwap.referenceQuote(cfg, state, 1_000_000n, NOW)).toBe(12_126_640n);
  });

  it("adds the creator fee to the input-side fee when enabled with creator_fee_on = BothToken", async () => {
    // enable_creator_fee is the u8 at offset 390; creator_fee_on stays 0.
    // total_fee = ceil(5e6 * (2500 + 500) / 1e6) = 15000, net = 4985000,
    // out = floor(4985000 * 144736343 / (1771691202 + 4985000)) = 406101.
    const fx = doctored(fixtures, POOL, (data) => {
      data[390] = 1;
    });
    const cfg = await fetchCfg(fx);
    expect(raydiumCpSwap.referenceQuote(cfg, fixtureBytesMap(fx), 5_000_000n, NOW)).toBe(406_101n);
  });

  it("takes the creator fee out of the output when creator_fee_on points at the output side", async () => {
    // creator_fee_on = 2 (OnlyToken1) with a ZeroForOne swap => fee on output.
    // trade_fee = ceil(5e6 * 2500 / 1e6) = 12500, net = 4987500,
    // out_swapped = floor(4987500 * 144736343 / (1771691202 + 4987500)) = 406304,
    // creator_fee = ceil(406304 * 500 / 1e6) = 204, out = 406100.
    const fx = doctored(fixtures, POOL, (data) => {
      data[389] = 2;
      data[390] = 1;
    });
    const cfg = await fetchCfg(fx);
    expect(raydiumCpSwap.referenceQuote(cfg, fixtureBytesMap(fx), 5_000_000n, NOW)).toBe(406_100n);
  });

  it("throws when the snapshot has the swap-disabled bit set", async () => {
    const cfg = await fetchCfg();
    const fx = doctored(fixtures, POOL, (data) => {
      data[329] |= 4;
    });
    expect(() => raydiumCpSwap.referenceQuote(cfg, fixtureBytesMap(fx), 1_000_000n, NOW)).toThrow(
      `raydium-cp-swap pool ${POOL} swap is disabled (status 4 has bit 2 set)`,
    );
  });

  it("throws when now is before the pool open_time", async () => {
    const cfg = await fetchCfg();
    expect(() => raydiumCpSwap.referenceQuote(cfg, state, 1_000_000n, 1_715_746_442n)).toThrow(
      `raydium-cp-swap pool ${POOL} is not open yet (open_time 1715746443, now 1715746442)`,
    );
  });

  it("throws when the state map is missing an account it reads", async () => {
    const cfg = await fetchCfg();
    const partial = { ...state };
    delete partial[VAULT1];
    expect(() => raydiumCpSwap.referenceQuote(cfg, partial, 1_000_000n, NOW)).toThrow(
      `raydium-cp-swap referenceQuote is missing account ${VAULT1}`,
    );
  });

  it("rejects non-u64 amounts", async () => {
    const cfg = await fetchCfg();
    expect(() => raydiumCpSwap.referenceQuote(cfg, state, 0n, NOW)).toThrow(
      "raydium-cp-swap amountIn must be a positive u64, got 0",
    );
    expect(() => raydiumCpSwap.referenceQuote(cfg, state, 1n << 64n, NOW)).toThrow(
      `raydium-cp-swap amountIn must be a positive u64, got ${1n << 64n}`,
    );
  });
});

describe("raydium-cp-swap buildSwap", () => {
  const user = { outAta: "user-usdc-ata", inAta: "user-wsol-ata", owner: "user-wallet" };

  it("encodes swap_base_input with min_out 1", async () => {
    const swap = raydiumCpSwap.buildSwap(await fetchCfg(), user, 1_000_000n);
    expect(swap.programId).toBe("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    expect(swap.data).toEqual(
      Uint8Array.from([
        143,
        190,
        90,
        218,
        196,
        30,
        51,
        222, // sha256("global:swap_base_input")[0..8]
        0x40,
        0x42,
        0x0f,
        0,
        0,
        0,
        0,
        0, // amount_in 1_000_000 u64 LE
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0, // minimum_amount_out 1 u64 LE
      ]),
    );
  });

  it("orders the 13 swap accounts exactly as the instruction expects (ZeroForOne)", async () => {
    const swap = raydiumCpSwap.buildSwap(await fetchCfg(), user, 1_000_000n);
    expect(swap.accounts).toEqual([
      { ref: "user-wallet", signer: true }, // 0 payer
      { ref: AUTHORITY, address: AUTHORITY }, // 1 authority PDA
      { ref: AMM_CONFIG, address: AMM_CONFIG }, // 2 amm_config
      { ref: POOL, address: POOL, writable: true }, // 3 pool_state
      { ref: "user-wsol-ata", writable: true }, // 4 input_token_account
      { ref: "user-usdc-ata", writable: true }, // 5 output_token_account
      { ref: VAULT0, address: VAULT0, writable: true }, // 6 input_vault
      { ref: VAULT1, address: VAULT1, writable: true }, // 7 output_vault
      { ref: TOKENKEG, address: TOKENKEG }, // 8 input_token_program
      { ref: TOKENKEG, address: TOKENKEG }, // 9 output_token_program
      { ref: WSOL, address: WSOL }, // 10 input_token_mint
      { ref: USDC, address: USDC }, // 11 output_token_mint
      { ref: OBSERVATION, address: OBSERVATION, writable: true }, // 12 observation_state
    ]);
  });

  it("swaps the vault and mint sides for OneForZero", async () => {
    const cfg = { ...(await fetchCfg()), inputIsToken0: false };
    const swap = raydiumCpSwap.buildSwap(cfg, user, 1_000_000n);
    expect(swap.accounts[6]).toEqual({ ref: VAULT1, address: VAULT1, writable: true });
    expect(swap.accounts[7]).toEqual({ ref: VAULT0, address: VAULT0, writable: true });
    expect(swap.accounts[10]).toEqual({ ref: USDC, address: USDC });
    expect(swap.accounts[11]).toEqual({ ref: WSOL, address: WSOL });
  });

  it("rejects non-u64 amounts", async () => {
    const cfg = await fetchCfg();
    expect(() => raydiumCpSwap.buildSwap(cfg, user, 0n)).toThrow(
      "raydium-cp-swap amountIn must be a positive u64, got 0",
    );
    expect(() => raydiumCpSwap.buildSwap(cfg, user, 1n << 64n)).toThrow(
      `raydium-cp-swap amountIn must be a positive u64, got ${1n << 64n}`,
    );
  });
});

describe("raydium-cp-swap emitQuote", () => {
  // Account model: reads go through main()'s ordered `acc<k>` params (k = the ref's
  // index in quoteAccounts), which for this venue is [pool=acc0, ammConfig=acc1,
  // token0Vault=acc2, token1Vault=acc3]. `accountUint` → `svm.sload(...).toLe()`.
  it("emits a q<i> fragment reading only quoteAccounts refs via svm.sload", async () => {
    const cfg = await fetchCfg();
    const fragment = raydiumCpSwap.emitQuote(cfg, 3, 1_000_000n);
    expect(fragment).toContain("const q3 =");
    expect(fragment).not.toContain("accountUint(");
    expect(fragment).not.toContain("accountData(");

    const accountCount = raydiumCpSwap.quoteAccounts(cfg).length;
    const reads = [...fragment.matchAll(/svm\.sload\((acc\d+)/g)].map((match) => match[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const acc of reads) {
      const k = Number(acc.slice(3));
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(accountCount);
    }
  });

  it("reads the input-side reserve from vault0 with the token_0 fee accumulators (ZeroForOne)", async () => {
    const fragment = raydiumCpSwap.emitQuote(await fetchCfg(), 0, 1_000_000n);
    const [rin, rout] = fragment.split("\n");
    // reserve = vault.amount(@64) - protocol(@341) - fund(@357) - creator(@397).
    // input vault = token0Vault = acc2; pool = acc0.
    expect(rin).toContain("svm.sload(acc2, 64, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 341, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 357, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 397, 8).toLe()");
    expect(rout).toContain("svm.sload(acc3, 64, 8).toLe()");
    expect(rout).toContain("svm.sload(acc0, 349, 8).toLe()");
    // Live trade fee rate from AmmConfig (acc1) @12; creator rate @108 stays unread
    // while enable_creator_fee is 0.
    expect(fragment).toContain("svm.sload(acc1, 12, 8).toLe()");
    expect(fragment).not.toContain("svm.sload(acc1, 108, 8)");
  });

  it("flips the reserve sides for OneForZero", async () => {
    const cfg = { ...(await fetchCfg()), inputIsToken0: false };
    const [rin, rout] = raydiumCpSwap.emitQuote(cfg, 0, 1_000_000n).split("\n");
    // input vault = token1Vault = acc3; output vault = token0Vault = acc2.
    expect(rin).toContain("svm.sload(acc3, 64, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 349, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 365, 8).toLe()");
    expect(rin).toContain("svm.sload(acc0, 405, 8).toLe()");
    expect(rout).toContain("svm.sload(acc2, 64, 8).toLe()");
  });

  it("adds the live creator rate to the input fee when enabled on the input side", async () => {
    const fx = doctored(fixtures, POOL, (data) => {
      data[390] = 1;
    });
    const fragment = raydiumCpSwap.emitQuote(await fetchCfg(fx), 0, 1_000_000n);
    expect(fragment).toContain("(svm.sload(acc1, 12, 8).toLe() + svm.sload(acc1, 108, 8).toLe())");
    expect(fragment).not.toContain("os0"); // single-fee path, no output-side creator carve-out
  });

  it("carves the creator fee out of the swapped output when enabled on the output side", async () => {
    const fx = doctored(fixtures, POOL, (data) => {
      data[389] = 2;
      data[390] = 1;
    });
    const fragment = raydiumCpSwap.emitQuote(await fetchCfg(fx), 0, 1_000_000n);
    expect(fragment).toContain("const os0 =");
    expect(fragment).toContain(
      "const q0 = os0 - ((os0 * svm.sload(acc1, 108, 8).toLe() + 999999) / 1000000);",
    );
  });

  it("compiles for the svm target, manifesting exactly the quote accounts in param order", async () => {
    const cfg = await fetchCfg();
    for (const variant of [
      cfg,
      { ...cfg, inputIsToken0: false },
      { ...cfg, enableCreatorFee: true },
      { ...cfg, enableCreatorFee: true, creatorFeeOn: 2 },
    ]) {
      const accounts = raydiumCpSwap.quoteAccounts(variant);
      const { bytecode, manifest } = compileSvm(
        wrapQuoteMain(accounts.length, raydiumCpSwap.emitQuote(variant, 0, 1_000_000n), "q0"),
      );
      expect(bytecode.length).toBeGreaterThan(0);
      expect(manifest?.accounts).toEqual(
        accounts.map((_, k) => ({ kind: "slot", index: k, name: "acc" + k, requires: "readonly" })),
      );
    }
  });

  it("rejects non-u64 amounts", async () => {
    const cfg = await fetchCfg();
    expect(() => raydiumCpSwap.emitQuote(cfg, 0, 0n)).toThrow(
      "raydium-cp-swap amountIn must be a positive u64, got 0",
    );
  });
});
