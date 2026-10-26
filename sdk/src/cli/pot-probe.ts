/**
 * What a Kitchen call deploys, found without sending it: an `eth_call` CREATION runs a probe whose
 * constructor makes the call to the Kitchen — `deployPot(owner, salt)`, `deployPot(owner, salt,
 * routerFixed)` or `deploySharedPot(salt)` — and returns the Pot it made: its address, its Router
 * and its runtime code, immutables included. A state override can first clear the Pot's address,
 * so the Kitchen deploys there again what it deploys for that owner and salt today.
 *
 * `sauce simulate` puts a Pot not deployed yet in place this way (`rehearse.ts`), and the Pot
 * guard (`chain.ts#requireReleasePot`) holds a deployed Pot's code to what the Kitchen deploys at
 * its address.
 */
import { concat, getAddress, pad, sliceHex, type Address, type Hex, type PublicClient } from "viem";

import { CliError } from "./args.js";

/**
 * The probe's init code, followed by the Kitchen (32 bytes) and the call's data. Its constructor:
 *
 *   mem[0..len]   = the call's data               CODECOPY(0, 0x8b, codesize - 0x8b)
 *   mem[0x100]    = kitchen                       CODECOPY(0x100, 0x6b, 0x20)
 *   mem[0x120]    = Kitchen.<call>(…)             CALL, bubbling a revert
 *   mem[0x140]    = pot.router()                  STATICCALL, bubbling a revert
 *   mem[0x160..]  = pot's runtime code            EXTCODECOPY
 *   RETURN mem[0x120 .. 0x160 + size]             pot, router, code
 *
 * Its first returned byte is a zero (the Pot's address word), as a creation's return must not
 * start with 0xef.
 */
const PROBE: Hex = `0x${[
  "61008b380380", //              PUSH2 0x8b CODESIZE SUB DUP1: len
  "61008b600039", //              CODECOPY(0, 0x8b, len)
  "602061006b61010039", //        CODECOPY(0x100, 0x6b, 0x20): kitchen
  "602061012082", //              retSize 0x20, retOffset 0x120, argsSize len
  "60006000610100515af1", //      CALL(gas, kitchen, 0, 0, len, 0x120, 0x20)
  "1561006057", //                ISZERO PUSH2 fail JUMPI
  "63f887ea4060e01b600052", //    PUSH4 router  PUSH1 e0 SHL  PUSH1 0 MSTORE
  "602061014060046000610120515afa", // STATICCALL(gas, pot, 0, 4, 0x140, 0x20)
  "1561006057", //                ISZERO PUSH2 fail JUMPI
  "610120513b", //                EXTCODESIZE(pot)
  "80600061016061012051", //      DUP1 PUSH1 0 PUSH2 0x160 MLOAD(0x120)
  "3c", //                        EXTCODECOPY(pot, 0x160, 0, size)
  "604001610120f3", //            RETURN(0x120, size + 0x40)
  "5b3d600060003e3d6000fd", //    fail: RETURNDATACOPY(0, 0, size) REVERT(0, size)
].join("")}`;

/** A whole storage that holds nothing: `state` replaces an account's storage with what it lists. */
const EMPTY_STORAGE = [{ slot: pad("0x0"), value: pad("0x0") }];

export interface ProbedPot {
  readonly pot: Address;
  readonly router: Address;
  readonly code: Hex;
}

/**
 * The Pot `data`, a call to `kitchen`, deploys, as an `eth_call` from `from` finds it. A revert of
 * the call (the Kitchen's, or the Pot's constructor's) is thrown as the endpoint reported it.
 * `cleared`, when given, is an address the call sees with no code, no nonce and no storage: a
 * deployed Pot, deployed again.
 */
export async function probeDeployment(
  client: PublicClient,
  input: {
    readonly kitchen: Address;
    readonly from: Address;
    readonly data: Hex;
    readonly cleared?: Address;
  },
): Promise<ProbedPot> {
  const { data: answer } = await client.call({
    account: input.from,
    data: concat([PROBE, pad(input.kitchen, { size: 32 }), input.data]),
    ...(input.cleared === undefined
      ? {}
      : {
          stateOverride: [{ address: input.cleared, code: "0x", nonce: 0, state: EMPTY_STORAGE }],
        }),
  });
  if (answer === undefined || answer.length < 2 + 64 * 2 + 2) {
    throw new CliError("the endpoint answered the Pot's deployment with no code");
  }

  return {
    pot: getAddress(sliceHex(answer, 12, 32)),
    router: getAddress(sliceHex(answer, 44, 64)),
    code: sliceHex(answer, 64),
  };
}
