/**
 * routes/portal.ts — how an intent's reward reaches its vault from a wallet: by transfer, then
 * `publish` (the default), or approvals then `publishAndFund` (the opt-in).
 *
 * Pure: hand-built `Intent`s, no compiler, no network. `routes-nest-dynamic.e2e.test.ts` and
 * `cli.e2e.test.ts` run both against the real Portal and check `isIntentFunded`.
 */
import {
  bytesToHex,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  toFunctionSelector,
  type Hex,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { openRoute } from "../src/routes/intent-dsl.js";
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

describe("BuiltIntent.sourceTxs and predictVault", () => {
  const OPTIONS = {
    deadline: 1_893_456_000n,
    creator: "0x5555555555555555555555555555555555555555",
    prover: "0x6666666666666666666666666666666666666666",
    source: requireChain("base"),
  } as const;
  const build = (fundVia?: "transfer" | "publishAndFund") =>
    openRoute(
      "optimism",
      `function main() {\n  const x = 1n;\n}`,
      fundVia === undefined ? OPTIONS : { ...OPTIONS, fundVia },
    ).reward({ tokens: [{ token: TOKEN_A, amount: 9n }] });

  it("defaults to transfer, into the vault predictVault() derives for the source Portal", () => {
    const built = build();
    const vault = built.predictVault();

    expect(vault).toBe(predictIntentVault(built.intent, { portal: PORTAL }));
    expect(built.sourceTxs()).toEqual(intentSourceTxs(built.intent, { portal: PORTAL }));
    expect(transferOf(built.sourceTxs()[0]!.data)).toEqual([vault, 9n]);
  });

  it("takes IntentOptions.fundVia as its default, and an explicit option over it", () => {
    const optedOut = build("publishAndFund");

    expect(optedOut.sourceTxs()).toEqual([
      ...optedOut.approvals(),
      optedOut.publishAndFundCalldata(false),
    ]);
    expect(optedOut.sourceTxs({ fundVia: "transfer" })).toEqual(
      intentSourceTxs(optedOut.intent, { portal: PORTAL }),
    );
  });

  it("hands IntentOptions.fundVia to the intents the route's own program opens", () => {
    const body = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Base(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;
    const programOf = (fundVia?: "publishAndFund") =>
      bytesToHex(
        openRoute("optimism", body, {
          ...OPTIONS,
          defines: { RECIPIENT: BigInt(OPTIONS.creator) },
          ...(fundVia === undefined ? {} : { fundVia }),
        }).reward({ tokens: [{ token: TOKEN_A, amount: 9n }] }).compiled.bytecode[0]!,
      );
    const selectorOf = (name: string) =>
      toFunctionSelector(
        PortalABI.find((item) => item.type === "function" && item.name === name)!,
      ).slice(2);

    expect(programOf()).toContain(selectorOf("intentVaultAddress"));
    expect(programOf()).not.toContain(selectorOf("publishAndFund"));
    expect(programOf("publishAndFund")).toContain(selectorOf("publishAndFund"));
    expect(programOf("publishAndFund")).not.toContain(selectorOf("intentVaultAddress"));
  });

  it("still takes an explicit vault config", () => {
    const built = build();
    const config = { portal: PORTAL, vaultInitCodeHash: `0x${"ab".repeat(32)}` as Hex };

    expect(built.predictVault(config)).toBe(predictVaultAddress(built.hash().intentHash, config));
    expect(built.vault()).toBe(built.predictVault());
  });
});
