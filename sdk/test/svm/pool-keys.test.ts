/**
 * A venue's pool by key (`svm/pool-keys.ts`), held to the pools mainnet held (`venue-fixture.ts`):
 * each fixture pool of a venue that finds pools by key is the address that venue derives for its pair
 * and the key its own bytes record, and each fee the SDK knows a Raydium-code config of is that
 * config's, as its account records it. Then resolved as a cook resolves a slot, by key: the pool's
 * nine accounts where it is there, and an empty slot where it is not.
 */
import { getAddressDecoder, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import { resolveSvmAccountName } from "../../src/svm/account-names.js";
import {
  svmAmmConfig,
  svmPoolByKey,
  svmPoolKeyProblem,
  SVM_KEYED_VENUES,
} from "../../src/svm/pool-keys.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import { BYTES, manifest, pool, SNAPSHOT, SYSTEM } from "./venue-fixture.js";

const keyAt = (data: Uint8Array, offset: number): Address =>
  getAddressDecoder().decode(data.subarray(offset, offset + 32));
const u16 = (data: Uint8Array, offset: number): number =>
  new DataView(data.buffer, data.byteOffset).getUint16(offset, true);
const u32 = (data: Uint8Array, offset: number): number =>
  new DataView(data.buffer, data.byteOffset).getUint32(offset, true);

/** Each fixture venue that finds pools by key: its namespace, and where a pool keeps its pair and key. */
const VENUES: Readonly<
  Record<string, { namespace: string; mints: [number, number]; key: (data: Uint8Array) => number }>
> = {
  "raydium-clmm": { namespace: "Raydium.CLMM", mints: [73, 105], key: (d) => feeOf(d) },
  "pancakeswap-clmm": { namespace: "Pancakeswap.CLMM", mints: [73, 105], key: (d) => feeOf(d) },
  byreal: { namespace: "Byreal.CLMM", mints: [73, 105], key: (d) => feeOf(d) },
  "stabble-clmm": { namespace: "Stabble.CLMM", mints: [73, 105], key: (d) => feeOf(d) },
  // A whirlpool's key is its fee tier's index (at 43): its tick spacing (at 41) for a fixed fee.
  "orca-whirlpool": { namespace: "Orca.Whirlpool", mints: [101, 181], key: (d) => u16(d, 43) },
  cropper: { namespace: "Cropper.Whirlpool", mints: [101, 181], key: (d) => u16(d, 43) },
  defituna: { namespace: "Defituna.Fusion", mints: [11, 43], key: (d) => u16(d, 139) },
  crema: { namespace: "Crema.CLMM", mints: [40, 72], key: (d) => u16(d, 168) },
};
/** A Raydium-code pool's fee: its AmmConfig's trade fee rate. */
const feeOf = (pool: Uint8Array): number => u32(BYTES.get(keyAt(pool, 9))!, 47);

/** The fixture's accounts, as an owner-aware loader reads them. */
const load: OwnedAccountLoader = async (at) => {
  const data = BYTES.get(at);
  return data === undefined ? null : { data, owner: SNAPSHOT.get(at)!.owner };
};

describe("a venue's pool by key", () => {
  // Every fixture pool of these venues whose key the fixture holds: byreal-sol-usdc's config was
  // never dumped (its fees are more than one rate).
  const keyed = manifest.pools.filter(
    (p) => VENUES[p.venue] !== undefined && (p.venue !== "byreal" || p.config !== SYSTEM),
  );

  it.each(keyed.map((p) => [p.name, p] as const))(
    "%s is its venue's pool for its pair at its key",
    (_name, p) => {
      const venue = VENUES[p.venue]!;
      const data = BYTES.get(p.pool)!;
      const [a, b] = venue.mints.map((at) => keyAt(data, at)) as [Address, Address];
      const key = BigInt(venue.key(data));
      expect(svmPoolKeyProblem(venue.namespace, key)).toBeUndefined();
      // The pair either way round: the venue derives it lower key first.
      expect(svmPoolByKey(venue.namespace, a, b, key)).toBe(p.pool);
      expect(svmPoolByKey(venue.namespace, b, a, key)).toBe(p.pool);
    },
  );

  it("knows each Raydium-code fee by its config, as the config's account records it", () => {
    for (const venue of Object.values(SVM_KEYED_VENUES)) {
      for (const [fee, index] of venue.configs ?? []) {
        const config = BYTES.get(svmAmmConfig(venue.program, index));
        expect(config).toBeDefined();
        expect(SNAPSHOT.get(svmAmmConfig(venue.program, index))!.owner).toBe(venue.program);
        expect(new DataView(config!.buffer, config!.byteOffset).getUint16(9, true)).toBe(index);
        expect(u32(config!, 47)).toBe(fee);
      }
    }
  });

  it("resolves a slot by key: the pool's nine where it is there, an empty slot where it is not", async () => {
    const ctx = {
      chain: requireChain("solana"),
      owner: SYSTEM,
      pot: SYSTEM,
      load,
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
    expect(ctx.found).toEqual(
      new Map([
        ["Orca.Whirlpool(USDC,WSOL,4)", orca.pool],
        ["Orca.Whirlpool(WSOL,USDC,4)", orca.pool],
        ["Orca.Whirlpool(USDC,WSOL,1)", null],
      ]),
    );
  });

  it("refuses a key the venue has no pool at, and a pair of one mint", async () => {
    expect(svmPoolKeyProblem("Raydium.CLMM", 123n)).toBe(
      "Raydium.CLMM's key is a pool's fee, in millionths (400 is 0.04%), and it has no config at " +
        "123: its fees are 400",
    );
    expect(svmPoolKeyProblem("Orca.Whirlpool", 65536n)).toBe(
      "Orca.Whirlpool's key is a tick spacing, from 1 to 65535, and 65536 is not one",
    );
    expect(svmPoolKeyProblem("Phoenix.Market", 1n)).toBe("Phoenix.Market finds no pool by key");
    const ctx = { chain: requireChain("solana"), owner: SYSTEM, pot: SYSTEM, load };
    await expect(
      resolveSvmAccountName("slot:Orca.Whirlpool(USDC,USDC,4):USDC.pool", ctx),
    ).rejects.toThrow("Orca.Whirlpool(USDC,USDC,4) names one mint twice");
  });
});
