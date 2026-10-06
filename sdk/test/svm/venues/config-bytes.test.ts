import * as kit from "@solana/kit";
import type { Address } from "@solana/kit";
import { resolve } from "node:path";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
let encodes = 0;
const countEncoder = <T extends { encode: (...args: never[]) => unknown }>(codec: T): T => ({
  ...codec,
  encode: (...args: never[]) => {
    encodes += 1;
    return codec.encode(...args);
  },
});
jest.unstable_mockModule("@solana/kit", () => ({
  ...kit,
  getAddressEncoder: () => countEncoder(kit.getAddressEncoder()),
  getAddressCodec: () => countEncoder(kit.getAddressCodec()),
}));
const pump = await import("../../../src/svm/venues/pumpswap/index.js");
const dlmm = await import("../../../src/svm/venues/meteora-dlmm/index.js");
const { __resetPdaMemoForTest } = await import("../../../src/svm/venues/pda-memo.js");
const poolBytes = (pool: Address) => new Uint8Array(kit.getAddressEncoder().encode(pool));
const pumpLoad = fixtureLoader(loadFixtures(resolve(process.cwd(), "test/svm/fixtures/pumpswap")));
const dlmmLoad = fixtureLoader(
  loadFixtures(resolve(process.cwd(), "test/svm/fixtures/meteora-dlmm")),
);
const pair = kit.address("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");

beforeEach(() => {
  __resetPdaMemoForTest();
  encodes = 0;
});

for (const pool of [
  kit.address("2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd"),
  kit.address("GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J"),
])
  for (const primed of [false, true])
    test(`Pumpswap bytes input preserves all config fields and avoids re-encoding account keys: ${pool}, primed=${primed}`, async () => {
      const expected = await pump.pumpswapAdapter.fetchPoolConfig(pumpLoad, pool);
      const bytes = poolBytes(pool);
      if (!primed) __resetPdaMemoForTest();
      encodes = 0;
      const actual = await pump.fetchPumpswapConfigBytes(pumpLoad, bytes);
      expect(actual).toEqual(expected);
      // Only the derived creator-vault authority crosses back into bytes for its ATA.
      expect(encodes).toBe(1);
    });

test("DLMM bytes input preserves both windows without re-encoding the pair for seven PDA seeds", async () => {
  const expected = await dlmm.fetchMeteoraDlmmConfig(dlmmLoad, pair);
  const bytes = poolBytes(pair);
  encodes = 0;
  expect(await dlmm.fetchMeteoraDlmmConfigBytes(dlmmLoad, bytes)).toEqual(expected);
  expect(encodes).toBe(0);
});

for (const length of [0, 31, 33])
  test(`bytes fetchers refuse ${length}-byte keys before loading`, async () => {
    let reads = 0;
    const load = async () => {
      reads += 1;
      return null;
    };
    await expect(pump.fetchPumpswapConfigBytes(load, new Uint8Array(length))).rejects.toThrow();
    await expect(dlmm.fetchMeteoraDlmmConfigBytes(load, new Uint8Array(length))).rejects.toThrow();
    expect(reads).toBe(0);
  });

test("DLMM snapshots the caller's key before the asynchronous load", async () => {
  const bytes = poolBytes(pair);
  const expected = await dlmm.fetchMeteoraDlmmConfig(dlmmLoad, pair);
  const actual = dlmm.fetchMeteoraDlmmConfigBytes(async (address) => {
    bytes.fill(0);
    return dlmmLoad(address);
  }, bytes);
  expect(await actual).toEqual(expected);
});

test("legacy string fetchers also reuse raw PDA seeds", async () => {
  const pool = kit.address("GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J");
  await pump.pumpswapAdapter.fetchPoolConfig(pumpLoad, pool);
  encodes = 0;
  await pump.pumpswapAdapter.fetchPoolConfig(pumpLoad, pool);
  expect(encodes).toBe(1);
  await dlmm.fetchMeteoraDlmmConfig(dlmmLoad, pair);
  encodes = 0;
  await dlmm.fetchMeteoraDlmmConfig(dlmmLoad, pair);
  expect(encodes).toBe(1);
});

test("bytes entrypoints keep live pool gates after PDA memo priming", async () => {
  const pool = kit.address("GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J");
  await pump.fetchPumpswapConfigBytes(pumpLoad, poolBytes(pool));
  await expect(
    pump.fetchPumpswapConfigBytes(async (key) => {
      const data = await pumpLoad(key);
      if (key === pool && data) data[243] = 1;
      return data;
    }, poolBytes(pool)),
  ).rejects.toThrow("is_mayhem_mode");
  await dlmm.fetchMeteoraDlmmConfigBytes(dlmmLoad, poolBytes(pair));
  await expect(
    dlmm.fetchMeteoraDlmmConfigBytes(async (key) => {
      const data = await dlmmLoad(key);
      if (key === pair && data) data[dlmm.OFF_STATUS] = 1;
      return data;
    }, poolBytes(pair)),
  ).rejects.toThrow("not Enabled");
});

test("DLMM live active-id changes derive the new window despite a warm PDA memo", async () => {
  const bytes = poolBytes(pair);
  const original = await dlmm.fetchMeteoraDlmmConfigBytes(dlmmLoad, bytes);
  const movedLoad = async (key: Address) => {
    const data = await dlmmLoad(key);
    if (key === pair && data) {
      new DataView(data.buffer, data.byteOffset, data.byteLength).setInt32(
        dlmm.OFF_ACTIVE_ID,
        original.activeId + dlmm.BINS_PER_ARRAY,
        true,
      );
    }
    return data;
  };
  const moved = await dlmm.fetchMeteoraDlmmConfigBytes(movedLoad, bytes);
  expect(moved).toEqual(await dlmm.fetchMeteoraDlmmConfig(movedLoad, pair));
  expect(moved.windows.xToY.arrayIndexes).not.toEqual(original.windows.xToY.arrayIndexes);
  expect(moved.windows.xToY.binArrays).not.toEqual(original.windows.xToY.binArrays);
});

for (const length of [8, 88, 674])
  test(`Pumpswap bytes fetch refuses truncated global config (${length} bytes)`, async () => {
    const pool = kit.address("2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd");
    const load = async (key: Address) => {
      const data = await pumpLoad(key);
      return key === "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw" && data
        ? data.slice(0, length)
        : data;
    };
    await expect(pump.fetchPumpswapConfigBytes(load, poolBytes(pool))).rejects.toThrow();
  });

test("bytes fetchers are available from the public SVM barrel", async () => {
  const svm = await import("../../../src/svm/index.js");
  expect(svm.fetchPumpswapConfigBytes).toBe(pump.fetchPumpswapConfigBytes);
  expect(svm.fetchMeteoraDlmmConfigBytes).toBe(dlmm.fetchMeteoraDlmmConfigBytes);
});
