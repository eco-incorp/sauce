/**
 * The PDA sites that used to derive raw, beside the Kitchen's (kitchen-pda-memo.test.ts): the
 * eco-routes Portal's PDAs, the lookup table `createAltWithAddresses` creates, perps-jlp's and
 * voltr's program-wide PDAs, and every known-bump `create_program_address` (stabble, saber-
 * stableswap, mercurial, sanctum-stake-pool, fluxbeam, the spl-token-swap forks, orca-legacy-
 * token-swap). Each goes through the shared memo (src/svm/venues/pda-memo.ts), so:
 *
 *  (a) every result is byte-identical to a direct, un-memoized derivation;
 *  (b) a SECOND call with the same inputs performs ZERO underlying derivations
 *      (`__pdaMemoStats().misses` counts them);
 *  (c) a known-bump site keeps its own on-curve behaviour: stabble, saber and mercurial refuse an
 *      on-curve result, the others take it (their pools exist on chain with that bump).
 *
 * Fails on a tree where these sites derive raw: the memo counters never move.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  address,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  isOffCurveAddress,
} from "@solana/kit";
import type { Address, Blockhash } from "@solana/kit";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstructionAsync,
} from "@solana-program/address-lookup-table";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { AccountLoader } from "../../src/svm/index.js";
import { createAltWithAddresses } from "../../src/svm/alt.js";
import {
  associatedTokenAccount,
  hyperlaneDispatchedMessagePda,
  hyperlaneOutboxPda,
  igpGasPaymentPda,
  igpProgramDataPda,
  svmExecutorPda,
  svmFulfillMarkerPda,
  svmHyperDispatcherPda,
  svmPortalDispatcherPda,
} from "../../src/svm/portal.js";
import { __pdaMemoStats, __resetPdaMemoForTest } from "../../src/svm/venues/pda-memo.js";
import {
  eventAuthorityPda,
  perpetualsPda,
  PERPS_JLP_PROGRAM_ID,
  transferAuthorityPda,
} from "../../src/svm/venues/perps-jlp/index.js";
import { fetchVoltrConfig, VOLTR_PROGRAM_ID } from "../../src/svm/venues/voltr/index.js";
import {
  deriveStabbleVaultAuthority,
  STABBLE_VAULT_PROGRAM_ID,
} from "../../src/svm/venues/stabble-common.js";
import {
  SABER_STABLESWAP_PROGRAM_ID,
  saberStableswap,
} from "../../src/svm/venues/saber-stableswap/index.js";
import type { SaberPoolConfig } from "../../src/svm/venues/saber-stableswap/index.js";
import {
  fetchMercurialPoolConfig,
  MERCURIAL_PROGRAM_ID,
} from "../../src/svm/venues/mercurial/index.js";
import {
  SANCTUM_STAKE_POOL_PROGRAM_ID,
  sanctumStakePool,
} from "../../src/svm/venues/sanctum-stake-pool/index.js";
import {
  fetchFluxBeamPoolConfig,
  FLUXBEAM_PROGRAM_ID,
} from "../../src/svm/venues/fluxbeam/index.js";
import {
  TOKEN_SWAP_V1_PROGRAM_ID,
  tokenSwapV1,
} from "../../src/svm/venues/spl-token-swap-forks/index.js";
import { orcaLegacyTokenSwap } from "../../src/svm/venues/orca-legacy-token-swap/index.js";
import { fixtureData, loadFixtures } from "./fixtures.js";
import { makeLegacyMint } from "./fixtures/token-2022/synth.js";

const enc = getAddressEncoder();
const dec = getAddressDecoder();
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const key = (b: number): Address => dec.decode(new Uint8Array(32).fill(b));

const PORTAL = key(1);
const PROVER = key(2);
const MAILBOX = key(3);
const IGP = key(4);
const UNIQUE = key(5);
const OWNER = key(6);
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const INTENT_HASH = `0x${"ab".repeat(32)}` as const;
const CLOCK = address("SysvarC1ock11111111111111111111111111111111");

beforeEach(() => {
  __resetPdaMemoForTest();
});

/** `run` once (each of its derivations a miss), check it, then again: no new derivation. */
async function expectMemoized<T>(run: () => Promise<T>, check: (first: T) => Promise<void>) {
  const first = await run();
  const { misses } = __pdaMemoStats();
  expect(misses).toBeGreaterThan(0);
  await check(first);
  expect(await run()).toEqual(first);
  expect(__pdaMemoStats().misses).toBe(misses);
  expect(__pdaMemoStats().hits).toBeGreaterThan(0);
}

async function direct(programAddress: Address, seeds: (string | Uint8Array)[]): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress, seeds }))[0];
}

describe("find-style sites use the shared PDA memo", () => {
  const cases: [string, () => Promise<Address>, () => Promise<Address>][] = [
    ["svmExecutorPda", () => svmExecutorPda(PORTAL), () => direct(PORTAL, ["executor"])],
    [
      "svmFulfillMarkerPda",
      () => svmFulfillMarkerPda(PORTAL, INTENT_HASH),
      () => direct(PORTAL, ["fulfill_marker", new Uint8Array(32).fill(0xab)]),
    ],
    [
      "svmPortalDispatcherPda",
      () => svmPortalDispatcherPda(PORTAL, PROVER),
      () => direct(PORTAL, ["dispatcher", enc.encode(PROVER) as Uint8Array]),
    ],
    [
      "svmHyperDispatcherPda",
      () => svmHyperDispatcherPda(PROVER),
      () => direct(PROVER, ["dispatcher"]),
    ],
    [
      "hyperlaneOutboxPda",
      () => hyperlaneOutboxPda(MAILBOX),
      () => direct(MAILBOX, ["hyperlane", "-", "outbox"]),
    ],
    [
      "hyperlaneDispatchedMessagePda",
      () => hyperlaneDispatchedMessagePda(MAILBOX, UNIQUE),
      () =>
        direct(MAILBOX, [
          "hyperlane",
          "-",
          "dispatched_message",
          "-",
          enc.encode(UNIQUE) as Uint8Array,
        ]),
    ],
    [
      "igpProgramDataPda",
      () => igpProgramDataPda(IGP),
      () => direct(IGP, ["hyperlane_igp", "-", "program_data"]),
    ],
    [
      "igpGasPaymentPda",
      () => igpGasPaymentPda(IGP, UNIQUE),
      () =>
        direct(IGP, ["hyperlane_igp", "-", "gas_payment", "-", enc.encode(UNIQUE) as Uint8Array]),
    ],
    [
      "associatedTokenAccount",
      () => associatedTokenAccount(OWNER, MINT, TOKEN_PROGRAM_ADDRESS),
      async () =>
        (
          await findAssociatedTokenPda({
            owner: OWNER,
            mint: MINT,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          })
        )[0],
    ],
    [
      "perps-jlp transferAuthorityPda",
      transferAuthorityPda,
      () => direct(PERPS_JLP_PROGRAM_ID, ["transfer_authority"]),
    ],
    ["perps-jlp perpetualsPda", perpetualsPda, () => direct(PERPS_JLP_PROGRAM_ID, ["perpetuals"])],
    [
      "perps-jlp eventAuthorityPda",
      eventAuthorityPda,
      () => direct(PERPS_JLP_PROGRAM_ID, ["__event_authority"]),
    ],
  ];

  for (const [name, run, expected] of cases) {
    it(`${name}: byte-identical to a direct derive; the second call derives nothing`, async () => {
      await expectMemoized(run, async (first) => expect(first).toBe(await expected()));
      expect(__pdaMemoStats()).toEqual({ misses: 1, hits: 1 });
    });
  }

  it("voltr fetchVoltrConfig: the protocol PDA is byte-identical; a second fetch derives nothing", async () => {
    const pool = address("Gj8kURFs8fK3GhiX5Yc6H1HQKSpEvLHeDRZsP6Y2D1je");
    const lpMint = await direct(VOLTR_PROGRAM_ID, [
      "vault_lp_mint",
      enc.encode(pool) as Uint8Array,
    ]);
    const vault = new Uint8Array(928);
    vault.set([211, 8, 232, 43, 2, 152, 117, 119], 0);
    vault.set(enc.encode(MINT), 104);
    vault.set(enc.encode(lpMint), 272);
    const accounts = new Map<string, Uint8Array>([
      [pool, vault],
      [MINT, makeLegacyMint()],
      [lpMint, makeLegacyMint()],
    ]);
    const load: AccountLoader = async (a) => accounts.get(a) ?? null;

    await expectMemoized(
      () => fetchVoltrConfig(load, pool),
      async (cfg) => {
        // The protocol PDA, the three vault PDAs and the idle ATA: every derivation is the memo's.
        expect(__pdaMemoStats().misses).toBe(5);
        expect(cfg.protocol).toBe(await direct(VOLTR_PROGRAM_ID, ["protocol"]));
      },
    );
  });

  it("createAltWithAddresses: the table address and create instruction are what the async builder derives; a second call derives nothing", async () => {
    const authority = await generateKeyPairSigner();
    const recentSlot = 100n;
    const rpc = {
      getSlot: () => ({ send: async () => recentSlot }),
      getLatestBlockhash: () => ({
        send: async () => ({
          context: { slot: recentSlot },
          value: {
            blockhash: "11111111111111111111111111111111" as Blockhash,
            lastValidBlockHeight: 1000n,
          },
        }),
      }),
    } as unknown as Parameters<typeof createAltWithAddresses>[0]["rpc"];
    const run = async () => {
      const created: Uint8Array[] = [];
      const { lookupTableAddress } = await createAltWithAddresses({
        rpc,
        payer: authority,
        authority,
        addresses: [MINT],
        sendAndConfirm: async (transaction) => {
          if (created.length > 0) return;
          const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
          if (message.version !== 0) throw new Error("expected a v0 compiled message");
          created.push(Uint8Array.from(message.instructions[0]!.data!));
        },
      });
      return { lookupTableAddress, createData: created[0] };
    };

    await expectMemoized(run, async ({ lookupTableAddress, createData }) => {
      const [expected] = await findAddressLookupTablePda({
        authority: authority.address,
        recentSlot,
      });
      expect(lookupTableAddress).toBe(expected);
      const viaAsync = await getCreateLookupTableInstructionAsync({
        authority: authority.address,
        payer: authority,
        recentSlot,
      });
      expect(createData).toEqual(Uint8Array.from(viaAsync.data));
    });
  });
});

/** `create_program_address` computed by hand: sha256(seeds || program || "ProgramDerivedAddress"). */
function createDirect(program: Address, seeds: Uint8Array[]): Address {
  const hash = createHash("sha256");
  for (const seed of seeds) hash.update(seed);
  hash.update(enc.encode(program) as Uint8Array).update("ProgramDerivedAddress");
  return dec.decode(hash.digest());
}

/** The first bump whose `create_program_address` lands off (or on) the curve. */
function bumpWhere(
  offCurve: boolean,
  program: Address,
  seeds: (bump: number) => Uint8Array[],
): number {
  for (let bump = 255; bump >= 0; bump--) {
    if (isOffCurveAddress(createDirect(program, seeds(bump))) === offCurve) return bump;
  }
  throw new Error("no such bump");
}

/** A constant-product spl-token-swap SwapV1 pool (the layout orca-legacy and FluxBeam share). */
function swapV1(bump: number, mintA: Address, mintB: Address): Uint8Array {
  const data = new Uint8Array(324);
  data[0] = 1; // SwapV1
  data[1] = 1; // initialized
  data[2] = bump;
  data.set(enc.encode(mintA), 131);
  data.set(enc.encode(mintB), 163);
  return data;
}

const POOL = key(7);
const VAULT_A = key(8);
const VAULT_B = key(9);
const MINT_A = key(10);
const MINT_B = key(11);
const loaderOf =
  (accounts: [Address, Uint8Array][]): AccountLoader =>
  async (a) =>
    new Map<string, Uint8Array>(accounts).get(a) ?? null;
const saberFixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/saber-stableswap"));
const SABER_POOL = address("YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe");

interface KnownBumpSite {
  name: string;
  program: Address;
  seeds: (bump: number) => Uint8Array[];
  /** The site, through the public path that reaches it. */
  run: (bump: number) => Promise<Address>;
  /** Refuses an on-curve result (the others return it). */
  strict: boolean;
}

const KNOWN_BUMP_SITES: KnownBumpSite[] = [
  {
    name: "stabble deriveStabbleVaultAuthority",
    program: STABBLE_VAULT_PROGRAM_ID,
    seeds: (bump) => [utf8("vault_authority"), enc.encode(POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) => deriveStabbleVaultAuthority(POOL, bump),
    strict: true,
  },
  {
    name: "saber-stableswap swap authority",
    program: SABER_STABLESWAP_PROGRAM_ID,
    seeds: (bump) => [enc.encode(SABER_POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) => {
      const load: AccountLoader = async (a) => {
        const fixture = saberFixtures.find((f) => f.address === a);
        if (fixture === undefined) return null;
        const data = fixtureData(fixture);
        if (a === SABER_POOL) data[2] = bump;
        return data;
      };
      const cfg = (await saberStableswap.fetchPoolConfig(load, SABER_POOL)) as SaberPoolConfig;
      return cfg.swapAuthority;
    },
    strict: true,
  },
  {
    name: "mercurial swap authority",
    program: MERCURIAL_PROGRAM_ID,
    seeds: (bump) => [enc.encode(POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) => {
      const pool = new Uint8Array(265);
      pool.set([2, 1, bump]); // SwapV2, initialized, nonce
      new DataView(pool.buffer).setUint32(27, 2, true); // 2 coins
      pool.set(enc.encode(VAULT_A), 71);
      pool.set(enc.encode(VAULT_B), 103);
      const owner = createDirect(MERCURIAL_PROGRAM_ID, [
        enc.encode(POOL) as Uint8Array,
        Uint8Array.of(bump),
      ]);
      const vault = (mint: Address): Uint8Array => {
        const data = new Uint8Array(165);
        data.set(enc.encode(mint), 0);
        data.set(enc.encode(owner), 32);
        return data;
      };
      const load = loaderOf([
        [POOL, pool],
        [VAULT_A, vault(MINT_A)],
        [VAULT_B, vault(MINT_B)],
        [MINT_A, makeLegacyMint()],
        [MINT_B, makeLegacyMint()],
      ]);
      return (await fetchMercurialPoolConfig(load, POOL)).authority;
    },
    strict: true,
  },
  {
    name: "sanctum-stake-pool withdraw authority",
    program: SANCTUM_STAKE_POOL_PROGRAM_ID,
    seeds: (bump) => [enc.encode(POOL) as Uint8Array, utf8("withdraw"), Uint8Array.of(bump)],
    run: async (bump) => {
      const pool = new Uint8Array(611);
      pool[0] = 1; // StakePool
      pool[97] = bump; // stake_withdraw_bump_seed
      const load = loaderOf([
        [POOL, pool],
        [CLOCK, new Uint8Array(40)],
      ]);
      return (await sanctumStakePool.fetchPoolConfig(load, POOL)).withdrawAuthority;
    },
    strict: false,
  },
  {
    name: "fluxbeam swap authority",
    program: FLUXBEAM_PROGRAM_ID,
    seeds: (bump) => [enc.encode(POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) => {
      const load = loaderOf([
        [POOL, swapV1(bump, MINT_A, MINT_B)],
        [MINT_A, makeLegacyMint()],
        [MINT_B, makeLegacyMint()],
      ]);
      return (await fetchFluxBeamPoolConfig(load, POOL)).swapAuthority;
    },
    strict: false,
  },
  {
    name: "spl-token-swap fork (token-swap-v1) swap authority",
    program: TOKEN_SWAP_V1_PROGRAM_ID,
    seeds: (bump) => [enc.encode(POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) =>
      (await tokenSwapV1.fetchPoolConfig(loaderOf([[POOL, swapV1(bump, MINT_A, MINT_B)]]), POOL))
        .swapAuthority,
    strict: false,
  },
  {
    name: "orca-legacy-token-swap swap authority",
    program: orcaLegacyTokenSwap.programId,
    seeds: (bump) => [enc.encode(POOL) as Uint8Array, Uint8Array.of(bump)],
    run: async (bump) =>
      (
        await orcaLegacyTokenSwap.fetchPoolConfig(
          loaderOf([[POOL, swapV1(bump, MINT_A, MINT_B)]]),
          POOL,
        )
      ).swapAuthority,
    strict: false,
  },
];

describe("known-bump sites use the shared PDA memo", () => {
  for (const site of KNOWN_BUMP_SITES) {
    it(`${site.name}: byte-identical to a direct create_program_address; the second call derives nothing`, async () => {
      const bump = bumpWhere(true, site.program, site.seeds);
      await expectMemoized(
        () => site.run(bump),
        async (first) => expect(first).toBe(createDirect(site.program, site.seeds(bump))),
      );
    });

    it(`${site.name}: ${site.strict ? "refuses" : "returns"} an on-curve result, as before`, async () => {
      const bump = bumpWhere(false, site.program, site.seeds);
      if (site.strict) {
        await expect(site.run(bump)).rejects.toThrow(/on-curve/);
      } else {
        expect(await site.run(bump)).toBe(createDirect(site.program, site.seeds(bump)));
      }
    });
  }
});
