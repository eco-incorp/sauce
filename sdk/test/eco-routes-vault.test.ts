/**
 * The SDK's offline vault prediction for an eco-routes Portal, held to what the deployed Portals
 * themselves answer.
 *
 * A funder that pays an intent's vault directly — the default way the SDK funds one — sends tokens
 * to an address the SDK computed. Nothing on chain checks that address before the tokens leave, so
 * it has to be right before anything is sent: `ecoRoutesVaultConfig(portal)` must give every
 * registry Portal's real `intentVaultAddress`. `fixtures/eco-routes-vaults.json` is what each one
 * returned for a fixed probe intent (`scripts/capture-eco-routes-vaults.mjs`); this suite requires
 * the prediction to equal every answer, and every Portal the registry carries on an EVM chain to have
 * been asked. A registry update that adds a Portal fails here until it is captured.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, getContractAddress, type Hex } from "viem";

import { resolveChain } from "../src/chains/canonical.js";
import { ECO_ROUTES_ADDRESSES } from "../src/protocols/eco-routes/addresses.generated.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesVaultImplementationOf,
} from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import {
  ECO_ROUTES_VAULT_PROXY_CREATION_CODE,
  ecoRoutesVaultConfig,
  predictVaultAddress,
  vaultInitCodeHash,
} from "../src/routes/vault.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Captured {
  readonly probe: {
    readonly destination: string;
    readonly route: {
      readonly salt: Hex;
      readonly deadline: string;
      readonly portal: Hex;
      readonly nativeAmount: string;
      readonly tokens: readonly never[];
      readonly calls: readonly never[];
    };
    readonly reward: {
      readonly deadline: string;
      readonly creator: Hex;
      readonly prover: Hex;
      readonly nativeAmount: string;
      readonly tokens: readonly { readonly token: Hex; readonly amount: string }[];
    };
  };
  readonly intentHash: Hex;
  readonly vaults: readonly {
    readonly chainId: number;
    readonly environment: string;
    readonly portal: Hex;
    readonly vault: Hex;
    readonly embedsProxyCreationCode: boolean;
  }[];
  readonly uncaptured: Readonly<Record<string, string>>;
}

const CAPTURED = JSON.parse(
  readFileSync(join(HERE, "fixtures/eco-routes-vaults.json"), "utf8"),
) as Captured;
const PORTAL_FIXTURE = JSON.parse(readFileSync(join(HERE, "evm/fixtures/Portal.json"), "utf8")) as {
  creationCode: Hex;
};

describe("an eco-routes Portal's vaults, predicted offline", () => {
  it("rebuilds the probe intent the capture asked about", () => {
    const { probe } = CAPTURED;
    const intent = {
      destination: BigInt(probe.destination),
      sourceChainId: 1n,
      route: normalizeRoute({
        ...probe.route,
        deadline: BigInt(probe.route.deadline),
        nativeAmount: BigInt(probe.route.nativeAmount),
      }),
      reward: normalizeReward({
        ...probe.reward,
        deadline: BigInt(probe.reward.deadline),
        nativeAmount: BigInt(probe.reward.nativeAmount),
        tokens: probe.reward.tokens.map((t) => ({ token: t.token, amount: BigInt(t.amount) })),
      }),
    };

    expect(hashIntent(intent).intentHash).toBe(CAPTURED.intentHash);
  });

  it.each(CAPTURED.vaults.map((v) => [`${v.chainId} ${v.environment}`, v] as const))(
    "%s: the prediction is the vault the deployed Portal reported",
    (_, captured) => {
      expect(predictVaultAddress(CAPTURED.intentHash, ecoRoutesVaultConfig(captured.portal))).toBe(
        getAddress(captured.vault),
      );
      // The Proxy the vault is a clone of is the one the SDK records, in that Portal's own code.
      expect(captured.embedsProxyCreationCode).toBe(true);
    },
  );

  it("covers every Portal the registry carries on an EVM chain", () => {
    const asked = new Set(CAPTURED.vaults.map((v) => `${v.chainId}:${getAddress(v.portal)}`));
    const missing: string[] = [];
    const registered = new Set<string>();
    for (const [id, environments] of Object.entries(ECO_ROUTES_ADDRESSES.v3.chains)) {
      if (resolveChain(Number(id))?.kind !== "evm") continue;
      for (const roles of Object.values(environments as Record<string, Record<string, Hex>>)) {
        if (roles.Portal === undefined) continue;
        const key = `${id}:${getAddress(roles.Portal)}`;
        registered.add(key);
        if (!asked.has(key) && CAPTURED.uncaptured[key] === undefined) missing.push(key);
      }
    }

    expect(missing).toEqual([]);
    // An exception for a Portal the registry no longer carries is stale.
    expect(Object.keys(CAPTURED.uncaptured).filter((key) => !registered.has(key))).toEqual([]);
  });

  it("derives the implementation as the Portal's first CREATE, beside the Executor's second", () => {
    const portal = "0xEC000064576f9C95a8623Bc0eff3db6d296ea6df" as const;

    expect(ecoRoutesVaultImplementationOf(portal)).toBe(
      getContractAddress({ from: portal, nonce: 1n, opcode: "CREATE" }),
    );
    expect(ecoRoutesExecutorOf(portal)).toBe(
      getContractAddress({ from: portal, nonce: 2n, opcode: "CREATE" }),
    );
    expect(ecoRoutesVaultConfig(portal)).toEqual({
      portal,
      vaultInitCodeHash: vaultInitCodeHash(
        ECO_ROUTES_VAULT_PROXY_CREATION_CODE,
        ecoRoutesVaultImplementationOf(portal),
      ),
      prefix: "0xff",
    });
  });

  it("is the Proxy the vendored eco-routes Portal build carries", () => {
    // `routes-nest-dynamic.e2e.test.ts` deploys this build and asks it for a vault; here, only that
    // the bytes the SDK records are the ones it was compiled with, once.
    const code = PORTAL_FIXTURE.creationCode.toLowerCase();
    const proxy = ECO_ROUTES_VAULT_PROXY_CREATION_CODE.slice(2).toLowerCase();

    expect(code.split(proxy)).toHaveLength(2);
  });
});
