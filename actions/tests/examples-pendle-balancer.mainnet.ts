/**
 * The Balancer V2 and Pendle examples (`skills/sauce-swaps/examples/balancer-*.sauce.ts`,
 * `skills/sauce-protocols/examples/pendle-*.sauce.ts`), EXECUTED: each program run as its header
 * says, through the `sauce` command itself (`runCli`): `simulate` for what `main` returns, then
 * `run` to send the cook, on Ethereum's state captured at its pinned block (`mainnet.ts`), through
 * the released engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * Every result is held to something the program did not compute: each Balancer batch to the
 * Vault's own `queryBatchSwap` on the same steps, each Pendle mint of SY to the SY's own
 * `previewDeposit`, and every trade to the balances it moved and the allowances it left.
 *
 * A group, not a suite of its own: `examples.mainnet.test.ts` registers it on the one anvil every
 * group reading `official-ethereum` shares, and a capture there writes all of their state.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { encodeAbiParameters, getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { OWNER_KEY, REPO_ROOT, type Anvil } from "./anvil.js";
import { allowance, balanceOf, NATIVE, setBalance } from "./swap-venues.js";

const example = (skill: string, name: string): string =>
  join(REPO_ROOT, "skills", skill, "examples", `${name}.sauce.ts`);

/** The address a program compiled for Ethereum names `name` by: the SDK's own define for it. */
function named(name: string): Address {
  const value = routes.chainDefines(requireChain("ethereum"))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on ethereum`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

const abi = {
  erc20: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
  balancer: parseAbi([
    "struct BatchSwapStep { bytes32 poolId; uint256 assetInIndex; uint256 assetOutIndex; uint256 amount; bytes userData; }",
    "struct FundManagement { address sender; bool fromInternalBalance; address recipient; bool toInternalBalance; }",
    "function queryBatchSwap(uint8 kind, BatchSwapStep[] swaps, address[] assets, FundManagement funds) returns (int256[])",
    "struct JoinPoolRequest { address[] assets; uint256[] maxAmountsIn; bytes userData; bool fromInternalBalance; }",
    "function joinPool(bytes32 poolId, address sender, address recipient, JoinPoolRequest request) payable",
    "function create(string name, string symbol, address[] tokens, uint256[] normalizedWeights, address[] rateProviders, uint256 swapFeePercentage, address owner, bytes32 salt) returns (address)",
    "function getPoolId() view returns (bytes32)",
  ]),
  pendleMarket: parseAbi([
    "function readTokens() view returns (address sy, address pt, address yt)",
  ]),
  sy: parseAbi([
    "function previewDeposit(address tokenIn, uint256 amountTokenToDeposit) view returns (uint256)",
    "function previewRedeem(address tokenOut, uint256 amountSharesToRedeem) view returns (uint256)",
  ]),
  yt: parseAbi(["function pyIndexStored() view returns (uint256)"]),
};

/** Recipients: anvil's dev accounts past the owner's. */
const PEOPLE: readonly Address[] = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
].map((address) => getAddress(address));

/** Where each token keeps `balanceOf` on Ethereum. */
const BALANCE_SLOT = { USDC: { slot: 9n }, WETH: { slot: 3n }, WSTETH: { slot: 0n } } as const;

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

/** Registers the group's tests on `anvil()`, which the entry starts before they run. */
export function register(anvil: () => Anvil): void {
  describe("the Balancer V2 and Pendle examples, executed", () => {
    let env: Anvil;
    let group: Hex;
    let snapshot: Hex;

    before(async () => {
      env = anvil();
      group = await env.testClient.snapshot();
    });
    after(async () => {
      await env.testClient.revert({ id: group });
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
        ...["--args", ...args],
      ]);
      assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

      return JSON.parse(stdout) as { ok: boolean; returned?: unknown; reason?: string };
    }

    /** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
    async function run(file: string, args: readonly string[]): Promise<void> {
      const { code, stdout, stderr } = await sauce([
        ...["run", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.equal(code, 0, `${stderr}\n${stdout}`);
      assert.equal((JSON.parse(stdout) as { cook: { status: string } }).cook.status, "success");
    }

    /** Simulates, then runs: `main`'s returned record, as the rehearsal decoded it, in bigints. */
    async function cook(file: string, args: readonly string[]): Promise<Record<string, bigint>> {
      const rehearsal = await simulate(file, args);
      assert.equal(rehearsal.ok, true, `the rehearsal reverts: ${rehearsal.reason}`);
      await run(file, args);
      const returned = rehearsal.returned;
      if (typeof returned !== "object" || returned === null)
        return { value: BigInt(returned as string) };

      return Object.fromEntries(
        Object.entries(returned as Record<string, string>).map(([k, v]) => [k, BigInt(v)]),
      );
    }

    const VAULT = named("BalancerV2_Vault");
    const USDC = named("USDC");
    const WETH = named("WETH");
    /** Balancer's 50/50 USDC/WETH and WBTC/WETH pools on Ethereum. */
    const USDC_WETH = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
    const WBTC_WETH = "0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e" as Hex;
    /** WBTC on Ethereum, which the registry does not name. */
    const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

    /** `a` and `b` agree to within a millionth: a rehearsal a block before the cook it priced. */
    function close(a: bigint, b: bigint): void {
      const gap = a > b ? a - b : b - a;
      assert.ok(gap * 1_000_000n <= b, `${a} is not within a millionth of ${b}`);
    }

    /** The Vault's own `queryBatchSwap` of `steps` over `assets`, from the Pot: + paid, - received. */
    async function query(
      kind: 0 | 1,
      steps: ReadonlyArray<readonly [Hex, bigint, bigint, bigint]>,
      assets: readonly Address[],
    ): Promise<readonly bigint[]> {
      const { result } = await env.publicClient.simulateContract({
        address: VAULT,
        abi: abi.balancer,
        functionName: "queryBatchSwap",
        args: [
          kind,
          steps.map(([poolId, assetInIndex, assetOutIndex, amount]) => ({
            poolId,
            assetInIndex,
            assetOutIndex,
            amount,
            userData: "0x" as Hex,
          })),
          [...assets],
          {
            sender: env.pot,
            fromInternalBalance: false,
            recipient: env.pot,
            toInternalBalance: false,
          },
        ],
      });

      return result;
    }

    describe("balancer-batch-swap: USDC to WBTC through WETH, in two pools", () => {
      const FILE = example("sauce-swaps", "balancer-batch-swap");
      const HELD = 5000n * 10n ** 6n;
      const args = (givenOut: boolean, amount: bigint, limit: bigint, recipient: Address) => [
        String(givenOut),
        USDC_WETH,
        WBTC_WETH,
        USDC,
        WETH,
        WBTC,
        String(amount),
        String(limit),
        recipient,
      ];

      it("given in: sells 1,000 USDC for the WBTC the Vault quotes, and nothing else moves", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, BALANCE_SLOT.USDC, env.pot, HELD);
        const amount = 1000n * 10n ** 6n;
        const quoted = await query(
          0,
          [
            [USDC_WETH, 0n, 1n, amount],
            [WBTC_WETH, 1n, 2n, 0n],
          ],
          [USDC, WETH, WBTC],
        );
        assert.equal(quoted[0], amount);
        assert.equal(quoted[1], 0n);
        const out = -quoted[2];
        assert.ok(out > 0n, "the pools quote some WBTC");

        const { paid, received } = await cook(FILE, args(false, amount, out, recipient));
        assert.equal(paid, amount);
        assert.equal(received, out);
        assert.equal(await balanceOf(env, WBTC, recipient), out);
        assert.equal(await balanceOf(env, USDC, env.pot), HELD - amount);
        assert.equal(await balanceOf(env, WETH, env.pot), 0n);
        assert.equal(await allowance(env, USDC, env.pot, VAULT), 0n);
      });

      it("given out: buys 0.001 WBTC for the USDC the Vault quotes, under a limit 1% above it", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, BALANCE_SLOT.USDC, env.pot, HELD);
        const amount = 100_000n; // 0.001 WBTC, 8 decimals
        const quoted = await query(
          1,
          [
            [WBTC_WETH, 1n, 2n, amount],
            [USDC_WETH, 0n, 1n, 0n],
          ],
          [USDC, WETH, WBTC],
        );
        assert.equal(-quoted[2], amount);
        const cost = quoted[0];
        assert.ok(cost > 0n, "the pools quote a USDC cost");
        const limit = (cost * 101n) / 100n;

        const { paid, received } = await cook(FILE, args(true, amount, limit, recipient));
        assert.equal(paid, cost);
        assert.equal(received, amount);
        assert.equal(await balanceOf(env, WBTC, recipient), amount);
        assert.equal(await balanceOf(env, USDC, env.pot), HELD - cost);
        // The 1% the Vault did not take is no longer approved.
        assert.equal(await allowance(env, USDC, env.pot, VAULT), 0n);
      });

      it("refuses a limit the pools cannot meet, before anything moves", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, BALANCE_SLOT.USDC, env.pot, HELD);
        const amount = 1000n * 10n ** 6n;
        const quoted = await query(
          0,
          [
            [USDC_WETH, 0n, 1n, amount],
            [WBTC_WETH, 1n, 2n, 0n],
          ],
          [USDC, WETH, WBTC],
        );
        const rehearsal = await simulate(FILE, args(false, amount, -quoted[2] + 1n, recipient));
        assert.equal(rehearsal.ok, false);
        assert.match(String(rehearsal.reason), /the pools give less tokenOut than the limit/);
      });
    });

    describe("balancer-flash-cycle: WETH sold where it is dear and bought back where it is cheap", () => {
      const FILE = example("sauce-swaps", "balancer-flash-cycle");
      /** Balancer's weighted pool factory on Ethereum. */
      const FACTORY: Address = "0x897888115Ada5773E02aA29F775430BFB5F34c51";
      const ONE_WETH = 10n ** 18n;

      async function send(request: unknown): Promise<void> {
        const hash = await env.walletClient.writeContract(request as never);
        assert.equal(
          (await env.publicClient.waitForTransactionReceipt({ hash })).status,
          "success",
        );
      }

      /**
       * A second 50/50 USDC/WETH pool, planted, where WETH costs 2,900 USDC. The factory is
       * disabled at the pinned block (`_disabled`, its slot 1), so it is enabled first.
       */
      async function plantDearPool(): Promise<Hex> {
        const owner = env.account.address;
        await env.testClient.setStorageAt({
          address: FACTORY,
          index: toHex(1n, { size: 32 }),
          value: toHex(0n, { size: 32 }),
        });
        const created = [
          "Dear WETH",
          "DEAR",
          [USDC, WETH],
          [5n * 10n ** 17n, 5n * 10n ** 17n],
          [NATIVE, NATIVE],
          3n * 10n ** 15n,
          owner,
          toHex(1n, { size: 32 }),
        ] as const;
        const { result: pool } = await env.publicClient.simulateContract({
          account: env.account,
          address: FACTORY,
          abi: abi.balancer,
          functionName: "create",
          args: created,
        });
        await send({ address: FACTORY, abi: abi.balancer, functionName: "create", args: created });
        const poolId = await env.publicClient.readContract({
          address: pool,
          abi: abi.balancer,
          functionName: "getPoolId",
        });
        const amounts = [290_000n * 10n ** 6n, 100n * ONE_WETH] as const;
        await setBalance(env, USDC, BALANCE_SLOT.USDC, owner, amounts[0]);
        await setBalance(env, WETH, BALANCE_SLOT.WETH, owner, amounts[1]);
        await send({
          address: USDC,
          abi: abi.erc20,
          functionName: "approve",
          args: [VAULT, amounts[0]],
        });
        await send({
          address: WETH,
          abi: abi.erc20,
          functionName: "approve",
          args: [VAULT, amounts[1]],
        });
        await send({
          address: VAULT,
          abi: abi.balancer,
          functionName: "joinPool",
          args: [
            poolId,
            owner,
            owner,
            {
              assets: [USDC, WETH],
              maxAmountsIn: [...amounts],
              // A weighted pool's first join: INIT (0) with each token's amount.
              userData: encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256[]" }],
                [0n, [...amounts]],
              ),
              fromInternalBalance: false,
            },
          ],
        });

        return poolId;
      }

      /** What the Vault quotes the cycle pays over `amount`: the WETH it would send out. */
      const profitOf = async (sellPool: Hex, buyPool: Hex, amount: bigint): Promise<bigint> => {
        const quoted = await query(
          0,
          [
            [sellPool, 0n, 1n, amount],
            [buyPool, 1n, 0n, 0n],
          ],
          [WETH, USDC],
        );
        assert.equal(quoted[1], 0n, "the USDC the first pool pays is all spent in the second");

        return -quoted[0];
      };

      it("earns the WETH the Vault quotes, the Pot holding and approving nothing", async () => {
        const [recipient] = PEOPLE;
        const dear = await plantDearPool();
        const profit = await profitOf(dear, USDC_WETH, ONE_WETH);
        assert.ok(profit > 0n, "the planted pool prices WETH above Balancer's own");
        const { value } = await cook(FILE, [
          dear,
          USDC_WETH,
          WETH,
          USDC,
          String(ONE_WETH),
          String(profit),
          recipient,
        ]);
        assert.equal(value, profit);
        assert.equal(await balanceOf(env, WETH, recipient), profit);
        assert.equal(await balanceOf(env, WETH, env.pot), 0n);
        assert.equal(await balanceOf(env, USDC, env.pot), 0n);
        assert.equal(await allowance(env, WETH, env.pot, VAULT), 0n);
      });

      it("reverts in the Vault the other way round, which would cost the Pot WETH", async () => {
        const [recipient] = PEOPLE;
        const dear = await plantDearPool();
        const rehearsal = await simulate(FILE, [
          USDC_WETH,
          dear,
          WETH,
          USDC,
          String(ONE_WETH),
          "0",
          recipient,
        ]);
        assert.equal(rehearsal.ok, false);
        assert.match(String(rehearsal.reason), /BAL#507/);
      });
    });

    describe("pendle: on the wstETH market", () => {
      const ROUTER = named("Pendle_Router");
      const WSTETH = named("Lido_WstETH");
      /** Pendle's wstETH market on Ethereum, expiring at the end of 2027. */
      const MARKET = getAddress("0x34280882267ffa6383b363e278b027be083bbe3b");
      const ONE = 10n ** 18n;
      const HELD = 3n * ONE;

      const tokens = async () => {
        const [sy, pt, yt] = await env.publicClient.readContract({
          address: MARKET,
          abi: abi.pendleMarket,
          functionName: "readTokens",
        });

        return { sy, pt, yt };
      };
      /** No allowance left to the Router on any token the market involves. */
      const noAllowances = async () => {
        const { sy, pt, yt } = await tokens();
        for (const token of [WSTETH, sy, pt, yt])
          assert.equal(await allowance(env, token, env.pot, ROUTER), 0n);
      };

      describe("pendle-trade", () => {
        const FILE = example("sauce-protocols", "pendle-trade");
        const args = (useYt: boolean, sell: boolean, amount: bigint, min: bigint, to: Address) => [
          MARKET,
          WSTETH,
          String(useYt),
          String(sell),
          String(amount),
          String(min),
          to,
        ];

        // The least share of the wstETH each round trip pays back, at the pinned block: YT's
        // leverage costs more (about a fifth).
        for (const [useYt, keep] of [
          [false, 99n],
          [true, 80n],
        ] as const) {
          const name = useYt ? "YT" : "PT";
          it(`buys ${name} with 1 wstETH into the Pot, then sells all of it for wstETH`, async () => {
            const [recipient] = PEOPLE;
            const { pt, yt } = await tokens();
            const traded = useYt ? yt : pt;
            await setBalance(env, WSTETH, BALANCE_SLOT.WSTETH, env.pot, HELD);

            const bought = await cook(FILE, args(useYt, false, ONE, ONE, env.pot));
            const held = await balanceOf(env, traded, env.pot);
            assert.equal(bought.spent, ONE);
            assert.ok(held > ONE, `1 wstETH buys more than 1 ${name}`);
            close(bought.received, held);
            assert.equal(await balanceOf(env, WSTETH, env.pot), HELD - ONE);

            const sold = await cook(FILE, args(useYt, true, held, (ONE * keep) / 100n, recipient));
            const back = await balanceOf(env, WSTETH, recipient);
            assert.equal(sold.spent, held);
            close(sold.received, back);
            assert.ok(back >= (ONE * keep) / 100n && back < ONE, `wstETH back: ${back}`);
            assert.equal(await balanceOf(env, traded, env.pot), 0n);
            assert.equal(await balanceOf(env, WSTETH, env.pot), HELD - ONE);
            await noAllowances();
          });
        }

        it("refuses a purchase below minOut, moving nothing", async () => {
          await setBalance(env, WSTETH, BALANCE_SLOT.WSTETH, env.pot, HELD);
          const rehearsal = await simulate(FILE, args(false, false, ONE, 100n * ONE, env.pot));
          assert.equal(rehearsal.ok, false);
        });
      });

      describe("pendle-mint-redeem", () => {
        const FILE = example("sauce-protocols", "pendle-mint-redeem");
        const args = (
          split: boolean,
          redeem: boolean,
          amount: bigint,
          min: bigint,
          to: Address,
        ) => [MARKET, WSTETH, String(split), String(redeem), String(amount), String(min), to];

        it("mints SY from 1 wstETH as the SY previews, and redeems it back to wstETH", async () => {
          const [recipient] = PEOPLE;
          const { sy } = await tokens();
          await setBalance(env, WSTETH, BALANCE_SLOT.WSTETH, env.pot, HELD);
          const preview = await env.publicClient.readContract({
            address: sy,
            abi: abi.sy,
            functionName: "previewDeposit",
            args: [WSTETH, ONE],
          });

          const minted = await cook(FILE, args(false, false, ONE, preview, env.pot));
          assert.equal(minted.spent, ONE);
          assert.equal(minted.received, preview);
          assert.equal(await balanceOf(env, sy, env.pot), preview);

          const back = await env.publicClient.readContract({
            address: sy,
            abi: abi.sy,
            functionName: "previewRedeem",
            args: [WSTETH, preview],
          });
          const redeemed = await cook(FILE, args(false, true, preview, back, recipient));
          assert.equal(redeemed.spent, preview);
          assert.equal(redeemed.received, back);
          assert.equal(await balanceOf(env, WSTETH, recipient), back);
          assert.equal(await balanceOf(env, sy, env.pot), 0n);
          await noAllowances();
        });

        it("splits 1 wstETH into PT and YT at the YT's index, and joins them back into wstETH", async () => {
          const [recipient] = PEOPLE;
          const { pt, yt } = await tokens();
          await setBalance(env, WSTETH, BALANCE_SLOT.WSTETH, env.pot, HELD);
          const index = () =>
            env.publicClient.readContract({
              address: yt,
              abi: abi.yt,
              functionName: "pyIndexStored",
            });

          const minted = await cook(FILE, args(true, false, ONE, ONE, env.pot));
          // 1 wstETH is 1 SY, split into PT and YT worth that SY at the index the mint used.
          const py = (ONE * (await index())) / ONE;
          assert.equal(minted.spent, ONE);
          assert.equal(minted.received, py);
          assert.equal(await balanceOf(env, pt, env.pot), py);
          assert.equal(await balanceOf(env, yt, env.pot), py);

          const redeemed = await cook(FILE, args(true, true, py, 1n, recipient));
          const back = (py * ONE) / (await index());
          assert.equal(redeemed.spent, py);
          assert.equal(redeemed.received, back);
          assert.equal(await balanceOf(env, WSTETH, recipient), back);
          assert.equal(await balanceOf(env, pt, env.pot), 0n);
          assert.equal(await balanceOf(env, yt, env.pot), 0n);
          await noAllowances();
        });
      });
    });
  });
}
