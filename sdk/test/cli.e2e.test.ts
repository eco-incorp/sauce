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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { v12EngineAddress, v12KitchenAddress } from "../src/deployments/index.js";
import { potSalt, SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm, hashIntent } from "../src/routes/encode.js";
import {
  intentHashCall,
  intentVaultAddressCall,
  isIntentFundedCall,
  predictIntentVault,
} from "../src/routes/portal.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { SETTLE_VECTORS, SETTLE_WIRE, settlePayload } from "../src/verify/index.js";
import { v12Pot } from "../src/evm/engine.js";
import {
  CLI_FIXTURES,
  KEYSTORE_PASSWORD_FILE,
  deployPot,
  describeEvm,
  erc20,
  FEE,
  fixture,
  jsonOf,
  laggingEndpoint,
  OTHER_KEY,
  OWNER,
  OWNER_KEY,
  placePortal,
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

const HERE = dirname(fileURLToPath(import.meta.url));
/** The suites' programs (the `sauce-cli` skill's own are executed by `cli-examples.e2e.test.ts`). */
const PAY = join(CLI_FIXTURES, "pay.sauce.ts");
/** eco-routes' own Portal creation code, vendored (see routes-nest-dynamic.e2e.test.ts). */
const PORTAL_CREATION = (
  JSON.parse(readFileSync(join(HERE, "evm/fixtures/Portal.json"), "utf8")) as { creationCode: Hex }
).creationCode;
/** Its deployment: the creation code and `nativeErc20 = address(0)`. */
const PORTAL_DEPLOYMENT =
  `${PORTAL_CREATION}${encodeAbiParameters([{ type: "address" }], [zeroAddress]).slice(2)}` as Hex;
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
    it("`sauce tx` plans the Pot's deploy first when the Pot is not deployed yet", async () => {
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
      const plan = jsonOf(run) as { pot: Address; transactions: Array<Record<string, string>> };
      const predicted = v12PredictPot(OWNER.address, `0x${"00".repeat(32)}`) as Address;
      expect(plan.pot).toBe(predicted);
      expect(plan.transactions.map((tx) => [tx.deploysPot ?? null, tx.value])).toEqual([
        [predicted, "0"],
        [null, FEE.toString()],
      ]);
      expect(run.stderr).toContain(
        `Your Pot ${predicted} on ethereum isn't deployed yet: the first transaction deploys it`,
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
          `^Simulated with eth_simulateV1 on the state of block \\d+; nothing was signed or sent:\n  the cook, from the owner ${KEYSTORE_OWNER}, gas used \\d+$`,
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
      const question = (label: string) =>
        new RegExp(
          `^Your Pot ${salted(label)} on ethereum isn't deployed yet\\. Deploy it now \\(one ` +
            "transaction, about [\\d,]+ gas, ~[\\d.]+ ETH\\), then run\\? \\[deploy/cancel\\] $",
        );
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
      expect(questions[0]).toMatch(question("yes"));
      expect(await potOwner(ethereum, salted("yes"))).toBe(RAW_OWNER);

      const no = await run("no", false);
      expect(no.code).toBe(1);
      expect(no.stderr).toContain(
        `Your Pot ${salted("no")} on ethereum isn't deployed yet, so nothing was sent: run again ` +
          "and answer deploy, or pass --yes (-y), or deploy it yourself with sauce pot --deploy " +
          `--owner ${RAW_OWNER} --chain ethereum --salt no`,
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
          `  deploy Pot ${salted("unasked")}\nPass --yes (-y)`,
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

describeEvm("an intent file: published from a wallet, or run on a Pot", () => {
  let ethereum: LocalChain;
  let work: string;
  let usdc: Address;
  let portal: Address;
  const REWARD = 2_000_000n;
  const DEADLINE = "2000000000";
  // A top-level file: no `main`, one intent, every amount a define.
  const INTENT = [
    "// @chain ethereum",
    "Base(() => {",
    "  USDC.transfer(RECIPIENT, AMOUNT);",
    "}).reward({ tokens: [{ token: USDC, amount: REWARD }] });",
    "",
  ].join("\n");
  const definesFor = (reward: bigint): string[] => [
    "--define",
    `RECIPIENT=${RECIPIENT}`,
    "--define",
    `AMOUNT=${AMOUNT}`,
    "--define",
    `REWARD=${reward}`,
    "--intent-deadline",
    DEADLINE,
    "--intent-creator",
    OWNER.address,
  ];
  const DEFINES = definesFor(REWARD);
  let intentFile: string;

  /** The one intent the file opens, as the SDK encodes it for `creator`. */
  const theIntent = (creator: Address) =>
    compileSauceProgram("ethereum", INTENT, {
      defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT, REWARD },
      intents: { deadline: BigInt(DEADLINE), creator },
    }).intents[0]!.intent;

  const read = async <T>(call: { to: Hex; data: Hex; decode: (result: Hex) => T }): Promise<T> =>
    call.decode((await ethereum.publicClient.call({ to: call.to, data: call.data })).data!);

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-publish-"));
    intentFile = join(work, "bridge.sauce.ts");
    writeFileSync(intentFile, INTENT);
    ethereum = await startChain("ethereum");
    // The real eco-routes Portal, at the address the SDK records for Ethereum — with the vault
    // implementation and Executor a Portal deployed there would have, so its vaults are the ones
    // the SDK derives for that address, as every deployed Portal's are.
    ({ portal } = await placePortal(ethereum));
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await ethereum?.stop();
  });

  /** The vault the SDK derives for `intent` on this anvil's Portal. */
  const vaultOf = (intent: ReturnType<typeof theIntent>): Address =>
    predictIntentVault(intent, { portal });

  /** `Portal.getRewardStatus`: 0 published (or never), 1 Funded — only `publishAndFund` sets it. */
  const statusOf = (intentHash: Hex): Promise<number> =>
    ethereum.publicClient.readContract({
      address: portal,
      abi: PortalABI,
      functionName: "getRewardStatus",
      args: [intentHash],
    }) as Promise<number>;

  it("prints the unsigned transfer to the vault and publish, with no key and no endpoint", async () => {
    const run = await sauce("intent", "publish", intentFile, ...DEFINES, "--format", "json");
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as {
      portal: string;
      intents: Array<{
        intentHash: Hex;
        fundVia: string;
        vault: Address;
        vaultFrom: string;
        transactions: Array<{ what: string; to: Address; data: Hex; value: string }>;
      }>;
    };
    const intent = theIntent(OWNER.address);
    expect(out.portal).toBe(portal);
    expect(out.intents).toHaveLength(1);
    expect(out.intents[0]).toMatchObject({
      intentHash: hashIntent(intent).intentHash,
      fundVia: "transfer",
      // With no endpoint, the SDK's own derivation — held to every deployed Portal elsewhere.
      vault: vaultOf(intent),
      vaultFrom: "derived",
    });
    const transactions = out.intents[0]!.transactions;
    expect(transactions.map((tx) => [tx.what, tx.to])).toEqual([
      [`transfer ${usdc} to the vault`, usdc],
      ["publish", portal],
    ]);
    // The whole reward, to the vault, and no approval anywhere.
    expect(decodeFunctionData({ abi: erc20Abi, data: transactions[0]!.data }).args).toEqual([
      vaultOf(intent),
      REWARD,
    ]);
    expect(decodeFunctionData({ abi: PortalABI, data: transactions[1]!.data }).functionName).toBe(
      "publish",
    );
    expect(run.stderr).toContain("Each vault is the SDK's offline derivation for the Portal");
    expect(run.stderr).toContain("The transfers come first");
  }, 60_000);

  it("prints the approval and publishAndFund instead with --intent-fund-via publishAndFund", async () => {
    const run = await sauce(
      ...["intent", "publish", intentFile, ...DEFINES, "--intent-fund-via", "publishAndFund"],
      ...["--format", "json"],
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as {
      intents: Array<{ fundVia: string; transactions: Array<{ what: string; to: string }> }>;
    };
    expect(out.intents[0]!.fundVia).toBe("publishAndFund");
    expect(out.intents[0]!.transactions.map((tx) => [tx.what, tx.to])).toEqual([
      [`approve ${usdc} to the Portal`, usdc],
      ["publishAndFund", portal],
    ]);

    const wrong = await sauce(
      "intent",
      "publish",
      intentFile,
      ...DEFINES,
      "--intent-fund-via",
      "permit",
    );
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain("--intent-fund-via: 'permit' is not transfer or publishAndFund");
  }, 60_000);

  it("rehearses the transactions together, and sends nothing", async () => {
    await ethereum.mint(usdc, OWNER.address, REWARD);
    const run = await sauce(
      "intent",
      "publish",
      intentFile,
      ...DEFINES,
      "--rpc-url",
      ethereum.rpcUrl,
      "--from",
      OWNER.address,
      "--dry-run",
      "--json",
    );
    // The one note: the destination side is `sauce intent fill`'s.
    expect(run.stderr).toBe(
      "This simulates publishing on ethereum only. What the intent does runs on base, when a " +
        "solver fills it: `sauce intent fill` with the same file and flags, and the destination's " +
        "endpoint, simulates that.\n",
    );
    expect(run.code).toBe(0);
    // Each with its gas, as the text gives it.
    const gas = expect.stringMatching(/^[1-9]\d*$/);
    expect(JSON.parse(run.stdout)).toMatchObject({
      ok: true,
      // After the transfer and the publish, the Portal counts it funded — what a solver checks.
      intents: [{ fundVia: "transfer", vault: vaultOf(theIntent(OWNER.address)), funded: true }],
      transactions: [
        { status: "success", gasUsed: gas },
        { status: "success", gasUsed: gas },
      ],
    });
    expect(await ethereum.balanceOf(usdc, OWNER.address)).toBe(REWARD);
    expect(await ethereum.balanceOf(usdc, vaultOf(theIntent(OWNER.address)))).toBe(0n);
  }, 60_000);

  it("rehearses for a wallet that does not hold the reward yet, with --assume-balance", async () => {
    const empty = getAddress("0x5a0ce0000000000000000000000000000000beef");
    const dryRun = (...flags: string[]) =>
      sauce(
        ...["intent", "publish", intentFile, ...DEFINES, "--rpc-url", ethereum.rpcUrl],
        ...["--from", empty, "--dry-run", ...flags],
      );
    // Without it the transfer into the vault reverts: the wallet holds nothing to send.
    const short = await dryRun();
    expect(short.code).toBe(1);
    expect(short.stdout).toMatch(new RegExp(`^transfer ${usdc} to the vault: reverts: `, "m"));
    // And in JSON, the same reason beside the transaction.
    const shortJson = JSON.parse((await dryRun("--json")).stdout) as {
      transactions: Array<{ reason?: string }>;
    };
    const said = new RegExp(`^transfer ${usdc} to the vault: reverts: (.+)$`, "m").exec(
      short.stdout,
    )![1];
    expect(shortJson.transactions[0]!.reason).toBe(said);
    const run = await dryRun("--assume-balance", "USDC:2", "--json");
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      ok: true,
      from: empty,
      assumed: [{ holder: empty, token: usdc, symbol: "USDC", amount: "2000000" }],
      intents: [{ funded: true }],
      transactions: [{ status: "success" }, { status: "success" }],
    });
    expect(await ethereum.balanceOf(usdc, empty)).toBe(0n);
    // A balance is assumed only for a rehearsal.
    const sent = await sauce(
      ...["intent", "publish", intentFile, ...DEFINES, "--rpc-url", ethereum.rpcUrl],
      ...["--private-key", OWNER_KEY, "--assume-balance", "USDC:2"],
    );
    expect(sent.code).toBe(2);
    expect(sent.stderr).toContain("--assume-balance goes with --dry-run");
  }, 60_000);

  it("refuses a vault the Portal reports differently from the SDK, and sends nothing", async () => {
    // A Portal whose code was copied to the registry address, not deployed there: it derives its
    // vaults from another implementation, as a Portal built some other way — or an endpoint
    // answering for another chain — would. The two sources disagree, so neither address is paid.
    const relocated = (await ethereum.publicClient.getCode({ address: portal }))!;
    const elsewhere = await ethereum.plant(PORTAL_DEPLOYMENT);
    await ethereum.testClient.setCode({
      address: portal,
      bytecode: (await ethereum.publicClient.getCode({ address: elsewhere }))!,
    });
    try {
      const reported = await read(intentVaultAddressCall(theIntent(OWNER.address), { portal }));
      expect(reported).not.toBe(vaultOf(theIntent(OWNER.address)));
      const held = await ethereum.balanceOf(usdc, OWNER.address);
      for (const flags of [
        ["--private-key", OWNER_KEY],
        ["--from", OWNER.address, "--format", "json"],
      ]) {
        const run = await sauce(
          ...["intent", "publish", intentFile, ...DEFINES, "--rpc-url", ethereum.rpcUrl],
          ...flags,
        );
        expect(run.code).toBe(1);
        expect(run.stderr).toContain(`reports the intent's vault as ${reported}`);
        expect(run.stderr).toContain("refusing to send the reward to either, and nothing was sent");
      }
      expect(await ethereum.balanceOf(usdc, OWNER.address)).toBe(held);
      expect(await ethereum.balanceOf(usdc, reported)).toBe(0n);
    } finally {
      await ethereum.testClient.setCode({ address: portal, bytecode: relocated });
    }
  }, 60_000);

  it("publishes from the wallet: the reward paid into the vault, which the Portal counts funded", async () => {
    const run = await sauce(
      "intent",
      "publish",
      intentFile,
      ...DEFINES,
      "--rpc-url",
      ethereum.rpcUrl,
      "--private-key",
      OWNER_KEY,
    );
    expect(run.code).toBe(0);
    const intent = theIntent(OWNER.address);
    const { intentHash } = hashIntent(intent);
    const vault = vaultOf(intent);
    expect(run.stdout).toContain(`intent ${intentHash} to base, funded by transfer to its vault`);
    expect(run.stdout).toMatch(/^transfer .* to the vault 0x[0-9a-f]{64}: success/m);
    expect(run.stdout).toMatch(/^publish 0x[0-9a-f]{64}: success/m);
    expect(await read(isIntentFundedCall(intent, { portal }))).toBe(true);
    expect((await read(intentHashCall(intent, { portal }))).intentHash).toBe(intentHash);
    // The Portal's own vault, and the SDK's, are one address — and it holds the reward.
    expect(await read(intentVaultAddressCall(intent, { portal }))).toBe(vault);
    expect(await ethereum.balanceOf(usdc, vault)).toBe(REWARD);
    expect(await ethereum.balanceOf(usdc, OWNER.address)).toBe(0n);
    // No approval was asked for, and `publish` records the publication, not a `Funded` status.
    expect(
      await ethereum.publicClient.readContract({
        address: usdc,
        abi: erc20,
        functionName: "allowance",
        args: [OWNER.address, portal],
      }),
    ).toBe(0n);
    expect(await statusOf(intentHash)).toBe(0);

    // `sauce inspect` takes both transactions back apart: the transfer to that vault, and the
    // publish of the same intent, naming its vault.
    const transfer = /^transfer .* to the vault (0x[0-9a-f]{64}): success/m.exec(run.stdout)![1]!;
    expect(
      jsonOf(await sauce("inspect", transfer, "--rpc-url", ethereum.rpcUrl, "--json")),
    ).toMatchObject({
      status: "success",
      to: usdc,
      call: "ERC20.transfer",
      args: { to: vault, amount: REWARD.toString() },
    });
    const published = /^publish (0x[0-9a-f]{64}): success/m.exec(run.stdout)![1]!;
    expect(
      jsonOf(await sauce("inspect", published, "--rpc-url", ethereum.rpcUrl, "--json")),
    ).toMatchObject({
      status: "success",
      from: OWNER.address,
      to: portal,
      call: "Portal.publish",
      intent: {
        intentHash,
        vault,
        destination: { id: "8453", chain: "base" },
        reward: { creator: OWNER.address, tokens: [{ token: usdc, amount: REWARD.toString() }] },
      },
    });
    // The reward is escrowed in Ethereum's USDC, the chain that funds it.
    expect(
      intent.reward.tokens.map((token) => denormalizeToEvm(token.token).toLowerCase()),
    ).toEqual([usdc.toLowerCase()]);

    // Run again, it pays nothing more: the vault holds the reward, so only `publish` is sent.
    const again = await sauce(
      ...["intent", "publish", intentFile, ...DEFINES, "--rpc-url", ethereum.rpcUrl],
      ...["--private-key", OWNER_KEY, "--json"],
    );
    expect(jsonOf(again)).toMatchObject({ transactions: [{ what: "publish", status: "success" }] });
    expect(await ethereum.balanceOf(usdc, vault)).toBe(REWARD);
  }, 60_000);

  it("publishes through publishAndFund with --intent-fund-via publishAndFund", async () => {
    // Another reward, so another intent: the one above is already funded.
    const other = 3_000_000n;
    const defines = definesFor(other);
    await ethereum.mint(usdc, OWNER.address, other);
    const run = await sauce(
      ...["intent", "publish", intentFile, ...defines, "--intent-fund-via", "publishAndFund"],
      ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY],
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^approve .* to the Portal 0x[0-9a-f]{64}: success/m);
    expect(run.stdout).toMatch(/^publishAndFund 0x[0-9a-f]{64}: success/m);
    const intent = compileSauceProgram("ethereum", INTENT, {
      defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT, REWARD: other },
      intents: { deadline: BigInt(DEADLINE), creator: OWNER.address },
    }).intents[0]!.intent;
    expect(await read(isIntentFundedCall(intent, { portal }))).toBe(true);
    // The Portal pulled it, into the same vault the SDK derives, and recorded it Funded.
    expect(await ethereum.balanceOf(usdc, vaultOf(intent))).toBe(other);
    expect(await statusOf(hashIntent(intent).intentHash)).toBe(1);
  }, 60_000);

  describe("rewards that are not a plain ERC-20", () => {
    /** A one-intent file rewarding `reward`, with the token, if any, as the define TOKEN. */
    const rewardFile = (name: string, reward: string): string => {
      const path = join(work, `${name}.sauce.ts`);
      writeFileSync(
        path,
        [
          "// @chain ethereum",
          "Base(() => {",
          "  USDC.transfer(RECIPIENT, AMOUNT);",
          `}).reward(${reward});`,
          "",
        ].join("\n"),
      );

      return path;
    };
    const publishFile = (file: string, ...flags: string[]) =>
      sauce(
        ...["intent", "publish", file, ...DEFINES, "--rpc-url", ethereum.rpcUrl],
        ...["--private-key", OWNER_KEY, ...flags],
      );
    const intentOf = (file: string, defines: Record<string, bigint>) =>
      compileSauceProgram("ethereum", readFileSync(file, "utf8"), {
        defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT, REWARD, ...defines },
        intents: { deadline: BigInt(DEADLINE), creator: OWNER.address },
      }).intents[0]!.intent;

    it("a USDT-style token, whose transfer returns nothing, funds its vault", async () => {
      const usdt = await ethereum.plant(USDT_CREATION);
      await ethereum.mint(usdt, OWNER.address, REWARD);
      const file = rewardFile("usdt", "{ tokens: [{ token: TOKEN, amount: REWARD }] }");
      const run = await publishFile(file, "--define", `TOKEN=${usdt}`);

      expect(run.code).toBe(0);
      const intent = intentOf(file, { TOKEN: BigInt(usdt) });
      expect(await read(isIntentFundedCall(intent, { portal }))).toBe(true);
      expect(await ethereum.balanceOf(usdt, vaultOf(intent))).toBe(REWARD);
    }, 60_000);

    it("a native reward is sent to the vault", async () => {
      const NATIVE = 12_345_000_000n;
      const file = rewardFile("native", `{ nativeAmount: ${NATIVE}n }`);
      const run = await publishFile(file);

      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/^send ETH to the vault 0x[0-9a-f]{64}: success/m);
      const intent = intentOf(file, {});
      expect(await read(isIntentFundedCall(intent, { portal }))).toBe(true);
      expect(await ethereum.publicClient.getBalance({ address: vaultOf(intent) })).toBe(NATIVE);
    }, 60_000);

    it("a token whose transfer returns false is caught before the intent is published", async () => {
      // Its transfer "succeeds" and moves nothing: the Portal, asked before `publish` is sent, does
      // not count the intent funded, and the command stops there.
      const liar = await ethereum.plant(fixture("FalseReturnERC20"));
      const file = rewardFile("liar", "{ tokens: [{ token: TOKEN, amount: REWARD }] }");
      const run = await publishFile(file, "--define", `TOKEN=${liar}`);

      expect(run.code).toBe(1);
      const intent = intentOf(file, { TOKEN: BigInt(liar) });
      expect(run.stderr).toContain(`the vault ${vaultOf(intent)} does not hold intent`);
      expect(run.stderr).toContain("so it is not published");
      expect(run.stderr).toMatch(/sent so far: transfer .* to the vault 0x[0-9a-f]{64}/);
      expect(run.stdout).not.toMatch(/^publish /m);
      expect(await read(isIntentFundedCall(intent, { portal }))).toBe(false);
    }, 60_000);
  });

  // The route pays in the DESTINATION's USDC — Base's, not Ethereum's: a nested body's names
  // resolve on its own chain, and the command compiles through that scoping.
  it("names each chain's own USDC: Base's in the route", () => {
    const intent = theIntent(OWNER.address);
    const baseUsdc = registered(requireChain("base"), "USDC").toLowerCase();
    const routeTokens = intent.route.tokens.map((token) =>
      denormalizeToEvm(token.token).toLowerCase(),
    );
    expect(routeTokens).toEqual([baseUsdc]);
  });

  it("runs the same file on a Pot, which publishes and funds it from its own balance", async () => {
    const creator = privateKeyToAccount(OTHER_KEY).address;
    const pot = v12PredictPot(creator, SAUCE_INTENT_POT_SALT) as Address;
    await ethereum.mint(usdc, pot, REWARD);
    const run = await sauce(
      "run",
      intentFile,
      "--define",
      `RECIPIENT=${RECIPIENT}`,
      "--define",
      `AMOUNT=${AMOUNT}`,
      "--define",
      `REWARD=${REWARD}`,
      "--intent-deadline",
      DEADLINE,
      "--intent-creator",
      creator,
      "--rpc-url",
      ethereum.rpcUrl,
      "--private-key",
      OTHER_KEY,
      "--auto-approve",
    );
    expect(run.stderr).not.toMatch(/sauce run:/);
    expect(run.code).toBe(0);
    const intent = theIntent(creator);
    expect(await read(isIntentFundedCall(intent, { portal }))).toBe(true);
    expect(await ethereum.balanceOf(usdc, pot)).toBe(0n);
  }, 60_000);

  it("refuses to publish an amount measured on chain, or a file that does more", async () => {
    const measured = join(work, "measured.sauce.ts");
    writeFileSync(
      measured,
      [
        "// @chain ethereum",
        "const amount = USDC.balanceOf(ctx.self());",
        "Base(() => {",
        "  USDC.transfer(RECIPIENT, amount);",
        "}).reward({ tokens: [{ token: USDC, amount }] });",
        "",
      ].join("\n"),
    );
    const refused = await sauce("intent", "publish", measured, ...DEFINES, "--format", "json");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(
      /the intent to base uses `amount`, which the program measures or computes while it runs, so it cannot be built from a wallet: use `sauce run` on a Pot/,
    );

    const more = join(work, "more.sauce.ts");
    writeFileSync(more, `${INTENT}USDC.transfer(RECIPIENT, 1n);\n`);
    const extra = await sauce("intent", "publish", more, ...DEFINES, "--format", "json");
    expect(extra.code).toBe(1);
    expect(extra.stderr).toContain(`${more}:5 does something besides open an intent`);
  }, 60_000);
});

describeEvm("what is deployed: the released contracts, a Pot, and an intent's destination", () => {
  let base: LocalChain;
  let bare: ChildProcess;
  let work: string;
  let config: string;
  let BARE: string;
  const REWARD = 2_000_000n;
  // An intent from Ethereum whose body is a program on Base: its cook pays Base's Kitchen fee, on
  // the Pot every intent through Base's Portal shares.
  const INTENT = [
    "// @chain ethereum",
    "Base(() => {",
    "  require(AMOUNT > 0n);",
    "  Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).transfer(RECIPIENT, AMOUNT);",
    "}).reward({ tokens: [{ token: USDC, amount: REWARD }] });",
    "",
  ].join("\n");
  const DEFINES = [
    ...["--define", `RECIPIENT=${RECIPIENT}`, "--define", `AMOUNT=${AMOUNT}`],
    ...["--define", `REWARD=${REWARD}`, "--intent-deadline", "2000000000"],
    ...["--intent-creator", OWNER.address],
  ];
  const sharedPot = () =>
    v12PredictPot(
      getAddress(ecoRoutesExecutorOf(ecoRoutesPortal("base"))),
      SAUCE_INTENT_POT_SALT,
    ) as Address;

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

  it("reads the destination Kitchen's fee for --intent-execution-fee auto", async () => {
    const file = join(work, "intent.sauce.ts");
    writeFileSync(file, INTENT);
    const auto = await sauce(
      ...["compile", file, ...DEFINES, "--intent-execution-fee", "auto"],
      ...["--config", config, "--json"],
    );
    expect(auto.code).toBe(0);
    expect(auto.stderr).toContain(
      `--intent-execution-fee auto: the Kitchen on base charges ${FEE} wei`,
    );
    const given = await sauce(...["compile", file, ...DEFINES, "--intent-execution-fee", `${FEE}`]);
    expect(JSON.parse(auto.stdout).bytecode).toBe(given.stdout.trim());
    // With no endpoint for Base, there is nothing to read the fee from.
    const blind = await sauce("compile", file, ...DEFINES, "--intent-execution-fee", "auto");
    expect(blind.code).toBe(2);
    expect(blind.stderr).toMatch(
      /reads the Kitchen's fee on base.*rpcUrls entry for chain id 8453/,
    );
  }, 60_000);

  it("warns, compiling or publishing, while the destination's shared Pot is not deployed", async () => {
    const file = join(work, "intent.sauce.ts");
    writeFileSync(file, INTENT);
    const pot = sharedPot();
    const executor = getAddress(ecoRoutesExecutorOf(ecoRoutesPortal("base")));
    const compile = async () =>
      sauce(
        ...[
          "compile",
          file,
          ...DEFINES,
          "--intent-execution-fee",
          `${FEE}`,
          "--config",
          config,
          "--json",
        ],
      );
    const missing = await compile();
    expect(missing.code).toBe(0);
    expect(JSON.parse(missing.stdout).intentPots).toEqual([
      { destination: "base", pot, executor, deployed: false },
    ]);
    expect(missing.stderr).toContain(
      `warning: the intent to base cooks on Pot ${pot}, which is not deployed there, so no solver can fill it yet`,
    );
    expect(missing.stderr).toContain(`sauce pot --deploy --chain base --owner ${executor}`);
    // Publishing says so before it sends anything; with no endpoint for Base, that it cannot check.
    const unsigned = await sauce(
      ...[
        "intent",
        "publish",
        file,
        ...DEFINES,
        "--intent-execution-fee",
        `${FEE}`,
        "--format",
        "json",
      ],
    );
    expect(unsigned.stderr).toContain(`the intent to base cooks on Pot ${pot}`);
    expect(unsigned.stderr).toContain("pass --config with an rpcUrls entry for chain id 8453");

    // Deployed as the warning says — by any account, for the Executor — the warning goes away.
    const deployed = await sauce(
      ...["pot", "--deploy", "--chain", "base", "--owner", executor, "--rpc-url", base.rpcUrl],
      ...["--private-key", OTHER_KEY],
    );
    expect(jsonOf(deployed)).toMatchObject({ pot, owner: executor, deployed: true });
    const there = await compile();
    expect(JSON.parse(there.stdout).intentPots).toEqual([
      { destination: "base", pot, executor, deployed: true },
    ]);
    expect(there.stderr).not.toContain("warning:");
  }, 90_000);
});
