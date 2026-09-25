/**
 * Shared iteration budget for the off-chain order-book tree walks the CLOB
 * venues (manifest, phoenix) run over raw market bytes.
 *
 * A PER-CALL iteration guard bounds nothing useful: with a cyclic parent/child
 * pointer set every successor call burns its own full guard, so the cost is
 * (guard x levels), not (guard). One counter for the WHOLE walk — successor
 * descents, parent climbs and level steps all drawing from it — makes a walk
 * O(nodes) in total no matter the pointer shape.
 */

/** Draws one pointer hop from the walk's budget; throws once it is exhausted. */
export type SpendHop = () => void;

/**
 * A budget of `3 * nodeCapacity` hops — the MEASURED worst case of a
 * legitimate full walk, not an estimate. Per side, over a tree of n nodes:
 *
 * - the emit loop spends one hop per node VISITED (zero-size orders are
 *   skipped but still visited), so n;
 * - manifest's `nextLower` leaves the first left step and the final parent
 *   step uncounted, so its descend and climb loops together spend exactly one
 *   hop per tree edge: n - 1. Manifest tops out at 2n - 1;
 * - phoenix's `successor` climb spends a hop per iteration INCLUDING the one
 *   that returns the parent, so every node with no right child costs a hop
 *   even when its successor is its immediate parent — up to n more on top of
 *   the per-edge n - 1. Phoenix tops out at 3n - 1.
 *
 * Both book sides draw from ONE budget and `nodeCapacity` counts every block
 * the account can physically hold, so bids + asks <= nodeCapacity and the
 * whole-market worst case is 3 * nodeCapacity - 2. Measured against
 * fully-populated all-zero-size markets: manifest 2.000x capacity (chain) /
 * 1.998x (balanced), phoenix 3.000x (chain) / 2.499x (balanced) — a BALANCED
 * phoenix tree alone overruns a 2x budget, which is why the factor is 3 and
 * not 2. A real market is nowhere near either: the SOL/USDC manifest fixture
 * spends 42 hops against a 2,983-block capacity, because MANIFEST_MAX_ORDERS /
 * PHOENIX_MAX_ORDERS stop the walk after a handful of levels.
 *
 * `nodeCapacity` must be derived from the account's own byte length, never from
 * a capacity field inside it: a corrupt account can declare any capacity.
 */
export function makeTreeWalkBudget(slug: string, nodeCapacity: number): SpendHop {
  const hops = 3 * Math.max(nodeCapacity, 0);
  let remaining = hops;

  return () => {
    if (remaining === 0) {
      throw new Error(
        `${slug}: order-book tree walk exceeded ${hops} pointer hops — the account's tree is cyclic or corrupt`,
      );
    }
    remaining--;
  };
}
