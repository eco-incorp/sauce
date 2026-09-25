/**
 * CLOB off-chain tree-walk budget (manifest + phoenix): a market account whose
 * red-black-tree pointers CYCLE must fail fast, and a well-formed book must
 * still resolve its window unchanged.
 *
 * The wall-clock assertions are the point of these tests, not the thrown
 * value: a per-CALL iteration guard also "terminates", it just does so after
 * (guard x levels) hops — 8.5 hours for a self-cycling manifest market, ~557 s
 * for a two-node phoenix cycle on a max-size market. A single whole-walk
 * budget sized on the account's node capacity makes both O(nodes).
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import {
  fetchManifestConfig,
  MARKET_DISCRIMINANT,
  MARKET_FIXED_SIZE,
  MANIFEST_MAX_ORDERS,
} from "../../../src/svm/venues/manifest/index.js";
import type { ManifestOrder } from "../../../src/svm/venues/manifest/index.js";
import {
  fetchPhoenixConfig,
  MARKET_DISCRIMINANT as PHOENIX_MARKET_DISCRIMINANT,
  BIDS_NODES_BASE,
  PHOENIX_MAX_ORDERS,
} from "../../../src/svm/venues/phoenix/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint } from "../fixtures/token-2022/synth.js";

/** A bounded walk must finish in milliseconds; a per-call guard needs hours. */
const WALL_CLOCK_BUDGET_MS = 1_000;

function writeU64LE(buf: Uint8Array, off: number, val: bigint): void {
  for (let i = 0; i < 8; i++) buf[off + i] = Number((val >> BigInt(8 * i)) & 0xffn);
}
function writeU32LE(buf: Uint8Array, off: number, val: number): void {
  for (let i = 0; i < 4; i++) buf[off + i] = (val >>> (8 * i)) & 0xff;
}

async function elapsedMs(run: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await run();
  return Date.now() - started;
}

// --- manifest ---------------------------------------------------------------

const MANIFEST_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/manifest");
const MANIFEST_MARKET = address("ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ");

const MANIFEST_BLOCK_SIZE = 80;
const MANIFEST_OFF_BIDS_BEST = 160;
const MANIFEST_OFF_ASKS_BEST = 168;
const MANIFEST_NODE_LEFT = 0;
const MANIFEST_NODE_RIGHT = 4;
const MANIFEST_NODE_PARENT = 8;
const MANIFEST_NIL = 0xffff_ffff;

/**
 * A MarketFixed header valid through every gate (discriminant, size, classic
 * mints) followed by `blocks` 80-byte blocks, both book sides pointing at
 * DataIndex 0. Every block starts NIL/NIL/NIL with a zero size — the caller
 * rewires only the pointers its shape needs.
 */
function manifestMarket(blocks: number, extraBytes = 0): Uint8Array {
  const buf = new Uint8Array(MARKET_FIXED_SIZE + blocks * MANIFEST_BLOCK_SIZE + extraBytes);
  writeU64LE(buf, 0, MARKET_DISCRIMINANT);
  writeU32LE(buf, MANIFEST_OFF_BIDS_BEST, 0);
  writeU32LE(buf, MANIFEST_OFF_ASKS_BEST, 0);
  for (let block = 0; block < blocks; block++) {
    const base = MARKET_FIXED_SIZE + block * MANIFEST_BLOCK_SIZE;
    writeU32LE(buf, base + MANIFEST_NODE_LEFT, MANIFEST_NIL);
    writeU32LE(buf, base + MANIFEST_NODE_RIGHT, MANIFEST_NIL);
    writeU32LE(buf, base + MANIFEST_NODE_PARENT, MANIFEST_NIL);
  }
  return buf;
}

const manifestLoader =
  (market: Uint8Array): AccountLoader =>
  async (addr) =>
    addr === MANIFEST_MARKET ? new Uint8Array(market) : makeLegacyMint();

const levels = (orders: readonly ManifestOrder[]): [number, bigint][] =>
  orders.map(({ dataIndex, sequenceNumber }) => [dataIndex, sequenceNumber]);

describe("manifest: cyclic tree pointers exhaust the walk budget", () => {
  it("fails fast on a 336-byte market whose only block points at itself", async () => {
    const market = manifestMarket(1);
    // left = right = parent = DataIndex 0 — the block IS its own child.
    writeU32LE(market, MARKET_FIXED_SIZE + MANIFEST_NODE_LEFT, 0);
    writeU32LE(market, MARKET_FIXED_SIZE + MANIFEST_NODE_RIGHT, 0);
    writeU32LE(market, MARKET_FIXED_SIZE + MANIFEST_NODE_PARENT, 0);
    expect(market.length).toBe(336);

    const elapsed = await elapsedMs(() =>
      expect(fetchManifestConfig(manifestLoader(market), MANIFEST_MARKET)).rejects.toThrow(
        /manifest: order-book tree walk exceeded 3 pointer hops/,
      ),
    );
    expect(elapsed).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });

  it("fails fast on a 1 MB market whose two blocks are a right-descent 2-cycle", async () => {
    // The case a per-call cap misses: each nextLower() returns after two hops,
    // so every one of them burns its own full guard.
    const blocks = Math.floor((1_048_576 - MARKET_FIXED_SIZE) / MANIFEST_BLOCK_SIZE);
    const market = manifestMarket(blocks);
    const blockA = MARKET_FIXED_SIZE;
    const blockB = MARKET_FIXED_SIZE + MANIFEST_BLOCK_SIZE;
    writeU32LE(market, blockA + MANIFEST_NODE_LEFT, MANIFEST_BLOCK_SIZE); // A.left = B
    writeU32LE(market, blockB + MANIFEST_NODE_RIGHT, 0); // B.right = A

    const elapsed = await elapsedMs(() =>
      expect(fetchManifestConfig(manifestLoader(market), MANIFEST_MARKET)).rejects.toThrow(
        /manifest: order-book tree walk exceeded 39312 pointer hops/,
      ),
    );
    expect(elapsed).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });

  // Verified byte-identical to the pre-budget walk against this same fixture.
  it("still resolves both windows of the real SOL/USDC market fixture unchanged", async () => {
    const load = fixtureLoader(loadFixtures(MANIFEST_FIXTURES));
    const cfg = await fetchManifestConfig(load, MANIFEST_MARKET);

    // The bid walk stops on its own (an expiring order) well inside the cap.
    expect(levels(cfg.windows.baseIn.orders)).toEqual([
      [236400, 68794935n],
      [236240, 68794937n],
      [237440, 68794895n],
      [227360, 68794896n],
      [236880, 67870971n],
      [230800, 68794897n],
      [236320, 68794898n],
      [236800, 67870970n],
      [236640, 67889229n],
      [235360, 67870969n],
    ]);
    // The ask walk fills the cap — the O(nodes) budget caps nothing legitimate.
    expect(levels(cfg.windows.quoteIn.orders)).toEqual([
      [232720, 68794936n],
      [235280, 68794899n],
      [204960, 68794900n],
      [236960, 68794938n],
      [237120, 68794901n],
      [230480, 68794902n],
      [232160, 68788703n],
      [233680, 68788704n],
      [228160, 67844805n],
      [228240, 67844894n],
      [227760, 67844999n],
      [235040, 67845064n],
      [231680, 67845207n],
      [235120, 67845503n],
      [234560, 67856065n],
      [235200, 67856126n],
    ]);
    expect(cfg.windows.quoteIn.orders.length).toBe(MANIFEST_MAX_ORDERS);
  });
});

// --- phoenix ----------------------------------------------------------------

const PHOENIX_MARKET = address("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

const PHOENIX_NODE_SIZE = 64;
const PHOENIX_OFF_BIDS_SIZE = 16;
const PHOENIX_OFF_ASKS_SIZE = 24;
const PHOENIX_BIDS_TREE_ROOT = 880;
const PHOENIX_NODE_SEQ = 24;
const PHOENIX_NODE_NUM_BASE_LOTS = 40;

interface PhoenixNode {
  left: number;
  right: number;
  parent: number;
  sequenceNumber: bigint;
  numBaseLots: bigint;
}

const phoenixNode = (over: Partial<PhoenixNode> = {}): PhoenixNode => ({
  left: 0,
  right: 0,
  parent: 0,
  sequenceNumber: 0n,
  numBaseLots: 0n,
  ...over,
});

/**
 * A MarketHeader + FIFOMarket body valid through every gate, with `bidsSize`
 * declared bid capacity, `bids` written into the bids node array (1-based) and
 * an empty asks tree. `totalBytes` is the account length — the walk budget is
 * sized on it, not on the declared capacity.
 */
function phoenixMarket(
  bidsSize: number,
  bidsRoot: number,
  bids: readonly PhoenixNode[],
  totalBytes: number,
): Uint8Array {
  const buf = new Uint8Array(totalBytes);
  writeU64LE(buf, 0, PHOENIX_MARKET_DISCRIMINANT);
  writeU64LE(buf, PHOENIX_OFF_BIDS_SIZE, BigInt(bidsSize));
  writeU64LE(buf, PHOENIX_OFF_ASKS_SIZE, 1n);
  writeU32LE(buf, PHOENIX_BIDS_TREE_ROOT, bidsRoot);
  bids.forEach((node, index) => {
    const base = BIDS_NODES_BASE + index * PHOENIX_NODE_SIZE;
    writeU32LE(buf, base + 0, node.left);
    writeU32LE(buf, base + 4, node.right);
    writeU32LE(buf, base + 8, node.parent);
    writeU64LE(buf, base + PHOENIX_NODE_SEQ, node.sequenceNumber);
    writeU64LE(buf, base + PHOENIX_NODE_NUM_BASE_LOTS, node.numBaseLots);
  });
  return buf;
}

// An unreadable mint falls back to the legacy assumption, so the walk is the
// only thing under test here.
const phoenixLoader =
  (market: Uint8Array): AccountLoader =>
  async (addr) =>
    addr === PHOENIX_MARKET ? new Uint8Array(market) : null;

describe("phoenix: cyclic tree registers exhaust the walk budget", () => {
  it("fails fast on a single-node market whose left register points at itself", async () => {
    const market = phoenixMarket(
      1,
      1,
      [phoenixNode({ left: 1 })],
      BIDS_NODES_BASE + PHOENIX_NODE_SIZE,
    );

    const elapsed = await elapsedMs(() =>
      expect(fetchPhoenixConfig(phoenixLoader(market), PHOENIX_MARKET)).rejects.toThrow(
        /phoenix: order-book tree walk exceeded 3 pointer hops/,
      ),
    );
    expect(elapsed).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });

  it("fails fast on a max-size market whose two nodes are a successor 2-cycle", async () => {
    // node 1's successor descends into node 2, whose findMin walks back to
    // node 1: every successor() call returns after two hops and would burn its
    // own full per-call guard.
    const market = phoenixMarket(
      26_000,
      1,
      [phoenixNode({ right: 2 }), phoenixNode({ left: 1 })],
      1_723_488,
    );

    const elapsed = await elapsedMs(() =>
      expect(fetchPhoenixConfig(phoenixLoader(market), PHOENIX_MARKET)).rejects.toThrow(
        /phoenix: order-book tree walk exceeded 80745 pointer hops/,
      ),
    );
    expect(elapsed).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });

  it("still resolves a well-formed three-level bid book in walk order", async () => {
    const bids = [
      phoenixNode({ parent: 2, sequenceNumber: 101n, numBaseLots: 10n }),
      phoenixNode({ left: 1, right: 3, sequenceNumber: 102n, numBaseLots: 20n }),
      phoenixNode({ parent: 2, sequenceNumber: 103n, numBaseLots: 30n }),
    ];
    const market = phoenixMarket(4, 2, bids, BIDS_NODES_BASE + 4 * PHOENIX_NODE_SIZE);

    const cfg = await fetchPhoenixConfig(phoenixLoader(market), PHOENIX_MARKET);
    expect(cfg.windows.baseIn.orders).toEqual([
      { nodeIndex: 1, orderSequenceNumber: 101n },
      { nodeIndex: 2, orderSequenceNumber: 102n },
      { nodeIndex: 3, orderSequenceNumber: 103n },
    ]);
    expect(cfg.windows.baseIn.orders.length).toBeLessThan(PHOENIX_MAX_ORDERS);
    expect(cfg.windows.quoteIn.orders).toEqual([]);
  });
});

// --- saturated books --------------------------------------------------------
// The budget's other edge: it must not throw on a LEGITIMATE walk. The costly
// legitimate shape is a book whose orders are all zero-size — skip-and-continue
// emits nothing, so MAX_ORDERS never stops the walk and it visits every node in
// the tree. Both sides drawing from one budget, that is the worst case the
// factor has to cover; measured at 2.000x capacity for manifest and 3.000x for
// phoenix (see makeTreeWalkBudget).

type Shape = "chain" | "balanced";

/** In-order node ids wired as a left-leaning chain (worst case) or a balanced BST. */
function wireTree(
  ids: readonly number[],
  shape: Shape,
  write: (id: number, left: number, right: number, parent: number) => void,
  nil: number,
): void {
  if (shape === "chain") {
    // Descending left spine: the root IS the max, so no right edge is ever
    // descended and every left edge is climbed — manifest's and phoenix's
    // costliest acyclic shape alike.
    ids.forEach((id, index) => {
      write(
        id,
        index + 1 < ids.length ? ids[index + 1]! : nil,
        nil,
        index > 0 ? ids[index - 1]! : nil,
      );
    });

    return;
  }
  const wire = (lo: number, hi: number, parent: number): number => {
    if (lo > hi) return nil;
    const mid = (lo + hi) >> 1;
    const self = ids[mid]!;
    write(self, wire(lo, mid - 1, self), wire(mid + 1, hi, self), parent);

    return self;
  };
  wire(0, ids.length - 1, nil);
}

/** Every block of the account in one of the two book trees, all zero-size. */
function saturatedManifestMarket(totalBytes: number, shape: Shape): Uint8Array {
  const blocks = Math.floor((totalBytes - MARKET_FIXED_SIZE) / MANIFEST_BLOCK_SIZE);
  const market = manifestMarket(
    blocks,
    totalBytes - MARKET_FIXED_SIZE - blocks * MANIFEST_BLOCK_SIZE,
  );
  const write = (block: number, left: number, right: number, parent: number): void => {
    const base = MARKET_FIXED_SIZE + block * MANIFEST_BLOCK_SIZE;
    writeU32LE(
      market,
      base + MANIFEST_NODE_LEFT,
      left === MANIFEST_NIL ? MANIFEST_NIL : left * MANIFEST_BLOCK_SIZE,
    );
    writeU32LE(
      market,
      base + MANIFEST_NODE_RIGHT,
      right === MANIFEST_NIL ? MANIFEST_NIL : right * MANIFEST_BLOCK_SIZE,
    );
    writeU32LE(
      market,
      base + MANIFEST_NODE_PARENT,
      parent === MANIFEST_NIL ? MANIFEST_NIL : parent * MANIFEST_BLOCK_SIZE,
    );
  };
  const half = Math.ceil(blocks / 2);
  const bids = Array.from({ length: half }, (_, index) => index);
  const asks = Array.from({ length: blocks - half }, (_, index) => half + index);
  wireTree(bids, shape, write, MANIFEST_NIL);
  wireTree(asks, shape, write, MANIFEST_NIL);
  // The walk enters at the side's MAX: the chain's head, the balanced tree's last in-order node.
  const best = (ids: readonly number[]): number =>
    shape === "chain" ? ids[0]! : ids[ids.length - 1]!;
  writeU32LE(market, MANIFEST_OFF_BIDS_BEST, best(bids) * MANIFEST_BLOCK_SIZE);
  writeU32LE(market, MANIFEST_OFF_ASKS_BEST, best(asks) * MANIFEST_BLOCK_SIZE);

  return market;
}

/** Every node of the account in one of the two book trees, all zero-size. */
function saturatedPhoenixMarket(nodesPerSide: number, shape: Shape): Uint8Array {
  const asksTreeRoot = PHOENIX_BIDS_TREE_ROOT + 32 + nodesPerSide * PHOENIX_NODE_SIZE;
  const asksNodesBase = asksTreeRoot + 32;
  const market = new Uint8Array(asksNodesBase + nodesPerSide * PHOENIX_NODE_SIZE);
  writeU64LE(market, 0, PHOENIX_MARKET_DISCRIMINANT);
  writeU64LE(market, PHOENIX_OFF_BIDS_SIZE, BigInt(nodesPerSide));
  writeU64LE(market, PHOENIX_OFF_ASKS_SIZE, BigInt(nodesPerSide));
  const ids = Array.from({ length: nodesPerSide }, (_, index) => index + 1);
  const writeInto =
    (nodesBase: number) =>
    (id: number, left: number, right: number, parent: number): void => {
      const base = nodesBase + (id - 1) * PHOENIX_NODE_SIZE;
      writeU32LE(market, base + 0, left);
      writeU32LE(market, base + 4, right);
      writeU32LE(market, base + 8, parent);
    };
  wireTree(ids, shape, writeInto(BIDS_NODES_BASE), 0);
  wireTree(ids, shape, writeInto(asksNodesBase), 0);
  // Phoenix walks UP from the tree root, so the root is what it is told.
  const root = shape === "chain" ? ids[0]! : ids[(ids.length - 1) >> 1]!;
  writeU32LE(market, PHOENIX_BIDS_TREE_ROOT, root);
  writeU32LE(market, asksTreeRoot, root);

  return market;
}

describe("a saturated all-zero-size book still fits the walk budget", () => {
  it.each<Shape>(["chain", "balanced"])(
    "manifest, every block in the two book trees (%s)",
    async (shape) => {
      const market = saturatedManifestMarket(318_528, shape);
      const cfg = await fetchManifestConfig(manifestLoader(market), MANIFEST_MARKET);

      // Every order was skipped, so both windows are empty — the walk still ran
      // to the end of both trees, which is the cost the budget has to absorb.
      expect(cfg.windows.baseIn.orders).toEqual([]);
      expect(cfg.windows.quoteIn.orders).toEqual([]);
    },
  );

  it.each<Shape>(["chain", "balanced"])(
    "phoenix, every node in the two book trees (%s)",
    async (shape) => {
      const market = saturatedPhoenixMarket(13_457, shape);
      const cfg = await fetchPhoenixConfig(phoenixLoader(market), PHOENIX_MARKET);

      expect(cfg.windows.baseIn.orders).toEqual([]);
      expect(cfg.windows.quoteIn.orders).toEqual([]);
    },
  );
});
