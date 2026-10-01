/**
 * `svm/portal.ts` against the programs' own definitions, offline: the Anchor discriminators from
 * their derivation, the PDAs against eco-routes-svm's goldens for the rotated ids
 * (`programs/*\/src/state/testdata/*.golden` at aa8059e), and the transfer call byte for byte
 * against the layout eco-routes' `DepositAddress_USDCTransfer_Solana._encodeRoute` writes.
 * `svm-portal.e2e.test.ts` runs the same instructions against the programs.
 */
import { createHash } from "node:crypto";
import { address, getAddressEncoder } from "@solana/kit";
import { bytesToHex, concat, hexToBytes, toHex, type Hex } from "viem";

import { toUniversalAddress } from "../src/routes/normalize.js";
import type { Route } from "../src/routes/types.js";
import {
  associatedTokenAccount,
  compactSvmRoute,
  decodeFulfillMarker,
  PORTAL_DISCRIMINATORS,
  SVM_CANCELLED_CLAIMANT,
  svmExecutorPda,
  svmHyperDispatcherPda,
  svmKeyOf,
  svmPortalDispatcherPda,
  svmTokenTransferCall,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import { CANCELLED_CLAIMANT_BYTES32 } from "../src/routes/portal.js";

const PORTAL = address("EcoowmRRrMyYtQCuh5fCvMDWcD6B9ZDZkpgedf2bWKXi");
const HYPER = address("EcoHjwFYKtiHp5ZuFQBc87GDikm9Lc5EYapKywjNAQQF");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const key = (bytes: number[]): string => bytesToHex(Uint8Array.from(bytes));
const keyOf = (value: string): string =>
  bytesToHex(new Uint8Array(getAddressEncoder().encode(address(value))));
const le = (value: bigint, bytes: number): Hex => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);

  return bytesToHex(out.subarray(0, bytes));
};

describe("svm/portal.ts", () => {
  it("names each instruction and the marker by its Anchor discriminator", () => {
    const anchor = (name: string) => [...createHash("sha256").update(name).digest().subarray(0, 8)];
    expect([...PORTAL_DISCRIMINATORS.fulfill]).toEqual(anchor("global:fulfill"));
    expect([...PORTAL_DISCRIMINATORS.prove]).toEqual(anchor("global:prove"));
    expect([...PORTAL_DISCRIMINATORS.cancel]).toEqual(anchor("global:cancel"));
    expect([...PORTAL_DISCRIMINATORS.payForGas]).toEqual(anchor("global:pay_for_gas"));
    expect([...PORTAL_DISCRIMINATORS.fulfillMarker]).toEqual(anchor("account:FulfillMarker"));
  });

  it("derives the PDAs eco-routes-svm pins for the rotated ids", async () => {
    // portal/src/state/testdata/executor_pda_deterministic.golden
    expect(keyOf(await svmExecutorPda(PORTAL))).toBe(
      key([
        191, 82, 234, 114, 68, 88, 56, 207, 194, 105, 30, 239, 194, 232, 159, 164, 236, 88, 228,
        243, 155, 78, 241, 198, 87, 0, 69, 133, 181, 238, 214, 46,
      ]),
    );
    // hyper-prover/src/state/testdata/dispatcher_pda_deterministic.golden: the message's sender,
    // which the EVM HyperProvers whitelist.
    expect(keyOf(await svmHyperDispatcherPda(HYPER))).toBe(
      key([
        235, 39, 28, 152, 53, 224, 115, 117, 234, 148, 109, 212, 173, 113, 174, 253, 37, 89, 203,
        93, 162, 126, 126, 206, 140, 91, 19, 211, 20, 122, 134, 82,
      ]),
    );
    // hyper-prover/src/state/testdata/accepted_prove_caller_authority_deterministic.golden
    expect(keyOf(await svmPortalDispatcherPda(PORTAL, HYPER))).toBe(
      key([
        34, 176, 123, 19, 42, 110, 112, 105, 147, 216, 228, 42, 202, 237, 140, 74, 28, 118, 85, 198,
        167, 4, 138, 188, 89, 231, 85, 88, 84, 178, 204, 189,
      ]),
    );
  });

  it("writes the transfer call DepositAddress_USDCTransfer_Solana writes", async () => {
    const recipient = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    const executor = await svmExecutorPda(PORTAL);
    const call = await svmTokenTransferCall({
      portal: PORTAL,
      mint: USDC,
      amount: 1_000_000n,
      decimals: 6,
      recipient,
    });
    expect(call.target).toBe(universalOfSvmKey(TOKEN_PROGRAM_ID));
    const instruction = concat(["0x0c", le(1_000_000n, 8), "0x06"]);
    expect(call.data).toBe(
      concat([
        le(10n, 4),
        instruction,
        "0x04",
        le(4n, 4),
        keyOf(await associatedTokenAccount(executor, USDC, TOKEN_PROGRAM_ID)) as Hex,
        "0x0001",
        keyOf(USDC) as Hex,
        "0x0000",
        keyOf(recipient) as Hex,
        "0x0001",
        keyOf(executor) as Hex,
        "0x0000",
      ]),
    );
  });

  it("refuses a route that commits a signer the fill cannot have", async () => {
    const stranger = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    const call = await svmTokenTransferCall({
      portal: PORTAL,
      mint: USDC,
      amount: 1n,
      decimals: 6,
      recipient: stranger,
    });
    // The same call, its recipient committed as a signer.
    const bytes = hexToBytes(call.data);
    bytes[bytes.length - 2 - 34] = 1;
    const route: Route = {
      salt: `0x${"11".repeat(32)}`,
      deadline: 1n,
      portal: universalOfSvmKey(PORTAL),
      nativeAmount: 0n,
      tokens: [],
      calls: [{ ...call, data: toHex(bytes) }],
    };
    const solver = address("So11111111111111111111111111111111111111112");
    expect(() => compactSvmRoute(route, { signers: [solver] })).toThrow(
      `the route commits ${stranger} as a signer of a call`,
    );
    expect(compactSvmRoute(route, { signers: [stranger] }).callAccounts).toHaveLength(4);
  });

  it("reads a fulfill marker's claimant, and nothing from what is not one", () => {
    const claimant = toUniversalAddress("0x658d45d9DEB56768ca379C50daEcde116Db44521");
    const marker = new Uint8Array([
      ...PORTAL_DISCRIMINATORS.fulfillMarker,
      ...hexToBytes(claimant),
      255,
    ]);
    expect(decodeFulfillMarker(marker)).toBe(claimant);
    expect(decodeFulfillMarker(marker.subarray(0, 40))).toBeNull();
    expect(decodeFulfillMarker(new Uint8Array(41))).toBeNull();
    // The sentinel is the EVM one, the same 32 bytes.
    expect(SVM_CANCELLED_CLAIMANT).toBe(CANCELLED_CLAIMANT_BYTES32.toLowerCase());
    expect(svmKeyOf(universalOfSvmKey(PORTAL))).toBe(PORTAL);
  });
});
