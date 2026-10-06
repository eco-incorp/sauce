/**
 * The sauce-chains skill's one-file-for-every-chain example, `skills/sauce-chains/examples/
 * holdings.sauce.ts`, EXECUTED on Ethereum's and Base's state at their pinned blocks (`mainnet.ts`),
 * through the released engine, Kitchen and Pot: the example line of its header, `sauce simulate`,
 * run as written on each chain. The same file reads each chain's own USDC, WETH, bCSPX and Uniswap
 * V3 factory, and returns the chain's own pool and the balances the Pot was given. No RPC is reached.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Hex } from "viem";

import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import type { ChainName } from "./mainnet.js";
import { setBalance, type BalanceSlot } from "./swap-venues.js";

/** Pending: main's return type, which the compiler reports with the v12 #557 port (entrySignature).
 *  A todo runs, and its failure fails nothing, until the compiler is relinked with it. */
const RETURN_TYPE_PENDING = { todo: "main's return type: the compiler's v12 #557 port" };

const EXAMPLE = join(REPO_ROOT, "skills/sauce-chains/examples/holdings.sauce.ts");

interface Chain {
  readonly chain: ChainName;
  readonly USDC: Hex;
  readonly WETH: Hex;
  /** Backed's tokenized S&P 500 fund, a proxy whose implementation keeps balances at slot 101. */
  readonly bCSPX: Hex;
  readonly factory: Hex;
  /** The USDC/WETH 0.05% pool, as the chain's factory records it at the pinned block. */
  readonly pool: Hex;
}

const CHAINS: readonly Chain[] = [
  {
    chain: "ethereum",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    bCSPX: "0x1e2C4fb7eDE391d116E6B41cD0608260e8801D59",
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
  },
  {
    chain: "base",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    bCSPX: "0xC3cE78B037DDA1B966D31EC7979d3f3a38571A8E",
    factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
  },
];

const SLOTS: Readonly<Record<"USDC" | "WETH" | "bCSPX", BalanceSlot>> = {
  USDC: { slot: 9n },
  WETH: { slot: 3n },
  bCSPX: { slot: 101n },
};

/** What the Pot is given on each chain: 1,234.56789 USDC, 1.5 WETH and 2.5 bCSPX. */
const HELD = { USDC: 1_234_567_890n, WETH: 15n * 10n ** 17n, bCSPX: 25n * 10n ** 17n } as const;

/** The example line of the header, `sauce simulate holdings.sauce.ts --chain base …`, as words. */
function exampleLine(): string[] {
  const line = readFileSync(EXAMPLE, "utf8")
    .split("\n")
    .map((one) => one.replace(/^\/\/\s*/, ""))
    .find((one) => one.startsWith("sauce simulate holdings.sauce.ts --chain base"));
  assert.ok(line, "the header has a `sauce simulate` example line on Base");

  return line.split(/\s+/).slice(1);
}

/** `sauce <argv>`, in process: its exit code and what it printed. */
async function sauce(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runCli([...argv], {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

describe("sauce-chains' holdings.sauce.ts, executed on each chain", () => {
  for (const chain of CHAINS) {
    describe(`on ${chain.chain} state`, { skip: skipReason(), timeout: 900_000 }, () => {
      let env: Anvil;
      let snapshot: Hex;
      before(async () => {
        env = await startAnvil({ mainnet: `holdings-${chain.chain}`, chain: chain.chain });
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

      /** The header's example line on this chain, from the Pot's owner, at `fee`. */
      const simulate = (fee: string) => {
        const words = exampleLine().map((word) =>
          word === "holdings.sauce.ts"
            ? EXAMPLE
            : word === "<address>"
              ? env.account.address
              : word,
        );
        words[words.indexOf("--chain") + 1] = chain.chain;
        const at = words.indexOf("--args");

        return sauce([
          ...words.slice(0, at),
          ...["--rpc-url", env.rpc, "--salt-hex", POT_SALT, "--json"],
          "--args",
          fee,
        ]);
      };

      it(
        "returns the chain's own pool and what the Pot holds of its USDC, WETH and bCSPX",
        RETURN_TYPE_PENDING,
        async () => {
          for (const token of ["USDC", "WETH", "bCSPX"] as const) {
            await setBalance(env, chain[token], SLOTS[token], env.pot, HELD[token]);
          }
          // The pool, as the chain's factory answers on its own.
          const pool = await env.publicClient.readContract({
            address: chain.factory,
            abi: parseAbi(["function getPool(address,address,uint24) view returns (address)"]),
            functionName: "getPool",
            args: [chain.USDC, chain.WETH, 500],
          });
          assert.equal(pool, chain.pool);

          const run = await simulate("500");
          assert.equal(run.code, 0, `${run.stderr}\n${run.stdout}`);
          const out = JSON.parse(run.stdout) as Record<string, unknown>;
          assert.equal(out.ok, true);
          assert.equal(out.chain, chain.chain);
          assert.deepEqual(out.returned, {
            pool: chain.pool,
            usdc: HELD.USDC.toString(),
            weth: HELD.WETH.toString(),
            bcspx: HELD.bCSPX.toString(),
          });
        },
      );

      it("refuses, with its message, a fee tier the chain has no USDC/WETH pool at", async () => {
        const run = await simulate("1234");
        assert.equal(run.code, 1, run.stdout);
        assert.match(run.stdout, /no USDC\/WETH pool at that fee on this chain/);
      });
    });
  }
});
