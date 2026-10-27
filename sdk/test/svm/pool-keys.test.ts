/**
 * A venue's pool by key (`svm/pool-keys.ts`), per cluster. Held to mainnet: each fixture pool of a
 * venue that finds pools by key (`venue-fixture.ts`) is a pool that venue derives for its pair and
 * the key its own bytes record. Each cluster's Raydium-code tables are every AmmConfig its programs
 * kept and its whirlpools' every fee tier their configs kept, as
 * `test/fixtures/svm-pool-keys/amm-configs.json` (mainnet) and `amm-configs.devnet.json`
 * (`scripts/dump-amm-configs.mjs`) record each. Then resolved as a cook resolves a slot, by key:
 * the pool's nine accounts where it is there, an empty slot where it is not, and a refusal where a
 * fee finds a pool under two configs or a tick spacing a pool on two fee tiers. On devnet, the
 * pools a key derives are the devnet pools each venue's program keeps there.
 */
import { readFileSync } from "node:fs";
import { address, getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import { resolveSvmAccountName } from "../../src/svm/account-names.js";
import {
  svmAmmConfig,
  svmKeyedVenue,
  svmPoolCandidates,
  svmPoolKeyProblem,
} from "../../src/svm/pool-keys.js";
import { SVM_VENUE_TABLE } from "../../src/svm/venue-table.js";
import type { SvmTokenCluster } from "../../src/routes/token-registry.js";
import { memoizedFindProgramAddressSync } from "../../src/svm/venues/pda-memo.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import { BYTES, manifest, pool, SNAPSHOT, SYSTEM, USDC, WSOL } from "./venue-fixture.js";

const keyAt = (data: Uint8Array, offset: number): Address =>
  getAddressDecoder().decode(data.subarray(offset, offset + 32));
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset);
const u16 = (data: Uint8Array, offset: number): number => view(data).getUint16(offset, true);
const u32 = (data: Uint8Array, offset: number): number => view(data).getUint32(offset, true);

/** An account the dump read: its index, address, owner and data. */
interface Dumped {
  index: number;
  address: Address;
  owner: Address;
  base64Data: string;
}

type Configs = {
  venues: Record<string, { program: Address; configs: Dumped[] }>;
  whirlpools: Record<string, { program: Address; config: Address; feeTiers: Dumped[] }>;
};
const read = (file: string): Configs =>
  JSON.parse(readFileSync(new URL(`../fixtures/svm-pool-keys/${file}`, import.meta.url), "utf8"));

/** Each AmmConfig each cluster's Raydium-code programs kept and each fee tier of its whirlpools'
 *  configs, as the cluster held them. Testnet has no venue, so nothing to dump. */
const CLUSTER_CONFIGS: Readonly<Record<Exclude<SvmTokenCluster, "testnet">, Configs>> = {
  "mainnet-beta": read("amm-configs.json"),
  devnet: read("amm-configs.devnet.json"),
};
const CONFIGS = CLUSTER_CONFIGS["mainnet-beta"];
const M = "mainnet-beta";

/** Each fixture venue that finds pools by key: its namespace, and where a pool keeps its pair. */
const VENUES: Readonly<Record<string, { namespace: string; mints: [number, number] }>> = {
  "raydium-clmm": { namespace: "Raydium.CLMM", mints: [73, 105] },
  "pancakeswap-clmm": { namespace: "Pancakeswap.CLMM", mints: [73, 105] },
  byreal: { namespace: "Byreal.CLMM", mints: [73, 105] },
  "stabble-clmm": { namespace: "Stabble.CLMM", mints: [73, 105] },
  "orca-whirlpool": { namespace: "Orca.Whirlpool", mints: [101, 181] },
  cropper: { namespace: "Cropper.Whirlpool", mints: [101, 181] },
  defituna: { namespace: "Defituna.Fusion", mints: [11, 43] },
  crema: { namespace: "Crema.CLMM", mints: [40, 72] },
};

/** A pool's key, read from its own bytes: a whirlpool's tick spacing and fee tier index, DefiTuna's
 *  and Crema's tick spacing, a Raydium-code pool's config's fee and spacing. */
function keyOf(venue: string, data: Uint8Array): { key: bigint; refinement?: bigint } {
  if (VENUES[venue]!.mints[0] === 73) {
    const namespace = VENUES[venue]!.namespace;
    const config = CONFIGS.venues[namespace]!.configs.find(
      (one) => one.address === keyAt(data, 9),
    )!;
    const bytes = new Uint8Array(Buffer.from(config.base64Data, "base64"));
    return { key: BigInt(u32(bytes, 47)), refinement: BigInt(u16(bytes, 51)) };
  }
  if (VENUES[venue]!.mints[0] === 101)
    return { key: BigInt(u16(data, 41)), refinement: BigInt(u16(data, 43)) };
  const at = { defituna: 139, crema: 168 }[venue]!;
  return { key: BigInt(u16(data, at)) };
}

/** The fixture's accounts, as an owner-aware loader reads them, with `more` beside them. */
const loader =
  (more: Readonly<Record<string, Address>> = {}): OwnedAccountLoader =>
  async (at) => {
    if (more[at] !== undefined) return { data: new Uint8Array(1544), owner: more[at] };
    const data = BYTES.get(at);
    return data === undefined ? null : { data, owner: SNAPSHOT.get(at)!.owner };
  };

describe("a venue's pool by key", () => {
  // Every fixture pool of these venues but byreal-sol-usdc, whose config was never dumped.
  const keyed = manifest.pools.filter(
    (p) => VENUES[p.venue] !== undefined && (p.venue !== "byreal" || p.config !== SYSTEM),
  );

  it.each(keyed.map((p) => [p.name, p] as const))(
    "%s is a pool its venue derives for its pair at its key",
    (_name, p) => {
      const venue = VENUES[p.venue]!;
      const data = BYTES.get(p.pool)!;
      const [a, b] = venue.mints.map((at) => keyAt(data, at)) as [Address, Address];
      const { key, refinement } = keyOf(p.venue, data);
      expect(svmPoolKeyProblem(M, venue.namespace, key)).toBeUndefined();
      // The pair either way round, the key alone or with its config's spacing or its fee tier; a
      // whirlpool on an adaptive tier only with its tier.
      const tierOnly = venue.mints[0] === 101 && refinement !== key;
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        const alone = svmPoolCandidates(M, venue.namespace, x, y, key).map((one) => one.pool);
        if (tierOnly) expect(alone).not.toContain(p.pool);
        else expect(alone).toContain(p.pool);
        if (refinement !== undefined)
          expect(
            svmPoolCandidates(M, venue.namespace, x, y, key, refinement).map((one) => one.pool),
          ).toContain(p.pool);
      }
    },
  );

  it.each(Object.keys(CLUSTER_CONFIGS) as (keyof typeof CLUSTER_CONFIGS)[])(
    "knows every config the Raydium-code programs keep on %s, each its account's fee and spacing",
    (cluster) => {
      const dumped = CLUSTER_CONFIGS[cluster].venues;
      // The fixture holds each Raydium-code venue the cluster's table has, and no other.
      expect(Object.keys(dumped).sort()).toEqual(
        ["Raydium.CLMM", "Pancakeswap.CLMM", "Byreal.CLMM", "Stabble.CLMM"]
          .filter((namespace) => svmKeyedVenue(namespace, cluster) !== undefined)
          .sort(),
      );
      for (const [namespace, { program, configs }] of Object.entries(dumped)) {
        const venue = svmKeyedVenue(namespace, cluster)!;
        expect(venue.program).toBe(program);
        expect(venue.configs!.map((one) => one.index)).toEqual(configs.map((one) => one.index));
        for (const config of configs) {
          const bytes = new Uint8Array(Buffer.from(config.base64Data, "base64"));
          const row = venue.configs!.find((one) => one.index === config.index)!;
          expect(config.owner).toBe(program);
          expect(svmAmmConfig(program, config.index)).toBe(config.address);
          expect(view(bytes).getUint16(9, true)).toBe(config.index);
          expect([u32(bytes, 47), u16(bytes, 51)]).toEqual([row.fee, row.tickSpacing]);
        }
      }
    },
  );
  it.each(Object.keys(CLUSTER_CONFIGS) as (keyof typeof CLUSTER_CONFIGS)[])(
    "knows every fee tier the whirlpools' configs keep on %s, each its account's index and spacing",
    (cluster) => {
      const dumped = CLUSTER_CONFIGS[cluster].whirlpools;
      expect(Object.keys(dumped).sort()).toEqual(
        ["Orca.Whirlpool", "Cropper.Whirlpool"]
          .filter((namespace) => svmKeyedVenue(namespace, cluster) !== undefined)
          .sort(),
      );
      for (const [namespace, { program, config, feeTiers }] of Object.entries(dumped)) {
        const venue = svmKeyedVenue(namespace, cluster)!;
        expect(venue.program).toBe(program);
        expect(venue.feeTiers!.map((one) => one.index)).toEqual(feeTiers.map((one) => one.index));
        for (const tier of feeTiers) {
          const bytes = new Uint8Array(Buffer.from(tier.base64Data, "base64"));
          const row = venue.feeTiers!.find((one) => one.index === tier.index)!;
          expect(tier.owner).toBe(program);
          expect(keyAt(bytes, 8)).toBe(config);
          expect(
            memoizedFindProgramAddressSync(program, [
              new TextEncoder().encode("fee_tier"),
              getAddressEncoder().encode(config) as Uint8Array,
              Uint8Array.of(tier.index & 0xff, tier.index >> 8),
            ])[0],
          ).toBe(tier.address);
          // A static tier (44 bytes): its tick spacing at 40, which is its index. An adaptive tier:
          // its index at 40, its tick spacing at 42.
          if (bytes.length === 44) {
            expect([tier.index, u16(bytes, 40)]).toEqual([row.tickSpacing, row.tickSpacing]);
          } else {
            expect([u16(bytes, 40), u16(bytes, 42)]).toEqual([row.index, row.tickSpacing]);
            expect(row.index).not.toBe(row.tickSpacing);
          }
        }
      }
    },
  );

  it("resolves a slot by key: the pool's nine where it is there, an empty slot where it is not", async () => {
    const ctx = {
      chain: requireChain("solana"),
      owner: SYSTEM,
      pot: SYSTEM,
      load: loader(),
      found: new Map<string, Address | null>(),
    };
    const orca = pool("orca-whirlpool-sol-usdc");
    const at = async (name: string) => (await resolveSvmAccountName(name, ctx)).value;
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4):USDC.pool")).toBe(orca.pool);
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4):USDC.vaultB")).toBe(orca.vaultB);
    expect(await at("slot:Orca.Whirlpool(WSOL,USDC,4):USDC.ticks0")).toBe(orca.payB[0]);
    // Spacing 1 has no pool in the fixture: all nine are the System program, which the swap skips.
    const empty = await resolveSvmAccountName("slot:Orca.Whirlpool(USDC,WSOL,1):USDC.pool", ctx);
    expect(empty.value).toBe(SYSTEM);
    expect(empty.label).toBe("an empty slot: no pool at Orca.Whirlpool(USDC,WSOL,1) (pool)");
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,1):USDC.program")).toBe(SYSTEM);
    // Raydium's 0.04%, its one config at that fee.
    expect(await at("slot:Raydium.CLMM(USDC,WSOL,400):USDC.pool")).toBe(
      pool("raydium-clmm-sol-usdc").pool,
    );
    expect(ctx.found).toEqual(
      new Map([
        ["Orca.Whirlpool(USDC,WSOL,4)", orca.pool],
        ["Orca.Whirlpool(WSOL,USDC,4)", orca.pool],
        ["Orca.Whirlpool(USDC,WSOL,1)", null],
        ["Raydium.CLMM(USDC,WSOL,400)", pool("raydium-clmm-sol-usdc").pool],
      ]),
    );
  });

  it("takes the one pool a fee finds under two configs, and refuses two, naming each spacing", async () => {
    // Raydium's 0.01%: two configs, spacing 10 (index 0) and 1 (index 4).
    const [wide, narrow] = svmPoolCandidates(M, "Raydium.CLMM", USDC, WSOL, 100n);
    expect([wide!.config!.tickSpacing, narrow!.config!.tickSpacing]).toEqual([10, 1]);
    const program = svmKeyedVenue("Raydium.CLMM", M)!.program;
    const resolve = (name: string, more: Record<string, Address>) =>
      resolveSvmAccountName(name, {
        chain: requireChain("solana"),
        owner: SYSTEM,
        pot: SYSTEM,
        load: loader(more),
      });
    // Neither there: an empty slot. Only the spacing-1 one: that pool, which the fee names alone (an
    // empty account here, so its slot cannot be read: the pool chosen is the one the error names).
    expect((await resolve("slot:Raydium.CLMM(USDC,WSOL,100):USDC.pool", {})).value).toBe(SYSTEM);
    await expect(
      resolve("slot:Raydium.CLMM(USDC,WSOL,100):USDC.pool", { [narrow!.pool]: program }),
    ).rejects.toThrow(`pool ${narrow!.pool}'s slot paying USDC could not be read`);
    // Both there: refused, naming each; given the spacing, the one.
    await expect(
      resolve("slot:Raydium.CLMM(USDC,WSOL,100):USDC.pool", {
        [wide!.pool]: program,
        [narrow!.pool]: program,
      }),
    ).rejects.toThrow(
      `Raydium.CLMM.pool(USDC, WSOL, 100) finds 2 pools, one under each config charging that fee: ` +
        `${wide!.pool} at tick spacing 10, ${narrow!.pool} at tick spacing 1. Name the tick ` +
        "spacing after the fee: Raydium.CLMM.pool(USDC, WSOL, 100, 10)",
    );
    await expect(
      resolve("slot:Raydium.CLMM(USDC,WSOL,100,1):USDC.pool", {
        [wide!.pool]: program,
        [narrow!.pool]: program,
      }),
    ).rejects.toThrow(`pool ${narrow!.pool}'s slot paying USDC could not be read`);
    // A pool's account the venue does not own is no pool: lamports sent to its address.
    expect(
      (
        await resolve("slot:Raydium.CLMM(USDC,WSOL,100):USDC.pool", {
          [wide!.pool]: SYSTEM,
          [narrow!.pool]: SYSTEM,
        })
      ).value,
    ).toBe(SYSTEM);
  });

  it("names SOL/USDC's pool on Orca's static tier by its tick spacing, and its pool on the adaptive tier there by that tier", async () => {
    // Mainnet's SOL/USDC has a pool on both of Orca's tiers at tick spacing 4: 4 and 1028.
    const fixed = pool("orca-whirlpool-sol-usdc");
    const adaptive = pool("orca-whirlpool-sol-usdc-adaptive");
    const tierOf = (p: typeof fixed) => {
      const data = BYTES.get(p.pool)!;
      return [u16(data, 41), u16(data, 43)];
    };
    expect([tierOf(fixed), tierOf(adaptive)]).toEqual([
      [4, 4],
      [4, 1028],
    ]);
    const ctx = { chain: requireChain("solana"), owner: SYSTEM, pot: SYSTEM, load: loader() };
    const at = async (name: string) => (await resolveSvmAccountName(name, ctx)).value;
    // Both there, and nothing refused: the spacing alone is the static tier's, the tier its own.
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4):USDC.pool")).toBe(fixed.pool);
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4,4):USDC.pool")).toBe(fixed.pool);
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4,1028):USDC.pool")).toBe(adaptive.pool);
    expect(await at("slot:Orca.Whirlpool(WSOL,USDC,4,1028):USDC.vaultB")).toBe(adaptive.vaultB);
    expect(await at("slot:Orca.Whirlpool(USDC,WSOL,4,1028):USDC.ticks0")).toBe(adaptive.payB[0]);
  });

  it("names a whirlpool's static tier by its tick spacing, and an adaptive tier by its index after it", async () => {
    const adaptive = pool("orca-whirlpool-adaptive");
    const data = BYTES.get(adaptive.pool)!;
    const [a, b] = [keyAt(data, 101), keyAt(data, 181)];
    // Tick spacing 256 on fee tier 1033: Orca's adaptive tier at that spacing, beside the static 256.
    expect([u16(data, 41), u16(data, 43)]).toEqual([256, 1033]);
    const [fixed] = svmPoolCandidates(M, "Orca.Whirlpool", a, b, 256n);
    expect(svmPoolCandidates(M, "Orca.Whirlpool", a, b, 256n)).toEqual([
      { pool: fixed!.pool, feeTier: { index: 256, tickSpacing: 256 } },
    ]);
    expect(svmPoolCandidates(M, "Orca.Whirlpool", a, b, 256n, 1033n)).toEqual([
      { pool: adaptive.pool, feeTier: { index: 1033, tickSpacing: 256 } },
    ]);
    const program = svmKeyedVenue("Orca.Whirlpool", M)!.program;
    const resolve = (name: string, more: Record<string, Address> = {}) =>
      resolveSvmAccountName(name, {
        chain: requireChain("solana"),
        owner: SYSTEM,
        pot: SYSTEM,
        load: loader(more),
      });
    // The spacing alone is the static tier's pool, none here: an empty slot, though the adaptive
    // one is there. Named by its tier, the adaptive pool, whose slot reads.
    expect((await resolve(`slot:Orca.Whirlpool(${a},${b},256):${a}.pool`)).value).toBe(SYSTEM);
    const named = `slot:Orca.Whirlpool(${a},${b},256,1033):${a}`;
    expect((await resolve(`${named}.pool`)).value).toBe(adaptive.pool);
    expect((await resolve(`${named}.vaultA`)).value).toBe(adaptive.vaultA);
    // Both there: each name takes its own, and nothing is refused.
    await expect(
      resolve(`slot:Orca.Whirlpool(${a},${b},256):${a}.pool`, { [fixed!.pool]: program }),
    ).rejects.toThrow(`pool ${fixed!.pool}'s slot paying mint ${a} could not be read`);
    expect((await resolve(`${named}.pool`, { [fixed!.pool]: program })).value).toBe(adaptive.pool);
  });

  it("derives a config from its index big-endian: 256 is [1, 0]", () => {
    const program = svmKeyedVenue("Raydium.CLMM", M)!.program;
    expect(svmAmmConfig(program, 256)).toBe(
      memoizedFindProgramAddressSync(program, [
        new TextEncoder().encode("amm_config"),
        Uint8Array.of(1, 0),
      ])[0],
    );
    expect(svmAmmConfig(program, 256)).not.toBe(svmAmmConfig(program, 1));
  });

  it("refuses a key the venue has no pool at, and a pair of one mint", async () => {
    expect(svmPoolKeyProblem(M, "Raydium.CLMM", 123n)).toMatch(
      /^Raydium\.CLMM's key is a pool's fee, in millionths \(400 is 0\.04%\), and it has no config at 123: its fees are 100, 200, 300, 400, 500, /,
    );
    expect(svmPoolKeyProblem(M, "Raydium.CLMM", 100n, 60n)).toBe(
      "Raydium.CLMM's configs at fee 100 have tick spacing 10 and 1, not 60",
    );
    expect(svmPoolKeyProblem(M, "Orca.Whirlpool", 64n, 7n)).toBe(
      "Orca.Whirlpool's fee tiers at tick spacing 64 are 64, 1025 and 2051, not 7",
    );
    expect(svmPoolKeyProblem(M, "Orca.Whirlpool", 3n)).toMatch(
      /^Orca\.Whirlpool's key is a pool's tick spacing, and it has no fee tier at 3: its tick spacings are 1, 2, 4, 8, /,
    );
    expect(svmPoolKeyProblem(M, "Defituna.Fusion", 4n, 4n)).toBe(
      "Defituna.Fusion's pool is found by its tick spacing alone: pool(tokenA, tokenB, tickSpacing)",
    );
    expect(svmPoolKeyProblem(M, "Defituna.Fusion", 65536n)).toBe(
      "Defituna.Fusion's key is a tick spacing, from 1 to 65535, and 65536 is not one",
    );
    expect(svmPoolKeyProblem(M, "Phoenix.Market", 1n)).toBe("Phoenix.Market finds no pool by key");
    const ctx = { chain: requireChain("solana"), owner: SYSTEM, pot: SYSTEM, load: loader() };
    await expect(
      resolveSvmAccountName("slot:Orca.Whirlpool(USDC,USDC,4):USDC.pool", ctx),
    ).rejects.toThrow("Orca.Whirlpool(USDC,USDC,4) names one mint twice");
  });
});

describe("a venue's pool by key on devnet", () => {
  const D = "devnet";
  const DEVNET_USDC = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const NATIVE = address("So11111111111111111111111111111111111111112");
  const derived = (namespace: string, a: string, b: string, key: bigint, refinement?: bigint) =>
    svmPoolCandidates(D, namespace, address(a), address(b), key, refinement).map((one) => one.pool);

  // Each pool devnet's programs keep, read on devnet and named by the key its own bytes record,
  // derived under the devnet row: the venue's devnet program, config and tables.
  it.each([
    // Orca's devnet WhirlpoolsConfig: spacing 1 and 64, static.
    [
      "Orca.Whirlpool",
      NATIVE,
      DEVNET_USDC,
      1n,
      undefined,
      "6XqJUqX4zUL7KEm9wGqTvJmE7DdC8e6MYeMBF9uYLckX",
    ],
    [
      "Orca.Whirlpool",
      NATIVE,
      DEVNET_USDC,
      64n,
      undefined,
      "EQ5KAPVdHvSP5aBqYos4vtEsZApx43iM9AnibexL4WYA",
    ],
    // Its adaptive tier 1025 at spacing 64.
    [
      "Orca.Whirlpool",
      NATIVE,
      DEVNET_USDC,
      64n,
      1025n,
      "FaNMSW3wtWME1fWoGTVpkoxcdyX5ajfBXKE2488zUA8a",
    ],
    // Raydium's devnet program, its AmmConfig 1 (0.01%, spacing 1) and 0 (0.25%, spacing 60).
    [
      "Raydium.CLMM",
      NATIVE,
      DEVNET_USDC,
      100n,
      undefined,
      "9sEu85vhNJ7pL6VJVT4JMBH6FYMe9osoSm5M14fn7pqK",
    ],
    [
      "Raydium.CLMM",
      NATIVE,
      DEVNET_USDC,
      2500n,
      undefined,
      "BG35KaBMqezC3xb5E1PZMyiSAHronageFFAqVmWRy5dT",
    ],
    // Stabble's devnet AmmConfig 0, a fee of 0 that mainnet's table has not.
    [
      "Stabble.CLMM",
      "AYsxSRXcVi5hSbsBnaq7gp23auUjcFLMcU7YNVdW5aVA",
      "HemBBhWhvrjDg6AD91Yd1TF3HTrDAryfqkRrGW6DXRR5",
      0n,
      undefined,
      "ETBvSjbKgNaDnW9WRnqxtPm3FiafHyi6BL6TgxPUov33",
    ],
    // Crema's devnet config, an account of its own at mainnet's address.
    [
      "Crema.CLMM",
      "46mchoPXcKxmVTjHp3YoxZnnkhGRpEdjA4UgZGvYc66w",
      "9GfDNMkDt71U5GK4U8mb5vcchJLaqJK3GFXvQP5889i9",
      2n,
      undefined,
      "G4Ve6SokhRUoWtdNsuKFFcjmmvEbESEFDTVD67KgqWa1",
    ],
    [
      "Crema.CLMM",
      NATIVE,
      "GKZ9nzWPfL6k3JQGiPtmoocugZQaPbbPBmfQLrW72uk7",
      100n,
      undefined,
      "DQdz7vPZg2jdkgecvDnMsTFLB7zniF1qTUNnEpG9B6mc",
    ],
    [
      "Defituna.Fusion",
      NATIVE,
      "6b2MVXz73RJB4hZq4NBPbW5KRKC13gaqiZLexED2eKs6",
      64n,
      undefined,
      "8FZfHh7tUMhPsGjSXo3iX2iB2MKB9dXyhovUpNq8Fk74",
    ],
  ] as const)("%s(%s, %s, %s, %s) is devnet's %s", (namespace, a, b, key, refinement, expected) => {
    expect(svmPoolKeyProblem(D, namespace, key, refinement)).toBeUndefined();
    expect(derived(namespace, a, b, key, refinement)).toContain(expected);
    expect(derived(namespace, b, a, key, refinement)).toContain(expected);
  });

  it("derives Orca's devnet pool under devnet's WhirlpoolsConfig, not mainnet's", () => {
    expect(svmKeyedVenue("Orca.Whirlpool", D)!.program).toBe(
      svmKeyedVenue("Orca.Whirlpool", M)!.program,
    );
    const devnet = derived("Orca.Whirlpool", NATIVE, DEVNET_USDC, 64n);
    const mainnet = svmPoolCandidates(M, "Orca.Whirlpool", NATIVE, DEVNET_USDC, 64n).map(
      (one) => one.pool,
    );
    expect(devnet).toEqual(["EQ5KAPVdHvSP5aBqYos4vtEsZApx43iM9AnibexL4WYA"]);
    expect(mainnet).not.toEqual(devnet);
  });

  it("derives Raydium's devnet AmmConfigs under its devnet program", () => {
    const program = SVM_VENUE_TABLE["raydium-clmm"].devnet!.program;
    expect(program).toBe("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    expect([0, 1, 2].map((index) => svmAmmConfig(program, index))).toEqual([
      "CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu",
      "F8aaMZVpXaQHk3Qo9BPDhsa7RgpfrfiRsk8L3iXnq3AT",
      "FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q",
    ]);
  });

  it("refuses a key devnet's tables lack, and a venue devnet lacks, naming the cluster", () => {
    // Mainnet's 0.05% Raydium config at spacing 1 (5) and Orca's spacing 96 are not on devnet;
    // devnet's Orca spacing 32 and Stabble fee 0 are not on mainnet.
    expect(svmPoolKeyProblem(M, "Raydium.CLMM", 500n, 1n)).toBeUndefined();
    expect(svmPoolKeyProblem(D, "Raydium.CLMM", 500n, 1n)).toBe(
      "Raydium.CLMM's configs at fee 500 have tick spacing 10, not 1",
    );
    expect(svmPoolKeyProblem(M, "Orca.Whirlpool", 96n)).toBeUndefined();
    expect(svmPoolKeyProblem(D, "Orca.Whirlpool", 96n)).toMatch(/has no fee tier at 96/);
    expect(svmPoolKeyProblem(D, "Orca.Whirlpool", 32n)).toBeUndefined();
    expect(svmPoolKeyProblem(M, "Orca.Whirlpool", 32n)).toMatch(/has no fee tier at 32/);
    expect(svmPoolKeyProblem(D, "Stabble.CLMM", 0n)).toBeUndefined();
    expect(svmPoolKeyProblem(M, "Stabble.CLMM", 0n)).toMatch(/has no config at 0/);
    for (const namespace of ["Byreal.CLMM", "Cropper.Whirlpool"]) {
      expect(svmPoolKeyProblem(D, namespace, 100n)).toBe(
        `${namespace} has no program on Solana's devnet`,
      );
    }
    expect(svmPoolKeyProblem(D, "Pancakeswap.CLMM", 100n)).toBe(
      "Pancakeswap.CLMM is not supported on Solana's devnet: its devnet pools lack the tick arrays " +
        "a swap at a price needs",
    );
  });
});
