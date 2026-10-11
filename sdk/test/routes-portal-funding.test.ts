/**
 * routes/portal.ts — how an intent's reward reaches its vault from a wallet: by transfer, then
 * `publish` (the default), or approvals then `publishAndFund` (the opt-in).
 *
 * Pure: hand-built `Intent`s, no compiler, no network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  erc20Abi,
  toFunctionSignature,
  getAddress,
  type AbiFunction,
  type Hex,
} from "viem";

import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import {
  approvalTxs,
  assertIntentVault,
  intentSourceTxs,
  IntentVaultMismatchError,
  predictIntentVault,
  publishAndFundTx,
  publishTx,
  rewardVaultLegs,
  vaultTransferTxs,
} from "../src/routes/portal.js";
import type { Intent } from "../src/routes/types.js";
import { ecoRoutesVaultConfig, predictVaultAddress } from "../src/routes/vault.js";

const PORTAL = ecoRoutesPortal("base");
const TOKEN_A = "0x7777777777777777777777777777777777777777" as const;
const TOKEN_B = "0x8888888888888888888888888888888888888888" as const;

function intent(reward: {
  nativeAmount?: bigint;
  tokens?: { token: Hex; amount: bigint }[];
}): Intent {
  return {
    destination: 10n,
    sourceChainId: 8453n,
    route: normalizeRoute({
      deadline: 1_893_456_000n,
      portal: ecoRoutesPortal("optimism"),
      calls: [{ target: TOKEN_A, data: "0xdeadbeef", value: 0n }],
    }),
    reward: normalizeReward({
      deadline: 1_893_456_000n,
      creator: "0x5555555555555555555555555555555555555555",
      prover: "0x6666666666666666666666666666666666666666",
      nativeAmount: reward.nativeAmount ?? 0n,
      tokens: reward.tokens ?? [],
    }),
  };
}

const transferOf = (data: Hex) => {
  const decoded = decodeFunctionData({ abi: erc20Abi, data });
  expect(decoded.functionName).toBe("transfer");

  return decoded.args as readonly [Hex, bigint];
};

describe("the vault read a Pot makes is publish's payload under another selector", () => {
  // A program that funds an intent asks for the vault with `publish`'s rendered calldata behind
  // `intentVaultAddress`'s selector, which is sound only while the two take the same arguments.
  // That is held two ways: this compares the registry's declarations; and
  // `registry-abi/targets.json` requires both overloads, so the registry test fails if a deployed
  // Portal stops dispatching either signature.
  const signature = (name: string) =>
    toFunctionSignature(
      PortalABI.find((item) => item.type === "function" && item.name === name) as AbiFunction,
    );
  const TARGETS = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "fixtures/registry-abi/targets.json"),
      "utf8",
    ),
  ) as {
    protocols: Record<string, Record<string, { required?: Record<string, string> }>>;
  };

  it("declares the same parameters for both", () => {
    const params = (name: string) => signature(name).slice(name.length);

    expect(params("publish")).toBe(params("intentVaultAddress"));
    expect(params("publish")).toBe(
      "(uint64,bytes,(uint64,address,address,uint256,(address,uint256)[]))",
    );
  });

  it("requires both overloads of every deployed Portal", () => {
    const required = Object.keys(TARGETS.protocols["eco-routes"]!.PortalABI!.required ?? {});

    expect(required).toEqual(
      expect.arrayContaining([signature("publish"), signature("intentVaultAddress")]),
    );
  });
});

describe("what the vault must hold", () => {
  it("one leg per distinct token for its LARGEST amount, then native, zero legs left out", () => {
    const legs = rewardVaultLegs(
      intent({
        nativeAmount: 3n,
        tokens: [
          { token: TOKEN_A, amount: 5n },
          { token: TOKEN_B, amount: 0n },
          { token: TOKEN_A, amount: 9n },
          { token: TOKEN_A, amount: 2n },
        ],
      }),
    );

    // `_isRewardFunded` checks each entry against the vault's whole balance of that token, so the
    // largest entry is what funds them all — the sum would overpay.
    expect(legs).toEqual([{ token: getAddress(TOKEN_A), amount: 9n }, { amount: 3n }]);
  });
});

describe("intentSourceTxs: by transfer to the vault, then publish (the default)", () => {
  const built = intent({ nativeAmount: 4n, tokens: [{ token: TOKEN_A, amount: 9n }] });
  const vault = predictIntentVault(built, { portal: PORTAL });

  it("is the eco-routes derivation for the intent's hash", () => {
    expect(vault).toBe(
      predictVaultAddress(hashIntent(built).intentHash, ecoRoutesVaultConfig(PORTAL)),
    );
  });

  it("pays each leg into the vault, then publishes, and approves nothing", () => {
    const txs = intentSourceTxs(built, { portal: PORTAL });

    expect(txs).toHaveLength(3);
    expect(txs[0]!.to).toBe(getAddress(TOKEN_A));
    expect(transferOf(txs[0]!.data)).toEqual([vault, 9n]);
    expect(txs[0]!.value).toBe(0n);
    // The native amount is a plain send: the vault is an undeployed clone address, or a Proxy
    // whose `receive()` accepts it.
    expect(txs[1]).toEqual({ to: vault, data: "0x", value: 4n });
    // `publish` last, with no value: the vault already holds everything.
    expect(txs[2]).toEqual(publishTx(built, { portal: PORTAL }));
    expect(decodeFunctionData({ abi: PortalABI, data: txs[2]!.data }).functionName).toBe("publish");
    expect(vaultTransferTxs(built, vault)).toEqual(txs.slice(0, 2));
  });

  it("takes the vault the Portal reports when it agrees with the derivation", () => {
    const lower = vault.toLowerCase() as Hex;

    expect(intentSourceTxs(built, { portal: PORTAL }, { vault: lower })).toEqual(
      intentSourceTxs(built, { portal: PORTAL }),
    );
    expect(assertIntentVault(built, { portal: PORTAL }, lower)).toBe(vault);
  });

  it("refuses a vault the derivation disagrees with, and sends nothing to it", () => {
    const wrong = "0x000000000000000000000000000000000000bad1" as const;
    let error: unknown;
    try {
      intentSourceTxs(built, { portal: PORTAL }, { vault: wrong });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(IntentVaultMismatchError);
    expect((error as IntentVaultMismatchError).reported).toBe(getAddress(wrong));
    expect((error as IntentVaultMismatchError).predicted).toBe(vault);
    expect((error as Error).message).toMatch(/refusing to send the reward to either/);
  });

  it("refuses allowPartial: true, which only publishAndFund takes", () => {
    expect(() => intentSourceTxs(built, { portal: PORTAL }, { allowPartial: true })).toThrow(
      /`allowPartial` goes with fundVia "publishAndFund"/,
    );
    // `false` is what a transfer does anyway.
    expect(intentSourceTxs(built, { portal: PORTAL }, { allowPartial: false })).toHaveLength(3);
  });

  it("publishes alone when the reward is empty", () => {
    expect(intentSourceTxs(intent({}), { portal: PORTAL })).toEqual([
      publishTx(intent({}), { portal: PORTAL }),
    ]);
  });
});

describe("intentSourceTxs: approvals then publishAndFund (the opt-in)", () => {
  const built = intent({ nativeAmount: 4n, tokens: [{ token: TOKEN_A, amount: 9n }] });

  it("is exactly the approvals and publishAndFund", () => {
    expect(intentSourceTxs(built, { portal: PORTAL }, { fundVia: "publishAndFund" })).toEqual([
      ...approvalTxs(built, { portal: PORTAL }),
      publishAndFundTx(built, false, { portal: PORTAL }),
    ]);
    expect(
      intentSourceTxs(
        built,
        { portal: PORTAL },
        {
          fundVia: "publishAndFund",
          allowPartial: true,
        },
      ).at(-1),
    ).toEqual(publishAndFundTx(built, true, { portal: PORTAL }));
  });

  it("refuses a vault, which the Portal finds itself", () => {
    expect(() =>
      intentSourceTxs(built, { portal: PORTAL }, { fundVia: "publishAndFund", vault: PORTAL }),
    ).toThrow(/`vault` goes with fundVia "transfer"/);
  });

  it("refuses a mode it does not know", () => {
    expect(() =>
      intentSourceTxs(built, { portal: PORTAL }, { fundVia: "permit" as never }),
    ).toThrow(/fundVia 'permit' is not "transfer" or "publishAndFund"/);
  });
});
