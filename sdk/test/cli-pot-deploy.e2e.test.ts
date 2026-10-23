/**
 * No one runs a deploy step of their own: a command deploys the Pot it cooks on when the Pot has no
 * code yet, through the released gated stack on a local anvil (`cli-anvil.ts`). `sauce run` asks
 * first — "Your Pot … isn't deployed yet. Deploy it now (one transaction, about … gas, ~… ETH),
 * then run? [deploy/cancel]" — and `-y`/`--yes` deploys without asking; with no terminal, or with
 * `--json`, nothing is sent until `--yes`, the refusal naming the deploy. `sauce tx` plans the
 * deploy first and the cook after it, and plans the cook alone once the Pot is there.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWalletClient,
  decodeFunctionData,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { gasEstimate, type Approver, type SetupStep } from "../src/cli/approvals.js";
import { runCommand, txCommand, type RunInput } from "../src/cli/commands.js";
import type { CliIo } from "../src/cli/run.js";
import { nodeIo } from "../src/cli/run.js";
import { requireChain } from "../src/chains/canonical.js";
import { v12KitchenAddress } from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12KitchenAbi } from "../src/evm/engine.js";
import { describeEvm, potOwner, sauceWith, startChain, type LocalChain } from "./cli-anvil.js";

/** A program that needs no token: what is under test is the Pot it runs on. */
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

/** No terminal, and nothing to answer: what a pipe, CI or an agent's shell gives the command. */
const NO_TERMINAL: Partial<CliIo> = { canAsk: () => false, confirm: async () => undefined };

describeEvm("a command deploys the Pot it needs", () => {
  let local: LocalChain;
  let work: string;
  let program: string;
  const kitchen = getAddress(v12KitchenAddress());

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-deploy-e2e-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
    local = await startChain("ethereum");
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  /** A fresh owner with ETH and no Pot: its key, address, and the Pot `label` names. */
  async function owner(label: string) {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    await local.testClient.setBalance({ address, value: parseEther("10") });
    const salt = potSalt(label);

    return { key, address, salt, pot: getAddress(v12PredictPot(address, salt) as Address) };
  }

  const run = (io: Partial<CliIo>, key: Hex, label: string, ...more: string[]) =>
    sauceWith(
      io,
      ...["run", program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
      ...["--private-key", key, "--salt", label, ...more, "--args", "41"],
    );

  /** Nothing was sent from `address`, and its Pot has no code. */
  async function nothingSent(address: Address, pot: Address): Promise<void> {
    expect(await local.publicClient.getTransactionCount({ address })).toBe(0);
    expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
  }

  it("sauce tx plans the Pot's deploy first, then the cook", async () => {
    const fresh = await owner("planned");
    const tx = (...more: string[]) =>
      sauceWith(
        NO_TERMINAL,
        ...["tx", program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
        ...["--owner", fresh.address, "--salt", "planned", ...more, "--args", "41"],
      );
    const planned = await tx();
    expect(planned.code).toBe(0);
    const plan = JSON.parse(planned.stdout) as {
      chainId: number;
      pot: string;
      transactions: Array<{
        what: string;
        deploysPot?: string;
        to: string;
        data: Hex;
        value: string;
      }>;
    };
    expect(plan).toMatchObject({ chainId: 1, pot: fresh.pot });
    expect(plan).not.toHaveProperty("to");
    const [deploy, cook] = plan.transactions;
    expect(plan.transactions).toHaveLength(2);
    expect(deploy).toMatchObject({ deploysPot: fresh.pot, chainId: 1, value: "0x0" });
    expect(getAddress(deploy!.to)).toBe(kitchen);
    expect(decodeFunctionData({ abi: v12KitchenAbi, data: deploy!.data })).toMatchObject({
      functionName: "deployPot",
      args: [fresh.address, fresh.salt],
    });
    expect(getAddress(cook!.to)).toBe(fresh.pot);
    expect(BigInt(cook!.value)).toBeGreaterThan(0n);
    expect(planned.stderr).toContain(
      `Your Pot ${fresh.pot} on ethereum isn't deployed yet: the first transaction deploys it`,
    );
    // As cast lines: the deploy, then the cook.
    const cast = await tx("--format", "cast");
    expect(cast.stdout.trim().split("\n")).toEqual([
      expect.stringMatching(new RegExp(`^cast send ${kitchen} ${deploy!.data} --rpc-url `, "i")),
      expect.stringMatching(new RegExp(`^cast send ${fresh.pot} ${cook!.data} --value \\d+ `, "i")),
    ]);
    // Sent as planned, in order, the cook runs on the Pot the first one deployed.
    const sender = createWalletClient({
      account: privateKeyToAccount(fresh.key),
      transport: http(local.rpcUrl),
    });
    for (const each of plan.transactions) {
      await local.send(sender, getAddress(each.to), each.data, BigInt(each.value));
    }
    expect(await potOwner(local, fresh.pot)).toBe(fresh.address);
    // With the Pot there, the cook alone, as ever.
    const alone = JSON.parse((await tx()).stdout) as Record<string, unknown>;
    expect(alone).toMatchObject({ chainId: 1, to: fresh.pot });
    expect(alone).not.toHaveProperty("transactions");
  }, 120_000);

  it("with no terminal, sends nothing and names the deploy and --yes", async () => {
    const fresh = await owner("unasked");
    const refused = await run(NO_TERMINAL, fresh.key, "unasked");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      "nothing was sent: this run needs an approval, and there is no terminal to ask on:\n" +
        `  deploy Pot ${fresh.pot}\nPass --yes (-y) to approve them`,
    );
    await nothingSent(fresh.address, fresh.pot);
  }, 120_000);

  it("with --json, asks nothing even at a terminal, and sends nothing without --yes", async () => {
    const fresh = await owner("json");
    const questions: string[] = [];
    const refused = await run(
      {
        canAsk: () => true,
        confirm: async (question) => {
          questions.push(question);

          return true;
        },
      },
      fresh.key,
      "json",
      "--json",
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      `this run needs an approval, and --json asks nothing:\n  deploy Pot ${fresh.pot}\n` +
        "Pass --yes (-y)",
    );
    expect(questions).toEqual([]);
    await nothingSent(fresh.address, fresh.pot);
    // With --yes, the same run deploys and cooks, and says so in its JSON.
    const sent = await run(NO_TERMINAL, fresh.key, "json", "--json", "--yes");
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.stdout)).toMatchObject({
      pot: fresh.pot,
      deployPot: { status: "success" },
      cook: { status: "success" },
    });
  }, 120_000);

  it("at a terminal, asks with the deploy's gas: cancel sends nothing, deploy deploys then cooks", async () => {
    const fresh = await owner("asked");
    const QUESTION = new RegExp(
      `^Your Pot ${fresh.pot} on ethereum isn't deployed yet\\. Deploy it now \\(one ` +
        "transaction, about [\\d,]+ gas, ~[\\d.]+ ETH\\), then run\\? \\[deploy/cancel\\] $",
    );
    const asked: string[] = [];
    const answering = (answer: boolean): Partial<CliIo> => ({
      canAsk: () => true,
      confirm: async (question) => {
        asked.push(question);

        return answer;
      },
    });
    const cancelled = await run(answering(false), fresh.key, "asked");
    expect(cancelled.code).toBe(1);
    expect(asked).toEqual([expect.stringMatching(QUESTION)]);
    expect(cancelled.stderr).toContain(
      `Your Pot ${fresh.pot} on ethereum isn't deployed yet, so nothing was sent: run again and ` +
        "answer deploy, or pass --yes (-y), or deploy it yourself with sauce pot --deploy",
    );
    await nothingSent(fresh.address, fresh.pot);

    const deployed = await run(answering(true), fresh.key, "asked");
    expect(deployed.code).toBe(0);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatch(QUESTION);
    const lines = deployed.stdout.split("\n").filter((line) => !line.startsWith("  "));
    expect(lines[0]).toMatch(new RegExp(`^deployed Pot ${fresh.pot} in 0x[0-9a-f]{64}: success`));
    expect(lines[1]).toMatch(/^cook 0x[0-9a-f]{64}: success/);
    expect(await potOwner(local, fresh.pot)).toBe(fresh.address);
    // Once it is there, nothing is asked.
    const again = await run(answering(true), fresh.key, "asked");
    expect(again.code).toBe(0);
    expect(asked).toHaveLength(2);
  }, 120_000);

  it("asks once for the Pot and a command's own setup on another chain, and sends both before the cook", async () => {
    // A second chain, where a command's setup step (here, one wei to a recipient) is sent: what a
    // remote message's destination setup is, with the Pot's deployment in the same question.
    const other = await startChain("base");
    try {
      const fresh = await owner("set-up");
      await other.testClient.setBalance({ address: fresh.address, value: parseEther("1") });
      const recipient = privateKeyToAccount(generatePrivateKey()).address;
      const setup: RunInput["setup"] = async (reach) => {
        const there = await reach.on(other.chain);
        const tx = { to: recipient, data: "0x" as Hex, value: 1n };

        return [
          {
            action: `pay ${recipient} on base`,
            reason: `The setup on base is not done yet`,
            offer: "Do it now",
            estimate: await gasEstimate(there.client, there.from!, tx, other.chain),
            planned: {
              what: "the setup on base",
              chainId: other.chain.id,
              to: tx.to,
              data: tx.data,
              value: "0x1",
            },
            send: () => there.send!(tx),
          } satisfies SetupStep,
        ];
      };
      const input = (approver: Approver): RunInput => ({
        file: program,
        text: PROGRAM,
        chain: requireChain("ethereum"),
        defines: {},
        target: { owner: fresh.address, salt: fresh.salt },
        args: { from: "--args", values: ["41"] },
        rpcUrl: local.rpcUrl,
        endpointOf: (chain) => (chain.id === other.chain.id ? other.rpcUrl : undefined),
        account: privateKeyToAccount(fresh.key),
        approver,
        setup,
      });
      // One question for both, listing them; cancelled, nothing is sent on either chain.
      const asked: string[] = [];
      await expect(
        runCommand(
          input({
            auto: false,
            canAsk: true,
            approve: async (_action, question) => (asked.push(question), false),
          }),
          nodeIo(),
        ),
      ).rejects.toThrow(
        `${`Your Pot ${fresh.pot} on ethereum isn't deployed yet`}; The setup on base is not done yet, ` +
          "so nothing was sent",
      );
      expect(asked).toHaveLength(1);
      expect(asked[0]!.split("\n").slice(0, 3)).toEqual([
        "Before it can run, it sends 2 transactions:",
        expect.stringMatching(
          new RegExp(`^  1\\. Your Pot ${fresh.pot} on ethereum isn't deployed yet: deploy Pot`),
        ),
        expect.stringMatching(
          /^ {2}2\. The setup on base is not done yet: pay 0x[0-9a-fA-F]{40} on base \(about [\d,]+ gas/,
        ),
      ]);
      await nothingSent(fresh.address, fresh.pot);
      // Approved, both go first, in order, then the cook.
      const approved: string[] = [];
      const done = await runCommand(
        input({
          auto: true,
          canAsk: true,
          approve: async (action) => (approved.push(action), true),
        }),
        nodeIo(),
      );
      expect(approved).toEqual([`deploy Pot ${fresh.pot}`, `pay ${recipient} on base`]);
      expect(done.json).toMatchObject({
        deployPot: { status: "success" },
        setup: [{ what: `pay ${recipient} on base`, status: "success" }],
        cook: { status: "success" },
      });
      expect(await other.publicClient.getBalance({ address: recipient })).toBe(1n);
      // Unsigned, the same setup leads the plan, after the Pot's deployment.
      const plan = await txCommand(
        {
          ...input({ auto: false, canAsk: false, approve: async () => undefined }),
          target: { owner: fresh.address, salt: potSalt("set-up-plan") },
        },
        nodeIo(),
      );
      expect(
        (plan.json.transactions as Array<{ what: string; chainId?: number }>).map((tx) => [
          tx.what.split(":")[0],
          tx.chainId ?? null,
        ]),
      ).toEqual([
        [expect.stringMatching(/^Kitchen\.deployPot\(/), local.chain.id],
        ["the setup on base", other.chain.id],
        [expect.stringMatching(/^cook on Pot /), local.chain.id],
      ]);
    } finally {
      await other.stop();
    }
  }, 120_000);

  it("-y deploys the Pot without asking, then cooks", async () => {
    const fresh = await owner("yes");
    const sent = await run(NO_TERMINAL, fresh.key, "yes", "-y");
    expect(sent.code).toBe(0);
    expect(sent.stderr).toContain(`auto-approved: deploy Pot ${fresh.pot}`);
    expect(sent.stdout).toMatch(new RegExp(`^deployed Pot ${fresh.pot} in 0x`, "m"));
    expect(sent.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
    expect(await potOwner(local, fresh.pot)).toBe(fresh.address);
    // The older name does the same.
    const older = await owner("older");
    expect((await run(NO_TERMINAL, older.key, "older", "--auto-approve")).code).toBe(0);
    expect(await potOwner(local, older.pot)).toBe(older.address);
  }, 120_000);
});
