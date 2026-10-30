import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEther,
  zeroAddress,
  type Hex,
} from "viem";

import { PotStore } from "../src/cli/pot-store.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { keeping } from "../src/cli/keep.js";
import { requirePlanSendable, requireReleasePot } from "../src/cli/chain.js";
import { v12Kitchen, v12PotAbi } from "../src/evm/engine.js";
import {
  getVerifiedPotBinding,
  withPotBinding,
  type PotCandidate,
} from "../src/cli/pot-binding.js";
import { authenticatePot } from "../src/cli/pots.js";
import { runCommand } from "../src/cli/commands.js";
import { fundingFor } from "../src/cli/inputs.js";
import { nodeIo } from "../src/cli/run.js";
import { OWNER, OWNER_KEY, sauceWith, startChain, type LocalChain } from "./cli-anvil.js";

const candidateFile = process.env.SAUCE_LOCAL_CANDIDATE;
const suite = candidateFile ? describe : describe.skip;

// Requires the real paired factory, Pot and gated engine; no mocked authentication success.
suite("CLI explicit CREATE3 lifecycle", () => {
  let local: LocalChain;
  let work: string;
  let source: string;
  let candidate: PotCandidate;
  let pots: PotStore;

  beforeAll(async () => {
    candidate = JSON.parse(readFileSync(candidateFile!, "utf8")) as PotCandidate;
    work = mkdtempSync(join(tmpdir(), "sauce-create3-cli-"));
    source = join(work, "work.sauce.ts");
    writeFileSync(source, "function main(): Uint256 { return 42; }\n");
    pots = new PotStore(join(work, "pots"));
    local = await startChain("base");
    await local.testClient.setBalance({ address: OWNER.address, value: parseEther("10") });
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("refuses missing code, then deploys, authenticates and persists before ordinary signing", async () => {
    const label = "explicit-create3-cli";
    const salt = potSalt(label);
    const pot = v12PredictPot(OWNER.address, salt, getAddress(candidate.kitchen));
    const flags = [
      "--chain",
      "base",
      "--rpc-url",
      local.rpcUrl,
      "--pot-binding",
      candidateFile!,
      "--pots",
      pots.dir,
      "--private-key",
      OWNER_KEY,
    ];
    const absent = await sauceWith({}, "run", source, ...flags, "--salt", label, "--yes");
    expect(absent.code).toBe(1);
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
    expect(await local.publicClient.getTransactionCount({ address: OWNER.address })).toBe(0);

    const deployed = await sauceWith({}, "pot", "--deploy", ...flags, "--salt", label);
    if (deployed.code !== 0) throw new Error(deployed.stderr || deployed.stdout);
    const binding = pots.recordsOf(local.chain.id, pot).find((record) => record.binding)?.binding;
    expect(binding).toMatchObject({
      scheme: "create3",
      pot,
      compiler: candidate.compiler,
      engine: candidate.engine,
      router: candidate.router,
      profileHash: candidate.profileHash,
    });
    expect(binding?.codeHash).toMatch(/^0x[0-9a-f]{64}$/);
    await keeping({ stores: { pots }, say: () => undefined }, async () => {
      await expect(
        requirePlanSendable(local.publicClient, [
          {
            what: "wrong engine",
            tx: {
              to: pot,
              value: 0n,
              data: encodeFunctionData({
                abi: v12PotAbi,
                functionName: "cook",
                args: [OWNER.address, "0x01"],
              }),
            },
          },
        ]),
      ).rejects.toThrow(/engine/);
    });

    const signed = await sauceWith({}, "sign", source, ...flags, "--pot", pot, "--max-fee", "1234");
    expect(signed.code).toBe(0);
    expect(JSON.parse(signed.stdout)).toMatchObject({ pot, engine: binding!.engine });
    const funded = await sauceWith(
      {},
      "run",
      source,
      ...flags,
      "--pot",
      pot,
      "--fund",
      "native:0.001",
      "--yes",
    );
    expect(funded.code).toBe(0);
    expect(await local.publicClient.getBalance({ address: pot })).toBeGreaterThan(0n);
    expect(pots.recordsOf(local.chain.id, pot).find((record) => record.binding)?.binding).toEqual(
      binding,
    );

    await local.testClient.setCode({ address: pot, bytecode: "0x" as Hex });
    const missing = await sauceWith({}, "run", source, ...flags, "--salt", label, "--yes");
    expect(missing.code).toBe(1);
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
  }, 120_000);

  it("refuses a foreign getter Kitchen with the authentic candidate before recording, funding or signing", async () => {
    const salt = potSalt("foreign-kitchen-cli");
    const implementationSlot = await local.publicClient.getStorageAt({
      address: getAddress(candidate.kitchen),
      slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    });
    const implementation = getAddress(`0x${implementationSlot!.slice(-40)}`);
    const proxy = JSON.parse(
      readFileSync(join(dirname(candidateFile!), "V12KitchenProxy.json"), "utf8"),
    ) as { bytecode: Hex };
    const foreignKitchen = await local.plant(
      concat([
        proxy.bytecode,
        encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint256" }],
          [implementation, OWNER.address, 1n],
        ),
      ]),
    );
    await local.send(
      local.owner,
      foreignKitchen,
      encodeFunctionData({
        abi: v12Kitchen.abi,
        functionName: "setRouter",
        args: [candidate.router],
      }),
    );
    const pot = v12PredictPot(OWNER.address, salt, foreignKitchen);
    await local.send(
      local.deployer,
      foreignKitchen,
      v12Kitchen.encodeDeployPot(OWNER.address, salt),
    );
    expect(
      await local.publicClient.readContract({
        address: pot,
        abi: v12PotAbi,
        functionName: "kitchen",
      }),
    ).toBe(getAddress(foreignKitchen));
    const flags = [
      "--chain",
      "base",
      "--rpc-url",
      local.rpcUrl,
      "--pot-binding",
      candidateFile!,
      "--pots",
      pots.dir,
      "--pot",
      pot,
    ];
    const nonce = await local.publicClient.getTransactionCount({ address: OWNER.address });
    const balance = await local.publicClient.getBalance({ address: OWNER.address });
    for (const args of [
      ["pot", "import", ...flags],
      ["sign", source, ...flags, "--private-key", OWNER_KEY, "--max-fee", "1234"],
      ["run", source, ...flags, "--private-key", OWNER_KEY, "--fund", "native:0.001", "--yes"],
    ]) {
      const refused = await sauceWith({}, ...args);
      expect(refused.code).toBe(1);
      expect(pots.recordsOf(local.chain.id, pot)).toEqual([]);
    }
    expect(await local.publicClient.getTransactionCount({ address: OWNER.address })).toBe(nonce);
    expect(await local.publicClient.getBalance({ address: OWNER.address })).toBe(balance);
    expect(await local.publicClient.getBalance({ address: pot })).toBe(0n);
  }, 120_000);

  it("reauthenticates an owner-updated Router only through explicit descriptor import", async () => {
    const label = "router-update-cli";
    const salt = potSalt(label);
    const pot = v12PredictPot(OWNER.address, salt, getAddress(candidate.kitchen));
    const flags = ["--chain", "base", "--rpc-url", local.rpcUrl, "--pots", pots.dir];
    expect(
      (
        await sauceWith(
          {},
          "pot",
          "--deploy",
          ...flags,
          "--private-key",
          OWNER_KEY,
          "--pot-binding",
          candidateFile!,
          "--salt",
          label,
        )
      ).code,
    ).toBe(0);
    const original = pots.recordsOf(local.chain.id, pot)[0]!;
    const originalBytes = readFileSync(
      join(pots.dir, String(local.chain.id), `${pot.toLowerCase()}.json`),
      "utf8",
    );
    const artifact = JSON.parse(
      readFileSync(join(dirname(candidateFile!), "Router.json"), "utf8"),
    ) as { bytecode: Hex };
    const router = await local.plant(artifact.bytecode);
    const routerCodeHash = keccak256((await local.publicClient.getCode({ address: router }))!);
    await local.send(
      local.owner,
      pot,
      encodeFunctionData({ abi: v12PotAbi, functionName: "setRouter", args: [router] }),
    );
    const nonce = await local.publicClient.getTransactionCount({ address: OWNER.address });
    const potBalance = await local.publicClient.getBalance({ address: pot });
    const stale = await sauceWith(
      {},
      "sign",
      source,
      ...flags,
      "--private-key",
      OWNER_KEY,
      "--pot",
      pot,
      "--max-fee",
      "1234",
    );
    expect(stale.code).toBe(1);
    const staleFunding = await sauceWith(
      {},
      "run",
      source,
      ...flags,
      "--private-key",
      OWNER_KEY,
      "--pot",
      pot,
      "--fund",
      "native:0.001",
      "--yes",
    );
    expect(staleFunding.code).toBe(1);
    expect(await local.publicClient.getTransactionCount({ address: OWNER.address })).toBe(nonce);
    expect(await local.publicClient.getBalance({ address: pot })).toBe(potBalance);
    expect(pots.recordsOf(local.chain.id, pot)).toEqual([original]);
    const descriptor = join(work, "updated-router.json");
    writeFileSync(descriptor, JSON.stringify({ ...candidate, router, routerCodeHash }));
    expect(
      (await sauceWith({}, "pot", "import", ...flags, "--pot", pot, "--pot-binding", descriptor))
        .code,
    ).toBe(0);
    const records = pots.recordsOf(local.chain.id, pot);
    expect(records).toHaveLength(2);
    expect(records[1]!.binding).toEqual({ ...original.binding, router, routerCodeHash });
    expect(
      readFileSync(join(pots.dir, String(local.chain.id), `${pot.toLowerCase()}.json`), "utf8"),
    ).toBe(originalBytes);
    expect(
      (
        await sauceWith(
          {},
          "sign",
          source,
          ...flags,
          "--private-key",
          OWNER_KEY,
          "--pot",
          pot,
          "--max-fee",
          "1234",
        )
      ).code,
    ).toBe(0);

    await withPotBinding(records[1]!.binding, async () => {
      expect(getVerifiedPotBinding()).toBeUndefined();
      expect(await authenticatePot(local.publicClient, OWNER.address, pot)).toBe("own");
      await requireReleasePot(local.publicClient, local.chain, pot);
      expect(getVerifiedPotBinding()).toEqual(records[1]!.binding);
      const approver = { auto: true, canAsk: false, approve: async () => true };
      const funded = await runCommand(
        {
          file: source,
          text: "function main(): Uint256 { return 42; }",
          chain: local.chain,
          defines: {},
          target: { pot },
          rpcUrl: local.rpcUrl,
          account: OWNER,
          approver,
          fund: fundingFor({
            chain: local.chain,
            rpcUrl: local.rpcUrl,
            fund: ["native:0.001"],
            sweep: false,
            send: true,
            account: OWNER,
            approver,
          }),
        },
        nodeIo(),
      );
      expect(funded.json.pot).toBe(pot);
      expect(await local.publicClient.getBalance({ address: pot })).toBeGreaterThan(potBalance);
      expect(pots.recordsOf(local.chain.id, pot)).toEqual(records);
    });
    expect(getVerifiedPotBinding()).toBeUndefined();
  }, 120_000);

  it.each(["private-fixed-router", "shared"] as const)(
    "refuses a release-Router mismatch for %s imports",
    async (kind) => {
      const salt = potSalt(`fixed-router-${kind}`);
      const owner = kind === "shared" ? zeroAddress : OWNER.address;
      const pot = v12PredictPot(owner, salt, getAddress(candidate.kitchen), true);
      await local.send(
        local.deployer,
        getAddress(candidate.kitchen),
        kind === "shared"
          ? v12Kitchen.encodeDeploySharedPot(salt)
          : v12Kitchen.encodeDeployPot(owner, salt, true),
      );
      const descriptor = join(work, `wrong-router-${kind}.json`);
      writeFileSync(
        descriptor,
        JSON.stringify({
          ...candidate,
          router: candidate.engine,
          routerCodeHash: candidate.engineCodeHash,
        }),
      );
      const refused = await sauceWith(
        {},
        "pot",
        "import",
        "--chain",
        "base",
        "--rpc-url",
        local.rpcUrl,
        "--pots",
        pots.dir,
        "--pot",
        pot,
        "--pot-binding",
        descriptor,
      );
      expect(refused.code).toBe(1);
      expect(refused.stderr).toMatch(/fixed Router|release Router|fixedRouter/);
      expect(pots.recordsOf(local.chain.id, pot)).toEqual([]);
    },
    120_000,
  );
});
