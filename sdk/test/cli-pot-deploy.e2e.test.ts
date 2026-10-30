/** Implicit EVM deployment is removed. Exercise refusal against the real local gated stack. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { rehearse } from "../src/cli/rehearse.js";
import {
  describeEvm,
  DEPLOYER,
  DEPLOYER_KEY,
  sauceWith,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import { keeping } from "../src/cli/keep.js";
import { POT_SCHEMA, PotStore } from "../src/cli/pot-store.js";
import { withPotCandidate } from "../src/cli/pot-binding.js";
import { runCommand } from "../src/cli/commands.js";
import { signCommand } from "../src/cli/sign.js";
import { nodeIo } from "../src/cli/run.js";

const candidateFlags = process.env.SAUCE_LOCAL_CANDIDATE
  ? ["--pot-binding", process.env.SAUCE_LOCAL_CANDIDATE]
  : [];
describeEvm("missing Pots never trigger implicit deployment", () => {
  let local: LocalChain;
  let work: string;
  let source: string;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-explicit-deploy-"));
    source = join(work, "ordinary.sauce.ts");
    writeFileSync(source, "function main(): Uint256 { return 42; }\n");
    local = await startChain("base");
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it.each(["tx", "simulate", "run", "sign"])(
    "%s refuses a missing owner/salt Pot without sending",
    async (command) => {
      const key = generatePrivateKey();
      const owner = privateKeyToAccount(key).address;
      const salt = potSalt(`missing-${command}`);
      const pot = v12PredictPot(owner, salt);
      await local.testClient.setBalance({ address: owner, value: parseEther("10") });
      const result = await sauceWith(
        { potsDir: join(work, command), canAsk: () => true, confirm: async () => true },
        command,
        source,
        "--chain",
        "base",
        "--rpc-url",
        local.rpcUrl,
        ...candidateFlags,
        "--salt",
        `missing-${command}`,
        ...(command === "run" || command === "sign" ? ["--private-key", key] : ["--owner", owner]),
        ...(command === "run" ? ["--yes"] : []),
        ...(command === "sign" ? ["--max-fee", "1234"] : []),
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/deploy|no code|missing/i);
      expect(await local.publicClient.getTransactionCount({ address: owner })).toBe(0);
      expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
      expect(await local.publicClient.getBalance({ address: owner })).toBe(parseEther("10"));
    },
    120_000,
  );

  it("refuses a missing explicit Pot while preparing an existing authenticated Pot", async () => {
    const pot = getAddress("0x3333333333333333333333333333333333333333");
    const flags = ["--chain", "base", "--rpc-url", local.rpcUrl, ...candidateFlags];
    const existing = await sauceWith({}, "tx", source, ...flags, "--pot", local.seedPot);
    expect(existing.code).toBe(0);
    const result = await sauceWith({}, "tx", source, ...flags, "--pot", pot);
    expect(result.code).toBe(1);
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
  }, 120_000);

  it("does not treat counterfactual rehearsal or balance overrides as runtime authentication", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const salt = potSalt("counterfactual-rehearsal");
    const pot = v12PredictPot(owner, salt);
    const result = await rehearse(local.publicClient, {
      owner,
      pot,
      deploy: { salt },
      cook: { to: pot, data: "0x", value: 0n },
      overrides: [{ address: pot, balance: parseEther("10") }],
    });
    expect(result).toMatchObject({ ok: false, stage: "deploy" });
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
    expect(await local.publicClient.getBalance({ address: pot })).toBe(0n);
  }, 120_000);

  it("keeps deployed compiler, engine, Router and address for ordinary new work across default changes", async () => {
    const binding = await local.bindingOf(local.seedPot);
    const store = new PotStore(join(work, "retained"));
    store.save({
      schema: POT_SCHEMA,
      chain: local.chain.slug,
      chainId: local.chain.id,
      pot: binding.pot,
      owner: binding.owner,
      salt: binding.userSalt,
      kind: binding.kind,
      kitchen: binding.kitchen,
      engine: binding.engine,
      release: binding.release,
      binding,
      sdk: "test",
      origin: "imported",
      recordedAt: "2026-10-31T00:00:00.000Z",
    });
    const input = {
      file: source,
      text: "function main(): Uint256 { return 42; }",
      chain: local.chain,
      defines: {},
      target: { owner: binding.owner, salt: binding.userSalt },
      rpcUrl: local.rpcUrl,
    };
    await keeping({ stores: { pots: store }, say: () => undefined }, async () =>
      withPotCandidate(
        {
          ...binding,
          compiler: "unrelated-default-compiler",
          engine: getAddress("0x3333333333333333333333333333333333333333"),
        },
        async () => {
          const run = await runCommand(
            {
              ...input,
              account: privateKeyToAccount(DEPLOYER_KEY),
              approver: { auto: true, canAsk: false, approve: async () => true },
            },
            nodeIo(),
          );
          expect(run.json.pot).toBe(binding.pot);
          const signed = await signCommand(
            { ...input, maxExecutionFee: 1234n },
            nodeIo(),
            DEPLOYER,
          );
          expect(signed.json.engine).toBe(binding.engine);
          expect(store.recordsOf(local.chain.id, binding.pot)[0]!.binding).toEqual(binding);
        },
      ),
    );
  }, 120_000);
});
