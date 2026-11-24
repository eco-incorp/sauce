// Whether one EVM engine release is another with only its fixed-Router constant changed.
//
// The engine compiles in one fixed Router: its Pot gate accepts a fixed-Router or Shared Pot only if
// that Pot's `fixedRouter` equals the constant (`FIXED_ROUTER_ENC`), and a Router release therefore
// ships with an engine built for it. A dynamic Pot, whose Router is storage, passes the gate whatever
// the constant is, so every existing dynamic Pot moves from the earlier engine to the new one, and
// that move rests on the new engine being the earlier one with nothing but the constant changed.
// `routerOnlyDiff` checks exactly that, on the two releases' creation code. `scripts/engine-diff.mjs`
// holds each file to its row's pinned digest first, and `test/evm/engine-router-diff.test.ts` runs the
// same check on the synced files.
//
// What may differ: the 20 payload bytes of each PUSH20 that pushes `FIXED_ROUTER_ENC`. The rest of
// the creation code is fixed by the build. It is `[init: PUSH2 rtsize … RETURN][body]`, where `rtsize`
// and every jump destination depend only on the code's length and layout, which a same-width payload
// leaves unchanged; the body's jump table is scrambled with two constants; the Kitchen's encoding is
// the same Kitchen; the Pot init-code hash is unset for a CREATE3 build; the creation code holds no
// self-address (the init appends it at deploy); and Huff emits no metadata. A payload that starts with
// a zero byte could be pushed narrower, which moves every later offset and cannot be told from another
// change, so that case is refused rather than compared.

import { getAddress, hexToBytes, keccak256 } from "viem";

/** v12's gate nonce (v12-evm/engine/Runtime.huff:79, script/GatedEngine.sol:19). */
export const GATE_NONCE = "0x9e3779b97f4a7c159e3779b97f4a7c159e3779b97f4a7c159e3779b97f4a7c15";

/** PUSH20. */
const PUSH20 = 0x73;

/**
 * What the engine build pushes for `router`: the address XOR the low 20 bytes of
 * keccak256(GATE_NONCE) (GatedEngine.sol:111-120).
 */
export function encodedRouter(router) {
  const mask = hexToBytes(keccak256(GATE_NONCE)).subarray(12);

  return hexToBytes(getAddress(router)).map((byte, at) => byte ^ mask[at]);
}

/** The offsets of `code` where a PUSH20 pushes `encoded`. */
function pushSites(code, encoded) {
  const sites = [];
  for (let at = 0; at + 1 + encoded.length <= code.length; at++) {
    if (code[at] !== PUSH20) continue;
    if (encoded.every((byte, i) => code[at + 1 + i] === byte)) sites.push(at);
  }

  return sites;
}

/**
 * Whether `after` is `before` with only its fixed-Router constant changed: `before` and `after` are
 * creation code (Uint8Array), `routerBefore` and `routerAfter` the Routers they were built for.
 * `{ ok: true, sites }` with the offsets of the constant's PUSH20 (the same in both), or
 * `{ ok: false, problem }`.
 */
export function routerOnlyDiff(before, after, routerBefore, routerAfter) {
  if (before.length !== after.length) {
    return {
      ok: false,
      problem: `the creation codes differ in length (${before.length} and ${after.length} bytes)`,
    };
  }
  const encodedBefore = encodedRouter(routerBefore);
  const encodedAfter = encodedRouter(routerAfter);
  if (encodedBefore[0] === 0 || encodedAfter[0] === 0) {
    return {
      ok: false,
      problem:
        "an encoded Router starts with a zero byte, which the Huff compiler may push narrower and so " +
        "move every later offset: compare by hand with v12",
    };
  }

  const sites = pushSites(before, encodedBefore);
  if (sites.length === 0) {
    return { ok: false, problem: "no fixed-Router site in the earlier engine" };
  }
  const found = pushSites(after, encodedAfter);
  if (found.length !== sites.length || found.some((at, i) => at !== sites[i])) {
    return { ok: false, problem: "the fixed-Router sites differ between the two engines" };
  }

  for (let at = 0; at < before.length; at++) {
    if (before[at] === after[at]) continue;
    if (sites.some((site) => at > site && at <= site + encodedBefore.length)) continue;

    return { ok: false, problem: `byte ${at} differs outside a fixed-Router site` };
  }

  return { ok: true, sites };
}
