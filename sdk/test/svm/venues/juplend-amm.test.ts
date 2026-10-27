/**
 * juplend-amm venue adapter units (no engine, no RPC): fetchPoolConfig
 * against a REAL mainnet dump (dex_id 1, USDC/USDT, pool
 * FfEJYz4hLLFe4KyNyKYCjvfhMfbtpLH3CXpcPe8nhmfy — checked in under
 * sdk/test/svm/fixtures/juplend-amm/, captured 2026-07-31; a smart_debt,
 * non-shifting-peg pool — see index.ts's module doc for why an ACTIVE
 * center-price-shift pool like the SOL/JitoSOL one is rejected outright and
 * so cannot be the fetchPoolConfig fixture here), plus the capacity-clamp /
 * rate-model unit coverage.
 *
 * VALIDATION METHOD AND ITS LIMITS (see index.ts's module doc for the full
 * account-list write-up): every byte offset and every PDA this test
 * exercises was independently reproduced against LIVE mainnet-beta state —
 * this fixture's `tokenReserve0`/`tokenReserve1`/`position0`/`position1`
 * derivations below are asserted against the REAL addresses the RPC
 * returned for this exact Dex, not merely "does it not throw". What this
 * suite does NOT do (and could not, without the closed-source Rust): assert
 * `referenceQuote` reproduces the real program's own exact output. The
 * account-list correctness (all 24 `swap_in` accounts, both position kinds)
 * was instead proven by round-tripping the real instruction through
 * `simulateTransaction` for THIS pool and for a smart-collateral pool
 * (SOL/JitoSOL), each running deep into the program's own business logic
 * (11–50k CU) past every Anchor account/owner/discriminator check — see
 * index.ts's module doc for the full account-list validation writeup.
 */
import { resolve } from "path";
import { address, getProgramDerivedAddress } from "@solana/kit";
import {
  juplendAmm,
  JUPLEND_LIQUIDITY_PROGRAM_ID,
} from "../../../src/svm/venues/juplend-amm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import {
  makeLegacyMint,
  makeT22Mint,
  NON_TRANSFERABLE_TLV,
  PERMANENT_DELEGATE_TLV,
  transferFeeConfigTlv,
} from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/juplend-amm");
const POOL = address("FfEJYz4hLLFe4KyNyKYCjvfhMfbtpLH3CXpcPe8nhmfy");
const MINT_USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MINT_USDT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const TOKENKEG = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

describe("juplend-amm.fetchPoolConfig (real mainnet dump)", () => {
  it("decodes the USDC/USDT Dex and derives every PDA to the REAL on-chain address", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await juplendAmm.fetchPoolConfig(load, POOL, true);

    expect(cfg.token0).toBe(MINT_USDC);
    expect(cfg.token1).toBe(MINT_USDT);
    // fee = 500 (0.05%, 1e6-scale ppm — verified live against 8 real Dex pools).
    expect(cfg.feePpm).toBe(500n);
    // smart_debt enabled, smart_collateral disabled on this pool (real state).
    expect(cfg.positionKind).toBe("borrow");
    expect(cfg.tokenProgram0).toBe(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"));
    expect(cfg.tokenProgram1).toBe(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"));

    // Every derived PDA below was independently verified live: these are
    // the REAL addresses returned by getProgramAccounts / getMultipleAccounts
    // for this exact Dex (see index.ts's module doc).
    expect(cfg.tokenReserve0).toBe(address("94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu"));
    expect(cfg.tokenReserve1).toBe(address("Enao27EWUV2fv3rUqwknJ1eRaM5aAeN5ijeCrM9tayRX"));
    expect(cfg.position0).toBe(address("4NB8MfVbDzZEEKAda5kxChxPSqJJ2vjTb7hRFZyJ5EWr"));
    expect(cfg.position1).toBe(address("37PKKRw8Jv6sXUWi16hjj4TsCmXGugZejsRpWmGzf2PZ"));
    expect(cfg.vault0).toBe(address("BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB"));
    expect(cfg.vault1).toBe(address("4HTRHjdgy4VSVRcsumuzVFCgWywNhjGsD5oG3kqAt5vo"));

    const [expectedLiquidity] = await getProgramDerivedAddress({
      programAddress: JUPLEND_LIQUIDITY_PROGRAM_ID,
      seeds: ["liquidity"],
    });
    expect(cfg.liquidity).toBe(expectedLiquidity);
  });
});

describe("juplend-amm.fetchPoolConfig Token-2022 handling", () => {
  // Wrap the real fixture loader so token0 (USDC) resolves to synthetic
  // Token-2022 mint bytes, owned by the Token-2022 program; every other account
  // (reserves, positions — all keyed on the mint ADDRESS, not its data) is
  // served unchanged from the fixture.
  const wrapToken0 = (mintBytes: Uint8Array): OwnedAccountLoader => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    return async (addr) =>
      addr === MINT_USDC ? { data: new Uint8Array(mintBytes), owner: TOKEN_2022 } : load(addr);
  };

  it("routes a zero-fee Token-2022 token0 (advisory-only) and threads the program per side", async () => {
    const cfg = await juplendAmm.fetchPoolConfig(
      wrapToken0(makeT22Mint(PERMANENT_DELEGATE_TLV)),
      POOL,
      true,
    );
    expect(cfg.tokenProgram0).toBe(TOKEN_2022); // T22 side resolves to the T22 program
    expect(cfg.tokenProgram1).toBe(TOKENKEG); // opposite side stays legacy
  });

  it("routes a plain (extensionless-TLV) Token-2022 token0", async () => {
    const cfg = await juplendAmm.fetchPoolConfig(wrapToken0(makeT22Mint()), POOL, true);
    expect(cfg.tokenProgram0).toBe(TOKEN_2022);
    expect(cfg.tokenProgram1).toBe(TOKENKEG);
  });

  it("routes an extensionless (82-byte) Token-2022 token0 as Token-2022, by its owner", async () => {
    const cfg = await juplendAmm.fetchPoolConfig(wrapToken0(makeLegacyMint()), POOL, true);
    expect(cfg.tokenProgram0).toBe(TOKEN_2022);
    expect(cfg.tokenProgram1).toBe(TOKENKEG);
  });

  it("self-drops a NonTransferable (blocking) Token-2022 mint", async () => {
    await expect(
      juplendAmm.fetchPoolConfig(wrapToken0(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL, true),
    ).rejects.toThrow(`juplend-amm gate: mint ${MINT_USDC} is un-routable`);
  });

  it("still drops a fee-bearing Token-2022 mint (netting deferred to the recipes ladder)", async () => {
    await expect(
      juplendAmm.fetchPoolConfig(wrapToken0(makeT22Mint(transferFeeConfigTlv(30))), POOL, true),
    ).rejects.toThrow(
      `juplend-amm gate: mint ${MINT_USDC} carries a token-2022 TransferFeeConfig extension`,
    );
  });

  it("leaves the all-legacy fixture unchanged (control)", async () => {
    const cfg = await juplendAmm.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL, true);
    expect(cfg.tokenProgram0).toBe(TOKENKEG);
    expect(cfg.tokenProgram1).toBe(TOKENKEG);
  });
});
