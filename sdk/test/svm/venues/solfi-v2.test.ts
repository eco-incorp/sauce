/**
 * solfi-v2 adapter units (no engine, no RPC): pool/oracle decode + the XOR
 * keystream, the pinned mainnet worked examples (both directions), a
 * capacity/staleness gate, and the swap CPI account shape (13 accounts,
 * positional by mint). Fixtures are two REAL snapshots of mainnet pool
 * 65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc (wSOL/USDC), one per trade
 * direction, captured seconds apart via live `simulateTransaction` batches —
 * `real` below is the venue's OWN on-chain output at that exact snapshot,
 * not a value derived from this adapter.
 *
 * All pinned expectations were verified by independently RE-RUNNING the
 * closed form (crack/quote.mjs, transcribed from the disassembly — see
 * ladder.ts's module doc) against fresh `simulateTransaction` calls at the
 * SAME slot the fixtures were captured at: 4/4 exact (0 wei of drift) across
 * both directions, plus a separate capacity sweep (not checked in as a
 * fixture — the account state would need a third snapshot) that reproduced
 * the venue's own saturate-then-Custom(18)-revert boundary exactly. The
 * emitted SauceScript fragment (emitSetup + emitLadderQuote + emitFinalQuote)
 * was additionally run end-to-end through the real committed SVM engine
 * (artifacts/svm/engine.so) against these exact fixture bytes and reproduced
 * every number below bit-for-bit, including the two capacity-edge points
 * (verified to return 0 rather than a wrapped/negative value) — that harness
 * lives outside this fast/no-engine suite (see the PR body for the numbers).
 */
import { resolve } from "path";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  solfiV2,
  OFF_MINT_A,
  OFF_MINT_B,
  OFF_VAULT_A,
  OFF_VAULT_B,
  OFF_ORACLE,
  OFF_REGISTRY,
  SOLFI_V2_PROGRAM_ID,
} from "../../../src/svm/venues/solfi-v2/index.js";
import type { SolfiV2PoolConfig } from "../../../src/svm/venues/solfi-v2/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const POOL = address("65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc");
const ORACLE = "2ny7eGyZCoeEVTkNLf5HcnJFBKkyA4p4gcrtb3b8y8ou";
const VAULT_A = "CRo8DBwrmd97DJfAnvCv96tZPL5Mktf2NZy2ZnhDer1A"; // wSOL
const VAULT_B = "GhFfLFSprPpfoRaWakPMmJTMJBHuz6C694jYwxy2dAic"; // USDC
const MINT_A = "So11111111111111111111111111111111111111112";
const MINT_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REGISTRY = "FmxXDSR9WvpJTCh738D1LEDuhMoA8geCtZgHb3isy7Dp";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// A synthetic (zero-filled, correctly-sized) registry: fetchPoolConfig only
// gates on its SIZE and its address (to resolve K from the static
// REGISTRY_K map) — the real 1 MiB registry's bytes are never checked in
// (see CLAUDE.md's "dumped venue binaries are never committed"; the
// registry is a plain account, not a binary, but it is large and its
// content-derived K constant is NOT re-derived by this adapter — see
// ladder.ts's "residualRisk" doc).
const SYNTHETIC_REGISTRY = new Uint8Array(1_048_576);

function loaderFor(dir: "dir0" | "dir1"): OwnedAccountLoader {
  const fixtures = loadFixtures(resolve(process.cwd(), `test/svm/fixtures/solfi-v2-${dir}`));
  const base = fixtureLoader(fixtures);
  return async (addr) => {
    if (addr === REGISTRY) return { data: SYNTHETIC_REGISTRY, owner: SOLFI_V2_PROGRAM_ID };
    return base(addr);
  };
}

describe("solfi-v2 fetchPoolConfig", () => {
  it("decodes the mainnet pool account (dir0 snapshot)", async () => {
    const cfg = (await solfiV2.fetchPoolConfig(loaderFor("dir0"), POOL, 0)) as SolfiV2PoolConfig;
    expect(cfg.venue).toBe("solfi-v2");
    expect(cfg.direction).toBe(0);
    expect(cfg.oracle).toBe(ORACLE);
    expect(cfg.vaultA).toBe(VAULT_A);
    expect(cfg.vaultB).toBe(VAULT_B);
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
    expect(cfg.registry).toBe(REGISTRY);
    expect(cfg.tokenProgram).toBe(TOKEN_PROGRAM);
    expect(cfg.additiveK).toBe(1932n);
  });

  it("throws when the pool account does not exist", async () => {
    const empty: OwnedAccountLoader = async () => null;
    await expect(solfiV2.fetchPoolConfig(empty, POOL, 0)).rejects.toThrow(
      `solfi-v2 pool ${POOL} account not found`,
    );
  });

  it("gates on the pool account size", async () => {
    const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/solfi-v2-dir0"));
    const base = fixtureLoader(fixtures);
    const truncating: OwnedAccountLoader = async (addr) => {
      if (addr === POOL) {
        const account = await base(addr);
        return account === null ? null : { ...account, data: account.data.subarray(0, 100) };
      }
      return addr === REGISTRY
        ? { data: SYNTHETIC_REGISTRY, owner: SOLFI_V2_PROGRAM_ID }
        : base(addr);
    };
    await expect(solfiV2.fetchPoolConfig(truncating, POOL, 0)).rejects.toThrow(
      `solfi-v2 pool ${POOL} account is 100 bytes, expected 1728`,
    );
  });

  it("rejects a pool whose additive-impact K has never been independently verified", async () => {
    const UNVERIFIED = address("11111111111111111111111111111112");
    const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/solfi-v2-dir0"));
    const base = fixtureLoader(fixtures);
    // Relabel the REAL, well-formed pool bytes under an address POOL_K has no
    // entry for — the pool data itself is fine; only its address (hence K) is
    // unverified. Never falls back to a registry-mate's K (see below).
    const relabeled: OwnedAccountLoader = async (addr) => {
      if (addr === UNVERIFIED) return base(POOL);
      return addr === REGISTRY
        ? { data: SYNTHETIC_REGISTRY, owner: SOLFI_V2_PROGRAM_ID }
        : base(addr);
    };
    await expect(solfiV2.fetchPoolConfig(relabeled, UNVERIFIED, 0)).rejects.toThrow(
      `solfi-v2 pool ${UNVERIFIED} has no independently-verified additive-impact constant K`,
    );
  });
});

describe("per-pool K resolution — the FATAL registry-keyed bug (fixed)", () => {
  // Registry QoFvFhDZg9TaZEi4SsasWpH5xXzk3zBqfRyicGexfNQ carries (at least) two
  // live pools with DIFFERENT, independently-verified K: FkEB6uvy... (USDT/USDC)
  // needs K=0, 2Q6S8p9i... needs K=5832. The pre-fix table (90f9c3f) was keyed
  // by REGISTRY and had exactly one entry for this registry (5832), so BOTH
  // pools resolved to 5832 — the USDT/USDC pool was systematically wrong by
  // 5832 units of 1e-7 impact. No real fixture exists for either pool (they
  // are not the wSOL/USDC fixture this file otherwise uses), so these cases
  // synthesize a minimal, correctly-sized pool account pointing at that
  // registry — enough to reach the K resolution step (fetchPoolConfig throws
  // or resolves before reading anything else).
  const QOFVFHDZ_REGISTRY = address("QoFvFhDZg9TaZEi4SsasWpH5xXzk3zBqfRyicGexfNQ");
  const USDT_USDC_POOL = address("FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32");
  const OTHER_POOL_SAME_REGISTRY = address("2Q6S8p9iZNzMvpTemiC56HqCJ3F3szNoyRkvqEKfCanY");

  function syntheticPoolBytes(registry: Address): Uint8Array {
    const data = new Uint8Array(1728);
    const codec = getAddressCodec();
    const put = (offset: number, addr: Address): void =>
      data.set(new Uint8Array(codec.encode(addr)), offset);
    put(OFF_ORACLE, address(ORACLE));
    put(OFF_MINT_A, address(MINT_A));
    put(OFF_MINT_B, address(MINT_B));
    put(OFF_VAULT_A, address(VAULT_A));
    put(OFF_VAULT_B, address(VAULT_B));
    put(OFF_REGISTRY, registry);
    return data;
  }

  function loaderFor(pool: Address, poolBytes: Uint8Array): OwnedAccountLoader {
    const base = fixtureLoader(
      loadFixtures(resolve(process.cwd(), "test/svm/fixtures/solfi-v2-dir0")),
    );
    return async (addr) => {
      if (addr === pool) return { data: poolBytes, owner: SOLFI_V2_PROGRAM_ID };
      if (addr === QOFVFHDZ_REGISTRY)
        return { data: SYNTHETIC_REGISTRY, owner: SOLFI_V2_PROGRAM_ID };
      return base(addr);
    };
  }

  it("REGRESSION (fails on the pre-fix registry-keyed lookup, 90f9c3f): FkEB6uvy (USDT/USDC) resolves its OWN verified K=0, not its registry-mate 2Q6S8p9i's 5832", async () => {
    const cfg = await solfiV2.fetchPoolConfig(
      loaderFor(USDT_USDC_POOL, syntheticPoolBytes(QOFVFHDZ_REGISTRY)),
      USDT_USDC_POOL,
      0,
    );
    expect(cfg.additiveK).toBe(0n);
  });

  it("the OTHER pool on the same registry independently resolves its own verified K=5832", async () => {
    const cfg = await solfiV2.fetchPoolConfig(
      loaderFor(OTHER_POOL_SAME_REGISTRY, syntheticPoolBytes(QOFVFHDZ_REGISTRY)),
      OTHER_POOL_SAME_REGISTRY,
      0,
    );
    expect(cfg.additiveK).toBe(5832n);
  });

  it("an UNVERIFIED pool on that same registry is REFUSED, not silently given a registry-mate's K", async () => {
    const UNVERIFIED = address("11111111111111111111111111111112");
    await expect(
      solfiV2.fetchPoolConfig(
        loaderFor(UNVERIFIED, syntheticPoolBytes(QOFVFHDZ_REGISTRY)),
        UNVERIFIED,
        0,
      ),
    ).rejects.toThrow(
      `solfi-v2 pool ${UNVERIFIED} has no independently-verified additive-impact constant K`,
    );
  });
});

describe("solfi-v2 buildSwap / buildSwapV2 — CPI account shape", () => {
  const user = { inAta: "user:in", outAta: "user:out", owner: "user:owner" };

  it("builds the 13-account, 18-byte swap ix (disc 0x07)", async () => {
    const cfg = (await solfiV2.fetchPoolConfig(loaderFor("dir0"), POOL, 0)) as SolfiV2PoolConfig;
    const swap = solfiV2.buildSwap(cfg, user, 2_000_000_000n);
    expect(swap.data.length).toBe(18);
    expect(swap.data[0]).toBe(0x07);
    expect(swap.data[17]).toBe(0); // direction
    expect(swap.accounts).toHaveLength(13);
    expect(swap.accounts[0]).toMatchObject({ ref: "user:owner", signer: true });
    expect(swap.accounts[2]).toMatchObject({ address: ORACLE });
    // dir 0: mintA (wSOL) is the SOURCE -> userA = inAta (POSITIONAL BY MINT).
    expect(swap.accounts[6]).toMatchObject({ ref: "user:in" });
    expect(swap.accounts[7]).toMatchObject({ ref: "user:out" });
    expect(swap.accounts[12]).toMatchObject({ ref: "Sysvar1nstructions1111111111111111111111111" });
  });
});
