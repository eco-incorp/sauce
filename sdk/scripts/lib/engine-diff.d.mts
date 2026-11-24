/** v12's gate nonce (v12-evm/engine/Runtime.huff:79, script/GatedEngine.sol:19). */
export declare const GATE_NONCE: `0x${string}`;

/**
 * What the engine build pushes for `router`: the address XOR the low 20 bytes of
 * keccak256(GATE_NONCE) (GatedEngine.sol:111-120).
 */
export declare function encodedRouter(router: string): Uint8Array;

/** What `routerOnlyDiff` found. */
export type RouterOnlyDiff =
  | { readonly ok: true; readonly sites: number[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Whether `after` is `before` with only its fixed-Router constant changed: `before` and `after` are
 * creation code, `routerBefore` and `routerAfter` the Routers they were built for. `sites` are the
 * offsets of the constant's PUSH20, the same in both.
 */
export declare function routerOnlyDiff(
  before: Uint8Array,
  after: Uint8Array,
  routerBefore: string,
  routerAfter: string,
): RouterOnlyDiff;
