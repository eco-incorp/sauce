/**
 * A pool's slot read from its own state (`svm/pool-slot.ts`), for each price-limit venue's pool as
 * mainnet held it (`venue-fixture.ts`): the nine accounts, paying either token, are the fixture's
 * own — the slot the distributed swap's suites run on these pools.
 */
import { address, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import {
  isSvmAccountName,
  resolveSvmAccountName,
  type SvmAccountNameContext,
} from "../../src/svm/account-names.js";
import { SVM_SLOT_PARTS, svmPoolSlot, svmSlotAccounts } from "../../src/svm/pool-slot.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import { BYTES, SNAPSHOT, pool, USDC, USDT, WSOL, key } from "./venue-fixture.js";

/** The fixture's accounts, as an owner-aware loader reads them. */
const load: OwnedAccountLoader = async (at) => {
  const data = BYTES.get(at);
  return data === undefined ? null : { data, owner: SNAPSHOT.get(at)!.owner };
};

describe("svmPoolSlot", () => {
  // byreal-sol-usdc is left out: its fixture slot is the System program throughout (its fees are
  // more than one rate, so the distributed swap skips it and its accounts were never dumped).
  it.each([
    ["raydium-clmm-sol-usdc", WSOL, USDC],
    ["pancakeswap-clmm-sol-usdc", WSOL, USDC],
    ["byreal-usdc", address("4SoQ8UkWfeDH47T56PA53CZCeW4KytYCiU65CwBWoJUt"), USDC],
    ["stabble-clmm-usdc-usdt", USDC, USDT],
    ["orca-whirlpool-sol-usdc", WSOL, USDC],
    ["cropper-sol-usdc", WSOL, USDC],
    ["defituna-sol-usdc", WSOL, USDC],
    ["crema-sol-usdc", WSOL, USDC],
    ["phoenix-sol-usdc", WSOL, USDC],
  ] as const)("%s: the slot paying either token is the fixture's", async (name, a, b) => {
    const p = pool(name);
    // The lower-key token pays toward the falling price.
    const [lower, higher] = key(a) < key(b) ? [a, b] : [b, a];
    for (const [pay, ticks] of [
      [lower, p.payA],
      [higher, p.payB],
    ] as const) {
      const slot = await svmPoolSlot(load, p.pool, pay);
      expect(svmSlotAccounts(slot)).toEqual([
        p.program,
        p.pool,
        p.config,
        p.vaultA,
        p.vaultB,
        p.extra,
        ...ticks,
      ]);
    }
  });

  it("refuses a pool no price-limit venue owns, and a token its pair does not hold", async () => {
    const usdcUsdt = pool("stabble-clmm-usdc-usdt");
    await expect(svmPoolSlot(load, usdcUsdt.pool, WSOL)).rejects.toThrow(
      `Stabble CLMM pool ${usdcUsdt.pool} trades`,
    );
    const book = pool("manifest-sol-usdc");
    await expect(svmPoolSlot(load, book.pool, USDC)).rejects.toThrow(
      "which is not a venue whose swap stops at a price limit",
    );
    const nowhere = address("11111111111111111111111111111112") as Address;
    await expect(svmPoolSlot(load, nowhere, USDC)).rejects.toThrow("has no account");
  });

  it.each([
    ["raydium-clmm-sol-usdc", "Raydium CLMM pool"],
    ["orca-whirlpool-sol-usdc", "Orca Whirlpools pool"],
    ["cropper-sol-usdc", "Cropper pool"],
    ["defituna-sol-usdc", "DefiTuna pool"],
    ["crema-sol-usdc", "Crema pool"],
    ["phoenix-sol-usdc", "Phoenix market"],
    ["meteora-dlmm-sol-usdc", "Meteora DLMM pool"],
  ])(
    "%s: an account of the venue's program that is not a pool is refused before anything else is read",
    async (name, what) => {
      const p = pool(name);
      const forged = new Uint8Array(BYTES.get(p.pool)!);
      forged[0] ^= 0xff;
      const read: Address[] = [];
      const forgedLoad: OwnedAccountLoader = async (at) => {
        read.push(at);
        return at === p.pool ? { data: forged, owner: p.program } : load(at);
      };
      await expect(svmPoolSlot(forgedLoad, p.pool, USDC)).rejects.toThrow(
        `${p.pool} is not a ${what}: its account is another of the program's`,
      );
      expect(read).toEqual([p.pool]);
    },
  );

  // The SOL/USDC pool's bin arrays, by index: its active bin, -6260, is in -90, and -88 to -92 all
  // hold liquidity. Paying SOL, its token X, the walk goes down; paying USDC, its token Y, up.
  const BIN_ARRAYS: Record<number, Address> = {
    [-88]: address("88CrJuawxX8QQETR5U8gMrjP6fftzUYwSYJyeXBXmU2g"),
    [-89]: address("8CRkBdY5RkDRDBAZFKwRBpfe2JSWoPqM8jfr14KUXMpF"),
    [-90]: address("EsMdTh8Ce3fdpQoLGhbuqrXKQnZTUQfVpKAbokm6QjYC"),
    [-91]: address("BQfCpu2aNw3CXe4SQbDHY6goR6kZgSGakDs9yMqh6Bhv"),
  };
  const SYSTEM = address("11111111111111111111111111111111");

  it("meteora-dlmm-sol-usdc: the slot paying either token, two bin arrays its bitmap marks", async () => {
    const p = pool("meteora-dlmm-sol-usdc");
    const head = [
      p.program,
      p.pool,
      address("D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6"),
      address("EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o"),
      address("CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz"),
      address("59YuGWPunbchD2mbi9U7qvjWQKQReGeepn4ZSr9zz9Li"),
    ];
    expect(svmSlotAccounts(await svmPoolSlot(load, p.pool, WSOL))).toEqual([
      ...head,
      BIN_ARRAYS[-90],
      BIN_ARRAYS[-91],
      SYSTEM,
    ]);
    expect(svmSlotAccounts(await svmPoolSlot(load, p.pool, USDC))).toEqual([
      ...head,
      BIN_ARRAYS[-90],
      BIN_ARRAYS[-89],
      SYSTEM,
    ]);
  });

  it("meteora-dlmm-sol-usdc: past an unmarked array to the next marked, and no slot without one", async () => {
    const p = pool("meteora-dlmm-sol-usdc");
    const bitmap = (edit: (bits: Uint8Array) => void): OwnedAccountLoader => {
      const data = new Uint8Array(BYTES.get(p.pool)!);
      edit(data.subarray(584, 584 + 128));
      return async (at) => (at === p.pool ? { data, owner: p.program } : load(at));
    };
    const clear = (bits: Uint8Array, index: number) =>
      (bits[(index + 512) >> 3]! &= ~(1 << ((index + 512) & 7)));
    // -90 (the active bin's) unmarked: paying USDC, the arrays above it.
    const above = await svmPoolSlot(
      bitmap((bits) => clear(bits, -90)),
      p.pool,
      USDC,
    );
    expect(above.ticks).toEqual([BIN_ARRAYS[-89], BIN_ARRAYS[-88], SYSTEM]);
    // Nothing marked below -90: paying SOL, its one array.
    const alone = await svmPoolSlot(
      bitmap((bits) => {
        for (let index = -512; index < -90; index++) clear(bits, index);
      }),
      p.pool,
      WSOL,
    );
    expect(alone.ticks).toEqual([BIN_ARRAYS[-90], SYSTEM, SYSTEM]);
    await expect(
      svmPoolSlot(
        bitmap((bits) => bits.fill(0)),
        p.pool,
        WSOL,
      ),
    ).rejects.toThrow("no bin array holds liquidity below its active bin");
  });

  it("reads a Raydium-layout pool's tick arrays that hold nothing together, not one by one", async () => {
    const p = pool("raydium-clmm-sol-usdc");
    // No array marked: the slot is the three nearest its price that exist.
    const unmarked = new Uint8Array(BYTES.get(p.pool)!);
    unmarked.fill(0, 904, 904 + 128);
    let inFlight = 0;
    let most = 0;
    const slow: OwnedAccountLoader = async (at) => {
      if (at === p.pool) return { data: unmarked, owner: p.program };
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return load(at);
    };
    const slot = await svmPoolSlot(slow, p.pool, USDC);
    expect(most).toBeGreaterThan(1);
    for (const tick of slot.ticks) expect(BYTES.has(tick)).toBe(true);
    expect(new Set(slot.ticks).size).toBe(3);
  });
});

describe("slot:<pool>:<token>.<part>, the account-name form", () => {
  const SOLANA = requireChain("solana");
  const ctx = (more: Partial<SvmAccountNameContext> = {}): SvmAccountNameContext => ({
    chain: SOLANA,
    owner: address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"),
    pot: address("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"),
    load,
    ...more,
  });

  it("names each of a pool's nine accounts paying a token, the pool a key or main's argument", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    const ticks = key(USDC) < key(WSOL) ? p.payA : p.payB; // paying USDC
    const expected = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra, ...ticks];
    for (const [index, part] of SVM_SLOT_PARTS.entries()) {
      expect(await resolveSvmAccountName(`slot:${p.pool}:USDC.${part}`, ctx())).toEqual({
        value: expected[index],
        label: `pool ${p.pool}'s ${part}, paying USDC`,
        kind: "address",
      });
    }
    expect(
      (await resolveSvmAccountName("slot:@pool:WSOL.ticks0", ctx({ args: { pool: p.pool } })))
        .value,
    ).toBe((key(WSOL) < key(USDC) ? p.payA : p.payB)[0]);
  });

  it("reads the pool once a cook, however many of its nine accounts the cook names", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    let reads = 0;
    const counting: OwnedAccountLoader = async (at) => {
      if (at === p.pool) reads++;
      return load(at);
    };
    // What reading the slot once reads of the pool.
    await svmPoolSlot(counting, p.pool, USDC);
    const once = reads;
    reads = 0;
    const slots = new Map();
    await Promise.all(
      SVM_SLOT_PARTS.map((part) =>
        resolveSvmAccountName(`slot:${p.pool}:USDC.${part}`, ctx({ load: counting, slots })),
      ),
    );
    expect(reads).toBe(once);
  });

  it("reads the pool again for the next cook: a price that moved moves its tick arrays", async () => {
    const p = pool("raydium-clmm-sol-usdc");
    let data = new Uint8Array(BYTES.get(p.pool)!);
    const moving: OwnedAccountLoader = async (at) =>
      at === p.pool ? { data, owner: p.program } : load(at);
    const before = await resolveSvmAccountName(`slot:${p.pool}:USDC.ticks0`, ctx({ load: moving }));
    // The pool's tick moved by spans until its first tick array paying USDC is another.
    const span = 60 * new DataView(data.buffer).getUint16(235, true);
    const tick = new DataView(data.buffer).getInt32(269, true);
    let moved: Address | undefined;
    for (let spans = 1; moved === undefined && spans <= 8; spans++) {
      const next = new Uint8Array(BYTES.get(p.pool)!);
      new DataView(next.buffer).setInt32(269, tick + spans * span, true);
      const fresh = await svmPoolSlot(
        async (at) => (at === p.pool ? { data: next, owner: p.program } : load(at)),
        p.pool,
        USDC,
      );
      if (fresh.ticks[0] !== before.value) {
        data = next;
        moved = fresh.ticks[0];
      }
    }
    expect(moved).toBeDefined();
    // The same loader, a later cook: the slot is read from the pool as it is now.
    expect(
      (await resolveSvmAccountName(`slot:${p.pool}:USDC.ticks0`, ctx({ load: moving }))).value,
    ).toBe(moved);
  });

  it("refuses with no loader, and a pool whose slot cannot be read", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    await expect(
      resolveSvmAccountName(`slot:${p.pool}:USDC.vaultA`, ctx({ load: undefined })),
    ).rejects.toThrow("slot is read from the cluster, which this resolution has no way to do");
    await expect(resolveSvmAccountName(`slot:${p.pool}:USDT.vaultA`, ctx())).rejects.toThrow(
      `pool ${p.pool}'s slot paying USDT could not be read: Orca Whirlpools pool`,
    );
    expect(isSvmAccountName(`slot:${p.pool}:USDC.vault`)).toBe(false);
  });
});
