/**
 * Intent hooks EXECUTED: `.before(...)` and `.after(...)` written inside a program, their routes
 * fulfilled through eco-routes' own Portal and Executor (`cli-anvil.ts#placePortal`, the Portal's
 * forge creation code at the address the SDK records) on an anvil running Base's chain id and the
 * released gated stack, the program bodies cooked on the Executor's shared Pot.
 *
 * What it shows, each through `Portal.fulfill` — whose `Inbox._fulfill` rehashes the route, so a
 * route built wrong cannot pass:
 *
 *  - who calls a hook: a contract that logs its caller with what it was sent sees the Executor;
 *  - the order: the `before` hooks' calls, then the body (a cook, or its recorded writes), then the
 *    `after` hooks', read off the order of the logs in one fill;
 *  - what a hook's transfer spends is delivered on top of what `.receive(...)` names, which still
 *    moves into the Pot whole;
 *  - a hook that reverts reverts the fill, its body's `.catch(...)` notwithstanding — the handler
 *    is the body's — while the same handler does catch a reverting body;
 *  - every approve a hook records is reset to zero first: a token that refuses to move a standing
 *    allowance (USDT's shape) takes the second intent's approve through the reset, and refuses the
 *    same route without it.
 *
 * Every intent here is fixed when it is built: no value of the program reaches it at run time, so
 * the route the SDK encoded is the one fulfilled. Where a run-time value lands is
 * `routes-intent-hooks.test.ts`'s.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX, like every other executing EVM suite. The `.catch(...)`
 * case needs an engine that runs `try`.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  pad,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
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
import {
  DEPLOYER,
  FEE,
  describeEvm,
  erc20,
  fixture,
  placePortal,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import { gateAnchors } from "./evm/gated-engine.js";
import { freePort } from "./pools-anvil.js";

const GAS_LIMIT = 30_000_000n;
const AMOUNT = 1_000_000n;
const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const PROVER = "0x5555555555555555555555555555555555555555" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000e1" as Address;
const FALLBACK = "0x00000000000000000000000000000000000000e2" as Address;
const SPENDER = "0x00000000000000000000000000000000000000e3" as Address;
/** What a hook's call carries, to tell the `before` one from the `after` one in the logs. Each is
 *  an approve of zero, which moves nothing, so asks for no delivery, and is not reset first. */
const BEFORE = "0x00000000000000000000000000000000000000b4" as Address;
const AFTER = "0x00000000000000000000000000000000000000a4" as Address;
/** A contract that logs every call it gets, its caller the one topic and the calldata the data:
 *  CALLDATACOPY(0, 0, CALLDATASIZE), LOG1(0, CALLDATASIZE, CALLER), STOP. */
const RECORDER_CODE = "0x365f5f3733365fa100" as Hex;
const RECORDER = "0x00000000000000000000000000000000000f00d1" as Address;
/** A contract that reverts every call: REVERT(0, 0). */
const REVERTER_CODE = "0x5f5ffd" as Hex;
const REVERTER = "0x00000000000000000000000000000000000f00d2" as Address;

describeEvm("intent hooks, executed by the Portal's Executor", () => {
  let local: LocalChain;
  let portal: Address;
  let executor: Address;
  let pot: Address;
  let saltByte = 0x10;

  beforeAll(async () => {
    local = await startChain("base", await freePort());
    ({ portal, executor } = await placePortal(local));
    // The Executor's shared Pot, which the solver deploys once per Portal: a body cooks on it.
    const deploy = sauceEvmDeployPotCall({
      kitchen: gateAnchors().kitchen,
      owner: executor,
      salt: SAUCE_INTENT_POT_SALT,
    });
    await local.send(
      local.deployer,
      denormalizeToEvm(toUniversalAddress(deploy.target)) as Address,
      deploy.data,
    );
    pot = getAddress(v12PredictPot(executor, SAUCE_INTENT_POT_SALT));
    await local.testClient.setCode({ address: RECORDER, bytecode: RECORDER_CODE });
    await local.testClient.setCode({ address: REVERTER, bytecode: REVERTER_CODE });
  }, 300_000);

  afterAll(async () => {
    await local?.stop();
  });

  const token = (): Promise<Address> => local.plant(fixture("MockERC20"));
  /** USDT's shape: its writes return nothing, and `approve` refuses to move a non-zero allowance
   *  to another non-zero value. */
  const usdtLike = (): Promise<Address> =>
    local.plant(
      `${fixture("NoReturnERC20")}${encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint8" }],
        ["Tether USD", "USDT", 6],
      ).slice(2)}` as Hex,
    );

  /** The intent `program` opens, compiled for Base with `defines`, each its own salt. */
  const opened = (program: string, defines: Record<string, Address | bigint>): Intent => {
    const compiled = compileSauceProgram("base", program, {
      defines: Object.fromEntries(
        Object.entries({
          RECIPIENT,
          FALLBACK,
          SPENDER,
          BEFORE,
          AFTER,
          RECORDER,
          REVERTER,
          ...defines,
        }).map(([name, value]) => [name, BigInt(value)]),
      ),
      intents: {
        deadline: 4_000_000_000n,
        publisher: CREATOR,
        prover: PROVER,
        executionFee: FEE,
        salt: `0x${(saltByte++).toString(16).repeat(32)}` as Hex,
      },
    });
    const [lowered] = compiled.intents;
    // Fixed when built: the route encoded is the route fulfilled.
    expect(lowered!.captures).toEqual([]);

    return lowered!.intent;
  };

  /** What a solver does: hold the route's tokens, let the Portal pull them, and `fulfill`, paying
   *  the route's native. The receipt, whatever its status. */
  const fulfil = async (intent: Intent) => {
    const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], encodeRouteEvm(intent.route));
    // A token the route names twice is pulled twice: approve the sum.
    const owed = new Map<Address, bigint>();
    for (const { token: address, amount } of route.tokens) {
      owed.set(address, (owed.get(address) ?? 0n) + amount);
    }
    for (const [address, amount] of owed) {
      await local.mint(address, DEPLOYER.address, amount);
      await local.send(
        local.deployer,
        address,
        encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [portal, amount] }),
      );
    }
    const { intentHash, rewardHash } = hashIntent(intent);
    const hash = await local.deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to: portal,
      data: encodeFunctionData({
        abi: PortalABI,
        functionName: "fulfill",
        args: [intentHash, route, rewardHash, pad(DEPLOYER.address)],
      }),
      value: route.nativeAmount,
      gas: GAS_LIMIT,
    });

    return local.publicClient.waitForTransactionReceipt({ hash });
  };

  /** The recorder's logs in a fill: who called it, and whose approve it was sent. */
  const recorded = (logs: readonly Log[]) =>
    logs
      .filter((log) => getAddress(log.address) === getAddress(RECORDER))
      .map((log) => {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: log.data });
        return {
          index: log.logIndex!,
          caller: getAddress(`0x${log.topics[0]!.slice(26)}`),
          mark: getAddress((args as readonly [Address, bigint])[0]),
        };
      });

  /** Where in a fill `token` moved from `from`: the index of its `Transfer` log. */
  const transferFrom = (logs: readonly Log[], token: Address, from: Address): number => {
    const found = logs.find(
      (log) =>
        getAddress(log.address) === getAddress(token) &&
        log.topics[1] !== undefined &&
        getAddress(`0x${log.topics[1].slice(26)}`) === getAddress(from),
    );
    if (found === undefined) throw new Error(`no transfer of ${token} from ${from}`);

    return found.logIndex!;
  };

  const allowance = (address: Address): Promise<bigint> =>
    local.publicClient.readContract({
      address,
      abi: erc20,
      functionName: "allowance",
      args: [executor, SPENDER],
    });

  const HOOKS = `
    .before(() => { Token(RECORDER).approve(BEFORE, 0); })
    .after(() => { Token(RECORDER).approve(AFTER, 0); })`;

  it("a program body: the Executor calls the before hook, cooks, then calls the after hook", async () => {
    const delivered = await token();
    const intent = opened(
      `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${AMOUNT} })${HOOKS}
    .then(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(RECIPIENT, held);
    });
}`,
      { TOKEN: delivered },
    );
    const receipt = await fulfil(intent);
    expect(receipt.status).toBe("success");

    const [before, after] = recorded(receipt.logs);
    expect([before!.caller, after!.caller]).toEqual([getAddress(executor), getAddress(executor)]);
    expect([before!.mark, after!.mark]).toEqual([getAddress(BEFORE), getAddress(AFTER)]);
    // The body ran in the Pot between the two: its transfer out of the Pot is logged there.
    const body = transferFrom(receipt.logs, delivered, pot);
    expect(before!.index).toBeLessThan(body);
    expect(body).toBeLessThan(after!.index);
    expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
  }, 300_000);

  it("a body of token writes: the hooks' calls around the body's own, all the Executor's", async () => {
    const delivered = await token();
    const intent = opened(
      `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${AMOUNT} })${HOOKS}
    .then(() => { Token(TOKEN).transfer(RECIPIENT, ${AMOUNT}); });
}`,
      { TOKEN: delivered },
    );
    const receipt = await fulfil(intent);
    expect(receipt.status).toBe("success");

    const [before, after] = recorded(receipt.logs);
    expect([before!.caller, after!.caller]).toEqual([getAddress(executor), getAddress(executor)]);
    const body = transferFrom(receipt.logs, delivered, executor);
    expect(before!.index).toBeLessThan(body);
    expect(body).toBeLessThan(after!.index);
    expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
  }, 300_000);

  it("a hook's transfer is delivered on top of the body's: the Pot gets what `.receive` names", async () => {
    const delivered = await token();
    const intent = opened(
      `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${AMOUNT} })
    .before(() => { Token(TOKEN).transfer(SPENDER, 7); })
    .then(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(RECIPIENT, held);
    });
}`,
      { TOKEN: delivered },
    );
    expect(intent.route.tokens.map((t) => t.amount)).toEqual([7n, AMOUNT]);
    expect((await fulfil(intent)).status).toBe("success");
    expect(await local.balanceOf(delivered, SPENDER)).toBe(7n);
    expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
    expect(await local.balanceOf(delivered, executor)).toBe(0n);
  }, 300_000);

  describe("a hook that reverts reverts the fill", () => {
    /** A handled program body, `fails` deciding whether it reverts, with `hooks`. */
    const handled = (hooks: string, fails: boolean) => `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${AMOUNT} })${hooks}
    .then(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(RECIPIENT, held);
      require(${fails ? "false" : "true"}, "body");
    })
    .catch(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(FALLBACK, held);
    });
}`;

    it.each(["after", "before"])(
      "`.%s(...)`: the body's handler does not catch it",
      async (hook) => {
        const delivered = await token();
        const calling = (target: string) =>
          opened(handled(`.${hook}(() => { Token(${target}).approve(BEFORE, 0); })`, false), {
            TOKEN: delivered,
          });
        expect((await fulfil(calling("REVERTER"))).status).toBe("reverted");
        expect(await local.balanceOf(delivered, RECIPIENT)).toBe(0n);
        expect(await local.balanceOf(delivered, FALLBACK)).toBe(0n);
        // The same intent, its hook calling a contract that does not revert, is filled.
        expect((await fulfil(calling("RECORDER"))).status).toBe("success");
        expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
      },
      300_000,
    );

    it("CONTROL: the same handler catches a reverting body, between hooks that run", async () => {
      const delivered = await token();
      const receipt = await fulfil(opened(handled(HOOKS, true), { TOKEN: delivered }));
      expect(receipt.status).toBe("success");
      expect(recorded(receipt.logs).map((call) => call.mark)).toEqual([
        getAddress(BEFORE),
        getAddress(AFTER),
      ]);
      expect(await local.balanceOf(delivered, RECIPIENT)).toBe(0n);
      expect(await local.balanceOf(delivered, FALLBACK)).toBe(AMOUNT);
    }, 300_000);
  });

  describe("a recorded approve is reset to zero first", () => {
    /** An intent whose before hook approves `amount` of `approved` to the spender. */
    const approving = (approved: Address, delivered: Address, amount: bigint) =>
      opened(
        `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: 1 })
    .before(() => { Token(APPROVED).approve(SPENDER, ${amount}); })
    .then(() => { Token(TOKEN).transfer(RECIPIENT, 1); });
}`,
        { TOKEN: delivered, APPROVED: approved },
      );

    it("so a USDT-style token takes an approve over the allowance an earlier intent left", async () => {
      const usdt = await usdtLike();
      const delivered = await token();
      expect((await fulfil(approving(usdt, delivered, 7n))).status).toBe("success");
      expect(await allowance(usdt)).toBe(7n);

      const second = approving(usdt, delivered, 9n);
      // The reset, then the approve: two calls of the token, before the body's transfer.
      expect(second.route.calls).toHaveLength(3);
      expect((await fulfil(second)).status).toBe("success");
      expect(await allowance(usdt)).toBe(9n);
    }, 300_000);

    it("FAILING-FIRST CONTROL: the same route without the reset is refused", async () => {
      const usdt = await usdtLike();
      const delivered = await token();
      expect((await fulfil(approving(usdt, delivered, 7n))).status).toBe("success");

      const second = approving(usdt, delivered, 9n);
      const unreset: Intent = {
        ...second,
        route: { ...second.route, calls: second.route.calls.slice(1) },
      };
      expect((await fulfil(unreset)).status).toBe("reverted");
      expect(await allowance(usdt)).toBe(7n);
    }, 300_000);
  });
});
