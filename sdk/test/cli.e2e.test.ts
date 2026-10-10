/**
 * The `sauce` command against a chain: what it prints, sent, lands. On local anvils running the
 * released gated stack (`cli-anvil.ts` over `evm/gated-engine.ts`, deployed from the pinned creation
 * code), with the released engine at the address the SDK records, so the CLI runs with no override.
 *
 * Ethereum, the suites' smallest program (`fixtures/cli/pay.sauce.ts`):
 *   1. `sauce tx --rpc-url` before the Pot exists says so, and names the `sauce pot` to run;
 *   2. `sauce pot` prints the Kitchen.deployPot transaction — sent, it lands the Pot it predicted;
 *   3. the Pot is funded with a standard ERC-20 and a USDT-shaped one (no return values), planted
 *      at the registry's USDC and USDT addresses so the program names them as the SDK does;
 *   4. `sauce tx --rpc-url` reads the Kitchen's (non-zero) fee and the Pot's owner; its
 *      `{ to, data, value }`, sent from the owner with viem, pays the recipient in both tokens;
 *   5. the `cast send` line `sauce tx` prints is run VERBATIM through a shell — only its two
 *      `<…>` placeholders filled — and its effect asserted too.
 *
 * Base and Ethereum, `fixtures/cli/split.sauce.ts`: ONE source with a typed `main(token: Address,
 * recipients: Address[], amount: Uint256, alsoUsdc: bool)`, compiled for each chain (so `USDC` is
 * each chain's own; on Arbitrum too, a preview chain, where its cook is refused), its arguments
 * encoded by `sauce tx --args`, executed on each chain's anvil —
 * and read back off the chain by `sauce inspect <hash>` against the source. A settle cook sent there
 * is read back by `sauce verify <hash>`, and a cook that is not one is rejected.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it — or without `cast` — in CI.
 */
import { spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { v12EngineAddress, v12KitchenAddress } from "../src/deployments/index.js";
import { potSalt, SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { SETTLE_VECTORS, SETTLE_WIRE, settlePayload } from "../src/verify/index.js";
import { v12Pot } from "../src/evm/engine.js";
import {
  CLI_FIXTURES,
  KEYSTORE_PASSWORD_FILE,
  deployPot,
  describeEvm,
  FEE,
  fixture,
  jsonOf,
  laggingEndpoint,
  OTHER_KEY,
  OWNER,
  OWNER_KEY,
  potOwner,
  registered,
  sauce,
  sauceWith,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import { freePort, spawnAnvil } from "./anvil-process.js";
import * as gated from "./evm/gated-engine.js";

const HAS_CAST = spawnSync("cast", ["--version"], { stdio: "ignore" }).status === 0;
if (!HAS_CAST && process.env.CI) {
  throw new Error("`cast` is not on PATH in CI: Foundry is installed there, so this is a failure.");
}

/** The suites' programs (the `sauce-cli` skill's own are executed by `cli-examples.e2e.test.ts`). */
const PAY = join(CLI_FIXTURES, "pay.sauce.ts");
const SPLIT = join(CLI_FIXTURES, "split.sauce.ts");

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const SECOND_RECIPIENT: Address = "0x7777777777777777777777777777777777777777";
const AMOUNT = 1_000_000n;
const FUNDED = 10_000_000n;

const USDT_CREATION = `${fixture("NoReturnERC20")}${encodeAbiParameters(
  [{ type: "string" }, { type: "string" }, { type: "uint8" }],
  ["Tether USD", "USDT", 6],
).slice(2)}` as Hex;

describeEvm("sauce, sent to a chain", () => {
  let ethereum: LocalChain;
  let work: string;
  let usdc: Address;
  let usdt: Address;
  let pot: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-e2e-"));
    ethereum = await startChain("ethereum");
    // The registry's tokens, as code at their registered addresses: a standard OpenZeppelin ERC-20
    // as USDC, and a USDT-shaped one whose writes return nothing as USDT.
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    usdt = await ethereum.plant(USDT_CREATION, registered(ethereum.chain, "USDT"));
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await ethereum?.stop();
  });

  // `pay.sauce.ts` names no chain and takes `main(recipient: Address, amount: Uint256)` at run
  // time: `--args-json` is the one argument flag that need not come last.
  const defines = (recipient: Address, amount = AMOUNT): string[] => [
    "--chain",
    "ethereum",
    "--args-json",
    JSON.stringify([recipient, amount.toString()]),
  ];

  describe("the unsigned transactions, sent by a wallet", () => {
    it("`sauce tx` says the Pot is not deployed yet, and how to deploy it", async () => {
      const run = await sauce(
        "tx",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
      );
      expect(run.code).toBe(0);
      expect(jsonOf(run).value).toBe(FEE.toString());
      expect(run.stderr).toContain(
        `It is NOT deployed. Deploy it first (sauce pot --deploy --owner ${OWNER.address} --chain ethereum --keystore <keystore>), then fund it.`,
      );
      expect(run.stdout + run.stderr).not.toContain(ethereum.rpcUrl);
    }, 60_000);

    it("`sauce pot` prints the deploy transaction, and it lands the Pot it predicted", async () => {
      const predicted = jsonOf(await sauce("pot", "--owner", OWNER.address, "--chain", "ethereum"))
        .pot as Address;
      expect(await ethereum.publicClient.getCode({ address: predicted })).toBeUndefined();
      pot = await deployPot(ethereum);
      expect(pot).toBe(predicted);
      expect(await ethereum.publicClient.getCode({ address: pot })).toMatch(/^0x[0-9a-f]{2,}/);
      expect(await potOwner(ethereum, pot)).toBe(OWNER.address);
    }, 60_000);

    it("`sauce tx`, sent as printed, pays the recipient in USDC and USDT from the Pot", async () => {
      for (const token of [usdc, usdt]) await ethereum.mint(token, pot, FUNDED);
      const run = await sauce(
        "tx",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
      );
      const out = jsonOf(run);
      expect(out).toEqual({
        chainId: 1,
        to: pot,
        data: expect.stringMatching(/^0x[0-9a-f]+$/),
        value: FEE.toString(),
      });
      expect(run.stderr).toContain("It is deployed.");
      const kitchenBefore = await ethereum.publicClient.getBalance({
        address: gated.gateAnchors().kitchen,
      });

      await ethereum.send(
        ethereum.owner,
        out.to as Address,
        out.data as Hex,
        BigInt(out.value as string),
      );

      expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);
      expect(await ethereum.balanceOf(usdt, RECIPIENT)).toBe(AMOUNT);
      expect(await ethereum.balanceOf(usdc, pot)).toBe(FUNDED - AMOUNT);
      expect(await ethereum.balanceOf(usdt, pot)).toBe(FUNDED - AMOUNT);
      expect(await ethereum.publicClient.getBalance({ address: gated.gateAnchors().kitchen })).toBe(
        kitchenBefore + FEE,
      );
    }, 60_000);

    it("refuses a --value below the Kitchen's fee, which the cook would revert on", async () => {
      const run = await sauce(
        "tx",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        "--value",
        "1",
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(
        new RegExp(`--value 1 is below the Kitchen's execution fee on ethereum, ${FEE} wei`),
      );
    }, 60_000);

    // The ONE test that needs Foundry: `--format cast` is optional output, and this keeps it right.
    (HAS_CAST ? it : it.skip)(
      "the `--format cast` line, run verbatim, lands",
      async () => {
        // The zero-import `@sauce/token` function this time, on a Pot named outright, fee given.
        const program = join(work, "usdt.sauce.ts");
        writeFileSync(program, "// @chain ethereum\ntransfer(USDT, RECIPIENT, AMOUNT);\n");
        const run = await sauce(
          "tx",
          program,
          "--pot",
          pot,
          // A script: its values are defines, not `main`'s arguments.
          "--define",
          `RECIPIENT=${SECOND_RECIPIENT}`,
          "--define",
          `AMOUNT=${AMOUNT}`,
          "--value",
          String(FEE),
          "--format",
          "cast",
        );
        const line = run.stdout.trim();
        expect(line).toMatch(/^cast send .* --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>$/);
        const command = line
          .replace("<RPC_URL>", ethereum.rpcUrl)
          .replace("<PRIVATE_KEY>", OWNER_KEY);

        const cast = spawnSync("sh", ["-c", command], { encoding: "utf8" });
        expect(cast.stderr).toBe("");
        expect(cast.status).toBe(0);
        expect(cast.stdout).toMatch(/status\s+1 \(success\)/);

        expect(await ethereum.balanceOf(usdt, SECOND_RECIPIENT)).toBe(AMOUNT);
        expect(await ethereum.balanceOf(usdt, pot)).toBe(FUNDED - 2n * AMOUNT);
      },
      60_000,
    );
  });

  describe("the CLI on its own: pot --deploy, simulate, run", () => {
    // Anvil's third and fourth dev accounts: one signing with a keystore, one with a raw key.
    const KEYSTORE = [
      "--keystore",
      join(CLI_FIXTURES, "anvil-2.keystore.json"),
      "--password-file",
      KEYSTORE_PASSWORD_FILE,
    ];
    const KEYSTORE_OWNER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    const RAW_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
    const RAW_OWNER = privateKeyToAccount(RAW_KEY).address;
    const THIRD_RECIPIENT: Address = "0x8888888888888888888888888888888888888888";
    let labelled: Address;

    it("`sauce pot --deploy` deploys the signer's labelled Pot once, where `potSalt` puts it", async () => {
      labelled = v12PredictPot(KEYSTORE_OWNER, potSalt("e2e")) as Address;
      const out = jsonOf(
        await sauce(
          "pot",
          "--deploy",
          "--chain",
          "ethereum",
          "--salt",
          "e2e",
          "--rpc-url",
          ethereum.rpcUrl,
          ...KEYSTORE,
        ),
      );
      expect(out).toMatchObject({ pot: labelled, owner: KEYSTORE_OWNER, deployed: true });
      expect((out.deployPot as { status: string }).status).toBe("success");
      expect(await potOwner(ethereum, labelled)).toBe(KEYSTORE_OWNER);
      const again = await sauce(
        "pot",
        "--deploy",
        "--chain",
        "ethereum",
        "--salt",
        "e2e",
        "--rpc-url",
        ethereum.rpcUrl,
        ...KEYSTORE,
      );
      expect(again.code).toBe(0);
      expect(again.stderr).toContain(
        `Pot ${labelled} is already deployed on ethereum, owned by ${KEYSTORE_OWNER}.`,
      );
      // `sauce tx --owner --salt` derives the same Pot the signer deployed.
      const tx = jsonOf(
        await sauce(
          "tx",
          PAY,
          "--owner",
          KEYSTORE_OWNER,
          "--salt",
          "e2e",
          ...defines(RECIPIENT),
          "--value",
          "0",
        ),
      );
      expect(tx.to).toBe(labelled);
    }, 60_000);

    it("`sauce simulate` rehearses the cook from the Pot's owner, and decodes a revert", async () => {
      for (const token of [usdc, usdt]) await ethereum.mint(token, labelled, FUNDED);
      const ok = await sauce(
        "simulate",
        PAY,
        "--owner",
        KEYSTORE_OWNER,
        "--salt",
        "e2e",
        ...defines(THIRD_RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
      );
      expect(ok.stderr).toBe("");
      expect(ok.code).toBe(0);
      expect(ok.stdout).toMatch(
        new RegExp(`^The cook succeeds from ${KEYSTORE_OWNER}: gas used \\d+, returns 0x`),
      );
      // A deployed Pot: the cook alone, and what it moved, read from its logs.
      expect(ok.stdout).toMatch(
        new RegExp(
          `^Rehearsed with eth_simulateV1 on the state of block \\d+; nothing was signed or sent:\n  the cook, from the owner ${KEYSTORE_OWNER}, gas used \\d+$`,
          "m",
        ),
      );
      expect(ok.stdout).toMatch(/^ {2}\[\d\] Pot(?: 0x\w{4}…\w{4})? +-> 0x8888…8888 +1 USDC$/m);
      // Nothing moved: it was an eth_call.
      expect(await ethereum.balanceOf(usdc, THIRD_RECIPIENT)).toBe(0n);
      // The owner's keystore names the owner, read from its address field: no password, no --owner.
      const keyed = await sauce(
        ...["simulate", PAY, "--salt", "e2e", ...defines(THIRD_RECIPIENT)],
        ...["--rpc-url", ethereum.rpcUrl, ...KEYSTORE],
      );
      expect(keyed.code).toBe(0);
      expect(keyed.stdout).toMatch(new RegExp(`^The cook succeeds from ${KEYSTORE_OWNER}`));
      // And so does `sauce pot`: the signer's address and its Pot.
      const mine = jsonOf(await sauce("pot", "--chain", "ethereum", "--salt", "e2e", ...KEYSTORE));
      expect(mine).toMatchObject({ owner: KEYSTORE_OWNER, pot: labelled });

      const refusing = join(work, "refuses.sauce.ts");
      writeFileSync(refusing, '// @chain ethereum\nthrow "not today";\n');
      const reverts = await sauce(
        "simulate",
        refusing,
        "--pot",
        labelled,
        "--rpc-url",
        ethereum.rpcUrl,
        "--json",
      );
      expect(reverts.code).toBe(1);
      expect(JSON.parse(reverts.stdout)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("not today"),
      });

      const unowned = await sauce(
        "simulate",
        PAY,
        "--owner",
        RAW_OWNER,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
      );
      // A Pot not deployed yet is deployed in the rehearsal; this one holds nothing to pay with.
      expect(unowned.code).toBe(1);
      expect(unowned.stdout).toMatch(/^The cook reverts: /);
      expect(unowned.stdout).toContain(
        `  1. Kitchen.deployPot(${RAW_OWNER}, 0x${"00".repeat(32)})`,
      );
      expect(
        await ethereum.publicClient.getCode({
          address: v12PredictPot(RAW_OWNER, `0x${"00".repeat(32)}`) as Address,
        }),
      ).toBeUndefined();
    }, 60_000);

    it("`sauce run` signs, sends and waits for the cook on an existing Pot", async () => {
      const run = await sauce(
        "run",
        PAY,
        "--salt",
        "e2e",
        ...defines(THIRD_RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        ...KEYSTORE,
        "--json",
      );
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as {
        from: string;
        pot: string;
        leftInPot: unknown;
        cook: { status: string; hash: Hex; explorer: string; trace: string };
      };
      // Where a person opens it: the chain's explorer, and the trace on Phalcon.
      expect([out.cook.explorer, out.cook.trace]).toEqual([
        `https://etherscan.io/tx/${out.cook.hash}`,
        `https://app.blocksec.com/phalcon/explorer/tx/eth/${out.cook.hash}`,
      ]);
      expect(out).toMatchObject({
        from: KEYSTORE_OWNER,
        pot: labelled,
        cook: { status: "success" },
      });
      // What the Pot holds after the cook of what it moved, read at the cook's block: 9 of the 10
      // it held of each, which stay in the Pot.
      expect(out.leftInPot).toEqual(
        [usdc, usdt].map((token, index) => ({
          token,
          symbol: ["USDC", "USDT"][index],
          decimals: 6,
          amount: (FUNDED - AMOUNT).toString(),
          formatted: "9",
          before: FUNDED.toString(),
        })),
      );
      const receipt = await ethereum.publicClient.getTransactionReceipt({ hash: out.cook.hash });
      expect(receipt.from).toBe(KEYSTORE_OWNER.toLowerCase());
      expect(await ethereum.balanceOf(usdc, THIRD_RECIPIENT)).toBe(AMOUNT);
      expect(await ethereum.balanceOf(usdt, THIRD_RECIPIENT)).toBe(AMOUNT);
    }, 60_000);

    it("`sauce run` refuses a cook that would revert, without sending it", async () => {
      const refusing = join(work, "refuses.sauce.ts");
      const before = await ethereum.publicClient.getTransactionCount({ address: KEYSTORE_OWNER });
      const run = await sauce(
        "run",
        refusing,
        "--salt",
        "e2e",
        "--rpc-url",
        ethereum.rpcUrl,
        ...KEYSTORE,
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(/not sent — it would revert: .*not today/);
      expect(await ethereum.publicClient.getTransactionCount({ address: KEYSTORE_OWNER })).toBe(
        before,
      );
    }, 60_000);

    it("`sauce run --auto-approve` deploys the signer's missing Pot, then cooks", async () => {
      const fresh = v12PredictPot(RAW_OWNER, SAUCE_INTENT_POT_SALT) as Address;
      // Tokens can be sent to the address before the Pot exists.
      for (const token of [usdc, usdt]) await ethereum.mint(token, fresh, FUNDED);
      const run = await sauce(
        "run",
        PAY,
        ...defines(SECOND_RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        "--private-key",
        RAW_KEY,
        "--auto-approve",
      );
      expect(run.code).toBe(0);
      expect(run.stderr).toMatch(/warning: --private-key puts the key in your shell history/);
      expect(run.stderr).toContain(`auto-approved: deploy Pot ${fresh}`);
      expect(run.stdout).toMatch(
        new RegExp(`^deployed Pot ${fresh} in 0x[0-9a-f]{64}: success`, "m"),
      );
      expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success, gas used \d+, block \d+$/m);
      // Each sent transaction's explorer page and trace, under its line.
      expect(run.stdout).toMatch(
        new RegExp(
          "^cook (0x[0-9a-f]{64}): success.*\n" +
            " {2}explorer: https://etherscan\\.io/tx/\\1\n" +
            " {2}trace \\(calls and balance changes, to open in a browser\\): " +
            "https://app\\.blocksec\\.com/phalcon/explorer/tx/eth/\\1$",
          "m",
        ),
      );
      expect(run.stdout).toMatch(
        /^deployed Pot 0x\w{40} in (0x[0-9a-f]{64}): success.*\n {2}explorer: \S+\/tx\/\1$/m,
      );
      // What stays in the Pot comes right after what the cook cost, before what it moved.
      expect(run.stdout).toMatch(
        new RegExp(
          "^cost .*\n" +
            "Left in the Pot, not in your wallet:\n" +
            "  9 USDC \\(it held 10 USDC before\\)\n" +
            "  9 USDT \\(it held 10 USDT before\\)\n" +
            "  Only another cook moves it out\\. .*\n" +
            "What moved, in order:$",
          "m",
        ),
      );
      expect(await potOwner(ethereum, fresh)).toBe(RAW_OWNER);
      expect(await ethereum.balanceOf(usdc, fresh)).toBe(FUNDED - AMOUNT);
    }, 60_000);

    it("waits for an endpoint that lags behind the deployment before calling the Pot there", async () => {
      // After each transaction the endpoint answers eth_getCode with nothing, three times over, as
      // a load-balanced node that has not seen the block yet does.
      const lagging = await laggingEndpoint(ethereum.rpcUrl, 3);
      try {
        const salted = v12PredictPot(RAW_OWNER, potSalt("lagging")) as Address;
        for (const token of [usdc, usdt]) await ethereum.mint(token, salted, FUNDED);
        const run = await sauce(
          "run",
          PAY,
          ...defines(SECOND_RECIPIENT),
          "--salt",
          "lagging",
          "--rpc-url",
          lagging.url,
          "--private-key",
          RAW_KEY,
          "--auto-approve",
        );
        expect(run.stderr).not.toMatch(/the Pot is not there/);
        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
        expect(lagging.served()).toBeGreaterThanOrEqual(3);
        expect(await ethereum.balanceOf(usdc, salted)).toBe(FUNDED - AMOUNT);

        const before = lagging.served();
        const deployed = jsonOf(
          await sauce(
            "pot",
            "--deploy",
            "--chain",
            "ethereum",
            "--salt",
            "lagging-pot",
            "--rpc-url",
            lagging.url,
            "--private-key",
            RAW_KEY,
          ),
        );
        expect(deployed).toMatchObject({ deployed: true });
        // It asked past the stale answers, and only then said deployed.
        expect(lagging.served() - before).toBeGreaterThanOrEqual(3);
      } finally {
        await lagging.stop();
      }
    }, 90_000);

    it("asks before deploying a missing Pot, and does only what the answer says", async () => {
      const salted = (label: string) => v12PredictPot(RAW_OWNER, potSalt(label)) as Address;
      for (const token of [usdc, usdt]) await ethereum.mint(token, salted("yes"), FUNDED);
      const questions: string[] = [];
      const answering = (answer: boolean | undefined) => async (question: string) => {
        questions.push(question);

        return answer;
      };
      const run = (label: string, answer: boolean | undefined) =>
        sauceWith(
          { confirm: answering(answer), canAsk: () => true },
          "run",
          PAY,
          "--salt",
          label,
          ...defines(SECOND_RECIPIENT),
          "--rpc-url",
          ethereum.rpcUrl,
          "--private-key",
          RAW_KEY,
        );

      const yes = await run("yes", true);
      expect(yes.code).toBe(0);
      expect(questions[0]).toBe(
        `Pot ${salted("yes")} (owner ${RAW_OWNER}, salt ${potSalt("yes")}) is not deployed on ethereum. Deploy it now? [y/N] `,
      );
      expect(await potOwner(ethereum, salted("yes"))).toBe(RAW_OWNER);

      const no = await run("no", false);
      expect(no.code).toBe(1);
      expect(no.stderr).toMatch(
        new RegExp(
          `Pot ${salted("no")} is not deployed on ethereum, so nothing was sent. Deploy it with: sauce pot --deploy --owner ${RAW_OWNER} --chain ethereum --salt no`,
        ),
      );
      expect(await ethereum.publicClient.getCode({ address: salted("no") })).toBeUndefined();

      // No terminal to ask on (jest's stdin is not a TTY): the plain process io refuses, with the way out.
      const unasked = await sauce(
        "run",
        PAY,
        "--salt",
        "unasked",
        ...defines(SECOND_RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        "--private-key",
        RAW_KEY,
      );
      expect(unasked.code).toBe(1);
      expect(unasked.stderr).toContain(
        "nothing was sent: this run needs an approval, and there is no terminal to ask on:\n" +
          `  deploy Pot ${salted("unasked")}\nPass --auto-approve`,
      );
      expect(await ethereum.publicClient.getCode({ address: salted("unasked") })).toBeUndefined();
    }, 60_000);

    it("takes the owner from the signer, and refuses to cook on an --owner that is someone else", async () => {
      const run = await sauce(
        "run",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        ...KEYSTORE,
      );
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(
        new RegExp(`--owner ${OWNER.address} is not the signer, ${KEYSTORE_OWNER}`),
      );
    }, 60_000);

    it("`sauce pot --deploy --owner` deploys another owner's Pot, which the signer pays for", async () => {
      // How the Pot intents share is deployed: its owner is a Portal's Executor, which signs nothing.
      const pot = v12PredictPot(OWNER.address, potSalt("deployed-for")) as Address;
      // The flags in any order: the signer's before --deploy, the endpoint after it.
      const run = await sauce(
        "pot",
        "--chain",
        "ethereum",
        "--owner",
        OWNER.address,
        ...KEYSTORE,
        "--salt",
        "deployed-for",
        "--deploy",
        "--rpc-url",
        ethereum.rpcUrl,
      );
      const out = jsonOf(run);
      expect(out).toMatchObject({
        pot,
        owner: OWNER.address,
        sender: KEYSTORE_OWNER,
        deployed: true,
      });
      expect(run.stderr).toContain(
        `The Pot is ${OWNER.address}'s: ${KEYSTORE_OWNER} sent and paid for the deployment`,
      );
      expect(await potOwner(ethereum, pot)).toBe(OWNER.address);
    }, 60_000);
  });
});

describeEvm("a typed main, compiled for Base and for Ethereum, run with --args", () => {
  const chains: Record<string, LocalChain> = {};
  const RECIPIENTS: Address[] = [RECIPIENT, SECOND_RECIPIENT];

  beforeAll(async () => {
    chains.base = await startChain("base");
    chains.ethereum = await startChain("ethereum");
  }, 120_000);

  afterAll(async () => {
    for (const local of Object.values(chains)) await local.stop();
  });

  it("compiles one source into a program per chain, each naming its own USDC", async () => {
    const base = jsonOf(await sauce("compile", SPLIT, "--chain", "base", "--json"));
    const ethereum = jsonOf(await sauce("compile", SPLIT, "--chain", "ethereum", "--json"));
    // A preview chain compiles the same source, and only its cook is refused.
    const arbitrum = jsonOf(await sauce("compile", SPLIT, "--chain", "arbitrum", "--json"));
    const usdcOf = (slug: string) => registered(requireChain(slug), "USDC").slice(2).toLowerCase();
    expect(base.bytecode).toContain(usdcOf("base"));
    expect(ethereum.bytecode).toContain(usdcOf("ethereum"));
    expect(arbitrum.bytecode).toContain(usdcOf("arbitrum"));
    expect(base.bytecode).not.toContain(usdcOf("ethereum"));
    const refused = await sauce(
      ...["tx", SPLIT, "--chain", "arbitrum", "--owner", OWNER.address, "--value", "0"],
      ...["--args", RECIPIENT, JSON.stringify(RECIPIENTS), String(AMOUNT), "true"],
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(
      /building the cook transaction is refused: it involves arbitrum/,
    );
    for (const out of [base, ethereum, arbitrum]) {
      expect(out.entryEncoding).toBe("abi-v1");
      expect(out.entryParams).toEqual([
        { name: "token", type: "Address" },
        { name: "recipients", type: "Address[]" },
        { name: "amount", type: "Uint256" },
        { name: "alsoUsdc", type: "bool" },
      ]);
    }
  }, 60_000);

  for (const [slug, alsoUsdc] of [
    ["base", true],
    ["ethereum", false],
  ] as const) {
    it(`on ${slug}, pays each recipient as the arguments say (alsoUsdc: ${alsoUsdc})`, async () => {
      const local = chains[slug]!;
      const usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
      const token = await local.plant(fixture("MockERC20"));
      const pot = await deployPot(local);
      for (const funded of [usdc, token]) await local.mint(funded, pot, FUNDED);

      const out = jsonOf(
        await sauce(
          "tx",
          SPLIT,
          "--chain",
          slug,
          "--owner",
          OWNER.address,
          "--rpc-url",
          local.rpcUrl,
          "--args",
          token,
          JSON.stringify(RECIPIENTS),
          String(AMOUNT),
          String(alsoUsdc),
        ),
      );
      expect(out).toMatchObject({ chainId: local.chain.id, to: pot, value: FEE.toString() });
      const hash = await local.send(local.owner, pot, out.data as Hex, FEE);

      for (const recipient of RECIPIENTS) {
        expect(await local.balanceOf(token, recipient)).toBe(AMOUNT);
        expect(await local.balanceOf(usdc, recipient)).toBe(alsoUsdc ? AMOUNT : 0n);
      }
      expect(await local.balanceOf(token, pot)).toBe(FUNDED - 2n * AMOUNT);
      expect(await local.balanceOf(usdc, pot)).toBe(alsoUsdc ? FUNDED - 2n * AMOUNT : FUNDED);

      // `sauce inspect` reads the cook back off the chain — the chain from the endpoint itself —
      // and, against the source, finds split.sauce.ts's program and the arguments it was sent.
      const inspected = jsonOf(
        await sauce("inspect", hash, "--rpc-url", local.rpcUrl, "--source", SPLIT, "--json"),
      );
      expect(inspected).toMatchObject({
        chain: slug,
        status: "success",
        from: OWNER.address,
        to: pot,
        value: FEE.toString(),
        call: "Pot.cook",
        engine: { address: getAddress(v12EngineAddress()), released: true },
        program: {
          source: {
            file: SPLIT,
            matches: true,
            arguments: [
              { name: "token", type: "Address", value: getAddress(token) },
              { name: "recipients", type: "Address[]", value: RECIPIENTS },
              { name: "amount", type: "Uint256", value: AMOUNT.toString() },
              { name: "alsoUsdc", type: "bool", value: alsoUsdc },
            ],
          },
        },
      });
      // What it cost — gas at its price, and the value, the Kitchen's fee — and what it moved, from
      // the receipt's logs.
      const receipt = await local.publicClient.getTransactionReceipt({ hash: hash as Hex });
      const execution = receipt.gasUsed * receipt.effectiveGasPrice;
      expect(inspected.cost).toEqual({
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.effectiveGasPrice.toString(),
        execution: execution.toString(),
        value: FEE.toString(),
        total: (execution + FEE).toString(),
      });
      const moved = (inspected.effects as { transfers: Array<{ from: string; to: string }> })
        .transfers;
      expect(moved).toHaveLength(RECIPIENTS.length * (alsoUsdc ? 2 : 1));
      for (const transfer of moved) {
        expect(transfer.from).toBe(pot);
        expect(RECIPIENTS).toContain(transfer.to);
      }
    }, 60_000);
  }

  it("`sauce verify` reads a settle cook back off the chain, and rejects a cook that is not one", async () => {
    const local = chains.base!;
    const usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    const pot = v12PredictPot(OWNER.address) as Address;
    if ((await local.publicClient.getCode({ address: pot })) === undefined) await deployPot(local);
    await local.mint(usdc, pot, FUNDED);
    // The conformance corpus's single-token settle: sweep the Pot's USDC, no floor.
    const vector = SETTLE_VECTORS[0]!;
    const before = await local.balanceOf(usdc, getAddress(vector.recipient));
    const swept = await local.balanceOf(usdc, pot);
    const engine = getAddress(v12EngineAddress());
    const hash = await local.send(
      local.owner,
      pot,
      v12Pot.encodeCook(engine, settlePayload(vector.args)),
      FEE,
    );
    expect(await local.balanceOf(usdc, getAddress(vector.recipient))).toBe(before + swept);

    expect(jsonOf(await sauce("verify", hash, "--rpc-url", local.rpcUrl, "--json"))).toEqual({
      hash,
      chain: "base",
      to: pot,
      valid: true,
      tokens: vector.tokens.map((token) => token.toLowerCase()),
      floorToken: vector.tokens[0]!.toLowerCase(),
      minOut: vector.minOut.toString(),
      recipient: vector.recipient.toLowerCase(),
      programHash: SETTLE_WIRE.PROGRAM_HASH,
      engine,
    });
    // The split cook above is a program, not the settle: rejected, with the SDK's code.
    const split = jsonOf(
      await sauce(
        "tx",
        SPLIT,
        "--chain",
        "base",
        "--owner",
        OWNER.address,
        "--value",
        "0",
        "--args",
        usdc,
        "[]",
        "1",
        "false",
      ),
    );
    const notSettle = await local.send(local.owner, pot, split.data as Hex, FEE);
    const rejected = await sauce("verify", notSettle, "--rpc-url", local.rpcUrl);
    expect(rejected.code).toBe(1);
    // Split at the settle's 435 bytes, its tail is not a settle's arguments, or its program not
    // the settle's: either way one of the SDK's codes.
    expect(rejected.stdout).toMatch(
      /^rejected \((?:PROGRAM_HASH|TOKENS_OFFSET|TOKENS_EMPTY|ARGS_TRUNCATED|ARGS_OVERLONG|DIRTY_ADDRESS_WORD|ZERO_RECIPIENT)\): /,
    );
  }, 60_000);
});

describeEvm("what is deployed: the released contracts and a Pot", () => {
  let base: LocalChain;
  let bare: ChildProcess;
  let work: string;
  let config: string;
  let BARE: string;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-deployed-"));
    base = await startChain("base");
    // A chain with nothing of Sauce's on it.
    const port = await freePort();
    bare = await spawnAnvil(port, ["--chain-id", "1"]);
    BARE = `http://127.0.0.1:${port}`;
    config = join(work, "sauce.config.json");
    writeFileSync(config, JSON.stringify({ rpcUrls: { "8453": base.rpcUrl } }));
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await base?.stop();
    if (bare !== undefined && bare.exitCode === null) {
      const exited = once(bare, "exit");
      bare.kill();
      await exited;
    }
  });

  it("`sauce pot` with an endpoint reports the engine, the Kitchen and its fee, and the Pot", async () => {
    const owner = getAddress("0x9999999999999999999999999999999999999999");
    const pot = v12PredictPot(owner, SAUCE_INTENT_POT_SALT) as Address;
    const status = async () => {
      const run = await sauce("pot", "--chain", "base", "--owner", owner, "--rpc-url", base.rpcUrl);
      expect(run.code).toBe(0);

      return { out: JSON.parse(run.stdout) as Record<string, unknown>, stderr: run.stderr };
    };
    const before = await status();
    expect(before.out.deployment).toEqual({
      engine: { address: getAddress(v12EngineAddress()), deployed: true },
      kitchen: { address: getAddress(v12KitchenAddress()), deployed: true, executionFee: `${FEE}` },
      pot: { address: pot, deployed: false },
    });
    expect(before.stderr).toContain(`the Pot ${pot} is NOT deployed`);
    await base.send(base.deployer, before.out.to as Address, before.out.data as Hex);
    const after = await status();
    expect(after.out.deployment).toMatchObject({ pot: { address: pot, deployed: true, owner } });
    expect(after.stderr).toContain(`the Pot ${pot} is deployed, owned by ${owner}`);
  }, 60_000);

  it("names a chain with no Sauce contracts, and refuses to deploy a Pot there", async () => {
    const run = await sauce(
      "pot",
      "--chain",
      "ethereum",
      "--owner",
      OWNER.address,
      "--rpc-url",
      BARE,
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).deployment).toMatchObject({
      engine: { deployed: false },
      kitchen: { deployed: false },
      pot: { deployed: false },
    });
    expect(run.stderr).toContain("The released Kitchen has no code on ethereum");
    const deploy = await sauce(
      ...["pot", "--deploy", "--chain", "ethereum", "--rpc-url", BARE],
      ...["--private-key", OTHER_KEY],
    );
    expect(deploy.code).toBe(1);
    expect(deploy.stderr).toMatch(
      /has no code on ethereum: no Pot can be deployed there, so nothing was sent/,
    );
  }, 60_000);
});
