/**
 * `sauce intent publish` with no file (`cli/create.ts`) and the `sauce intent` picker
 * (`cli/interactive.ts`), offline: every question answered by its flag, or at a scripted terminal;
 * with no terminal, the flags still missing named; and the file it writes, which compiles as an
 * ordinary intent file. Nothing here reaches a network: with no endpoint, the margin is not
 * estimated and says so.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Hex } from "viem";

import { UsageError } from "../src/cli/args.js";
import { compileProgram } from "../src/cli/commands.js";
import {
  createIntent,
  parseWhen,
  portalChains,
  publishableChains,
  sourceChains,
  type CreateInput,
} from "../src/cli/create.js";
import { PreviewChainError } from "../src/cli/support.js";
import { interactiveIntents } from "../src/cli/interactive.js";
import { intentRecord } from "../src/cli/lifecycle.js";
import { IntentStore } from "../src/cli/store.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { nodeIo } from "../src/cli/run.js";

const NOW = 1_900_000_000n;
const ME = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");

describe("making an intent: sauce intent publish with no file", () => {
  let work: string;
  beforeEach(() => (work = mkdtempSync(join(tmpdir(), "sauce-create-"))));
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const input = (overrides: Partial<CreateInput> = {}): CreateInput => ({
    given: {},
    endpoint: () => undefined,
    signer: ME,
    now: NOW,
    writeText: (path, text) => writeFileSync(path, text),
    exists: (path) => existsSync(path),
    ...overrides,
  });

  it("writes an intent to Solana: a base58 wallet, Solana's token, a file that compiles", async () => {
    const out = join(work, "to-solana.sauce.ts");
    const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const given = {
      source: "base",
      destination: "solana",
      // Solana's USDC by its mint: a registered one.
      token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "2",
      recipient: wallet,
      rewardToken: "USDC",
      reward: "2.1",
      prover: "HyperProver",
      fillDeadline: "+1h",
      rewardDeadline: "+2h",
      out,
    };
    const created = await createIntent(input({ given }));
    expect(created.destination.slug).toBe("solana");
    const text = readFileSync(out, "utf8");
    expect(text).toContain(`The recipient is the wallet ${wallet}`);
    expect(text).toContain(
      "USDC.transfer(0x7e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2, 2000000);",
    );
    expect(text).toMatch(/^Solana\(\(\) => \{$/m);
    // Solana's costs are not priced here, and it says so.
    expect(created.summary.join("\n")).toMatch(/not priced here/);
    const program = compileProgram(
      {
        file: out,
        text,
        chain: created.source,
        compactArgs: false,
        defines: {},
        intents: { deadline: created.deadline, creator: ME, prover: created.prover },
      },
      nodeIo(),
    );
    expect(program.intents.map((intent) => intent.destination.slug)).toEqual(["solana"]);
    // An EVM address, or a mint Solana does not register, is refused by name.
    await expect(
      createIntent(
        input({ given: { ...given, recipient: RECIPIENT, out: join(work, "a.sauce.ts") } }),
      ),
    ).rejects.toThrow(
      /--recipient: '0x6666666666666666666666666666666666666666' is not a solana address/,
    );
    await expect(
      createIntent(input({ given: { ...given, token: wallet, out: join(work, "b.sauce.ts") } })),
    ).rejects.toThrow(/--token: '9WzD.*' is not a token solana registers/);
  });

  it("writes an intent file from flags alone, which compiles as any intent file does", async () => {
    const out = join(work, "bridge.sauce.ts");
    const created = await createIntent(
      input({
        given: {
          source: "ethereum",
          destination: "base",
          token: "USDC",
          amount: "1.5",
          recipient: RECIPIENT,
          rewardToken: "USDC",
          reward: "1.6",
          prover: "HyperProver",
          fillDeadline: "+1h",
          rewardDeadline: "+1d",
          fundVia: "publishAndFund",
          out,
        },
      }),
    );
    expect(created.source.slug).toBe("ethereum");
    // Funded through the Portal, as the flag asks, and the file's republish line says so.
    expect(created.fundVia).toBe("publishAndFund");
    expect(created.destination.slug).toBe("base");
    expect(created.deadline).toBe(NOW + 3600n);
    expect(created.rewardDeadline).toBe(NOW + 86_400n);
    const text = readFileSync(out, "utf8");
    expect(text).toContain(`USDC.transfer(${RECIPIENT.toLowerCase()}, 1500000);`);
    expect(text).toContain("reward({ tokens: [{ token: USDC, amount: 1600000 }] })");
    expect(text).toContain(`sauce intent publish ${out} --chain ethereum`);
    expect(text).toContain("--intent-fund-via publishAndFund");
    // With no endpoint the solver's costs are not estimated, and it says so.
    expect(created.summary.join("\n")).toContain("no base endpoint");
    const program = compileProgram(
      {
        file: out,
        text,
        chain: created.source,
        defines: {},
        compactArgs: false,
        intents: {
          deadline: created.deadline,
          rewardDeadline: created.rewardDeadline,
          creator: ME,
          prover: created.prover,
        },
      },
      nodeIo(),
    );
    const [intent] = program.intents;
    expect(intent!.destination.slug).toBe("base");
    expect(intent!.intent.reward.deadline).toBe(NOW + 86_400n);
    expect(intent!.intent.route.deadline).toBe(NOW + 3600n);
    expect(intent!.intent.route.tokens[0]!.amount).toBe(1_500_000n);
  });

  it("asks what no flag gave, at a terminal, with the defaults it says", async () => {
    const asked: string[] = [];
    const answers = [
      String(publishableChains().findIndex((chain) => chain.slug === "ethereum") + 1), // source
      "", // destination: prompt shown, then answered below
    ];
    const destinations = publishableChains().filter((chain) => chain.slug !== "ethereum");
    answers[1] = String(destinations.findIndex((chain) => chain.slug === "base") + 1);
    const script = [
      ...answers,
      "", // token: USDC, the default
      "2", // amount
      "", // recipient: the signer
      "", // prover: the registry's
      "", // reward token: what is delivered
      "2.1", // reward: no suggestion without an endpoint, so one is typed
      "", // fill deadline: +1h
      "", // reward deadline: +25h
      "", // funding: a transfer to the vault, the default
    ];
    const out = join(work, "asked.sauce.ts");
    const created = await createIntent(
      input({
        given: { out },
        ask: async (question) => {
          asked.push(question);

          return script.shift();
        },
      }),
    );
    expect(script).toEqual([]);
    expect(asked[0]).toMatch(/^Source chain/);
    // Only the supported chains with a Portal are offered: every other one is a preview chain. A
    // source is an EVM chain, whose wallet publishes; Solana is a destination.
    expect(publishableChains().map((chain) => chain.slug)).toEqual(["ethereum", "base", "solana"]);
    expect(sourceChains().map((chain) => chain.slug)).toEqual(["ethereum", "base"]);
    expect(portalChains().length).toBeGreaterThan(2);
    expect(asked[0]).toContain("Ethereum (1)");
    expect(asked[0]).toContain("Base (8453)");
    expect(asked[0]).not.toContain("Arbitrum");
    expect(asked.some((question) => /Token to deliver on base/.test(question))).toBe(true);
    expect(asked.some((question) => /Recipient on base \[0x5a0Ce/.test(question))).toBe(true);
    expect(created.deadline).toBe(NOW + 3600n);
    expect(created.rewardDeadline).toBe(NOW + 25n * 3600n);
    expect(asked.some((question) => /^Funding: how the reward reaches/.test(question))).toBe(true);
    expect(created.fundVia).toBe("transfer");
    expect(readFileSync(out, "utf8")).toContain(`USDC.transfer(${ME.toLowerCase()}, 2000000);`);
    expect(readFileSync(out, "utf8")).not.toContain("--intent-fund-via");
  });

  it("with no terminal, names every flag still missing", async () => {
    await expect(createIntent(input({ given: { source: "ethereum" } }))).rejects.toThrow(
      new UsageError(
        "sauce intent publish has no terminal to ask on, and needs --destination, --token, " +
          "--amount, --recipient, --prover, --reward-token, --reward, --fill-deadline, " +
          "--reward-deadline: pass them as flags",
      ),
    );
  });

  it("refuses a chain with no Portal, one chain twice, and a reward deadline before the fill's", async () => {
    const given = {
      destination: "base",
      token: "USDC",
      amount: "1",
      recipient: RECIPIENT,
      rewardToken: "USDC",
      reward: "1",
      prover: "HyperProver",
      out: join(work, "x.sauce.ts"),
    };
    await expect(
      createIntent(
        input({ given: { ...given, source: "base", fillDeadline: "+1h", rewardDeadline: "+2h" } }),
      ),
    ).rejects.toThrow(/the source and the destination are the same chain/);
    await expect(
      createIntent(
        input({
          given: { ...given, source: "ethereum", fillDeadline: "+2h", rewardDeadline: "+1h" },
        }),
      ),
    ).rejects.toThrow(/the reward deadline is before the fill deadline/);
    await expect(
      createIntent(
        input({
          given: { ...given, source: "solana", fillDeadline: "+2h", rewardDeadline: "+3h" },
        }),
      ),
    ).rejects.toThrow(
      /--source solana: an intent made here is published from a wallet on an EVM chain/,
    );
    // A preview chain is refused before anything is asked of it or read from it.
    let read = false;
    await expect(
      createIntent(
        input({
          given: { ...given, source: "arbitrum", fillDeadline: "+1h", rewardDeadline: "+2h" },
          endpoint: () => {
            read = true;

            return undefined;
          },
        }),
      ),
    ).rejects.toThrow(PreviewChainError);
    expect(read).toBe(false);
  });

  it("reads a deadline as a unix second or a span from now", () => {
    expect(parseWhen("fill-deadline", "+90", NOW)).toBe(NOW + 90n);
    expect(parseWhen("fill-deadline", "+30m", NOW)).toBe(NOW + 1800n);
    expect(parseWhen("fill-deadline", "+2h", NOW)).toBe(NOW + 7200n);
    expect(parseWhen("fill-deadline", "+1d", NOW)).toBe(NOW + 86_400n);
    expect(parseWhen("fill-deadline", "2000000000", NOW)).toBe(2_000_000_000n);
    expect(() => parseWhen("fill-deadline", "tomorrow", NOW)).toThrow(/neither a unix second/);
  });
});

describe("the picker: sauce intent at a terminal", () => {
  it("lists the stored intents, and runs what is picked on the one picked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-picker-"));
    try {
      const store = new IntentStore(dir);
      const portal = ecoRoutesPortal("arbitrum");
      const record = intentRecord(
        {
          sourceChainId: 42161n,
          destination: 8453n,
          route: {
            salt: `0x${"00".repeat(32)}` as Hex,
            deadline: 2_000_000_000n,
            portal: `0x${"00".repeat(12)}${ecoRoutesPortal("base").slice(2).toLowerCase()}` as Hex,
            nativeAmount: 0n,
            tokens: [],
            calls: [],
          },
          reward: {
            deadline: 2_000_086_400n,
            creator: `0x${"00".repeat(12)}${ME.slice(2).toLowerCase()}` as Hex,
            prover: `0x${"00".repeat(12)}${"77".repeat(20)}` as Hex,
            nativeAmount: 0n,
            tokens: [],
          },
        },
        { sourcePortal: portal },
      );
      store.save(record);
      store.append(record.intentHash, {
        event: "published",
        chain: "arbitrum",
        chainId: 42161,
        time: "2026-10-01T00:00:00.000Z",
      });
      const script = ["1", "1", "8"]; // the intent, its status, quit
      const asked: string[] = [];
      let stdout = "";
      const code = await interactiveIntents(
        {
          ask: async (question) => {
            asked.push(question);

            return script.shift();
          },
          stdout: (text) => void (stdout += text),
          stderr: () => undefined,
        },
        {
          store,
          endpoint: () => undefined,
          approver: { auto: false, canAsk: false, approve: async () => undefined },
        },
      );
      expect(code).toBe(0);
      expect(asked[0]).toContain(`${record.intentHash.slice(0, 18)}…  arbitrum -> base  published`);
      expect(asked[1]).toMatch(/status\n.*fill, simulated/s);
      expect(stdout).toContain(`Intent ${record.intentHash}: arbitrum -> base`);
      expect(stdout).toContain("published arbitrum");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says when the store is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-picker-"));
    try {
      let stdout = "";
      await interactiveIntents(
        {
          ask: async () => undefined,
          stdout: (text) => void (stdout += text),
          stderr: () => undefined,
        },
        {
          store: new IntentStore(dir),
          endpoint: () => undefined,
          approver: { auto: false, canAsk: false, approve: async () => undefined },
        },
      );
      expect(stdout).toMatch(/^No intents in /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
