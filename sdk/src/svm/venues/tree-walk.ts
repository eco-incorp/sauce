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
 * A budget of `2 * nodeCapacity` hops. An in-order traversal crosses each tree
 * edge at most twice, so that bounds any legitimate walk — and a real walk
 * stops after a handful of levels anyway, far below the bound.
 *
 * `nodeCapacity` must be derived from the account's own byte length, never from
 * a capacity field inside it: a corrupt account can declare any capacity.
 */
export function makeTreeWalkBudget(slug: string, nodeCapacity: number): SpendHop {
  const hops = 2 * Math.max(nodeCapacity, 0);
  let remaining = hops;

  return () => {
    if (remaining === 0) {
      throw new Error(`${slug}: order-book tree walk exceeded ${hops} pointer hops — the account's tree is cyclic or corrupt`);
    }
    remaining--;
  };
}
