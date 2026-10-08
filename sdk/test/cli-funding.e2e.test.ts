/**
 * `sauce run --fund` and `sauce simulate --fund` against a chain: the tokens a program spends pulled
 * into its Pot in the same cook, by each `--fund-mode`, on a local anvil running the released gated
 * stack (`cli-anvil.ts`) with canonical Permit2 installed at its address — its runtime read from
 * Ethereum once into `fixtures/cli/Permit2.json`, so nothing here reaches a network.
 *
 * The tokens, each at the address the program names it by:
 *   - USDC: a standard OpenZeppelin ERC-20 (no EIP-2612), at the registry's USDC;
 *   - USDT: USDT's shape — writes return nothing, approve refuses nonzero to nonzero — at the
 *     registry's USDT;
 *   - PUSDT: USDT's shape with EIP-2612 `permit` (`fixtures/cli/PullTokens.sol`);
 *   - FALSE: EIP-2612, honest except that `transferFrom` answers `false` and moves nothing.
 *
 * Every pull is a SafeERC20 `safeTransferFrom`: the USDT-shaped tokens succeed in every mode, and a
 * `false` pull reverts the whole run. Permit2 refuses an expired signature and a spent nonce. No key
 * is ever printed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { runCommand, type Approver, type CookInput } from "../src/cli/commands.js";
import { parseFund, permit2On, planFunding } from "../src/cli/funding.js";
import { nodeIo, type CliIo } from "../src/cli/run.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { addressOn, getDescriptor } from "../src/descriptors/query.js";
import {
  CLI_FIXTURES,
  KEYSTORE_PASSWORD_FILE,
  deployPot,
  describeEvm,
  erc20,
  FEE,
  fixture,
  jsonOf,
  OTHER_KEY,
  OWNER,
  OWNER_KEY,
  registered,
  sauce,
  sauceWith,
  startChain,
  WORKER,
  type LocalChain,
  type Run,
} from "./cli-anvil.js";

const PERMIT2_FIXTURE = JSON.parse(readFileSync(join(CLI_FIXTURES, "Permit2.json"), "utf8")) as {
  address: Address;
  codeHash: Hex;
  runtime: Hex;
};
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const tokenCreation = (name: string, symbol: string, dir?: string): Hex =>
  `${fixture(name, dir)}${encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint8" }],
    [`${symbol} token`, symbol, 6],
  ).slice(2)}` as Hex;
const permit2Abi = parseAbi(["function nonceBitmap(address, uint256) view returns (uint256)"]);
const nonces = parseAbi(["function nonces(address) view returns (uint256)"]);

/** What a run printed to stderr besides the warning every `--private-key` signer gets. */
const notes = (run: Run): string =>
  run.stderr.replace(
    "warning: --private-key puts the key in your shell history and in the process list; prefer --keystore or --wallet\n",
    "",
  );

/** Every word the suite's runs printed, to look for key material in. */
const printed: string[] = [];
const record = (run: Run): Run => {
  printed.push(run.stdout, run.stderr);

  return run;
};

describeEvm(
  "sauce run --fund: the tokens a program spends, pulled into its Pot in the cook",
  () => {
    let local: LocalChain;
    let work: string;
    let program: string;
    let pot: Address;
    let permit2: Address;
    let usdc: Address;
    let usdt: Address;
    let pusdt: Address;
    let falsePull: Address;
    /** USDT's shape again, by address, for an approval of Permit2 that starts nonzero. */
    let tether: Address;
    const MINTED = 100_000_000n;

    /** The program the suite funds: pays `amount` of `token` to `to` from the Pot, returns it. */
    const PAYS = [
      "// @chain ethereum",
      "function main(token: Address, to: Address, amount: Uint256): Uint256 {",
      "  transfer(token, to, amount);",
      "  return amount;",
      "}",
      "",
    ].join("\n");

    /** `sauce run` of the program, signed by the owner, with `flags` before its arguments. */
    const run = (
      flags: readonly string[],
      args: readonly string[],
      confirm?: (question: string) => Promise<boolean | undefined>,
    ): Promise<Run> =>
      sauceWith(
        confirm === undefined ? {} : { confirm, canAsk: () => true },
        "run",
        program,
        "--rpc-url",
        local.rpcUrl,
        "--private-key",
        OWNER_KEY,
        ...flags,
        "--args",
        ...args,
      ).then(record);

    /** A prompt that must not be asked. */
    const unasked = (question: string): Promise<boolean | undefined> => {
      throw new Error(`asked: ${question}`);
    };
    /** The approver a run with a terminal has, answering with `confirm`. */
    const asking = (confirm: (question: string) => Promise<boolean | undefined>): Approver => ({
      auto: false,
      canAsk: true,
      approve: (_action, question) => confirm(question),
    });

    const balance = (token: Address, holder: Address): Promise<bigint> =>
      local.balanceOf(token, holder);
    const allowance = (token: Address, spender: Address): Promise<bigint> =>
      local.publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: "allowance",
        args: [OWNER.address, spender],
      });

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), "sauce-cli-funding-"));
      program = join(work, "pays.sauce.ts");
      writeFileSync(program, PAYS);
      local = await startChain("ethereum", 9100 + WORKER);
      // Canonical Permit2, where the registry says Permit2 is.
      permit2 = getAddress(addressOn(getDescriptor("permit2", "Permit2")!, local.chain)!);
      expect(permit2).toBe(getAddress(PERMIT2_FIXTURE.address));
      expect(keccak256(PERMIT2_FIXTURE.runtime)).toBe(PERMIT2_FIXTURE.codeHash);
      await local.testClient.setCode({ address: permit2, bytecode: PERMIT2_FIXTURE.runtime });
      usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
      usdt = await local.plant(
        tokenCreation("NoReturnERC20", "USDT"),
        registered(local.chain, "USDT"),
      );
      pusdt = getAddress(
        await local.plant(tokenCreation("NoReturnPermitERC20", "PUSDT", CLI_FIXTURES)),
      );
      falsePull = getAddress(
        await local.plant(tokenCreation("FalsePullPermitERC20", "FALSE", CLI_FIXTURES)),
      );
      tether = getAddress(await local.plant(tokenCreation("NoReturnERC20", "TETHER")));
      for (const token of [usdc, usdt, pusdt, falsePull, tether])
        await local.mint(token, OWNER.address, MINTED);
      pot = await deployPot(local);
    }, 120_000);

    afterAll(async () => {
      rmSync(work, { recursive: true, force: true });
      await local?.stop();
    });

    describe("permit2, the default", () => {
      it("asks to approve Permit2 the first time, and does nothing on no or with no terminal", async () => {
        const questions: string[] = [];
        for (const answer of [undefined, false]) {
          const refused = await run(
            ["--fund", "USDC:1.5"],
            [usdc, RECIPIENT, "1000000"],
            async (q) => {
              questions.push(q);

              return answer;
            },
          );
          expect(refused.code).toBe(1);
          expect(refused.stderr).toContain(
            answer === undefined
              ? "USDC is not approved to Permit2: approve it, or pass --auto-approve to let the run do it"
              : "USDC is not approved to Permit2: approve it; nothing was sent",
          );
        }
        expect(questions[0]).toBe(
          `Permit2 (${permit2}) may move 0 of your USDC (base units), and this run needs 1500000. ` +
            "Approve Permit2 for USDC now? [y/N] ",
        );
        expect(await allowance(usdc, permit2)).toBe(0n);
        expect(await balance(usdc, OWNER.address)).toBe(MINTED);
      }, 60_000);

      it("on yes approves Permit2, then pulls 1.5 USDC into the Pot and runs the program in one cook", async () => {
        const done = await run(
          ["--fund", "USDC:1.5", "--json"],
          [usdc, RECIPIENT, "1000000"],
          async () => true,
        );
        expect(done.code).toBe(0);
        const out = JSON.parse(done.stdout) as {
          funding: Array<{ what: string; status: string }>;
          cook: { status: string };
          value: string;
        };
        expect(out.funding.map((step) => [step.what, step.status])).toEqual([
          [`approve USDC to ${permit2}`, "success"],
        ]);
        expect(out.cook.status).toBe("success");
        expect(out.value).toBe(FEE.toString());
        // Permit2 holds a standing approval, as it is meant to; the Pot holds none.
        expect(await allowance(usdc, permit2)).toBe(maxUint256);
        expect(await allowance(usdc, pot)).toBe(0n);
        expect(await balance(usdc, OWNER.address)).toBe(MINTED - 1_500_000n);
        expect(await balance(usdc, RECIPIENT)).toBe(1_000_000n);
        expect(await balance(usdc, pot)).toBe(500_000n);
        expect(done.stderr).toContain("approved Permit2 for USDC: a standing approval");
      }, 60_000);

      it("needs no approval the next time: one transaction, the cook", async () => {
        const done = await run(["--fund", "USDC:1000000n"], [usdc, RECIPIENT, "1000000"], unasked);
        expect(notes(done)).toBe("");
        expect(done.code).toBe(0);
        // The cook, alone: then what it cost and moved.
        expect(done.stdout).toMatch(
          /^cook 0x[0-9a-f]{64}: success, gas used \d+, block \d+\n {2}explorer: .*\n {2}trace .*\ncost /,
        );
        expect(await balance(usdc, RECIPIENT)).toBe(2_000_000n);
        expect(await balance(usdc, pot)).toBe(500_000n);
      }, 60_000);

      it("funds USDT, whose writes return nothing, and --sweep returns what the program left", async () => {
        const done = await run(
          ["--fund", "USDT:5", "--sweep", "--auto-approve"],
          [usdt, RECIPIENT, "2000000"],
        );
        expect(done.code).toBe(0);
        expect(done.stdout).toMatch(
          new RegExp(`^approve USDT to ${permit2} 0x[0-9a-f]{64}: success`, "m"),
        );
        expect(await allowance(usdt, permit2)).toBe(maxUint256);
        expect(await balance(usdt, RECIPIENT)).toBe(2_000_000n);
        // Swept: the Pot keeps none of it, the owner has back all but what was paid.
        expect(await balance(usdt, pot)).toBe(0n);
        expect(await balance(usdt, OWNER.address)).toBe(MINTED - 2_000_000n);
      }, 60_000);

      /** A cook funded by Permit2 with `nonce` and `deadline` set, as `sauce run` would send it. */
      const fundedCook = (amount: bigint, nonce: bigint, deadline?: bigint) =>
        runCommand(
          {
            file: program,
            text: PAYS,
            chain: local.chain,
            defines: {},
            compactArgs: false,
            intents: {},
            target: { pot },
            args: { from: "--args", values: [usdc, RECIPIENT, amount.toString()] },
            rpcUrl: local.rpcUrl,
            account: OWNER,
            approver: asking(unasked),
            fund: ((client, at, owner) =>
              planFunding({
                chain: local.chain,
                client,
                rpcUrl: local.rpcUrl,
                owner,
                pot: at,
                mode: "permit2",
                requests: [parseFund(`USDC:${amount}n`, local.chain)],
                sweep: false,
                account: OWNER,
                nonce,
                ...(deadline === undefined ? {} : { deadline }),
                send: true,
                approver: asking(unasked),
              })) satisfies CookInput["fund"],
          },
          nodeIo(),
        );

      it("refuses a spent nonce: Permit2 reverts InvalidNonce, and nothing is sent", async () => {
        const nonce = 77n;
        expect((await fundedCook(1n, nonce)).json).toMatchObject({ cook: { status: "success" } });
        const word = await local.publicClient.readContract({
          address: permit2,
          abi: permit2Abi,
          functionName: "nonceBitmap",
          args: [OWNER.address, nonce >> 8n],
        });
        expect((word >> (nonce & 255n)) & 1n).toBe(1n);
        const before = await balance(usdc, OWNER.address);
        await expect(fundedCook(1n, nonce)).rejects.toThrow(
          /not sent — it would revert: InvalidNonce\(\)/,
        );
        expect(await balance(usdc, OWNER.address)).toBe(before);
      }, 60_000);

      it("refuses an expired signature: Permit2 reverts SignatureExpired", async () => {
        const { timestamp } = await local.publicClient.getBlock();
        await expect(fundedCook(1n, 78n, timestamp - 1n)).rejects.toThrow(
          new RegExp(`not sent — it would revert: SignatureExpired\\(${timestamp - 1n}\\)`),
        );
      }, 60_000);

      it("picks a fresh nonce for every run", async () => {
        const before = await balance(usdc, RECIPIENT);
        for (let i = 0; i < 2; i++) {
          expect((await run(["--fund", "USDC:1n"], [usdc, RECIPIENT, "1"], unasked)).code).toBe(0);
        }
        expect(await balance(usdc, RECIPIENT)).toBe(before + 2n);
      }, 60_000);

      it("resets a smaller approval of Permit2 to zero first, as a USDT-shaped token requires", async () => {
        // Nonzero to nonzero is refused by this token, so a straight approve would revert.
        await local.send(
          local.owner,
          tether,
          encodeFunctionData({
            abi: parseAbi(["function approve(address, uint256)"]),
            functionName: "approve",
            args: [permit2, 1n],
          }),
        );
        const done = await run(
          ["--fund", `${tether}:2`, "--auto-approve"],
          [tether, RECIPIENT, "2000000"],
        );
        expect(done.code).toBe(0);
        // Each sent transaction's line, then its explorer page and its trace.
        const tx =
          "0x[0-9a-f]{64}: success, gas used \\d+, block \\d+\\n {2}explorer: .*\\n {2}trace .*";
        expect(done.stdout).toMatch(
          new RegExp(
            `^reset ${tether}'s allowance to ${permit2} ${tx}\\n` +
              `approve ${tether} to ${permit2} ${tx}\\ncook ${tx}\\ncost `,
          ),
        );
        expect(await allowance(tether, permit2)).toBe(maxUint256);
        expect(await balance(tether, RECIPIENT)).toBe(2_000_000n);
      }, 60_000);

      it("funds two tokens in one run, and sweeps both", async () => {
        const two = join(work, "two.sauce.ts");
        writeFileSync(
          two,
          [
            "// @chain ethereum",
            "function main(a: Address, b: Address, to: Address, amount: Uint256) {",
            "  transfer(a, to, amount);",
            "  transfer(b, to, amount);",
            "}",
            "",
          ].join("\n"),
        );
        const before = {
          usdc: await balance(usdc, RECIPIENT),
          usdt: await balance(usdt, RECIPIENT),
        };
        const owned = {
          usdc: await balance(usdc, OWNER.address),
          usdt: await balance(usdt, OWNER.address),
        };
        const potHeld = await balance(usdc, pot);
        const done = record(
          await sauceWith(
            { confirm: unasked },
            "run",
            two,
            "--rpc-url",
            local.rpcUrl,
            "--private-key",
            OWNER_KEY,
            "--fund",
            "USDC:1",
            "--fund",
            "USDT:1",
            "--sweep",
            "--args",
            usdc,
            usdt,
            RECIPIENT,
            "400000",
          ),
        );
        expect(notes(done)).toBe("");
        expect(done.code).toBe(0);
        expect(await balance(usdc, RECIPIENT)).toBe(before.usdc + 400_000n);
        expect(await balance(usdt, RECIPIENT)).toBe(before.usdt + 400_000n);
        // The sweep empties the Pot of both — the USDC it held before the run included.
        expect(await balance(usdc, pot)).toBe(0n);
        expect(await balance(usdt, pot)).toBe(0n);
        expect(await balance(usdc, OWNER.address)).toBe(owned.usdc - 400_000n + potHeld);
        expect(await balance(usdt, OWNER.address)).toBe(owned.usdt - 400_000n);
      }, 60_000);
    });

    describe("permit: the token's own EIP-2612", () => {
      it("pulls a USDT-shaped token, whose transferFrom returns nothing", async () => {
        const nonceBefore = await local.publicClient.readContract({
          address: pusdt,
          abi: nonces,
          functionName: "nonces",
          args: [OWNER.address],
        });
        const done = await run(
          ["--fund", `${pusdt}:3`, "--fund-mode", "permit"],
          [pusdt, RECIPIENT, "3000000"],
          unasked,
        );
        expect(notes(done)).toBe("");
        expect(done.code).toBe(0);
        expect(await balance(pusdt, RECIPIENT)).toBe(3_000_000n);
        expect(
          await local.publicClient.readContract({
            address: pusdt,
            abi: nonces,
            functionName: "nonces",
            args: [OWNER.address],
          }),
        ).toBe(nonceBefore + 1n);
        // The permit was for exactly the amount, and the pull spent it.
        expect(await allowance(pusdt, pot)).toBe(0n);
      }, 60_000);

      it("reverts the whole run when the pull answers false: no permit, no payment", async () => {
        const refused = await run(
          ["--fund", `${falsePull}:1`, "--fund-mode", "permit"],
          [falsePull, RECIPIENT, "1"],
          unasked,
        );
        expect(refused.code).toBe(1);
        expect(refused.stderr).toMatch(/not sent — it would revert/);
        expect(await balance(falsePull, RECIPIENT)).toBe(0n);
        expect(await allowance(falsePull, pot)).toBe(0n);
      }, 60_000);

      it("refuses a token with no EIP-2612 permit, before sending anything", async () => {
        const refused = await run(
          ["--fund", "USDC:1", "--fund-mode", "permit"],
          [usdc, RECIPIENT, "1"],
        );
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain(
          "USDC does not support EIP-2612 permit (no DOMAIN_SEPARATOR matching its name, version " +
            "and address): fund it with --fund-mode permit2, allowance or transfer",
        );
      }, 60_000);
    });

    describe("allowance: an approval of the Pot", () => {
      it("asks to approve the Pot, warns that it stands, and pulls a USDT-shaped token", async () => {
        const questions: string[] = [];
        const done = await run(
          ["--fund", `${pusdt}:2`, "--fund-mode", "allowance"],
          [pusdt, RECIPIENT, "2000000"],
          async (question) => {
            questions.push(question);

            return true;
          },
        );
        expect(done.code).toBe(0);
        expect(questions).toEqual([
          `The Pot ${pot} may pull 0 of your ${pusdt} (base units), and this run needs 2000000. ` +
            "Approve the Pot for 2000000? [y/N] ",
        ]);
        expect(done.stderr).toContain(
          `warning: the Pot's allowance over your ${pusdt} was set in a transaction of its own, ` +
            "and stands until a cook spends it — for good if this one does not. --fund-mode " +
            "permit2 (the default) gives the Pot no allowance at all.",
        );
        expect(done.stdout).toMatch(
          new RegExp(`^approve ${pusdt} to ${pot} 0x[0-9a-f]{64}: success`, "m"),
        );
        expect(await balance(pusdt, RECIPIENT)).toBe(5_000_000n);
        expect(await allowance(pusdt, pot)).toBe(0n);
      }, 60_000);

      it("spends an allowance that already stands without asking, and says the rest stands", async () => {
        await local.send(
          local.owner,
          pusdt,
          encodeFunctionData({
            abi: parseAbi(["function approve(address, uint256)"]),
            functionName: "approve",
            args: [pot, 10_000_000n],
          }),
        );
        const done = await run(
          ["--fund", `${pusdt}:1`, "--fund-mode", "allowance"],
          [pusdt, RECIPIENT, "1000000"],
          unasked,
        );
        expect(done.code).toBe(0);
        expect(notes(done)).toBe(
          `warning: the Pot holds a standing allowance of 10000000 over your ${pusdt} (base units); ` +
            "this cook spends 1000000 of it and the rest stands. --fund-mode permit2 (the default) " +
            "gives the Pot no allowance at all.\n",
        );
        expect(await allowance(pusdt, pot)).toBe(9_000_000n);
      }, 60_000);

      it("reverts the whole run when the pull answers false", async () => {
        const refused = await run(
          ["--fund", `${falsePull}:1`, "--fund-mode", "allowance", "--auto-approve"],
          [falsePull, RECIPIENT, "1"],
        );
        expect(refused.code).toBe(1);
        // The approval is its own transaction, sent first; the cook is refused, so nothing moved.
        expect(refused.stderr).toMatch(/not sent — it would revert/);
        expect(await allowance(falsePull, pot)).toBe(1_000_000n);
        expect(await balance(falsePull, RECIPIENT)).toBe(0n);
        expect(await balance(falsePull, pot)).toBe(0n);
      }, 60_000);
    });

    describe("transfer, and the native currency", () => {
      it("transfers to the Pot first, in a transaction of its own", async () => {
        const potBefore = await balance(usdt, pot);
        const paid = await balance(usdt, RECIPIENT);
        const done = await run(
          ["--fund", "USDT:1", "--fund-mode", "transfer", "--json"],
          [usdt, RECIPIENT, "1000000"],
          unasked,
        );
        const out = jsonOf(done) as { funding: Array<{ what: string; status: string }> };
        expect(out.funding.map((step) => [step.what, step.status])).toEqual([
          ["transfer 1000000 USDT to the Pot", "success"],
        ]);
        expect(await balance(usdt, pot)).toBe(potBefore);
        expect(await balance(usdt, RECIPIENT)).toBe(paid + 1_000_000n);
      }, 60_000);

      it("sends ETH as the cook's value, and --sweep returns what the program did not spend", async () => {
        const native = join(work, "native.sauce.ts");
        writeFileSync(
          native,
          [
            "// @chain ethereum",
            "function main(to: Address, amount: Uint256) {",
            "  evm.call(to, amount, hex``);",
            "}",
            "",
          ].join("\n"),
        );
        const recipientBefore = await local.publicClient.getBalance({ address: RECIPIENT });
        const done = record(
          await sauce(
            "run",
            native,
            "--rpc-url",
            local.rpcUrl,
            "--private-key",
            OWNER_KEY,
            "--fund",
            "ETH:1000n",
            "--sweep",
            "--json",
            "--args",
            RECIPIENT,
            "400",
          ),
        );
        const out = jsonOf(done);
        expect(out.value).toBe((FEE + 1000n).toString());
        expect(await local.publicClient.getBalance({ address: RECIPIENT })).toBe(
          recipientBefore + 400n,
        );
        expect(await local.publicClient.getBalance({ address: pot })).toBe(0n);
      }, 60_000);
    });

    describe("sauce simulate --fund", () => {
      it("rehearses the pulls with the owner's signature, and sends nothing", async () => {
        const before = await balance(usdc, OWNER.address);
        const done = record(
          await sauce(
            "simulate",
            program,
            "--pot",
            pot,
            "--rpc-url",
            local.rpcUrl,
            "--private-key",
            OWNER_KEY,
            "--fund",
            "USDC:2",
            "--json",
            "--args",
            usdc,
            RECIPIENT,
            "2000000",
          ),
        );
        expect(jsonOf(done)).toMatchObject({ ok: true, from: OWNER.address, to: pot });
        expect(await balance(usdc, OWNER.address)).toBe(before);
      }, 60_000);

      it("with no key, credits the Pot what the pull would bring, says so, and sends nothing", async () => {
        const [before, paid] = [await balance(usdc, OWNER.address), await balance(usdc, RECIPIENT)];
        const done = record(
          await sauce(
            "simulate",
            program,
            "--pot",
            pot,
            "--rpc-url",
            local.rpcUrl,
            "--fund",
            "USDC:2",
            "--json",
            "--args",
            usdc,
            RECIPIENT,
            // The Pot as it is holds no USDC (the multi-token run swept it): it pays only what the
            // rehearsal credits it.
            "2000000",
          ),
        );
        expect(done.code).toBe(0);
        expect(done.stderr).toContain(
          "--fund without a key: pulling USDC needs the owner's signature (--keystore or " +
            "--private-key), so the pulls are not rehearsed; the Pot is credited what they would " +
            "bring, for this rehearsal only",
        );
        const out = JSON.parse(done.stdout) as { transfers: { from: Address; amount: string }[] };
        expect(out.transfers).toEqual([
          expect.objectContaining({ from: pot, to: RECIPIENT, amount: "2000000" }),
        ]);
        expect(await balance(usdc, OWNER.address)).toBe(before);
        expect(await balance(usdc, RECIPIENT)).toBe(paid);
      }, 60_000);

      it("refuses a key that is not the Pot's owner's", async () => {
        const refused = record(
          await sauce(
            "simulate",
            program,
            "--pot",
            pot,
            "--rpc-url",
            local.rpcUrl,
            "--private-key",
            OTHER_KEY,
            "--fund",
            "USDC:2",
            "--args",
            usdc,
            RECIPIENT,
            "1",
          ),
        );
        expect(refused.code).toBe(2);
        expect(refused.stderr).toContain(
          `the signer ${privateKeyToAccount(OTHER_KEY).address} is not the owner of Pot ${pot}`,
        );
      }, 60_000);

      /** `sauce simulate` of the program with the owner's key and `flags` before its arguments. */
      const simulateWith = async (flags: readonly string[], args: readonly string[]) =>
        record(
          await sauceWith(
            { confirm: unasked },
            "simulate",
            program,
            "--pot",
            pot,
            "--rpc-url",
            local.rpcUrl,
            "--private-key",
            OWNER_KEY,
            ...flags,
            "--args",
            ...args,
          ),
        );

      it("in permit mode, signs the permit and rehearses the pull, sending nothing", async () => {
        const nonceOf = () =>
          local.publicClient.readContract({
            address: pusdt,
            abi: nonces,
            functionName: "nonces",
            args: [OWNER.address],
          });
        const [nonce, paid] = [await nonceOf(), await balance(pusdt, RECIPIENT)];
        const done = await simulateWith(
          ["--fund", `${pusdt}:1`, "--fund-mode", "permit", "--json"],
          [pusdt, RECIPIENT, "1000000"],
        );
        expect(jsonOf(done)).toMatchObject({ ok: true });
        expect(await nonceOf()).toBe(nonce);
        expect(await balance(pusdt, RECIPIENT)).toBe(paid);
      }, 60_000);

      /** A rehearsal's transactions, as `--json` lists them: each step, and what a funding one is. */
      type Step = { step: string; what?: string; from: Address; to: Address; data?: Hex };
      const stepsOf = (done: Run) =>
        (JSON.parse(done.stdout) as { transactions: Step[] }).transactions.map((each) => [
          each.step,
          each.what ?? null,
        ]);
      const approve = (spender: Address, amount: bigint) =>
        encodeFunctionData({
          abi: parseAbi(["function approve(address, uint256) returns (bool)"]),
          functionName: "approve",
          args: [spender, amount],
        });

      it("in allowance mode, runs the Pot's approval first in the cook's block, and sends nothing", async () => {
        const done = await simulateWith(
          ["--fund", "USDC:1", "--fund-mode", "allowance", "--json"],
          [usdc, RECIPIENT, "1"],
        );
        expect(done.code).toBe(0);
        expect(stepsOf(done)).toEqual([
          ["fund", "approve the Pot for 1000000 USDC"],
          ["cook", null],
        ]);
        expect((JSON.parse(done.stdout) as { transactions: Step[] }).transactions[0]).toMatchObject(
          { from: OWNER.address, to: usdc, data: approve(pot, 1_000_000n) },
        );
        expect(notes(done)).toBe(
          "USDC: the Pot may not pull it yet: sauce run asks to approve it first (--auto-approve " +
            "approves it), and the rehearsal runs that approval before the cook\n",
        );
        expect(await allowance(usdc, pot)).toBe(0n);
      }, 60_000);

      it("in transfer mode, runs the transfer to the Pot first, and sends nothing", async () => {
        const [held, paid] = [await balance(usdc, OWNER.address), await balance(usdc, RECIPIENT)];
        const done = await simulateWith(
          ["--fund", "USDC:1", "--fund-mode", "transfer", "--json"],
          [usdc, RECIPIENT, "1000000"],
        );
        expect(done.code).toBe(0);
        expect(stepsOf(done)).toEqual([
          ["fund", "transfer 1000000 USDC to the Pot"],
          ["cook", null],
        ]);
        expect(notes(done)).toBe(
          "USDC: sauce run transfers it to the Pot first, and the rehearsal runs that transfer " +
            "before the cook\n",
        );
        expect([await balance(usdc, OWNER.address), await balance(usdc, RECIPIENT)]).toEqual([
          held,
          paid,
        ]);
      }, 60_000);

      /** A signer of its own, with no Pot and no approval of Permit2, holding `tokens`. */
      const freshSigner = async (...tokens: Address[]) => {
        const key = generatePrivateKey();
        const account = privateKeyToAccount(key);
        await local.testClient.setBalance({ address: account.address, value: 10n ** 20n });
        for (const token of tokens) await local.mint(token, account.address, 10_000_000n);

        return { key, account };
      };
      const allowanceOf = (token: Address, holder: Address, spender: Address) =>
        local.publicClient.readContract({
          address: token,
          abi: erc20,
          functionName: "allowance",
          args: [holder, spender],
        });

      it("with a key, runs the Permit2 approval sauce run would ask for first, and says so", async () => {
        const { key, account } = await freshSigner(usdc);
        const signerPot = v12PredictPot(account.address, potSalt("rehearsed")) as Address;
        const rehearse = (...flags: string[]) =>
          sauce(
            ...["simulate", program, "--rpc-url", local.rpcUrl, "--private-key", key],
            ...["--salt", "rehearsed", "--fund", "USDC:2", ...flags],
            ...["--args", usdc, RECIPIENT, "2000000"],
          ).then(record);
        const done = await rehearse("--json");
        expect(done.code).toBe(0);
        const out = JSON.parse(done.stdout) as {
          ok: boolean;
          transactions: Step[];
          transfers: Array<{ from: Address; to: Address; amount: string }>;
        };
        expect(out.ok).toBe(true);
        // The Pot's deployment, the approval sauce run asks for, then the cook, in one block.
        expect(stepsOf(done)).toEqual([
          ["deployPot", null],
          ["fund", "approve Permit2 for USDC"],
          ["cook", null],
        ]);
        expect(out.transactions[1]).toMatchObject({
          from: account.address,
          to: usdc,
          data: approve(permit2, maxUint256),
        });
        expect(out.transfers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ from: account.address, to: signerPot, amount: "2000000" }),
            expect.objectContaining({ from: signerPot, to: RECIPIENT, amount: "2000000" }),
          ]),
        );
        expect(notes(done)).toContain(
          `USDC: Permit2 (${permit2}) may not move your tokens yet: sauce run asks to approve it ` +
            "first (--auto-approve approves it), and the rehearsal runs that approval before the cook",
        );
        // A rehearsal: nothing landed.
        expect(await allowanceOf(usdc, account.address, permit2)).toBe(0n);
        expect(await local.publicClient.getCode({ address: signerPot })).toBeUndefined();
        // For a person, each transaction with its own gas, the cook's in the headline.
        const text = await rehearse();
        expect(text.code).toBe(0);
        expect(text.stdout).toMatch(
          /^The cook succeeds from 0x[0-9a-fA-F]{40}: gas used \d+ for the cook, after what it needs sent first \(1\. to 2\. below\), returns 0x/,
        );
        expect(text.stdout).toMatch(
          new RegExp(
            `^ {2}2\\. approve Permit2 for USDC, from the owner ${account.address}, gas used \\d+: ` +
              "sauce run sends this before the cook$",
            "m",
          ),
        );
      }, 60_000);

      it("resets a smaller standing approval first, as for a USDT-shaped token run does", async () => {
        const { key, account } = await freshSigner(tether);
        // Nonzero to nonzero is refused by this token: the rehearsal must reset it first.
        const wallet = createWalletClient({ account, transport: http(local.rpcUrl) });
        await local.send(wallet, tether, approve(permit2, 1n));
        const done = record(
          await sauce(
            ...["simulate", program, "--rpc-url", local.rpcUrl, "--private-key", key],
            ...["--salt", "standing", "--fund", `${tether}:2`, "--json"],
            ...["--args", tether, RECIPIENT, "2000000"],
          ),
        );
        expect(done.code).toBe(0);
        expect(stepsOf(done)).toEqual([
          ["deployPot", null],
          ["fund", `reset ${tether}'s allowance to ${permit2}`],
          ["fund", `approve Permit2 for ${tether}`],
          ["cook", null],
        ]);
        expect(await allowanceOf(tether, account.address, permit2)).toBe(1n);
      }, 60_000);
    });

    describe("what it refuses before sending", () => {
      it("a balance below the amount", async () => {
        const refused = await run(["--fund", "USDC:1000"], [usdc, RECIPIENT, "1"], unasked);
        expect(refused.code).toBe(1);
        expect(refused.stderr).toMatch(
          new RegExp(
            `${OWNER.address} holds \\d+ of USDC \\(base units\\), below the 1000000000 --fund USDC:1000 needs`,
          ),
        );
      }, 60_000);

      it.each([
        [["--sweep"], "--sweep returns what is left of the tokens --fund pulls in: give --fund"],
        [["--fund-mode", "permit"], "--fund-mode says how --fund pulls: give --fund"],
        [
          ["--fund", "USDC:1", "--fund-mode", "magic"],
          "--fund-mode: 'magic' is not permit2, permit, allowance, transfer",
        ],
        [
          ["--fund", "USDC:1", "--fund", "usdc:2"],
          "--fund names USDC twice: give it once, with the total",
        ],
      ])(
        "%j",
        async (flags, message) => {
          const refused = await run(flags, [usdc, RECIPIENT, "1"], unasked);
          expect(refused.code).toBe(2);
          expect(refused.stderr).toContain(message);
        },
        60_000,
      );
    });

    // Anvil's third dev account, in a keystore: its key and the keystore's password stay unprinted.
    const KEYSTORE_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    const PASSWORD = readFileSync(join(CLI_FIXTURES, "anvil-2.password"), "utf8").trim();

    it("piped in with no terminal, names every approval it needs and sends nothing until approved", async () => {
      // A signer of its own: no Pot, and USDC never approved to Permit2.
      const key = generatePrivateKey();
      const signer = privateKeyToAccount(key).address;
      await local.testClient.setBalance({ address: signer, value: 10n ** 20n });
      await local.mint(usdc, signer, 10_000_000n);
      const pot = v12PredictPot(signer, potSalt("piped")) as Address;
      const permit2 = permit2On(local.chain);
      // The program comes from stdin, so no question can be asked there: with no terminal either.
      const piped = (overrides: Partial<CliIo>, ...flags: string[]) =>
        sauceWith(
          { readStdin: () => readFileSync(program, "utf8"), ...overrides },
          ...["run", "-", "--rpc-url", local.rpcUrl, "--private-key", key, "--salt"],
          ...[flags[0] ?? "piped", "--fund", "USDC:2", ...flags.slice(1)],
          ...["--args", usdc, RECIPIENT, "1000000"],
        ).then(record);
      const stopped = await piped({});
      expect(stopped.code).toBe(1);
      expect(stopped.stderr).toContain(
        "nothing was sent: this run needs approvals, and there is no terminal to ask on:\n" +
          `  deploy Pot ${pot}\n  approve Permit2 for USDC\nPass --auto-approve to approve them`,
      );
      expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
      expect(await allowance(usdc, permit2)).toBe(0n);

      const approved = await piped({}, "piped", "--auto-approve");
      expect(approved.code).toBe(0);
      expect(approved.stderr).toContain(`auto-approved: deploy Pot ${pot}`);
      expect(approved.stderr).toContain("auto-approved: approve Permit2 for USDC");
      expect(await balance(usdc, signer)).toBe(8_000_000n);

      // Piped in from a terminal session: the questions go to the terminal, and only what is
      // needed is asked — Permit2 is approved now, the Pot for this salt is not deployed.
      const questions: string[] = [];
      const asked = await piped(
        {
          canAsk: () => true,
          confirm: async (question) => {
            questions.push(question);

            return true;
          },
        },
        "piped-at-a-terminal",
      );
      expect(asked.code).toBe(0);
      expect(questions).toEqual([
        expect.stringMatching(
          /^Pot 0x[0-9a-fA-F]{40} \(owner .*\) is not deployed on ethereum\. Deploy it now\? \[y\/N\] $/,
        ),
      ]);

      async function allowance(token: Address, spender: Address): Promise<bigint> {
        return local.publicClient.readContract({
          address: token,
          abi: erc20,
          functionName: "allowance",
          args: [signer, spender],
        });
      }
    }, 120_000);

    it("signs with a keystore: deploys its Pot, approves Permit2 and funds the cook with --auto-approve", async () => {
      const signer = privateKeyToAccount(KEYSTORE_KEY).address;
      await local.mint(usdc, signer, 10_000_000n);
      const before = await balance(usdc, RECIPIENT);
      const done = record(
        await sauce(
          "run",
          program,
          "--rpc-url",
          local.rpcUrl,
          "--keystore",
          join(CLI_FIXTURES, "anvil-2.keystore.json"),
          "--password-file",
          KEYSTORE_PASSWORD_FILE,
          "--salt",
          "funded",
          "--fund",
          "USDC:4",
          "--sweep",
          "--auto-approve",
          "--args",
          usdc,
          RECIPIENT,
          "1000000",
        ),
      );
      expect(done.code).toBe(0);
      // What was sent, in order, each with its explorer page and trace; after the cook, what it
      // cost and moved.
      const lines = done.stdout.trim().split("\n");
      const sent = lines.slice(
        0,
        lines.findIndex((line) => line.startsWith("cost ")),
      );
      expect(
        sent.filter((line) => !line.startsWith("  ")).map((line) => line.split(" 0x")[0]),
      ).toEqual(["deployed Pot", "approve USDC to", "cook"]);
      expect(sent.filter((line) => line.startsWith("  trace "))).toHaveLength(3);
      expect(done.stdout).toMatch(
        /^cost [\d.]+ ETH: gas \d+ at \d+ wei = [\d.]+ ETH, value [\d.]+ ETH/m,
      );
      // What moved, in order: the pull from the wallet, the payment, and the sweep back to it.
      expect(done.stdout).toMatch(
        /^ {2}\[1\] wallet 0x\w{4}…\w{4} -> Pot 0x\w{4}…\w{4} +4 USDC\n {2}\[2\] Pot +-> 0x6666…6666 +1 USDC\n {2}\[3\] Pot +-> wallet +3 USDC$/m,
      );
      expect(await balance(usdc, RECIPIENT)).toBe(before + 1_000_000n);
      expect(await balance(usdc, signer)).toBe(9_000_000n);
    }, 120_000);

    it("never prints a key or a keystore's password", () => {
      const secrets = [OWNER_KEY, OTHER_KEY, KEYSTORE_KEY].flatMap((key) => [key, key.slice(2)]);
      for (const text of printed) {
        for (const secret of [...secrets, PASSWORD]) {
          expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
        }
      }
      expect(printed.length).toBeGreaterThan(20);
    });
  },
);
