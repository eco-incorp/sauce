/**
 * The Pot store, on a chain: every Pot the `sauce` command deploys recorded once the chain shows it
 * (`sauce pot --deploy`, a run that deploys its Pot before its first cook, `sauce send` of a signed
 * deployment), none by a cook on a Pot already there or by `sauce tx`, which sends nothing — and
 * `sauce pot import` recording Pots deployed another way, their kind and release told from the
 * address the real Kitchen minted them at. On a local anvil running the released gated stack
 * (`cli-anvil.ts` over `evm/gated-engine.ts`), its Kitchen at the release's address.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { PotStore, type PotRecord } from "../src/cli/pot-store.js";
import {
  v12EngineAddress,
  v12KitchenAddress,
  v12PotDerivation,
  v12ReleaseSet,
} from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12KitchenAbi } from "../src/evm/engine.js";
import {
  describeEvm,
  jsonOf,
  sauceWith,
  startChain,
  type LocalChain,
  type Run,
} from "./cli-anvil.js";

// Anvil's sixth to ninth dev accounts: public keys, local only, a Pot each.
const DEPLOYING_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const RUNNING_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const SENDING_KEY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";
const IMPORTED_KEY = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97";
const DEPLOYING = privateKeyToAccount(DEPLOYING_KEY);
const RUNNING = privateKeyToAccount(RUNNING_KEY);
const SENDING = privateKeyToAccount(SENDING_KEY);
const IMPORTED = privateKeyToAccount(IMPORTED_KEY);

/** What every record of a Pot the pinned release minted on Base says of it. */
const released = () => {
  const set = v12ReleaseSet();

  return {
    schema: "sauce.pot/1",
    chain: "base",
    chainId: 8453,
    kitchen: getAddress(v12KitchenAddress()),
    potInitCodeHash: v12PotDerivation().initCodeHash.toLowerCase(),
    engine: getAddress(v12EngineAddress()),
    release: {
      compiler: set.compiler,
      "v12-evm": set["v12-evm"].version,
      "kitchen-evm": set["kitchen-evm"].version,
    },
  };
};

describeEvm("the Pots the sauce command deploys, recorded", () => {
  let base: LocalChain;
  let work: string;
  let pots: string;
  let noop: string;

  /** `sauce …` recording into this suite's store. */
  const sauce = (...argv: string[]): Promise<Run> => sauceWith({ potsDir: pots }, ...argv);
  const stored = (): PotRecord[] => new PotStore(pots).list().pots;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pots-e2e-"));
    pots = join(work, "pots");
    noop = join(work, "noop.sauce.ts");
    writeFileSync(
      noop,
      "// Runs on the Pot and moves nothing.\nfunction main(): Address {\n  return ctx.self();\n}\n",
    );
    base = await startChain("base");
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await base?.stop();
  });

  it("`sauce pot --deploy` records the Pot once the chain shows it, under the release that minted it", async () => {
    const pot = getAddress(v12PredictPot(DEPLOYING.address, potSalt("pots")));
    const run = await sauce(
      ...["pot", "--deploy", "--chain", "base", "--salt", "pots"],
      ...["--rpc-url", base.rpcUrl, "--private-key", DEPLOYING_KEY],
    );
    const out = jsonOf(run) as { deployPot: { hash: Hex; blockNumber: string; pots: PotRecord[] } };
    expect(run.stderr).toContain(`recorded Pot ${pot} on base in ${pots}`);
    const record = {
      ...released(),
      pot,
      owner: DEPLOYING.address,
      salt: potSalt("pots"),
      kind: "private",
      origin: "deployed",
      deployment: {
        tx: out.deployPot.hash,
        block: out.deployPot.blockNumber,
        // Its block's own hash, which a fork's block at the same height does not have.
        blockHash: (await base.publicClient.getTransactionReceipt({ hash: out.deployPot.hash }))
          .blockHash,
        from: DEPLOYING.address,
      },
      sdk: expect.any(String),
      recordedAt: expect.any(String),
    };
    expect(stored()).toEqual([record]);
    // The JSON reports it with the transaction that deployed it, as the MCP server's results do.
    expect(out.deployPot.pots).toEqual(stored());

    // Deployed already: nothing is sent, and nothing more recorded.
    const again = await sauce(
      ...["pot", "--deploy", "--chain", "base", "--salt", "pots"],
      ...["--rpc-url", base.rpcUrl, "--private-key", DEPLOYING_KEY],
    );
    expect(again.code).toBe(0);
    expect(again.stderr).not.toContain("recorded Pot");
    expect(stored()).toEqual([record]);

    // `sauce pot list` reads it back, by chain and owner, with no chain read.
    const listed = jsonOf(
      await sauce("pot", "list", "--chain", "base", "--owner", DEPLOYING.address, "--json"),
    );
    expect(listed).toEqual({ store: pots, pots: [record] });
    const text = await sauce("pot", "list");
    expect(text.stdout).toContain(`base  ${pot}  private`);
    expect(text.stdout).toContain(
      `compiler ${record.release.compiler} (v12-evm ${record.release["v12-evm"]}, kitchen-evm ` +
        `${record.release["kitchen-evm"]}), engine ${record.engine}`,
    );
    expect(text.stdout).toContain(`deployed in ${out.deployPot.hash}`);
    expect(jsonOf(await sauce("pot", "list", "--chain", "ethereum", "--json")).pots).toEqual([]);
  }, 120_000);

  it("a run records the Pot it deploys before its first cook, and a second cook records none", async () => {
    const pot = getAddress(v12PredictPot(RUNNING.address));
    const cook = [
      ...["run", noop, "--chain", "base", "--rpc-url", base.rpcUrl],
      ...["--private-key", RUNNING_KEY, "--yes"],
    ];
    const first = await sauce(...cook);
    expect(first.code).toBe(0);
    expect(first.stderr).toContain(`auto-approved: deploy Pot ${pot}`);
    expect(first.stderr).toContain(`recorded Pot ${pot} on base in ${pots}`);
    const record = stored().find((one) => one.pot === pot);
    expect(record).toMatchObject({
      ...released(),
      owner: RUNNING.address,
      salt: `0x${"00".repeat(32)}`,
      kind: "private",
      origin: "deployed",
      deployment: { from: RUNNING.address },
    });

    const second = await sauce(...cook);
    expect(second.code).toBe(0);
    expect(second.stderr).not.toContain("recorded Pot");
    expect(stored().filter((one) => one.pot === pot)).toEqual([record]);
  }, 120_000);

  it("`sauce tx` sends nothing, and records nothing; `sauce send` records the deployment it broadcasts", async () => {
    const before = stored();
    const plan = jsonOf(
      await sauce(
        ...["tx", noop, "--chain", "base", "--owner", SENDING.address],
        ...["--rpc-url", base.rpcUrl],
      ),
    ) as {
      pot: Address;
      transactions: Array<{ to: Address; data: Hex; value: string; gas?: string }>;
    };
    expect(plan.transactions).toHaveLength(2);
    expect(stored()).toEqual(before);

    const [deploy] = plan.transactions;
    const fees = await base.publicClient.estimateFeesPerGas();
    const signed = await SENDING.signTransaction({
      chainId: base.chain.id,
      type: "eip1559",
      to: deploy!.to,
      data: deploy!.data,
      value: 0n,
      nonce: await base.publicClient.getTransactionCount({ address: SENDING.address }),
      gas: BigInt(deploy!.gas ?? "1000000"),
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const sent = await sauce("send", signed, "--rpc-url", base.rpcUrl, "--json");
    const out = jsonOf(sent) as { sent: Array<{ hash: Hex; pots?: PotRecord[] }> };
    expect(sent.stderr).toContain(`recorded Pot ${plan.pot} on base in ${pots}`);
    expect(out.sent[0]!.pots).toEqual([
      expect.objectContaining({
        pot: plan.pot,
        owner: SENDING.address,
        deployment: expect.objectContaining({ tx: out.sent[0]!.hash, from: SENDING.address }),
      }),
    ]);
    expect(stored().find((one) => one.pot === plan.pot)).toEqual(out.sent[0]!.pots![0]);
  }, 120_000);

  describe("`sauce pot import`", () => {
    let imports: string;
    const importing = (...argv: string[]): Promise<Run> =>
      sauceWith(
        { potsDir: imports },
        "pot",
        "import",
        "--chain",
        "base",
        ...argv,
        "--rpc-url",
        base.rpcUrl,
      );
    const salts = {
      private: keccak256(stringToBytes("imported private")),
      fixed: keccak256(stringToBytes("imported fixed")),
      shared: keccak256(stringToBytes("imported shared")),
    };
    const minted: Record<keyof typeof salts, Address> = {} as never;

    beforeAll(async () => {
      imports = join(work, "imported");
      const kitchen = getAddress(v12KitchenAddress());
      // Deployed another way: straight to the Kitchen, from an account the command never sees, as
      // each kind of Pot. Where each lands is the Kitchen's own prediction.
      const calls = [
        ["private", "deployPot", [IMPORTED.address, salts.private], "predictPot"],
        ["fixed", "deployPot", [IMPORTED.address, salts.fixed, true], "predictPot"],
        ["shared", "deploySharedPot", [salts.shared], "predictSharedPot"],
      ] as const;
      for (const [kind, deploy, args, predict] of calls) {
        minted[kind] = getAddress(
          (await base.publicClient.readContract({
            address: kitchen,
            abi: v12KitchenAbi,
            functionName: predict,
            args: args as never,
          })) as Address,
        );
        await base.send(
          base.deployer,
          kitchen,
          encodeFunctionData({ abi: v12KitchenAbi, functionName: deploy, args: args as never }),
        );
      }
    }, 120_000);

    it("reads a Pot by address, and tells its kind and release from where the Kitchen minted it", async () => {
      const expected = {
        private: { owner: IMPORTED.address, salt: salts.private, kind: "private" },
        fixed: { owner: IMPORTED.address, salt: salts.fixed, kind: "private-fixed-router" },
        shared: {
          owner: "0x0000000000000000000000000000000000000000",
          salt: salts.shared,
          kind: "shared",
        },
      } as const;
      for (const kind of ["private", "fixed", "shared"] as const) {
        const run = await importing("--pot", minted[kind], "--json");
        expect(run.stderr).toContain(`recorded Pot ${minted[kind]} on base in ${imports}`);
        expect(jsonOf(run).pots).toEqual([
          {
            ...released(),
            pot: minted[kind],
            ...expected[kind],
            origin: "imported",
            sdk: expect.any(String),
            recordedAt: expect.any(String),
          },
        ]);
      }
      expect(new PotStore(imports).list().pots.map((one) => one.pot)).toEqual(
        expect.arrayContaining(Object.values(minted)),
      );

      // Recorded already: the record is kept as it was.
      const again = await importing("--pot", minted.private);
      expect(again.code).toBe(0);
      expect(again.stderr).toContain(`was already recorded in ${imports}; the record is kept`);
    }, 120_000);

    it("finds an owner's Pots by salt, under every release", async () => {
      const fresh = join(work, "by-owner");
      const run = await sauceWith(
        { potsDir: fresh },
        ...["pot", "import", "--chain", "base", "--owner", IMPORTED.address],
        ...["--salt-hex", salts.fixed, "--rpc-url", base.rpcUrl, "--json"],
      );
      expect(jsonOf(run).pots).toEqual([
        expect.objectContaining({ pot: minted.fixed, kind: "private-fixed-router" }),
      ]);
      const none = await sauceWith(
        { potsDir: fresh },
        ...["pot", "import", "--chain", "base", "--owner", IMPORTED.address],
        ...["--salt", "never deployed", "--rpc-url", base.rpcUrl],
      );
      expect(none.code).toBe(1);
      expect(none.stderr).toMatch(/has no Pot at salt 0x[0-9a-f]{64} on base under any release/);
    }, 120_000);

    it("refuses an address with no Pot, and a contract that is not one", async () => {
      const empty = await importing("--pot", IMPORTED.address);
      expect(empty.code).toBe(1);
      expect(empty.stderr).toContain(
        `${IMPORTED.address} has no code on base: no Pot is deployed there`,
      );
      const kitchen = await importing("--pot", getAddress(v12KitchenAddress()));
      expect(kitchen.code).toBe(1);
      expect(kitchen.stderr).toMatch(
        /is not a Pot: it has no userSalt\(\)|is not a Pot: it has no kitchen\(\)/,
      );
    }, 60_000);
  });
});
