/**
 * Real-chain Pot lifecycle: explicit deployment authenticates and persists before any cook.
 * Plans and cooks never deploy or repin. Imports verify each deployed Pot's actual provenance.
 * Historical artifacts exercise retained deployed Pots; new CLI deployments require LOCAL CREATE3.
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
import { potSalt } from "../src/deployments/pot.js";
import { v12KitchenAbi } from "../src/evm/engine.js";
import {
  deployPot,
  describeEvm,
  jsonOf,
  sauceWith,
  startChain,
  type LocalChain,
  type Run,
} from "./cli-anvil.js";
import { gateAnchors } from "./evm/gated-engine.js";

const DEPLOYING_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const RUNNING_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const SENDING_KEY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";
const IMPORTED_KEY = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97";
const DEPLOYING = privateKeyToAccount(DEPLOYING_KEY);
const RUNNING = privateKeyToAccount(RUNNING_KEY);
const SENDING = privateKeyToAccount(SENDING_KEY);
const IMPORTED = privateKeyToAccount(IMPORTED_KEY);
const BINDING = process.env.SAUCE_LOCAL_CANDIDATE
  ? ["--pot-binding", process.env.SAUCE_LOCAL_CANDIDATE]
  : [];

describeEvm("explicitly deployed Pots, authenticated and recorded", () => {
  let base: LocalChain;
  let work: string;
  let pots: string;
  let noop: string;
  const sauce = (...argv: string[]): Promise<Run> => sauceWith({ potsDir: pots }, ...argv);
  const stored = (): PotRecord[] => new PotStore(pots).list().pots;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pots-e2e-"));
    pots = join(work, "pots");
    noop = join(work, "noop.sauce.ts");
    writeFileSync(noop, "function main(): Address {\n  return ctx.self();\n}\n");
    base = await startChain("base");
  }, 120_000);
  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await base?.stop();
  });

  (BINDING.length ? it : it.skip)(
    "pot --deploy authenticates, records once and lists its exact binding",
    async () => {
      const flags = [
        "pot",
        "--deploy",
        ...BINDING,
        "--chain",
        "base",
        "--salt",
        "pots",
        "--rpc-url",
        base.rpcUrl,
        "--private-key",
        DEPLOYING_KEY,
      ];
      const run = await sauce(...flags);
      const out = jsonOf(run) as {
        pot: Address;
        deployPot: { hash: Hex; blockNumber: string; pots: PotRecord[] };
      };
      const pot = getAddress(out.pot);
      const binding = await base.bindingOf(pot);
      const receipt = await base.publicClient.getTransactionReceipt({ hash: out.deployPot.hash });
      expect(run.stderr).toContain(`recorded Pot ${pot} on base in ${pots}`);
      expect(stored()).toEqual([
        expect.objectContaining({
          chain: "base",
          chainId: 8453,
          pot,
          owner: DEPLOYING.address,
          salt: potSalt("pots"),
          kind: "private",
          origin: "deployed",
          binding,
          engine: binding.engine,
          release: binding.release,
          deployment: {
            tx: out.deployPot.hash,
            block: out.deployPot.blockNumber,
            blockHash: receipt.blockHash,
            from: DEPLOYING.address,
          },
        }),
      ]);
      const records = stored();
      expect(out.deployPot.pots).toEqual(records);
      const nonce = await base.publicClient.getTransactionCount({ address: DEPLOYING.address });
      expect((await sauce(...flags)).code).toBe(0);
      expect(await base.publicClient.getTransactionCount({ address: DEPLOYING.address })).toBe(
        nonce,
      );
      expect(stored()).toEqual(records);
      expect(
        jsonOf(
          await sauce("pot", "list", "--chain", "base", "--owner", DEPLOYING.address, "--json"),
        ),
      ).toEqual({ store: pots, pots: records });
      const text = await sauce("pot", "list");
      expect(text.stdout).toContain(`base  ${pot}  private`);
      expect(text.stdout).toContain(`deployed in ${out.deployPot.hash}`);
      expect(jsonOf(await sauce("pot", "list", "--chain", "ethereum", "--json")).pots).toEqual([]);
    },
    120_000,
  );

  it("run refuses missing Pots without side effects, then cooks only after explicit import", async () => {
    const cook = [
      "run",
      noop,
      "--chain",
      "base",
      "--rpc-url",
      base.rpcUrl,
      "--private-key",
      RUNNING_KEY,
      "--yes",
    ];
    const before = {
      records: stored(),
      nonce: await base.publicClient.getTransactionCount({ address: RUNNING.address }),
      balance: await base.publicClient.getBalance({ address: RUNNING.address }),
    };
    expect((await sauce(...cook)).code).toBe(1);
    expect(stored()).toEqual(before.records);
    expect(await base.publicClient.getTransactionCount({ address: RUNNING.address })).toBe(
      before.nonce,
    );
    expect(await base.publicClient.getBalance({ address: RUNNING.address })).toBe(before.balance);
    const pot = await deployPot(base, RUNNING.address);
    const imported = await sauce(
      "pot",
      "import",
      ...BINDING,
      "--pot",
      pot,
      "--chain",
      "base",
      "--rpc-url",
      base.rpcUrl,
      "--json",
    );
    expect(imported.code).toBe(0);
    const records = stored();
    expect(records.find((record) => record.pot === pot)).toMatchObject({
      binding: await base.bindingOf(pot),
      origin: "imported",
    });
    for (let index = 0; index < 2; index++) {
      const run = await sauce(...cook);
      expect(run.code).toBe(0);
      expect(run.stderr).not.toContain("recorded Pot");
      expect(stored()).toEqual(records);
    }
  }, 120_000);

  it("tx and send cook on an imported Pot without changing its persisted pins", async () => {
    const pot = await deployPot(base, SENDING.address);
    expect(
      (
        await sauce(
          "pot",
          "import",
          ...BINDING,
          "--pot",
          pot,
          "--chain",
          "base",
          "--rpc-url",
          base.rpcUrl,
        )
      ).code,
    ).toBe(0);
    const before = stored();
    const nonce = await base.publicClient.getTransactionCount({ address: SENDING.address });
    const tx = jsonOf(
      await sauce(
        "tx",
        noop,
        "--chain",
        "base",
        "--owner",
        SENDING.address,
        "--rpc-url",
        base.rpcUrl,
      ),
    ) as { to: Address; data: Hex; value: string };
    expect(tx.to).toBe(pot);
    expect(stored()).toEqual(before);
    expect(await base.publicClient.getTransactionCount({ address: SENDING.address })).toBe(nonce);
    const fees = await base.publicClient.estimateFeesPerGas();
    const signed = await SENDING.signTransaction({
      chainId: base.chain.id,
      type: "eip1559",
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      nonce,
      gas: 1_000_000n,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const out = jsonOf(await sauce("send", signed, "--rpc-url", base.rpcUrl, "--json")) as {
      sent: Array<{ status: string }>;
    };
    expect(out.sent[0]!.status).toBe("success");
    expect(await base.publicClient.getTransactionCount({ address: SENDING.address })).toBe(
      nonce + 1,
    );
    expect(stored()).toEqual(before);
  }, 120_000);

  describe("pot import", () => {
    let imports: string;
    const importing = (...argv: string[]): Promise<Run> =>
      sauceWith(
        { potsDir: imports },
        "pot",
        "import",
        ...BINDING,
        "--chain",
        "base",
        "--rpc-url",
        base.rpcUrl,
        ...argv,
      );
    const salts = {
      private: keccak256(stringToBytes("imported private")),
      fixed: keccak256(stringToBytes("imported fixed")),
      shared: keccak256(stringToBytes("imported shared")),
    };
    const minted: Record<keyof typeof salts, Address> = {} as never;
    beforeAll(async () => {
      imports = join(work, "imported");
      const kitchen = gateAnchors().kitchen;
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
        await base.bindingOf(minted[kind]);
      }
    }, 120_000);

    it("authenticates private, fixed-router and shared Pots, retaining existing records", async () => {
      const kinds = { private: "private", fixed: "private-fixed-router", shared: "shared" };
      for (const kind of ["private", "fixed", "shared"] as const) {
        const binding = await base.bindingOf(minted[kind]);
        const run = await importing("--pot", minted[kind], "--json");
        expect(run.stderr).toContain(`recorded Pot ${minted[kind]} on base in ${imports}`);
        expect(jsonOf(run).pots).toEqual([
          expect.objectContaining({
            pot: minted[kind],
            owner: binding.owner,
            salt: salts[kind],
            kind: kinds[kind],
            origin: "imported",
            binding,
            engine: binding.engine,
            release: binding.release,
          }),
        ]);
      }
      const records = new PotStore(imports).list().pots;
      expect(records.map((record) => record.pot)).toEqual(
        expect.arrayContaining(Object.values(minted)),
      );
      expect((await importing("--pot", minted.private)).code).toBe(0);
      expect(new PotStore(imports).list().pots).toEqual(records);
    }, 120_000);

    it("finds an owner's deployed Pot by salt and refuses an undeployed salt", async () => {
      const fresh = join(work, "by-owner");
      const flags = [
        "pot",
        "import",
        ...BINDING,
        "--chain",
        "base",
        "--owner",
        IMPORTED.address,
        "--rpc-url",
        base.rpcUrl,
      ];
      const run = await sauceWith(
        { potsDir: fresh },
        ...flags,
        "--salt-hex",
        salts.fixed,
        "--json",
      );
      expect(jsonOf(run).pots).toEqual([
        expect.objectContaining({ pot: minted.fixed, kind: "private-fixed-router" }),
      ]);
      const before = new PotStore(fresh).list();
      const none = await sauceWith({ potsDir: fresh }, ...flags, "--salt", "never deployed");
      expect(none.code).toBe(1);
      expect(new PotStore(fresh).list()).toEqual(before);
    }, 120_000);

    it("refuses empty, non-Pot and copied-code addresses without recording or sending", async () => {
      const before = {
        records: new PotStore(imports).list(),
        nonce: await base.publicClient.getTransactionCount({ address: IMPORTED.address }),
        balance: await base.publicClient.getBalance({ address: IMPORTED.address }),
      };
      const copy = getAddress("0x00000000000000000000000000000000000c0b1e");
      await base.testClient.setCode({
        address: copy,
        bytecode: (await base.publicClient.getCode({ address: minted.private }))!,
      });
      for (const pot of [IMPORTED.address, gateAnchors().kitchen, copy]) {
        expect((await importing("--pot", pot)).code).toBe(1);
        expect(new PotStore(imports).list()).toEqual(before.records);
        expect(await base.publicClient.getTransactionCount({ address: IMPORTED.address })).toBe(
          before.nonce,
        );
        expect(await base.publicClient.getBalance({ address: IMPORTED.address })).toBe(
          before.balance,
        );
      }
    }, 60_000);
  });
});
