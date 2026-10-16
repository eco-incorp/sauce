/**
 * A venue's pool by key (`svm/pool-keys.ts`), held to mainnet: each fixture pool of a venue that
 * finds pools by key (`venue-fixture.ts`) is a pool that venue derives for its pair and the key its
 * own bytes record, and the Raydium-code table is every AmmConfig the four programs kept, as
 * `test/fixtures/svm-pool-keys/amm-configs.json` (`scripts/dump-amm-configs.mjs`) records each.
 * Then resolved as a cook resolves a slot, by key: the pool's nine accounts where it is there, an
 * empty slot where it is not, and a refusal where a fee finds a pool under two configs.
 */
import { readFileSync } from "node:fs";
import { getAddressDecoder, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import { resolveSvmAccountName } from "../../src/svm/account-names.js";
import {
  svmAmmConfig,
  svmPoolCandidates,
  svmPoolKeyProblem,
  SVM_KEYED_VENUES,
} from "../../src/svm/pool-keys.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import { BYTES, manifest, pool, SNAPSHOT, SYSTEM, USDC, WSOL } from "./venue-fixture.js";

const keyAt = (data: Uint8Array, offset: number): Address =>
  getAddressDecoder().decode(data.subarray(offset, offset + 32));
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset);
const u16 = (data: Uint8Array, offset: number): number => view(data).getUint16(offset, true);
const u32 = (data: Uint8Array, offset: number): number => view(data).getUint32(offset, true);

/** Each AmmConfig the four Raydium-code programs kept, as mainnet held it. */
const CONFIGS = JSON.parse(
  readFileSync(new URL("../fixtures/svm-pool-keys/amm-configs.json", import.meta.url), "utf8"),
) as {
  venues: Record<
    string,
    {
      program: Address;
      configs: { index: number; address: Address; owner: Address; base64Data: string }[];
    }
  >;
};

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

/** A pool's key, read from its own bytes: a whirlpool's fee tier index (its tick spacing for a
 *  fixed fee), DefiTuna's and Crema's tick spacing, a Raydium-code pool's config's fee and spacing. */
function keyOf(venue: string, data: Uint8Array): { key: bigint; spacing?: bigint } {
  if (VENUES[venue]!.mints[0] === 73) {
    const namespace = VENUES[venue]!.namespace;
    const config = CONFIGS.venues[namespace]!.configs.find(
      (one) => one.address === keyAt(data, 9),
    )!;
    const bytes = new Uint8Array(Buffer.from(config.base64Data, "base64"));
    return { key: BigInt(u32(bytes, 47)), spacing: BigInt(u16(bytes, 51)) };
  }
  const at = { "orca-whirlpool": 43, cropper: 43, defituna: 139, crema: 168 }[venue]!;
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
      const { key, spacing } = keyOf(p.venue, data);
      expect(svmPoolKeyProblem(venue.namespace, key)).toBeUndefined();
      // The pair either way round, the fee alone or with its config's spacing.
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        expect(svmPoolCandidates(venue.namespace, x, y, key).map((one) => one.pool)).toContain(
          p.pool,
        );
        if (spacing !== undefined)
          expect(
            svmPoolCandidates(venue.namespace, x, y, key, spacing).map((one) => one.pool),
          ).toContain(p.pool);
      }
    },
  );

  it("knows every config the Raydium-code programs keep, each its account's fee and spacing", () => {
    for (const [namespace, { program, configs }] of Object.entries(CONFIGS.venues)) {
      const venue = SVM_KEYED_VENUES[namespace]!;
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
  });

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
    const [wide, narrow] = svmPoolCandidates("Raydium.CLMM", USDC, WSOL, 100n);
    expect([wide!.config!.tickSpacing, narrow!.config!.tickSpacing]).toEqual([10, 1]);
    const program = SVM_KEYED_VENUES["Raydium.CLMM"]!.program;
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

  it("refuses a key the venue has no pool at, and a pair of one mint", async () => {
    expect(svmPoolKeyProblem("Raydium.CLMM", 123n)).toMatch(
      /^Raydium\.CLMM's key is a pool's fee, in millionths \(400 is 0\.04%\), and it has no config at 123: its fees are 100, 200, 300, 400, 500, /,
    );
    expect(svmPoolKeyProblem("Raydium.CLMM", 100n, 60n)).toBe(
      "Raydium.CLMM's configs at fee 100 have tick spacing 10 and 1, not 60",
    );
    expect(svmPoolKeyProblem("Orca.Whirlpool", 4n, 4n)).toBe(
      "Orca.Whirlpool's pool is found by its tick spacing alone: pool(tokenA, tokenB, tickSpacing)",
    );
    expect(svmPoolKeyProblem("Orca.Whirlpool", 65536n)).toBe(
      "Orca.Whirlpool's key is a tick spacing, from 1 to 65535, and 65536 is not one",
    );
    expect(svmPoolKeyProblem("Phoenix.Market", 1n)).toBe("Phoenix.Market finds no pool by key");
    const ctx = { chain: requireChain("solana"), owner: SYSTEM, pot: SYSTEM, load: loader() };
    await expect(
      resolveSvmAccountName("slot:Orca.Whirlpool(USDC,USDC,4):USDC.pool", ctx),
    ).rejects.toThrow("Orca.Whirlpool(USDC,USDC,4) names one mint twice");
  });
});
