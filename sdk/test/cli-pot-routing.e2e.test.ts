/**
 * The Pot a command names decides the engine its cook names. On a chain as the live ones are after
 * kitchen-evm 1.4.0's rollout — an earlier release's Kitchen, engine and Pots, upgraded in place to
 * the release this SDK pins (`cli-anvil.ts#startChain(slug, { upgraded })`, which stands up
 * `evm/gated-engine.ts#startUpgradedChain`) — a Pot of kitchen-evm 1.3.0 cooks on engine 1.3.0 and a
 * Pot of 1.4.0 on engine 1.4.0: each engine refuses the other's Pots, with empty returndata, so a
 * cook that names the wrong one reverts. The compiler's output runs on both (`alsoRunsOn`).
 *
 *   - `sauce tx`, `simulate` and `run` on a 1.3.0 Pot named by address name its own engine;
 *   - `--owner` means the owner's deployed 1.3.0 Pot at that salt, the oldest release's, even once
 *     a 1.4.0 Pot is deployed there too, and the 1.4.0 Pot for an owner with none (D1);
 *   - offline, a Pot named by address takes its engine from the Pot store's record of that Pot, else
 *     engine 1.4.0 with a note (D2); an owner's Pot is the 1.4.0 one, and a record of an earlier
 *     Pot for the owner is refused until the user names a Pot (`cli-pot-offline.test.ts` holds
 *     the rule on its own, with no chain); online the chain decides whatever the store holds;
 *   - a wallet whose policy names only its 1.3.0 Pot signs for it, before and without anything being
 *     read that could refuse it for the Pot an offline guess would have named first.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and on the earlier release's artifacts, which
 * `sync-engine-artifacts` writes to `src/artifacts/legacy`: a hard failure without either in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { PotStore } from "../src/cli/pot-store.js";
import { evmRelease } from "../src/cli/pots.js";
import { WalletStore } from "../src/cli/wallets.js";
import {
  sdkCompilerVersion,
  v12EngineAddress,
  v12KitchenAddress,
  v12ReleaseSet,
} from "../src/deployments/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import { signedCookTypedData, v12KitchenAbi, v12PotAbi } from "../src/evm/engine.js";
import {
  DEPLOYER,
  DEPLOYER_KEY,
  describeEvm,
  interceptingEndpoint,
  jsonOf,
  OTHER_KEY,
  sauceWith,
  startChain,
  type LocalChain,
  type Run,
} from "./cli-anvil.js";
import { hasLegacyArtifacts, NEW_POT_SALT, POT_SALT } from "./evm/gated-engine.js";
import { legacyRow } from "./release-arm.js";

if (!hasLegacyArtifacts("evm", "1.3.0") && process.env.CI) {
  throw new Error(
    "the earlier release's artifacts (src/artifacts/legacy) are missing in CI. This suite must " +
      'never skip here — see the "Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}
const describeUpgraded = hasLegacyArtifacts("evm", "1.3.0") ? describeEvm : describe.skip;

/** Runs on the Pot and returns 7: the Pots hold no native coin, so any engine that runs it says so. */
const PROGRAM = "function main(): Uint256 {\n  return ctx.selfBalance() + 7;\n}\n";
const OTHER = privateKeyToAccount(OTHER_KEY);
const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

/** The engine a `cook(engine, program)` names. */
const engineOf = (data: Hex): Address =>
  getAddress((decodeFunctionData({ abi: v12PotAbi, data }).args as readonly [Address, Hex])[0]);

interface Tx {
  readonly to: Address;
  readonly data: Hex;
}
interface Plan {
  readonly pot: Address;
  readonly transactions: readonly Tx[];
}

describeUpgraded("each Pot cooks on its own engine", () => {
  let local: LocalChain;
  let work: string;
  let program: string;
  /** A wallet: its Pot is kitchen-evm 1.3.0's, minted before the upgrade. */
  let agent: Address;
  const kitchen = getAddress(v12KitchenAddress());
  const engine = getAddress(v12EngineAddress());

  const walletsDir = (): string => join(work, "wallets");
  const sauce = (...argv: string[]): Promise<Run> => sauceWith({}, ...argv);
  /** The legacy Pot of `owner`, minted at `POT_SALT` before the upgrade. */
  const legacyPot = (owner: Address): Address => local.legacy!.pots[getAddress(owner)]!;
  const rpc = (): string[] => ["--rpc-url", local.rpcUrl];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-routing-e2e-"));
    program = join(work, "seven.sauce.ts");
    writeFileSync(program, PROGRAM);
    const { info } = await new WalletStore(walletsDir()).create("agent", "evm", PASSWORD);
    agent = getAddress(info.address);
    local = await startChain("base", { upgraded: true, legacyOwners: [OTHER.address, agent] });
  }, 180_000);

  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  describe("a Pot named by address", () => {
    it("sauce tx, simulate and run on a 1.3.0 Pot name its own engine", async () => {
      const { legacy } = local;
      const pot = legacy!.pot;
      expect(pot).toBe(
        getAddress(
          v12PredictPot(DEPLOYER.address, POT_SALT, {
            compiler: legacyRow("evm", "1.3.0").compiler,
          }),
        ),
      );
      expect(legacy!.engine).not.toBe(engine);

      const tx = await sauce("tx", program, "--chain", "base", "--pot", pot, ...rpc());
      expect(tx.code).toBe(0);
      const planned = JSON.parse(tx.stdout) as Tx;
      expect(getAddress(planned.to)).toBe(pot);
      expect(engineOf(planned.data)).toBe(getAddress(legacy!.engine));
      expect(tx.stderr).toContain("kitchen-evm 1.3.0");
      expect(tx.stderr).toContain(`its own engine, ${getAddress(legacy!.engine)}`);

      const simulated = jsonOf(
        await sauce("simulate", program, "--chain", "base", "--pot", pot, "--json", ...rpc()),
      );
      expect(simulated).toMatchObject({ ok: true, returned: "7" });

      // Sent from the Pot's owner: it cooks on engine 1.3.0, and what lands is a cook on that engine.
      const run = await sauce(
        ...["run", program, "--chain", "base", "--pot", pot, "--yes", ...rpc()],
        ...["--private-key", DEPLOYER_KEY, "--json"],
      );
      expect(run.code).toBe(0);
      const sent = jsonOf(run) as { cook: { hash: Hex; status: string } };
      expect(sent.cook.status).toBe("success");
      const landed = await local.publicClient.getTransaction({ hash: sent.cook.hash });
      expect(getAddress(landed.to!)).toBe(pot);
      expect(engineOf(landed.input)).toBe(getAddress(legacy!.engine));
    }, 180_000);

    it("a 1.4.0 Pot of the same chain names the 1.4.0 engine, with no earlier-release note", async () => {
      const pot = getAddress(v12PredictPot(DEPLOYER.address, NEW_POT_SALT));
      const tx = await sauce("tx", program, "--chain", "base", "--pot", pot, ...rpc());
      expect(tx.code).toBe(0);
      expect(engineOf((JSON.parse(tx.stdout) as Tx).data)).toBe(engine);
      expect(tx.stderr).not.toContain("kitchen-evm 1.3.0");
      expect(
        jsonOf(
          await sauce("simulate", program, "--chain", "base", "--pot", pot, "--json", ...rpc()),
        ),
      ).toMatchObject({ ok: true, returned: "7" });
    }, 120_000);
  });

  describe("a Pot named by its owner", () => {
    const salt = ["--salt-hex", POT_SALT];

    it("--owner resolves to the deployed 1.3.0 Pot, and to the 1.4.0 Pot once there is none", async () => {
      const first = await sauce(
        "tx",
        program,
        "--chain",
        "base",
        "--owner",
        OTHER.address,
        ...salt,
        ...rpc(),
      );
      expect(first.code).toBe(0);
      const earlier = JSON.parse(first.stdout) as Tx;
      expect(getAddress(earlier.to)).toBe(legacyPot(OTHER.address));
      expect(engineOf(earlier.data)).toBe(getAddress(local.legacy!.engine));
      expect(first.stderr).toContain("kitchen-evm 1.3.0");
      expect(first.stderr).toContain("needs another salt");
      // …and says why to move: the newer engine checks signatures and clears reused memory more
      // strictly, which a 1.3.0 Pot's engine does not.
      expect(first.stderr).toContain(
        "whose engine checks signatures and clears reused memory more strictly",
      );

      // The 1.4.0 Pot of the same owner and salt, deployed by anyone: the oldest Pot still wins, as
      // a funded Pot must never be displaced by one another account deployed.
      const newer = getAddress(v12PredictPot(OTHER.address, POT_SALT));
      expect(newer).not.toBe(legacyPot(OTHER.address));
      await local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({
          abi: v12KitchenAbi,
          functionName: "deployPot",
          args: [OTHER.address, POT_SALT],
        }),
      );
      expect(await local.publicClient.getCode({ address: newer })).toBeDefined();
      const again = await sauce(
        "tx",
        program,
        "--chain",
        "base",
        "--owner",
        OTHER.address,
        ...salt,
        ...rpc(),
      );
      expect(getAddress((JSON.parse(again.stdout) as Tx).to)).toBe(legacyPot(OTHER.address));

      // An owner with no Pot there: the 1.4.0 Pot, planned with its deployment, on engine 1.4.0.
      const fresh = privateKeyToAccount(generatePrivateKey()).address;
      const planned = await sauce(
        "tx",
        program,
        "--chain",
        "base",
        "--owner",
        fresh,
        ...salt,
        ...rpc(),
      );
      expect(planned.code).toBe(0);
      const plan = JSON.parse(planned.stdout) as Plan;
      expect(plan.pot).toBe(getAddress(v12PredictPot(fresh, POT_SALT)));
      expect(plan.transactions).toHaveLength(2);
      expect(getAddress(plan.transactions.at(-1)!.to)).toBe(plan.pot);
      expect(engineOf(plan.transactions.at(-1)!.data)).toBe(engine);
      expect(planned.stderr).not.toContain("needs another salt");
    }, 180_000);
  });

  describe("offline", () => {
    const offline = (pots: string, ...argv: string[]): Promise<Run> =>
      sauceWith(
        { potsDir: pots },
        "tx",
        program,
        "--chain",
        "base",
        "--offline",
        "--value",
        "0",
        ...argv,
      );

    it("a record names the engine of the Pot it is of, and an owner's Pot only with a chain to say; else the 1.4.0 engine", async () => {
      const recorded = join(work, "recorded");
      const empty = join(work, "empty");
      const { pot, engine: legacyEngine } = local.legacy!;
      const owner = DEPLOYER.address;
      const imported = await sauceWith(
        { potsDir: recorded },
        ...["pot", "import", "--pot", pot, "--chain", "base"],
        ...rpc(),
      );
      expect(imported.code).toBe(0);
      expect(new PotStore(recorded).list().pots).toEqual([
        expect.objectContaining({ pot, engine: getAddress(legacyEngine) }),
      ]);

      // Recorded: the cook names the Pot's own engine, by address and by owner and salt.
      const byPot = await offline(recorded, "--pot", pot);
      expect(byPot.code).toBe(0);
      expect(engineOf((JSON.parse(byPot.stdout) as Tx).data)).toBe(getAddress(legacyEngine));
      expect(byPot.stderr).toContain("the Pot store records");
      // The record is no evidence the Pot is on this chain (the store keeps fork deployments too),
      // so --owner builds nothing for it, nor for the CREATE3 Pot: the user names one, or gives an
      // endpoint (cook-pot.ts#refuseUnchosen).
      const byOwner = await offline(recorded, "--owner", owner, "--salt-hex", POT_SALT);
      expect(byOwner.code).toBe(1);
      expect(byOwner.stdout).toBe("");
      expect(byOwner.stderr).toContain(join(recorded, "8453", `${pot.toLowerCase()}.json`));
      expect(byOwner.stderr).toContain(pot);
      expect(byOwner.stderr).toContain(getAddress(v12PredictPot(owner, POT_SALT)));
      expect(byOwner.stderr).toContain(
        "Nothing offline can tell whether that record landed on base itself or on a fork",
      );
      // Online, with that store, the chain decides, as ever: the owner's deployed 1.3.0 Pot.
      const onChain = await sauceWith(
        { potsDir: recorded },
        ...["tx", program, "--chain", "base", "--owner", owner, "--salt-hex", POT_SALT],
        ...rpc(),
      );
      expect(onChain.code).toBe(0);
      const chosen = JSON.parse(onChain.stdout) as Tx;
      expect(getAddress(chosen.to)).toBe(pot);
      expect(engineOf(chosen.data)).toBe(getAddress(legacyEngine));
      expect(onChain.stderr).toContain("needs another salt");

      // Not recorded: the 1.4.0 engine, and the note says what an offline cook cannot know.
      const unknown = await offline(empty, "--pot", pot);
      expect(unknown.code).toBe(0);
      expect(engineOf((JSON.parse(unknown.stdout) as Tx).data)).toBe(engine);
      expect(unknown.stderr).toContain(
        `The cook names the current release's engine, ${engine}: offline, nothing says which ` +
          `release minted ${pot}, and the Pot store holds no record of it.`,
      );
      const guessed = await offline(empty, "--owner", owner, "--salt-hex", POT_SALT);
      expect(guessed.code).toBe(0);
      const prediction = JSON.parse(guessed.stdout) as Tx;
      expect(getAddress(prediction.to)).toBe(getAddress(v12PredictPot(owner, POT_SALT)));
      expect(engineOf(prediction.data)).toBe(engine);
      expect(guessed.stderr).toContain(
        `Offline, this is the current release's Pot for this owner and salt (CREATE3, kitchen-evm ${v12ReleaseSet()["kitchen-evm"].version})`,
      );
    }, 180_000);

    it("a record of a Pot that is not on this chain changes nothing online: the chain decides (D1)", async () => {
      // What SDK 1.1.0 recorded for a deployment that landed on a fork with this chain's id.
      const fresh = privateKeyToAccount(generatePrivateKey()).address;
      const earlier = getAddress(
        v12PredictPot(fresh, POT_SALT, { compiler: legacyRow("evm", "1.3.0").compiler }),
      );
      expect(await local.publicClient.getCode({ address: earlier })).toBeUndefined();
      const forkOnly = join(work, "fork-only");
      new PotStore(forkOnly).save({
        schema: "sauce.pot/1",
        chain: "base",
        chainId: local.chain.id,
        pot: earlier,
        owner: fresh,
        salt: POT_SALT,
        kind: "private",
        kitchen,
        potInitCodeHash: legacyRow("evm", "1.3.0")["kitchen-evm"].potInitCodeHash!,
        engine: getAddress(local.legacy!.engine),
        release: evmRelease(legacyRow("evm", "1.3.0")),
        sdk: "1.1.0",
        origin: "deployed",
        deployment: {
          tx: `0x${"11".repeat(32)}`,
          block: "39000000",
          blockHash: `0x${"22".repeat(32)}`,
          from: fresh,
        },
        recordedAt: "2026-11-19T10:00:00.000Z",
      });
      // Offline nothing says whether the record is the chain's: nothing is built.
      const refused = await offline(forkOnly, "--owner", fresh, "--salt-hex", POT_SALT);
      expect(refused.code).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain(earlier);
      // Online the chain says no Pot is there, so the owner's Pot is the 1.4.0 one, with its
      // deployment planned first and the cook on engine 1.4.0, and the record is not mentioned.
      const online = await sauceWith(
        { potsDir: forkOnly },
        ...["tx", program, "--chain", "base", "--owner", fresh, "--salt-hex", POT_SALT],
        ...rpc(),
      );
      expect(online.code).toBe(0);
      const plan = JSON.parse(online.stdout) as Plan;
      expect(plan.pot).toBe(getAddress(v12PredictPot(fresh, POT_SALT)));
      expect(plan.transactions).toHaveLength(2);
      expect(engineOf(plan.transactions.at(-1)!.data)).toBe(engine);
      expect(online.stderr).not.toContain("needs another salt");
      expect(online.stderr).not.toContain(earlier);
    }, 120_000);
  });

  describe("a wallet whose policy names only its 1.3.0 Pot", () => {
    const policy = (fields: Record<string, unknown>) =>
      writeFileSync(join(walletsDir(), "agent.policy.json"), JSON.stringify(fields), {
        mode: 0o600,
      });
    /** `sauce sign` from the wallet, the Pot its owner's at POT_SALT unless the flags name one. */
    const signing = (pots: string, ...flags: string[]): Promise<Run> =>
      sauceWith(
        {
          potsDir: pots,
          walletsDir: walletsDir(),
          readEnv: (name) => (name === "SAUCE_TEST_SIGN_PW" ? PASSWORD : undefined),
        },
        ...["sign", program, "--chain", "base", "--wallet", "agent"],
        ...["--password-env", "SAUCE_TEST_SIGN_PW", "--max-fee", "1"],
        ...(flags.includes("--pot") ? [] : ["--salt-hex", POT_SALT]),
        ...["--json", ...flags],
      );

    it("signs for it with an empty Pot store, and refuses what the policy forbids before reading", async () => {
      const pot = legacyPot(agent);
      const empty = join(work, "empty-signing");
      policy({ chains: ["base"], to: [pot.toLowerCase()] });

      // Online: the chain finds the 1.3.0 Pot, which the policy names, and the cook is signed for it.
      const online = await signing(empty, ...rpc());
      expect(online.code).toBe(0);
      const signed = JSON.parse(online.stdout) as {
        pot: Address;
        engine: Address;
        program: Hex;
        value: string;
        maxExecutionFee: string;
        nonce: string;
        deadline: string;
        submitter: Address;
        signature: Hex;
      };
      expect(signed.pot).toBe(pot);
      expect(getAddress(signed.engine)).toBe(getAddress(local.legacy!.engine));
      const execution = {
        chainId: local.chain.id,
        pot,
        engine: signed.engine,
        program: signed.program,
        value: BigInt(signed.value),
        maxExecutionFee: BigInt(signed.maxExecutionFee),
        nonce: BigInt(signed.nonce),
        deadline: BigInt(signed.deadline),
        submitter: signed.submitter,
      };
      expect(
        await recoverTypedDataAddress({
          ...signedCookTypedData(execution),
          signature: signed.signature,
        }),
      ).toBe(agent);
      expect(online.stderr).toContain("kitchen-evm 1.3.0");

      // Offline with that store empty, nothing can see the older Pot: the Pot this SDK would deploy
      // is the one named, and the policy refuses it (the D1 rule).
      const guessed = await signing(empty, "--offline");
      expect(guessed.code).toBe(1);
      expect(guessed.stderr).toContain("refused by the policy of wallet agent");
      expect(guessed.stderr).toContain(
        `to allows 1 address(es), and this cook runs on Pot ${getAddress(v12PredictPot(agent, POT_SALT))}`,
      );

      // Recorded, offline still cannot tell the record from a fork's: the wallet is the owner, so
      // nothing is signed for either Pot, and the message names the record...
      const imported = await sauceWith(
        { potsDir: empty },
        ...["pot", "import", "--pot", pot, "--chain", "base"],
        ...rpc(),
      );
      expect(imported.code).toBe(0);
      const unchosen = await signing(empty, "--offline");
      expect(unchosen.code).toBe(1);
      expect(unchosen.stdout).toBe("");
      expect(unchosen.stderr).toContain(join(empty, "8453", `${pot.toLowerCase()}.json`));
      expect(unchosen.stderr).toContain(
        "Nothing offline can tell whether that record landed on base itself or on a fork",
      );
      // ...until the user names the Pot: its recorded engine, and the policy names that Pot.
      const known = await signing(empty, "--offline", "--pot", pot);
      expect(known.code).toBe(0);
      const offline = JSON.parse(known.stdout) as { pot: Address; engine: Address };
      expect(offline.pot).toBe(pot);
      expect(getAddress(offline.engine)).toBe(getAddress(local.legacy!.engine));

      // A limit the policy cannot hold a signed cook to is refused before anything is read: not one
      // request reaches the chain.
      policy({ native: { perTransaction: "0.01" }, to: [pot.toLowerCase()] });
      let requests = 0;
      const watched = await interceptingEndpoint(local.rpcUrl, async () => {
        requests++;
      });
      try {
        const refused = await signing(empty, "--rpc-url", watched.url);
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("native is limited");
        expect(requests).toBe(0);
      } finally {
        await watched.stop();
      }
    }, 180_000);
  });
});

if (!hasLegacyArtifacts("evm", "1.4.0") && process.env.CI) {
  throw new Error(
    "the 1.4.0 release's artifacts (src/artifacts/legacy) are missing in CI. This suite must " +
      'never skip here — see the "Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}
const describeSwitched = hasLegacyArtifacts("evm", "1.4.0") ? describeEvm : describe.skip;

describeSwitched(
  "a fixed-Router or Shared Pot minted before the Router switch cooks on engine 1.4.0",
  () => {
    // The release the chain ran before its switch, and the one it runs now: each Router has the engine
    // built for it, and a fixed-Router or Shared Pot cooks only on the engine of the Router it has.
    const earlier = v12ReleaseSet("2.6.3");
    const R1 = getAddress(earlier["kitchen-evm"].fixedRouter!);
    const R2 = getAddress(v12ReleaseSet()["kitchen-evm"].fixedRouter!);
    const E1 = getAddress(earlier["v12-evm"].engine!);
    const E2 = getAddress(v12EngineAddress());
    let local: LocalChain;
    let work: string;
    let program: string;
    const rpc = (): string[] => ["--rpc-url", local.rpcUrl];
    const sauce = (...argv: string[]): Promise<Run> => sauceWith({}, ...argv);
    /** `sauce tx` of the program on `pot`: the engine its cook names, and the run. */
    const txOn = async (
      pot: Address,
      ...extra: string[]
    ): Promise<{ engine: Address; run: Run }> => {
      const run = await sauce("tx", program, "--chain", "base", "--pot", pot, ...extra, ...rpc());
      expect(run.code).toBe(0);

      return { engine: engineOf((JSON.parse(run.stdout) as Tx).data), run };
    };

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), "sauce-pot-routing-switched-"));
      program = join(work, "seven.sauce.ts");
      writeFileSync(program, PROGRAM);
      local = await startChain("base", { upgraded: true, from: "1.4.0" });
    }, 180_000);

    afterAll(async () => {
      await local?.stop();
      if (work !== undefined) rmSync(work, { recursive: true, force: true });
    });

    it("each Pot's Router is the one it was minted with, and the Kitchen hands out the new one", async () => {
      const router = (pot: Address) =>
        local.publicClient.readContract({ address: pot, abi: v12PotAbi, functionName: "router" });
      const { legacy } = local;
      expect(await router(legacy!.pot)).toBe(R1);
      expect(await router(legacy!.fixedPot!)).toBe(R1);
      expect(await router(legacy!.sharedPot!)).toBe(R1);
      expect(await router(local.fixedPot!)).toBe(R2);
      expect(await router(local.sharedPot!)).toBe(R2);
      expect(
        await local.publicClient.readContract({
          address: getAddress(v12KitchenAddress()),
          abi: v12KitchenAbi,
          functionName: "router",
        }),
      ).toBe(R2);
    });

    it("simulates and plans a cook on a Pot of the old Router on engine 1.4.0, and says why", async () => {
      const pot = local.legacy!.fixedPot!;
      const simulated = await sauce(
        "simulate",
        program,
        "--chain",
        "base",
        "--pot",
        pot,
        "--json",
        ...rpc(),
      );
      expect(jsonOf(simulated)).toMatchObject({ ok: true, returned: "7" });
      for (const run of [simulated, (await txOn(pot)).run]) {
        expect(run.stderr).toContain(
          `Pot ${pot} is a fixed-Router Pot whose Router, ${R1}, was fixed when it was minted`,
        );
        expect(run.stderr).toContain(`runs only on the engine built for that Router, ${E1}`);
      }
      expect((await txOn(pot)).engine).toBe(E1);
      // A Shared Pot minted before the switch is the same.
      const shared = await txOn(local.legacy!.sharedPot!);
      expect(shared.engine).toBe(E1);
      expect(shared.run.stderr).toContain("is a Shared Pot whose Router");
    }, 180_000);

    it("a Pot minted after the switch names engine 1.5.0, with no such note", async () => {
      for (const pot of [local.fixedPot!, local.sharedPot!]) {
        const { engine, run } = await txOn(pot);
        expect(engine).toBe(E2);
        expect(run.stderr).not.toContain("was fixed when it was minted");
      }
      expect(
        jsonOf(
          await sauce(
            "simulate",
            program,
            "--chain",
            "base",
            "--pot",
            local.fixedPot!,
            "--json",
            ...rpc(),
          ),
        ),
      ).toMatchObject({ ok: true, returned: "7" });
      // A dynamic Pot cooks on the installed engine whatever Router it has: the Pot's own is storage.
      expect((await txOn(local.legacy!.pot)).engine).toBe(E2);
    }, 180_000);

    it("imports a Pot with the engine its Router needs, and offline the record decides only for it", async () => {
      const pot = local.legacy!.fixedPot!;
      const recorded = join(work, "recorded");
      const imported = await sauceWith(
        { potsDir: recorded },
        ...["pot", "import", "--pot", pot, "--chain", "base"],
        ...rpc(),
      );
      expect(imported.code).toBe(0);
      expect(new PotStore(recorded).list().pots).toEqual([
        expect.objectContaining({
          pot,
          kind: "private-fixed-router",
          engine: E1,
          release: {
            compiler: sdkCompilerVersion(),
            "v12-evm": "1.4.0",
            "kitchen-evm": "1.4.0",
          },
        }),
      ]);
      const offline = (pots: string) =>
        sauceWith(
          { potsDir: pots },
          ...["tx", program, "--chain", "base", "--offline", "--value", "0", "--pot", pot],
        );
      const known = await offline(recorded);
      expect(known.code).toBe(0);
      expect(engineOf((JSON.parse(known.stdout) as Tx).data)).toBe(E1);
      // No record: the installed engine, which a Pot of the old Router would refuse, and the note
      // says so.
      const unknown = await offline(join(work, "empty"));
      expect(unknown.code).toBe(0);
      expect(engineOf((JSON.parse(unknown.stdout) as Tx).data)).toBe(E2);
      expect(unknown.stderr).toContain(
        "A fixed-Router or Shared Pot runs only on the engine built for its Router.",
      );
    }, 180_000);

    it("sauce pot tells a dynamic Pot its Router, and why a pool calling a newer name cannot pay it", async () => {
      const status = (salt: Hex) =>
        sauce("pot", "--owner", DEPLOYER.address, "--salt-hex", salt, "--chain", "base", ...rpc());
      const before = await status(POT_SALT);
      expect(jsonOf(before)).toMatchObject({ pot: local.legacy!.pot, router: R1 });
      expect(before.stderr).toContain(
        `Pot ${local.legacy!.pot} runs the Router ${R1}, not the one this chain's Kitchen now gives ` +
          `new Pots, ${R2}`,
      );
      expect(before.stderr).toContain("hyperswapV3SwapCallback");

      const after = await status(NEW_POT_SALT);
      expect(jsonOf(after)).toMatchObject({ router: R2 });
      expect(after.stderr).not.toContain("runs the Router");
      // Nothing it says moves a Pot: the Kitchen cannot, and the owner's call is no advice of ours.
      expect(before.stderr + after.stderr).not.toContain("setRouter");
    }, 120_000);
  },
);
