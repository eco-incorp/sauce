/**
 * A hop's hooks EXECUTED: a program on an anvil standing in for Base opens a hop to Base with
 * `before`/`after` hooks, the eco-routes Portal there logs it (`intent-anvil.ts`), and a solver fills
 * the route the Portal logged through `Portal.fulfill` — whose `Inbox._fulfill` rehashes the route, so
 * a route built wrong cannot pass — and the Portal's own Executor makes its calls: each hook's, the
 * delivered tokens' move into the Executor's shared Pot, the body's cook on it.
 *
 * What it shows:
 *
 *  - who makes a hook's call: a contract that logs its caller with what it was sent, standing in at
 *    Permit2's registry address, sees the Executor, whether the hook names it by its namespace or
 *    calls it with `evm.call`;
 *  - the order: the `before` hooks' calls, then the body's cook, then the `after` hooks', read off
 *    the order of the logs in one fill;
 *  - a hook is made exactly as written: its approve is that one call (a USDT-shaped token refuses it
 *    over a standing allowance, and takes it after the reset the writer writes), and the native an
 *    `evm.call` sends is what the solver brings beside the cook's fee;
 *  - a hook that reverts reverts the fill, its body's `.catch(...)` notwithstanding — the handler is
 *    the body's — while the same handler does catch a reverting body;
 *  - a value the program measures as it runs reaches a hook's call: written into the intent the
 *    program published, and made with it.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX, like every other executing EVM suite. The `.catch(...)`
 * cases need an engine that runs `try`.
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  pad,
  parseAbi,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesExecutorOf } from "../src/protocols/eco-routes/lookup.js";
import {
  EVM_ROUTE_PARAM,
  denormalizeToEvm,
  encodeRouteEvm,
  hashIntent,
} from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { sauceEvmDeployPotCall } from "../src/routes/sauce-calls.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import type { Intent } from "../src/routes/types.js";
import { DEPLOYER, FEE, describeEvm, erc20, fixture } from "./cli-anvil.js";
import { gateAnchors } from "./evm/gated-engine.js";
import { startIntentChain, type IntentChain } from "./intent-anvil.js";
import { freePort } from "./pools-anvil.js";

const GAS_LIMIT = 30_000_000n;
const AMOUNT = 1_000_000n;
const CREATOR = "0x4444444444444444444444444444444444444444";
const RECIPIENT = getAddress("0x00000000000000000000000000000000000000e1");
const FALLBACK = getAddress("0x00000000000000000000000000000000000000e2");
const SPENDER = getAddress("0x00000000000000000000000000000000000000e3");
/** Canonical Permit2, which a program names `Permit2`: the recorder stands in for it here. */
const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
/** A contract that logs every call it gets, its caller the one topic and the calldata the data:
 *  CALLDATACOPY(0, 0, CALLDATASIZE), LOG1(0, CALLDATASIZE, CALLER), STOP. */
const RECORDER_CODE = "0x365f5f3733365fa100" as Hex;
const RECORDER = getAddress("0x00000000000000000000000000000000000f00d1");
/** A contract that reverts every call: REVERT(0, 0). */
const REVERTER_CODE = "0x5f5ffd" as Hex;
const REVERTER = getAddress("0x00000000000000000000000000000000000f00d2");
const permit2 = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

describeEvm("hooks, made by the Portal's Executor", () => {
  let base: IntentChain;
  let executor: Address;
  let pot: Address;
  let usdc: Address;
  let saltByte = 0x10;

  beforeAll(async () => {
    base = await startIntentChain("base", await freePort(), ["USDC"]);
    executor = getAddress(ecoRoutesExecutorOf(base.portal));
    // The Executor's shared Pot, which the solver deploys once per Portal: a body cooks on it.
    const deploy = sauceEvmDeployPotCall({
      kitchen: gateAnchors().kitchen,
      owner: executor,
      salt: SAUCE_INTENT_POT_SALT,
    });
    await base.local.send(
      base.local.deployer,
      denormalizeToEvm(toUniversalAddress(deploy.target)) as Address,
      deploy.data,
    );
    pot = getAddress(v12PredictPot(executor, SAUCE_INTENT_POT_SALT));
    usdc = base.token("USDC");
    for (const [address, bytecode] of [
      [PERMIT2, RECORDER_CODE],
      [RECORDER, RECORDER_CODE],
      [REVERTER, REVERTER_CODE],
    ] as const) {
      await base.local.testClient.setCode({ address, bytecode });
    }
  }, 300_000);

  afterAll(async () => {
    await base?.stop();
  });

  /** The one intent `program` publishes, run on the harness Pot. */
  const publish = async (
    program: string,
    defines: Record<string, Address | bigint> = {},
  ): Promise<Intent> => {
    const compiled = compileSauceProgram("base", program, {
      defines: Object.fromEntries(
        Object.entries({ RECIPIENT, FALLBACK, SPENDER, RECORDER, REVERTER, ...defines }).map(
          ([name, value]) => [name, BigInt(value)],
        ),
      ),
      intents: {
        deadline: 4_000_000_000n,
        executionFee: FEE,
        salt: `0x${(saltByte++).toString(16).repeat(32)}` as Hex,
      },
    });
    const [published] = await base.publish(compiled);
    return published!.intent;
  };

  /** What a solver does: hold the route's tokens, let the Portal pull them, and `fulfill`, paying
   *  the route's native. The receipt, whatever its status. */
  const fulfil = async (intent: Intent) => {
    const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], encodeRouteEvm(intent.route));
    const owed = new Map<Address, bigint>();
    for (const { token, amount } of route.tokens) owed.set(token, (owed.get(token) ?? 0n) + amount);
    for (const [token, amount] of owed) {
      await base.local.mint(token, DEPLOYER.address, amount);
      await base.local.send(
        base.local.deployer,
        token,
        encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [base.portal, amount] }),
      );
    }
    const { intentHash, rewardHash } = hashIntent(intent);
    const hash = await base.local.deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to: base.portal,
      data: encodeFunctionData({
        abi: PortalABI,
        functionName: "fulfill",
        args: [intentHash, route, rewardHash, pad(DEPLOYER.address)],
      }),
      value: route.nativeAmount,
      gas: GAS_LIMIT,
    });

    return base.local.publicClient.waitForTransactionReceipt({ hash });
  };

  /** Every call a recorder at `at` got in a fill: who made it, with what data, in log order. */
  const calledAt = (logs: readonly Log[], at: Address) =>
    logs
      .filter((log) => getAddress(log.address) === at)
      .map((log) => ({
        index: log.logIndex!,
        caller: getAddress(`0x${log.topics[0]!.slice(26)}`),
        data: log.data,
      }));

  /** Where in a fill `token` moved out of `from`: the index of its `Transfer` log. */
  const movedFrom = (logs: readonly Log[], token: Address, from: Address): number => {
    const found = logs.find(
      (log) =>
        getAddress(log.address) === token &&
        log.topics[1] !== undefined &&
        getAddress(`0x${log.topics[1].slice(26)}`) === from,
    );
    if (found === undefined) throw new Error(`no transfer of ${token} from ${from}`);
    return found.logIndex!;
  };

  /** A hop to Base delivering `AMOUNT` USDC to a body that pays it on, with `hooks`. */
  const hop = (hooks: string, extra = "") => `function main() {
  Base.hop({
    reward: { token: USDC, amount: 1 },
    receive: { token: USDC, amount: ${AMOUNT} },
    refundee: ${CREATOR},${hooks}
  }).then(() => {
    USDC.transfer(RECIPIENT, ${AMOUNT});${extra}
  })${extra === "" ? "" : ".catch(() => { USDC.transfer(FALLBACK, " + AMOUNT + "); })"};
}`;

  it("the Executor makes each hook's call, by namespace and by `evm.call`, around the cook", async () => {
    const intent = await publish(
      hop(`
    before: [() => Permit2.approve(USDC, SPENDER, 5, 0)],
    after: [() => evm.call(RECORDER, 0, hex\`abcd\`)],`),
    );
    const before = await base.local.balanceOf(usdc, RECIPIENT);
    const receipt = await fulfil(intent);
    expect(receipt.status).toBe("success");

    const [byName] = calledAt(receipt.logs, PERMIT2);
    const [raw] = calledAt(receipt.logs, RECORDER);
    expect(byName).toMatchObject({
      caller: executor,
      data: encodeFunctionData({
        abi: permit2,
        functionName: "approve",
        args: [usdc, SPENDER, 5n, 0],
      }),
    });
    expect(raw).toMatchObject({ caller: executor, data: "0xabcd" });
    // The body ran in the Pot between the two: its transfer out of the Pot is logged there.
    const body = movedFrom(receipt.logs, usdc, pot);
    expect(byName!.index).toBeLessThan(body);
    expect(body).toBeLessThan(raw!.index);
    expect((await base.local.balanceOf(usdc, RECIPIENT)) - before).toBe(AMOUNT);
  }, 300_000);

  it("the native an `evm.call` hook sends is the solver's to bring, beside the cook's fee", async () => {
    const intent = await publish(
      hop(`
    after: [() => evm.call(RECORDER, 7, hex\`\`)],`),
    );
    expect(intent.route.nativeAmount).toBe(FEE + 7n);
    const held = await base.local.publicClient.getBalance({ address: RECORDER });
    expect((await fulfil(intent)).status).toBe("success");
    expect((await base.local.publicClient.getBalance({ address: RECORDER })) - held).toBe(7n);
  }, 300_000);

  it("writes a value the program measures as it runs into the hook's call, and makes it", async () => {
    const held = await base.local.balanceOf(usdc, base.pot);
    const intent = await publish(`function main() {
  const held = USDC.balanceOf(ctx.self());
  Base.hop({
    reward: { token: USDC, amount: 1 },
    refundee: ${CREATOR},
    before: [() => Permit2.approve(USDC, SPENDER, held / 2, 0)],
  }).then(() => {});
}`);
    const receipt = await fulfil(intent);
    expect(receipt.status).toBe("success");
    expect(calledAt(receipt.logs, PERMIT2)).toEqual([
      expect.objectContaining({
        caller: executor,
        data: encodeFunctionData({
          abi: permit2,
          functionName: "approve",
          args: [usdc, SPENDER, held / 2n, 0],
        }),
      }),
    ]);
  }, 300_000);

  describe("a hook that reverts reverts the fill", () => {
    it.each(["before", "after"])(
      "`%s`: the body's handler does not catch it",
      async (field) => {
        const handled = (target: string) =>
          hop(`\n    ${field}: [() => evm.call(${target}, 0, hex\`01\`)],`, "\n    require(true);");
        const fallback = await base.local.balanceOf(usdc, FALLBACK);
        expect((await fulfil(await publish(handled("REVERTER")))).status).toBe("reverted");
        expect(await base.local.balanceOf(usdc, FALLBACK)).toBe(fallback);
        // The same intent, its hook calling a contract that does not revert, is filled.
        const recipient = await base.local.balanceOf(usdc, RECIPIENT);
        expect((await fulfil(await publish(handled("RECORDER")))).status).toBe("success");
        expect((await base.local.balanceOf(usdc, RECIPIENT)) - recipient).toBe(AMOUNT);
      },
      300_000,
    );

    it("CONTROL: the same handler catches a reverting body, between hooks that run", async () => {
      const intent = await publish(
        hop(
          `
    before: [() => evm.call(RECORDER, 0, hex\`01\`)],
    after: [() => evm.call(RECORDER, 0, hex\`02\`)],`,
          '\n    require(false, "body");',
        ),
      );
      const fallback = await base.local.balanceOf(usdc, FALLBACK);
      const receipt = await fulfil(intent);
      expect(receipt.status).toBe("success");
      expect(calledAt(receipt.logs, RECORDER).map((call) => call.data)).toEqual(["0x01", "0x02"]);
      expect((await base.local.balanceOf(usdc, FALLBACK)) - fallback).toBe(AMOUNT);
    }, 300_000);
  });

  describe("a hook's approve is the one call written", () => {
    /** USDT's shape: its writes return nothing, and `approve` refuses to move a non-zero allowance
     *  to another non-zero value. */
    const usdtLike = (): Promise<Address> =>
      base.local.plant(
        `${fixture("NoReturnERC20")}${encodeAbiParameters(
          [{ type: "string" }, { type: "string" }, { type: "uint8" }],
          ["Tether USD", "USDT", 6],
        ).slice(2)}` as Hex,
      );
    const allowance = (token: Address): Promise<bigint> =>
      base.local.publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: "allowance",
        args: [executor, SPENDER],
      });
    const approving = (token: Address, approvals: string) =>
      publish(
        `function main() {
  Base.hop({
    reward: { token: USDC, amount: 1 },
    refundee: ${CREATOR},
    before: [${approvals}],
  }).then(() => {});
}`,
        { APPROVED: token },
      );

    it("so a USDT-style token refuses it over a standing allowance, unless the writer resets it", async () => {
      const usdt = await usdtLike();
      const first = await approving(usdt, "() => Erc20.ERC20(APPROVED).approve(SPENDER, 7)");
      // The approve, then the body's cook: nothing added.
      expect(first.route.calls).toHaveLength(2);
      expect((await fulfil(first)).status).toBe("success");
      expect(await allowance(usdt)).toBe(7n);

      // The allowance the first intent left stands, and USDT will not move it to another.
      const over = await approving(usdt, "() => Erc20.ERC20(APPROVED).approve(SPENDER, 9)");
      expect((await fulfil(over)).status).toBe("reverted");
      expect(await allowance(usdt)).toBe(7n);

      // The writer's own reset, written as a hook of its own, is made as written.
      const reset = await approving(
        usdt,
        "() => Erc20.ERC20(APPROVED).approve(SPENDER, 0), () => Erc20.ERC20(APPROVED).approve(SPENDER, 9)",
      );
      expect(reset.route.calls).toHaveLength(3);
      expect((await fulfil(reset)).status).toBe("success");
      expect(await allowance(usdt)).toBe(9n);
    }, 300_000);
  });
});
