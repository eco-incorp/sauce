/**
 * The Pot a command cooks on, deploys or signs for is checked against the chain before anything is
 * simulated, built or sent. Compiler output pairs with an engine by exact version, so the Pot must
 * be one of the release this SDK pins:
 *
 *   - a deployed Pot's release is told from the chain as `pots.ts` tells it (its owner, salt and
 *     Kitchen read off it, its address that Kitchen's CREATE2 under a release's Pot init-code hash),
 *     and a Pot of another release, or of none this SDK knows, is refused;
 *   - for a Pot not deployed yet, the deployed Kitchen's own `predictPot(owner, salt)` must be where
 *     this SDK deploys it. An SDK that predicts a Pot address the live Kitchen does not, as 0.99.15
 *     did after the Kitchen's upgrade to kitchen-evm 1.3.0, sends its cook to an address with no
 *     code, where it "succeeds", runs nothing and keeps the cook's value.
 *
 * A refusal names the release the deployed Kitchen mints (its `potInitCodeHash()`): its compiler and
 * the SDK versions that pair with it, or that the Kitchen is newer than this SDK. Where the command
 * keeps the Pot store, it lists the owner's other Pots on the chain, each with its release; and it
 * names the address this SDK deploys the Pot at under its own release.
 *
 * On a local anvil with the released gated stack (`cli-anvil.ts`), the Kitchen proxy pointed at
 * `MispredictingKitchen` or `OldPotDeployer` for a while (`evm/kitchen-releases.ts`). `sendAndWait`,
 * which every send passes, refuses the same; the normal path is what it was; and offline, where
 * nothing can be checked, the command says so.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI. The offline half needs no chain.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeFunctionData,
  getAddress,
  parseEther,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { Approver } from "../src/cli/approvals.js";
import { CliError } from "../src/cli/args.js";
import { requireKitchenPredicts, requireReleasePot, sendAndWait } from "../src/cli/chain.js";
import { runCommand, type RunInput } from "../src/cli/commands.js";
import { fundingFor } from "../src/cli/inputs.js";
import { keeping } from "../src/cli/keep.js";
import { PotStore, type PotRecord } from "../src/cli/pot-store.js";
import { nodeIo, type CliIo } from "../src/cli/run.js";
import { v12EngineAddress, v12KitchenAddress, v12ReleaseSet } from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12KitchenAbi, v12PotAbi } from "../src/evm/engine.js";
import {
  describeEvm,
  erc20,
  fixture,
  jsonOf,
  laggingEndpoint,
  registered,
  sauce,
  sauceWith,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import {
  ELSEWHERE,
  mintOldReleasePot,
  OLD_RELEASE,
  plantMispredictingKitchen,
  UNKNOWN_POT_HASH,
  withKitchenImplementation,
} from "./evm/kitchen-releases.js";

/** A program that needs no token: what is under test is the Pot it runs on. */
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

/** No terminal, and nothing to answer: what a pipe, CI or an agent's shell gives the command. */
const NO_TERMINAL: Partial<CliIo> = { canAsk: () => false, confirm: async () => undefined };

/** What every refusal of a Kitchen that puts a Pot elsewhere says. */
const MISMATCH = /this SDK does not match the deployed Kitchen/;
/** What a refusal says of a Kitchen whose release no row of this SDK records. */
const NEWER = /the Kitchen is newer than this SDK/;
const UPGRADE = /Upgrade @eco-incorp\/sauce \(sauce update\)/;

/** A release set as a refusal names it. */
const releaseOf = (set: typeof OLD_RELEASE): string =>
  `compiler ${set.compiler} (v12-evm ${set["v12-evm"].version}, kitchen-evm ${set["kitchen-evm"].version})`;
/** The release this SDK pins. */
const OWN = releaseOf(v12ReleaseSet());
/** kitchen-evm 1.2.0's release, and the SDK releases that pinned it (`docs/changelog.md`). */
const OLD = releaseOf(OLD_RELEASE);
const OLD_SDKS = "@eco-incorp/sauce 0.99.9 to 0.99.15";

describeEvm("the Pot is checked against the chain", () => {
  let local: LocalChain;
  let work: string;
  let program: string;
  /** Kitchen implementations that put every Pot elsewhere: one newer than this SDK, one older. */
  let newer: Address;
  let older: Address;
  /** USDC at its registry address, which `--fund` moves. */
  let usdc: Address;
  const kitchen = getAddress(v12KitchenAddress());

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-e2e-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
    local = await startChain("ethereum");
    newer = await plantMispredictingKitchen(local, UNKNOWN_POT_HASH);
    older = await plantMispredictingKitchen(
      local,
      OLD_RELEASE["kitchen-evm"].potInitCodeHash as Hex,
    );
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  /** A test owner: its key and address, and the Pot its label names. */
  interface Owner {
    readonly key: Hex;
    readonly address: Address;
    readonly label: string;
    readonly salt: Hex;
    readonly pot: Address;
  }

  /** A fresh owner with ETH and no Pot. */
  async function owner(label: string): Promise<Owner> {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    await local.testClient.setBalance({ address, value: parseEther("10") });
    const salt = potSalt(label);

    return { key, address, label, salt, pot: getAddress(v12PredictPot(address, salt) as Address) };
  }

  /** Runs `body` with the Kitchen proxy delegating to `implementation`, checking it mispredicts. */
  async function whileMispredicting(implementation: Address, body: () => Promise<void>) {
    await withKitchenImplementation(local, implementation, async () => {
      const live = await local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictPot",
        args: [ELSEWHERE, potSalt("any")],
      });
      expect(getAddress(live)).toBe(ELSEWHERE);
      await body();
    });
  }

  /** `command` on `who`'s Pot, signing where the command signs, with `io` (a Pot store, say). */
  const command = (command: string, who: Owner, io: Partial<CliIo>, ...more: string[]) =>
    sauceWith(
      { ...NO_TERMINAL, ...io },
      ...(command === "pot"
        ? ["pot", "--chain", "ethereum", "--rpc-url", local.rpcUrl, "--owner", who.address]
        : command === "pot --deploy"
          ? ["pot", "--deploy", "--chain", "ethereum", "--rpc-url", local.rpcUrl]
          : [command, program, "--chain", "ethereum", "--rpc-url", local.rpcUrl]),
      ...(command === "run" || command === "sign" || command === "pot --deploy"
        ? ["--private-key", who.key]
        : command === "pot"
          ? []
          : ["--owner", who.address]),
      ...(command === "run" ? ["--yes"] : []),
      "--salt",
      who.label,
      ...(command.startsWith("pot") ? [] : ["--args", "41"]),
      ...more,
    );

  /** `command` on the Pot at `pot`, named by its address: `who` signs where the command signs. */
  const onPot = (command: string, who: Owner, pot: Address, io: Partial<CliIo> = {}) =>
    sauceWith(
      { ...NO_TERMINAL, ...io },
      ...[command, program, "--chain", "ethereum", "--rpc-url", local.rpcUrl, "--pot", pot],
      ...(command === "run"
        ? ["--private-key", who.key, "--yes"]
        : command === "sign"
          ? ["--private-key", who.key]
          : []),
      ...["--args", "41"],
    );

  /** Nothing was sent from `who`, it holds what it held, and nothing was deployed where it says. */
  async function nothingSent(who: Owner, balance: bigint, potCode: Hex | undefined) {
    expect(await local.publicClient.getTransactionCount({ address: who.address })).toBe(0);
    // As strings: a jest worker cannot report a bigint a failing expectation holds.
    expect(String(await local.publicClient.getBalance({ address: who.address }))).toBe(
      String(balance),
    );
    expect(await local.publicClient.getCode({ address: who.pot })).toBe(potCode);
    expect(await local.publicClient.getCode({ address: ELSEWHERE })).toBeUndefined();
  }

  /** Deploys `who`'s Pot of this release straight through the Kitchen, from the deployer. */
  const deployPot = (who: { readonly address: Address; readonly salt: Hex }) =>
    local.send(
      local.deployer,
      kitchen,
      encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "deployPot",
        args: [who.address, who.salt],
      }),
    );

  it("leaves the normal path as it was", async () => {
    const fresh = await owner("normal");
    for (const each of ["pot", "tx", "simulate", "sign"]) {
      const result = await command(each, fresh, {}, ...(each === "simulate" ? ["--json"] : []));
      if (result.code !== 0) {
        throw new Error(`${each} exited ${result.code}: ${result.stderr}${result.stdout}`);
      }
      if (each === "simulate") {
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, returned: "42" });
      }
    }
    const ran = await command("run", fresh, {}, "--json");
    expect(ran.code).toBe(0);
    expect(JSON.parse(ran.stdout)).toMatchObject({
      pot: fresh.pot,
      deployPot: { status: "success" },
      cook: { status: "success" },
    });
    // On the Pot it deployed, every command again, with the Pot named by owner and by address.
    for (const each of ["tx", "simulate", "sign", "run"]) {
      const result = await command(each, fresh, {}, ...(each === "tx" ? [] : ["--json"]));
      if (result.code !== 0) {
        throw new Error(`${each} exited ${result.code}: ${result.stderr}${result.stdout}`);
      }
    }
    expect((await onPot("tx", fresh, fresh.pot)).code).toBe(0);
  }, 180_000);

  it("cooks on a deployed Pot of this release whatever the Kitchen puts elsewhere now", async () => {
    const fresh = await owner("deployed-before");
    await deployPot(fresh);
    await whileMispredicting(newer, async () => {
      for (const each of ["tx", "simulate", "sign", "run"]) {
        const result = await command(each, fresh, {}, ...(each === "tx" ? [] : ["--json"]));
        if (result.code !== 0) {
          throw new Error(`${each} exited ${result.code}: ${result.stderr}${result.stdout}`);
        }
        if (each === "simulate") {
          expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, returned: "42" });
        }
      }
      expect((await onPot("tx", fresh, fresh.pot)).code).toBe(0);
    });
    // The cook `run` sent.
    expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(1);
  }, 180_000);

  it.each(["simulate", "tx", "run", "sign", "pot", "pot --deploy"])(
    "refuses %s for a Pot not deployed yet while the Kitchen mints a release newer than this SDK",
    async (each) => {
      const fresh = await owner(`undeployed-${each}`);
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await whileMispredicting(newer, async () => {
        const refused = await command(each, fresh, {});
        const said = refused.stdout + refused.stderr;
        expect(refused.code).toBe(1);
        expect(said).toMatch(MISMATCH);
        expect(said).toContain(
          `puts the Pot of owner ${fresh.address} and salt ${fresh.salt} at ${ELSEWHERE}, but ` +
            `this SDK has it at ${fresh.pot}`,
        );
        expect(said).toContain(
          `mints Pots under init-code hash ${UNKNOWN_POT_HASH}, which no release this SDK knows`,
        );
        expect(said).toMatch(NEWER);
        expect(said).toMatch(UPGRADE);
        expect(said).toContain(
          `Under its release, ${OWN}, this SDK deploys the Pot of owner ${fresh.address} and ` +
            `salt ${fresh.salt} at ${fresh.pot}`,
        );
        // No Pot store was kept, so none is listed.
        expect(said).not.toContain("The Pot store");
        await nothingSent(fresh, balance, undefined);
      });
    },
    120_000,
  );

  it("names the older release the Kitchen mints, and the SDK versions that pair with it", async () => {
    const fresh = await owner("kitchen-older");
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    await whileMispredicting(older, async () => {
      for (const each of ["tx", "run"]) {
        const refused = await command(each, fresh, {});
        const said = refused.stdout + refused.stderr;
        expect(refused.code).toBe(1);
        expect(said).toMatch(MISMATCH);
        expect(said).toContain(
          `The Kitchen ${kitchen} on ethereum mints Pots of ${OLD}, which ${OLD_SDKS} pair with`,
        );
        expect(said).not.toMatch(NEWER);
        expect(said).toContain(`Under its release, ${OWN}, this SDK deploys`);
      }
      await nothingSent(fresh, balance, undefined);
    });
  }, 120_000);

  describe("a Pot of another release", () => {
    let who: Owner;
    /** `who`'s kitchen-evm 1.2.0 Pot, at the salt its label names. */
    let old: Address;
    let pots: string;

    beforeAll(async () => {
      who = await owner("another release");
      old = await mintOldReleasePot(local, who.address, who.salt);
      pots = join(work, "another-release");
    }, 120_000);

    it("is imported with the release the chain says it is of", async () => {
      const imported = await sauceWith(
        { ...NO_TERMINAL, potsDir: pots },
        ...["pot", "import", "--chain", "ethereum", "--pot", old, "--rpc-url", local.rpcUrl],
        "--json",
      );
      expect(jsonOf(imported).pots).toEqual([
        expect.objectContaining({
          pot: old,
          owner: who.address,
          salt: who.salt,
          kind: "private",
          kitchen,
          potInitCodeHash: OLD_RELEASE["kitchen-evm"].potInitCodeHash,
          engine: getAddress(OLD_RELEASE["v12-evm"].engine!),
          release: {
            compiler: OLD_RELEASE.compiler,
            "v12-evm": OLD_RELEASE["v12-evm"].version,
            "kitchen-evm": OLD_RELEASE["kitchen-evm"].version,
          },
          origin: "imported",
        }),
      ]);
    }, 60_000);

    it.each(["tx", "simulate", "run", "sign"])(
      "refuses %s on it, naming its release as the chain tells it",
      async (each) => {
        const code = await local.publicClient.getCode({ address: old });
        const balance = await local.publicClient.getBalance({ address: who.address });
        // With the store that recorded it and without one: the chain tells its release either way.
        for (const io of [{ potsDir: pots }, {}]) {
          const refused = await onPot(each, who, old, io);
          const said = refused.stdout + refused.stderr;
          expect(refused.code).toBe(1);
          expect(said).toContain(
            `${old} on ethereum is a Pot of ${OLD}, which ${OLD_SDKS} pair with`,
          );
          expect(said).toContain(`The Kitchen ${kitchen} on ethereum mints Pots of ${OWN}`);
          expect(said).toContain(
            `Under its release, ${OWN}, this SDK deploys the Pot of owner ${who.address} and ` +
              `salt ${who.salt} at ${who.pot}`,
          );
          // The Pot refused is not one of the owner's OTHER Pots.
          expect(said).not.toMatch(new RegExp(`^ {2}${old}`, "m"));
        }
        expect(await local.publicClient.getCode({ address: old })).toBe(code);
        await nothingSent(who, balance, undefined);
      },
      120_000,
    );
  });

  it("lists the owner's other Pots from the Pot store, each with its release", async () => {
    const pots = join(work, "listed");
    const store = new PotStore(pots);
    const lister = await owner("listed");
    // Its Pot of an older release, minted as that release's Kitchen did and imported.
    const oldSalt = potSalt("listed old");
    const old = await mintOldReleasePot(local, lister.address, oldSalt);
    const imported = await sauceWith(
      { ...NO_TERMINAL, potsDir: pots },
      ...["pot", "import", "--chain", "ethereum", "--pot", old, "--rpc-url", local.rpcUrl],
    );
    expect(imported.code).toBe(0);
    // Its Pot of this release, which `sauce run` deploys and records.
    const current = await owner("listed current");
    const ran = await sauceWith(
      { ...NO_TERMINAL, potsDir: pots },
      ...["run", program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
      ...["--private-key", lister.key, "--yes", "--salt", current.label, "--args", "41"],
    );
    if (ran.code !== 0) throw new Error(`run exited ${ran.code}: ${ran.stderr}${ran.stdout}`);
    const currentPot = getAddress(v12PredictPot(lister.address, current.salt) as Address);
    // Neither another owner's Pot nor the owner's Pot on another chain is the owner's here.
    const stranger = await owner("listed stranger");
    await deployPot(stranger);
    expect(
      (
        await sauceWith(
          { ...NO_TERMINAL, potsDir: pots },
          ...["pot", "import", "--chain", "ethereum", "--pot", stranger.pot],
          ...["--rpc-url", local.rpcUrl],
        )
      ).code,
    ).toBe(0);
    const [record] = store.recordsOf(local.chain.id, old);
    const elsewhere = getAddress("0x00000000000000000000000000000000000ba5e0");
    store.save({ ...(record as PotRecord), chain: "base", chainId: 8453, pot: elsewhere });
    expect(store.list().pots).toHaveLength(4);

    const balance = await local.publicClient.getBalance({ address: lister.address });
    const nonce = await local.publicClient.getTransactionCount({ address: lister.address });
    await whileMispredicting(newer, async () => {
      const refused = await command("tx", lister, { potsDir: pots });
      const said = refused.stdout + refused.stderr;
      expect(refused.code).toBe(1);
      expect(said).toMatch(NEWER);
      expect(said).toContain(
        `The Pot store ${pots} holds 2 other Pots of ${lister.address} on ethereum:`,
      );
      const lines = said.split("\n");
      expect(lines.find((line) => line.startsWith(`  ${old} `))).toContain(
        `private, salt ${oldSalt}: ${OLD}, ${OLD_SDKS}`,
      );
      expect(lines.find((line) => line.startsWith(`  ${currentPot} `))).toContain(
        `private, salt ${current.salt}: ${OWN}`,
      );
      expect(said).not.toContain(stranger.pot);
      expect(said).not.toContain(elsewhere);
      // A command that keeps no store lists none.
      const unlisted = await command("tx", lister, {});
      expect(unlisted.code).toBe(1);
      expect(unlisted.stdout + unlisted.stderr).not.toContain("The Pot store");
    });
    // The owner's Pot of the older release, refused: its other Pots are listed, not itself.
    const refused = await onPot("tx", lister, old, { potsDir: pots });
    const said = refused.stdout + refused.stderr;
    expect(refused.code).toBe(1);
    expect(said).toContain(
      `The Pot store ${pots} holds 1 other Pot of ${lister.address} on ethereum:`,
    );
    const lines = said.split("\n");
    expect(lines.find((line) => line.startsWith(`  ${currentPot} `))).toContain("private");
    expect(lines.some((line) => line.startsWith(`  ${old} `))).toBe(false);
    expect(String(await local.publicClient.getBalance({ address: lister.address }))).toBe(
      String(balance),
    );
    expect(await local.publicClient.getTransactionCount({ address: lister.address })).toBe(nonce);
  }, 180_000);

  it("refuses at the send itself: a deployment the Kitchen puts elsewhere, a cook on no Pot", async () => {
    const fresh = await owner("at-the-send");
    const account = privateKeyToAccount(fresh.key);
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const deploy = {
      to: kitchen,
      data: encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "deployPot",
        args: [fresh.address, fresh.salt],
      }),
      value: 0n,
    };
    // Signed elsewhere and handed to `sauce send`: refused the same, before it is broadcast.
    const signed = (tx: { to: Address; data: Hex; value: bigint }, nonce: number) =>
      account.signTransaction({
        ...tx,
        chainId: local.chain.id,
        nonce,
        gas: 1_000_000n,
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      });
    const send = (raw: Hex) =>
      sauceWith(NO_TERMINAL, "send", raw, "--chain", "ethereum", "--rpc-url", local.rpcUrl);
    await whileMispredicting(newer, async () => {
      await expect(sendAndWait(local.publicClient, local.rpcUrl, account, deploy)).rejects.toThrow(
        MISMATCH,
      );
      const sent = await send(await signed(deploy, 0));
      expect(sent.code).toBe(1);
      expect(sent.stdout + sent.stderr).toMatch(MISMATCH);
      expect(sent.stdout + sent.stderr).toMatch(NEWER);
    });
    const cook = {
      to: fresh.pot,
      data: encodeFunctionData({
        abi: v12PotAbi,
        functionName: "cook",
        args: [getAddress(ELSEWHERE), "0x00"],
      }),
      value: 1_234n,
    };
    const noPot = `the cook goes to ${fresh.pot}, which has no code on ethereum`;
    await expect(sendAndWait(local.publicClient, local.rpcUrl, account, cook)).rejects.toThrow(
      noPot,
    );
    const sent = await send(await signed(cook, 0));
    expect(sent.code).toBe(1);
    expect(sent.stdout + sent.stderr).toContain(noPot);
    await nothingSent(fresh, balance, undefined);
  }, 120_000);

  /** `who`'s transaction, signed at `nonce` as a signer elsewhere would sign it for `sauce send`. */
  const signedBy = (who: Owner, tx: { to: Address; data: Hex; value: bigint }, nonce: number) =>
    privateKeyToAccount(who.key).signTransaction({
      ...tx,
      chainId: local.chain.id,
      nonce,
      gas: 1_000_000n,
      maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });

  /** A cook on `pot`, as `sauce tx` builds one: what is under test is where it goes. */
  const cookOn = (pot: Address) => ({
    to: pot,
    data: encodeFunctionData({
      abi: v12PotAbi,
      functionName: "cook",
      args: [getAddress(v12EngineAddress()), "0x00"],
    }),
    value: 0n,
  });

  /** `Kitchen.deployPot` with calldata too short to carry its owner and salt. */
  const MALFORMED_DEPLOY = {
    to: kitchen,
    data: `${toFunctionSelector("function deployPot(address owner, bytes32 salt)")}${"00".repeat(8)}` as Hex,
    value: 0n,
  };

  /** `send` while the Kitchen puts every Pot elsewhere, returning what it returned. */
  async function whileMispredictingSend<T>(send: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    await whileMispredicting(newer, async () => {
      result = await send();
    });

    return result!;
  }

  it("says the release is not deployed where the Kitchen has no code, not that the SDK mismatches it", async () => {
    const fresh = await owner("no-kitchen");
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const deploy = {
      to: kitchen,
      data: encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "deployPot",
        args: [fresh.address, fresh.salt],
      }),
      value: 0n,
    };
    const notDeployed = `the released Kitchen ${kitchen} is not deployed on ethereum`;
    const code = await local.publicClient.getCode({ address: kitchen });
    await local.testClient.setCode({ address: kitchen, bytecode: "0x" });
    try {
      await expect(
        requireKitchenPredicts(local.publicClient, local.chain, fresh.address, fresh.salt),
      ).rejects.toThrow(notDeployed);
      await expect(
        sendAndWait(local.publicClient, local.rpcUrl, privateKeyToAccount(fresh.key), deploy),
      ).rejects.toThrow(notDeployed);
      // `sauce send` of the deployment, and `sauce sign`, which reach the guard before the fee.
      const sent = await sauceWith(
        NO_TERMINAL,
        ...["send", await signedBy(fresh, deploy, 0), "--chain", "ethereum"],
        ...["--rpc-url", local.rpcUrl],
      );
      const signed = await command("sign", fresh, {});
      for (const run of [sent, signed]) {
        expect(run.code).toBe(1);
        expect(run.stdout + run.stderr).toContain(notDeployed);
        expect(run.stdout + run.stderr).not.toMatch(MISMATCH);
      }
    } finally {
      await local.testClient.setCode({ address: kitchen, bytecode: code! });
    }
    await nothingSent(fresh, balance, undefined);
  }, 120_000);

  it.each([
    ["a cook on a Pot of another release", "old"],
    ["a cook on an address with no code", "empty"],
    ["a deployment the Kitchen puts elsewhere", "mispredicted"],
    ["a deployPot whose calldata carries no owner and salt", "malformed"],
  ] as const)(
    "sauce send refuses a batch whose later transaction is %s, before the first is sent",
    async (_, refused) => {
      const fresh = await owner(`batch-${refused}`);
      const recipient = privateKeyToAccount(generatePrivateKey()).address;
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const old =
        refused === "old"
          ? await mintOldReleasePot(local, fresh.address, potSalt(`batch-${refused} old`))
          : undefined;
      const [step, reason] =
        refused === "old"
          ? [cookOn(old!), `${old} on ethereum is a Pot of ${OLD}`]
          : refused === "empty"
            ? [cookOn(fresh.pot), `the cook goes to ${fresh.pot}, which has no code on ethereum`]
            : refused === "mispredicted"
              ? [
                  {
                    to: kitchen,
                    data: encodeFunctionData({
                      abi: v12KitchenAbi,
                      functionName: "deployPot",
                      args: [fresh.address, fresh.salt],
                    }),
                    value: 0n,
                  },
                  "this SDK does not match the deployed Kitchen",
                ]
              : [MALFORMED_DEPLOY, "carries no owner and salt"];
      // The plan's first transaction pays a recipient; its second is the one the guard refuses.
      const signed = [
        await signedBy(fresh, { to: recipient, data: "0x", value: 1_000n }, 0),
        await signedBy(fresh, step, 1),
      ];
      const send = () =>
        sauceWith(NO_TERMINAL, "send", ...signed, "--chain", "ethereum", "--rpc-url", local.rpcUrl);
      const sent = refused === "mispredicted" ? await whileMispredictingSend(send) : await send();
      const said = sent.stdout + sent.stderr;
      expect(sent.code).toBe(1);
      expect(said).toContain("nothing was sent — transaction 2 of 2 (");
      expect(said).toContain(reason);
      expect(said).not.toMatch(/AbiDecoding|Data size/);
      expect(String(await local.publicClient.getBalance({ address: recipient }))).toBe("0");
      await nothingSent(fresh, balance, undefined);
    },
    120_000,
  );

  it("refuses a Kitchen.deployPot with no owner and salt in its calldata, not with the decoder's error", async () => {
    const fresh = await owner("malformed-alone");
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const refused = sendAndWait(
      local.publicClient,
      local.rpcUrl,
      privateKeyToAccount(fresh.key),
      MALFORMED_DEPLOY,
    );
    await expect(refused).rejects.toBeInstanceOf(CliError);
    await expect(refused).rejects.toThrow("carries no owner and salt");
    await nothingSent(fresh, balance, undefined);
  }, 60_000);

  it("sauce run --fund holds the cook to the guard before each transaction it sends first", async () => {
    const fresh = await owner("fund-then-gone");
    await deployPot(fresh);
    await local.mint(usdc, fresh.address, 10_000_000n);
    const code = await local.publicClient.getCode({ address: fresh.pot });
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    // The Pot passes the guard when the run starts; by the time the funding approval is agreed
    // to, its code is gone: a plan gone stale while its user answered.
    const asked: string[] = [];
    const approver: Approver = {
      auto: true,
      canAsk: false,
      approve: async (action) => {
        asked.push(action);
        await local.testClient.setCode({ address: fresh.pot, bytecode: "0x" });

        return true;
      },
    };
    const account = privateKeyToAccount(fresh.key);
    const input: RunInput = {
      file: program,
      text: PROGRAM,
      chain: local.chain,
      defines: {},
      target: { owner: fresh.address, salt: fresh.salt },
      args: { from: "--args", values: ["41"] },
      rpcUrl: local.rpcUrl,
      account,
      approver,
      fund: fundingFor({
        chain: local.chain,
        rpcUrl: local.rpcUrl,
        fund: ["USDC:1"],
        mode: "allowance",
        sweep: false,
        send: true,
        account,
        approver,
      }),
    };
    try {
      await expect(runCommand(input, nodeIo())).rejects.toThrow(
        `the cook goes to ${fresh.pot}, which has no code on ethereum`,
      );
      expect(asked).toEqual(["approve the Pot for 1000000 USDC"]);
      // The approval it agreed to was never sent: the cook it was for would have been refused.
      expect(
        String(
          await local.publicClient.readContract({
            address: usdc,
            abi: erc20,
            functionName: "allowance",
            args: [fresh.address, fresh.pot],
          }),
        ),
      ).toBe("0");
      expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(0);
      expect(String(await local.publicClient.getBalance({ address: fresh.address }))).toBe(
        String(balance),
      );
    } finally {
      await local.testClient.setCode({ address: fresh.pot, bytecode: code! });
    }
  }, 120_000);

  it("sauce send waits for the Pot its plan's deployment made before holding the cook to the guard, on an endpoint that lags", async () => {
    const fresh = await owner("lagging-send");
    const plan = jsonOf(
      await sauce(
        ...["tx", program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
        ...["--owner", fresh.address, "--salt", fresh.label, "--args", "41"],
      ),
    ) as { transactions: Array<{ to: Address; data: Hex; value: string }> };
    expect(plan.transactions).toHaveLength(2);
    const signed = await Promise.all(
      plan.transactions.map((tx, nonce) =>
        signedBy(fresh, { to: tx.to, data: tx.data, value: BigInt(tx.value) }, nonce),
      ),
    );
    // Its first answers to eth_getCode after a transaction are a node's that has not seen the block.
    const lagging = await laggingEndpoint(local.rpcUrl, 2);
    try {
      const sent = await sauceWith(
        NO_TERMINAL,
        ...["send", ...signed, "--chain", "ethereum", "--rpc-url", lagging.url, "--json"],
      );
      expect(jsonOf(sent)).toMatchObject({
        ok: true,
        sent: [{ status: "success" }, { status: "success" }],
      });
      expect(lagging.served()).toBeGreaterThan(0);
    } finally {
      await lagging.stop();
    }
  }, 120_000);

  it("sauce send keeps what the chain already has when a later Kitchen.deployPot carries no owner and salt", async () => {
    const fresh = await owner("malformed-after");
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const first = await signedBy(fresh, { to: recipient, data: "0x", value: 1_000n }, 0);
    const landed = jsonOf(
      await sauceWith(
        NO_TERMINAL,
        ...["send", first, "--chain", "ethereum", "--rpc-url", local.rpcUrl, "--json"],
      ),
    ) as { sent: Array<{ hash: string }> };
    // The batch again, with a deployment the guard cannot read after the transaction that landed.
    const again = await sauceWith(
      NO_TERMINAL,
      ...["send", first, await signedBy(fresh, MALFORMED_DEPLOY, 1), "--chain", "ethereum"],
      ...["--rpc-url", local.rpcUrl, "--json"],
    );
    expect(again.code).toBe(1);
    const out = JSON.parse(again.stdout) as {
      ok: boolean;
      sent: Array<{ hash: string; status: string; reason?: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.sent).toHaveLength(2);
    expect(out.sent[0]).toMatchObject({ status: "success", hash: landed.sent[0]!.hash });
    expect(out.sent[1]).toMatchObject({ status: "failed", hash: "" });
    expect(out.sent[1]!.reason).toContain("transaction 2 of 2 (Kitchen.deployPot at");
    expect(out.sent[1]!.reason).toContain("carries no owner and salt");
    expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(1);
  }, 120_000);

  it("takes a Pot of every kind the release deploys, whatever the Kitchen mints now, and no Pot of another", async () => {
    const fresh = await owner("kinds");
    const salt = potSalt("kinds");
    const deploy = async (
      functionName: "deployPot" | "deploySharedPot",
      args: readonly unknown[],
    ) => {
      await local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({ abi: v12KitchenAbi, functionName, args: args as never }),
      );
    };
    await deploy("deployPot", [fresh.address, salt]);
    await deploy("deployPot", [fresh.address, salt, true]);
    await deploy("deploySharedPot", [salt]);
    const pots = await Promise.all([
      local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictPot",
        args: [fresh.address, salt, true],
      }),
      local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictSharedPot",
        args: [salt],
      }),
    ]);
    const old = await mintOldReleasePot(local, fresh.address, potSalt("kinds old"));
    for (const implementation of [undefined, newer, older]) {
      const check = async () => {
        for (const pot of [fresh.pot, ...pots]) {
          await expect(
            requireReleasePot(local.publicClient, local.chain, pot),
          ).resolves.toBeUndefined();
        }
        await expect(requireReleasePot(local.publicClient, local.chain, old)).rejects.toThrow(
          `${old} on ethereum is a Pot of ${OLD}`,
        );
      };
      await (implementation === undefined
        ? check()
        : withKitchenImplementation(local, implementation, check));
    }
    // In a scope that keeps the Pot store, the refusal lists the owner's other Pots there: here
    // its Pots of this release, which this store holds.
    const store = new PotStore(join(work, "kinds"));
    for (const pot of [fresh.pot, pots[0]]) {
      expect(
        (
          await sauceWith(
            { ...NO_TERMINAL, potsDir: store.dir },
            ...["pot", "import", "--chain", "ethereum", "--pot", pot, "--rpc-url", local.rpcUrl],
          )
        ).code,
      ).toBe(0);
    }
    await expect(
      keeping({ stores: { pots: store }, say: () => undefined }, () =>
        requireReleasePot(local.publicClient, local.chain, old),
      ),
    ).rejects.toThrow(
      `The Pot store ${store.dir} holds 2 other Pots of ${fresh.address} on ethereum:`,
    );
  }, 180_000);
});

describe("offline, the Pot's address cannot be checked", () => {
  const OWNER = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
  let work: string;
  let program: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-offline-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it.each([
    ["tx", ["--value", "1234"]],
    ["sign", ["--max-fee", "1234"]],
  ])("%s says so", async (each, more) => {
    const result = await sauce(
      ...[each, program, "--chain", "ethereum", "--offline", "--owner", OWNER],
      ...more,
      ...["--args", "41"],
    );
    if (result.code !== 0) throw new Error(`exited ${result.code}: ${result.stderr}`);
    expect(result.stdout + result.stderr).toContain(
      "The Pot's address is NOT checked against the deployed Kitchen",
    );
  });

  it("pot says so", async () => {
    const result = await sauce("pot", "--chain", "ethereum", "--offline", "--owner", OWNER);
    if (result.code !== 0) throw new Error(`exited ${result.code}: ${result.stderr}`);
    expect(result.stdout + result.stderr).toContain(
      "The Pot's address is NOT checked against the deployed Kitchen",
    );
  });
});
