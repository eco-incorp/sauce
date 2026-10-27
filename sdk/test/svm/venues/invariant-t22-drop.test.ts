/**
 * invariant adapter: Token-2022 self-drop and the boundary-window tick scan.
 *
 * Token-2022: a pool whose tokenX mint is a Token-2022 mint must drop
 * (fetchPoolConfig throws) rather than silently assuming legacy SPL. The legacy
 * path stays byte-identical (an 82-byte classic mint does not drop).
 *
 * Tick scan: each direction's window is the initialized ticks a swap crosses, in
 * the order the program walks them, so an adjacent initialized tick is never
 * skipped (the program fails a swap whose crossed Tick account is missing).
 */
import { address, getAddressCodec, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  fetchInvariantPoolConfig,
  INVARIANT_PROGRAM_ID,
  POOL_ACCOUNT_SIZE,
  POOL_DISCRIMINATOR,
  TICK_ACCOUNT_SIZE,
  TICK_DISCRIMINATOR,
  TICKMAP_ACCOUNT_SIZE,
} from "../../../src/svm/venues/invariant/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const codec = getAddressCodec();
const OFF_TOKEN_X = 8;
const OFF_TOKEN_Y = 40;

const POOL = address("So11111111111111111111111111111111111111112");

/** Distinct valid addresses derived from a fill byte. */
function addrFromByte(b: number): Address {
  return codec.decode(new Uint8Array(32).fill(b));
}

function buildPool(tokenX: Address, tokenY: Address): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(POOL_DISCRIMINATOR, 0);
  data.set(codec.encode(tokenX), OFF_TOKEN_X);
  data.set(codec.encode(tokenY), OFF_TOKEN_Y);
  // tickmap @222 and other fields stay zero — the drop fires before they're used.
  return data;
}

/** Each entry is [address, data] (owned as its shape implies) or [address, data, owner]. */
function loaderOf(
  entries: Array<[Address, Uint8Array] | [Address, Uint8Array, Address]>,
): OwnedAccountLoader {
  const map = new Map(entries.map(([a, d, o]) => [a as string, { d, o }]));
  return async (addr) => {
    const e = map.get(addr as string);
    if (e === undefined) return null;
    const owner =
      e.o ??
      (addr === POOL
        ? INVARIANT_PROGRAM_ID
        : e.d.length === 82
          ? TOKEN_PROGRAM_ID
          : TOKEN_2022_PROGRAM_ID);
    return { data: new Uint8Array(e.d), owner };
  };
}

describe("invariant Token-2022 self-drop", () => {
  const tokenX = addrFromByte(7);
  const tokenY = addrFromByte(9);

  it("drops a pool whose tokenX mint is a Token-2022 mint", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeT22Mint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose mint carries an un-routable extension (NonTransferable)", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeT22Mint(NON_TRANSFERABLE_TLV)],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022|un-routable/);
  });

  it("drops a pool whose 82-byte tokenX mint is owned by Token-2022 (extensionless Token-2022)", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeLegacyMint(), TOKEN_2022_PROGRAM_ID],
      [tokenY, makeLegacyMint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop for a classic 82-byte legacy mint (proceeds past the guard)", async () => {
    // Both mints legacy — the drop guard passes; the fetch proceeds and fails
    // later on the missing tickmap, proving the guard itself did not fire.
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeLegacyMint()],
      [tokenY, makeLegacyMint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.not.toThrow(
      /Token-2022|un-routable/,
    );
  });

  it("refuses a pool whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [tokenX, tokenY]) {
      const load = loaderOf([
        [POOL, buildPool(tokenX, tokenY)],
        [tokenX, makeLegacyMint(), mint === tokenX ? foreign : TOKEN_PROGRAM_ID],
        [tokenY, makeLegacyMint(), mint === tokenY ? foreign : TOKEN_PROGRAM_ID],
      ]);
      await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});

describe("invariant boundary window tick scan", () => {
  // Constants of structs/tickmap.rs: the bitmap's index of tick 0.
  const TICK_LIMIT = 44_364;
  const TICKMAP = addrFromByte(11);
  const OFF_TICK_SPACING = 152;
  const OFF_CURRENT_TICK = 218;
  const OFF_TICKMAP = 222;

  function poolAt(currentTick: number, tickSpacing: number): Uint8Array {
    const data = buildPool(addrFromByte(7), addrFromByte(9));
    const view = new DataView(data.buffer);
    view.setUint16(OFF_TICK_SPACING, tickSpacing, true);
    view.setInt32(OFF_CURRENT_TICK, currentTick, true);
    data.set(codec.encode(TICKMAP), OFF_TICKMAP);
    return data;
  }

  function tickmapWith(ticks: number[], tickSpacing: number): Uint8Array {
    const data = new Uint8Array(TICKMAP_ACCOUNT_SIZE);
    for (const tick of ticks) {
      const index = tick / tickSpacing + TICK_LIMIT;
      data[8 + Math.trunc(index / 8)]! |= 1 << (index % 8);
    }
    return data;
  }

  async function tickPda(tick: number): Promise<Address> {
    const index = new Uint8Array(4);
    new DataView(index.buffer).setInt32(0, tick, true);
    const [pda] = await getProgramDerivedAddress({
      programAddress: INVARIANT_PROGRAM_ID,
      seeds: ["tickv1", codec.encode(POOL), index],
    });
    return pda;
  }

  /** Windows of a pool at `currentTick` whose tickmap has `initialized`, each with its Tick account. */
  async function windowsOf(currentTick: number, tickSpacing: number, initialized: number[]) {
    const tick = new Uint8Array(TICK_ACCOUNT_SIZE);
    tick.set(TICK_DISCRIMINATOR, 0);
    const entries: Array<[Address, Uint8Array]> = [
      [POOL, poolAt(currentTick, tickSpacing)],
      [TICKMAP, tickmapWith(initialized, tickSpacing)],
    ];
    for (const t of initialized) entries.push([await tickPda(t), tick]);
    const config = await fetchInvariantPoolConfig(loaderOf(entries), POOL);
    return {
      xToY: config.windows.xToY.boundaries.map((b) => b.tick),
      yToX: config.windows.yToX.boundaries.map((b) => b.tick),
      yToXAddresses: config.windows.yToX.boundaries.map((b) => b.address),
    };
  }

  it("yToX visits every adjacent initialized tick above the current one (spacing 1)", async () => {
    const w = await windowsOf(0, 1, [1, 2, 3, 4]);
    expect(w.yToX).toEqual([1, 2, 3]);
    expect(w.yToXAddresses).toEqual(await Promise.all([1, 2, 3].map(tickPda)));
  });

  it("yToX visits every adjacent initialized tick above the current one (spacing 10)", async () => {
    const w = await windowsOf(0, 10, [10, 20, 50]);
    expect(w.yToX).toEqual([10, 20, 50]);
  });

  it("xToY visits every adjacent initialized tick, the current tick included", async () => {
    const w = await windowsOf(0, 1, [0, -1, -2, -3]);
    expect(w.xToY).toEqual([0, -1, -2]);
  });

  it("xToY visits every adjacent initialized tick (spacing 10)", async () => {
    const w = await windowsOf(0, 10, [0, -10, -20, -50]);
    expect(w.xToY).toEqual([0, -10, -20]);
  });

  it("both directions walk away from the same current tick", async () => {
    const w = await windowsOf(5, 1, [3, 4, 5, 6, 7]);
    expect(w.xToY).toEqual([5, 4, 3]);
    expect(w.yToX).toEqual([6, 7]);
  });
});
