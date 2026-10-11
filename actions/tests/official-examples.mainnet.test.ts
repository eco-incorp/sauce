/**
 * The protocols' own examples, ported to Sauce (`skills/sauce-swaps/examples` and
 * `skills/sauce-protocols/examples`, each header naming the official file it ports), EXECUTED: each
 * program run as its header says, through the `sauce` command itself (`runCli`): `simulate` for
 * what `main` returns, then `run` to send the cook, on Ethereum's state captured at its pinned block
 * (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * Every result is held to something the program did not compute: each swap to Uniswap's own
 * QuoterV2 on the same route, and to the balances it moved.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { OWNER_KEY, REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { allowance, balanceOf, setBalance } from "./swap-venues.js";

const example = (skill: string, name: string): string =>
  join(REPO_ROOT, "skills", skill, "examples", `${name}.sauce.ts`);

/** The address a program compiled for Ethereum names `name` by: the SDK's own define for it. */
function named(name: string): Address {
  const value = routes.chainDefines(requireChain("ethereum"))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on ethereum`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

/** Uniswap's own QuoterV2 on Ethereum: what every swap here is held to. */
const QUOTER: Address = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

const abi = {
  quoter: parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
    "function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
  ]),
};

/** Recipients: anvil's dev accounts past the owner's. */
const PEOPLE: readonly Address[] = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
].map((address) => getAddress(address));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(argv: readonly string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

describe(
  "the protocols' own examples, ported and executed",
  { skip: skipReason(), timeout: 1_800_000 },
  () => {
    let env: Anvil;
    let snapshot: Hex;

    before(async () => {
      env = await startAnvil({ mainnet: "official-ethereum", chain: "ethereum" });
    });
    after(async () => {
      await env?.stop();
    });
    beforeEach(async () => {
      snapshot = await env.testClient.snapshot();
    });
    afterEach(async () => {
      await env.testClient.revert({ id: snapshot });
    });

    /** `sauce simulate` of an example on the owner's Pot: the JSON it prints. */
    async function simulate(
      file: string,
      args: readonly string[],
    ): Promise<{ ok: boolean; returned?: unknown; reason?: string }> {
      const { code, stdout, stderr } = await sauce([
        ...["simulate", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--owner", env.account.address, "--salt-hex", POT_SALT, "--json"],
        ...(args.length === 0 ? [] : ["--args", ...args]),
      ]);
      assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

      return JSON.parse(stdout) as { ok: boolean; returned?: unknown; reason?: string };
    }

    /** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
    async function run(file: string, args: readonly string[]): Promise<void> {
      const { code, stdout, stderr } = await sauce([
        ...["run", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...(args.length === 0 ? [] : ["--args", ...args]),
      ]);
      assert.equal(code, 0, `${stderr}\n${stdout}`);
      assert.equal((JSON.parse(stdout) as { cook: { status: string } }).cook.status, "success");
    }

    /** Simulates, then runs: `main`'s return as the rehearsal decoded it, from the state it ran on. */
    async function cook(file: string, args: readonly string[]): Promise<unknown> {
      const rehearsal = await simulate(file, args);
      assert.equal(rehearsal.ok, true, `the rehearsal reverts: ${rehearsal.reason}`);
      await run(file, args);

      return rehearsal.returned;
    }

    describe("Uniswap V3's SwapExamples", () => {
      const FILE = example("sauce-swaps", "uniswap-v3-swap-examples");
      const DAI = named("Maker_Dai");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const ROUTER = named("UniswapV3_SwapRouter");
      const DAI_BALANCE = { slot: 2n };
      const FEE = 3000;
      const STABLE_FEE = 100;
      /** A router path: tokens with the fee of the pool between each two. */
      const path = (...hops: Array<Address | number>): Hex =>
        `0x${hops
          .map((hop) =>
            typeof hop === "number" ? hop.toString(16).padStart(6, "0") : hop.slice(2),
          )
          .join("")}` as Hex;
      const ONE_THOUSAND_DAI = 1000n * 10n ** 18n;
      const HELD = 5000n * 10n ** 18n;

      const quote = async (functionName: string, args: readonly unknown[]): Promise<bigint> => {
        const { result } = await env.publicClient.simulateContract({
          address: QUOTER,
          abi: abi.quoter,
          functionName: functionName as "quoteExactInput",
          args: args as never,
        });

        return (result as unknown as readonly [bigint])[0];
      };

      for (const multihop of [false, true]) {
        const route = multihop ? "DAI → USDC → WETH" : "DAI → WETH";

        it(`swapExactInput${multihop ? "Multihop" : "Single"}: sells 1,000 DAI ${route}, as the quoter quotes`, async () => {
          const [recipient] = PEOPLE;
          await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
          const quoted = multihop
            ? await quote("quoteExactInput", [
                path(DAI, STABLE_FEE, USDC, FEE, WETH),
                ONE_THOUSAND_DAI,
              ])
            : await quote("quoteExactInputSingle", [
                {
                  tokenIn: DAI,
                  tokenOut: WETH,
                  amountIn: ONE_THOUSAND_DAI,
                  fee: FEE,
                  sqrtPriceLimitX96: 0n,
                },
              ]);

          const returned = await cook(FILE, [
            String(multihop),
            "false",
            String(ONE_THOUSAND_DAI),
            String(quoted),
            recipient,
          ]);
          assert.equal(BigInt(returned as string), quoted);
          assert.equal(await balanceOf(env, WETH, recipient), quoted);
          assert.equal(await balanceOf(env, DAI, env.pot), HELD - ONE_THOUSAND_DAI);
        });

        it(`swapExactOutput${multihop ? "Multihop" : "Single"}: buys 0.1 WETH ${route}, keeps the unspent DAI and no allowance`, async () => {
          const [recipient] = PEOPLE;
          const amountOut = 10n ** 17n;
          await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
          const quoted = multihop
            ? await quote("quoteExactOutput", [path(WETH, FEE, USDC, STABLE_FEE, DAI), amountOut])
            : await quote("quoteExactOutputSingle", [
                {
                  tokenIn: DAI,
                  tokenOut: WETH,
                  amount: amountOut,
                  fee: FEE,
                  sqrtPriceLimitX96: 0n,
                },
              ]);
          const amountInMaximum = (quoted * 101n) / 100n;

          const returned = await cook(FILE, [
            String(multihop),
            "true",
            String(amountOut),
            String(amountInMaximum),
            recipient,
          ]);
          assert.equal(BigInt(returned as string), quoted);
          assert.equal(await balanceOf(env, WETH, recipient), amountOut);
          assert.equal(await balanceOf(env, DAI, env.pot), HELD - quoted);
          assert.equal(
            await allowance(env, DAI, env.pot, ROUTER),
            0n,
            "the allowance is withdrawn",
          );
        });
      }

      it("refuses a minimum the pool cannot meet, and DAI the Pot does not hold", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
        const quoted = await quote("quoteExactInputSingle", [
          {
            tokenIn: DAI,
            tokenOut: WETH,
            amountIn: ONE_THOUSAND_DAI,
            fee: FEE,
            sqrtPriceLimitX96: 0n,
          },
        ]);
        const short = await simulate(FILE, [
          "false",
          "false",
          String(ONE_THOUSAND_DAI),
          String(quoted + 1n),
          recipient,
        ]);
        assert.equal(short.ok, false);
        assert.match(String(short.reason), /Too little received/);

        const more = await simulate(FILE, ["false", "false", String(HELD + 1n), "0", recipient]);
        assert.equal(more.ok, false);
        assert.match(String(more.reason), /the DAI to spend is not in the Pot/);
      });
    });
  },
);
