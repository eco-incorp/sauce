/**
 * Intent hooks EXECUTED: `.before(...)` and `.after(...)` written inside a program, their routes
 * fulfilled through eco-routes' own Portal and Executor (`cli-anvil.ts#placePortal`, the Portal's
 * forge creation code at the address the SDK records) on an anvil running Base's chain id and the
 * released gated stack, the program bodies cooked on the Executor's shared Pot.
 *
 * What it shows, each through `Portal.fulfill` — whose `Inbox._fulfill` rehashes the route, so a
 * route built wrong cannot pass:
 *
 *  - who calls a hook: a contract that logs its caller with what it was sent sees the Executor,
 *    whether a token write reaches it, its namespace (`Permit2`, the recorder standing in at the
 *    registry's address) or `evm.call`;
 *  - the order: the `before` hooks' calls, then the body (a cook, or its recorded writes), then the
 *    `after` hooks', read off the order of the logs in one fill;
 *  - a hook is made exactly as written: what it spends is the intent's to deliver (a transfer
 *    the delivery does not cover reverts the fill; named in `.receive(...)`, it is made), and its
 *    approve is that one call (USDT's shape refuses it over a standing allowance, and takes it
 *    after the reset the writer writes);
 *  - a hook that reverts reverts the fill, its body's `.catch(...)` notwithstanding — the handler
 *    is the body's — while the same handler does catch a reverting body;
 *  - a value the program measures as it runs reaches a contract call's argument: the program runs
 *    on its owner's Pot and publishes the intent, and the route the Portal logged is fulfilled.
 *
 * Every other intent here is fixed when it is built, so the route the SDK encoded is the one
 * fulfilled.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX, like every other executing EVM suite. The `.catch(...)`
 * case needs an engine that runs `try`.
 */
import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  keccak256,
  pad,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import {
  EVM_REWARD_PARAM,
  EVM_ROUTE_PARAM,
  denormalizeToEvm,
  encodeRouteEvm,
  hashIntent,
} from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { buildSauceEvmCall, sauceEvmDeployPotCall } from "../src/routes/sauce-calls.js";
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

/** A route as `Portal.fulfill` takes it. */
type EvmRoute = {
  readonly salt: Hex;
  readonly deadline: bigint;
  readonly portal: Address;
  readonly nativeAmount: bigint;
  readonly tokens: readonly { readonly token: Address; readonly amount: bigint }[];
  readonly calls: readonly {
    readonly target: Address;
    readonly data: Hex;
    readonly value: bigint;
  }[];
};

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
  const fulfil = (intent: Intent) => {
    const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], encodeRouteEvm(intent.route));
    return fulfilRoute(route, hashIntent(intent).rewardHash);
  };
  /** `fulfil`, of a route as the Portal takes it and the hash of its reward: one a program
   *  published, read back from the Portal's log. */
  const fulfilRoute = async (route: EvmRoute, rewardHash: Hex) => {
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
    const intentHash = keccak256(
      encodePacked(
        ["uint64", "bytes32", "bytes32"],
        [
          BigInt(local.chain.id),
          keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route])),
          rewardHash,
        ],
      ),
    );
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

  it("a hook spends what the intent delivers: nothing is delivered for it", async () => {
    const delivered = await token();
    const program = (received: bigint) => `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${received} })
    .before(() => { Token(TOKEN).transfer(SPENDER, 7); })
    .then(() => { Token(TOKEN).transfer(RECIPIENT, ${AMOUNT}); });
}`;
    // The route delivers what the intent names, and only that: the hook's 7 come out of it, so
    // the body's transfer finds too little.
    const short = opened(program(AMOUNT), { TOKEN: delivered });
    expect(short.route.tokens.map((t) => t.amount)).toEqual([AMOUNT]);
    expect((await fulfil(short)).status).toBe("reverted");
    // The writer names what the hook spends too, and the fill makes both.
    const named = opened(program(AMOUNT + 7n), { TOKEN: delivered });
    expect(named.route.tokens.map((t) => t.amount)).toEqual([AMOUNT + 7n]);
    expect((await fulfil(named)).status).toBe("success");
    expect(await local.balanceOf(delivered, SPENDER)).toBe(7n);
    expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
    expect(await local.balanceOf(delivered, executor)).toBe(0n);
  }, 300_000);

  describe("a contract a hook calls", () => {
    /** Canonical Permit2, which the program names `Permit2`: the recorder stands in for it here. */
    const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    const permit2 = parseAbi([
      "function approve(address token, address spender, uint160 amount, uint48 expiration)",
    ]);
    /** Every call a contract at `at` got in a fill: who made it, with what data. */
    const calledAt = (logs: readonly Log[], at: Address) =>
      logs
        .filter((log) => getAddress(log.address) === at)
        .map((log) => ({
          index: log.logIndex!,
          caller: getAddress(`0x${log.topics[0]!.slice(26)}`),
          data: log.data,
        }));
    const approve = (token: Address, amount: bigint) =>
      encodeFunctionData({
        abi: permit2,
        functionName: "approve",
        args: [getAddress(token), getAddress(SPENDER), amount, 0],
      });

    beforeAll(async () => {
      await local.testClient.setCode({ address: PERMIT2, bytecode: RECORDER_CODE });
    });

    it("by its namespace and by `evm.call`: the Executor calls each, around the cook", async () => {
      const delivered = await token();
      const intent = opened(
        `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: ${AMOUNT} })
    .before(() => { Permit2.approve(TOKEN, SPENDER, 5, 0); })
    .after(() => { evm.call(RECORDER, 0, hex\`abcd\`); })
    .then(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(RECIPIENT, held);
    });
}`,
        { TOKEN: delivered },
      );
      const receipt = await fulfil(intent);
      expect(receipt.status).toBe("success");

      const [byName] = calledAt(receipt.logs, PERMIT2);
      const [raw] = calledAt(receipt.logs, getAddress(RECORDER));
      expect(byName).toMatchObject({ caller: getAddress(executor), data: approve(delivered, 5n) });
      expect(raw).toMatchObject({ caller: getAddress(executor), data: "0xabcd" });
      const body = transferFrom(receipt.logs, delivered, pot);
      expect(byName!.index).toBeLessThan(body);
      expect(body).toBeLessThan(raw!.index);
      expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
    }, 300_000);

    it("a value the program measured, written into a contract call's argument as it runs", async () => {
      const delivered = await token();
      const reward = await token();
      // The program runs on its owner's Pot, measures what it holds, and opens the intent with it.
      const deploy = sauceEvmDeployPotCall({
        kitchen: gateAnchors().kitchen,
        owner: DEPLOYER.address,
        salt: SAUCE_INTENT_POT_SALT,
      });
      const owned = getAddress(v12PredictPot(DEPLOYER.address, SAUCE_INTENT_POT_SALT));
      if ((await local.publicClient.getCode({ address: owned })) === undefined) {
        await local.send(
          local.deployer,
          denormalizeToEvm(toUniversalAddress(deploy.target)) as Address,
          deploy.data,
        );
      }
      const MEASURED = 777_777n;
      await local.mint(reward, owned, MEASURED);
      const program = compileSauceProgram(
        "base",
        `function main() {
  const amount = Token(REWARD).balanceOf(ctx.self());
  Base.Portal.send({ token: REWARD, amount })
    .refundee(${CREATOR})
    .receive({ token: TOKEN, amount: ${AMOUNT} })
    .before(() => { Permit2.approve(TOKEN, SPENDER, amount, 0); })
    .then(() => {
      const held = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(RECIPIENT, held);
    });
}`,
        {
          defines: {
            TOKEN: BigInt(delivered),
            REWARD: BigInt(reward),
            RECIPIENT: BigInt(RECIPIENT),
            SPENDER: BigInt(SPENDER),
          },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            executionFee: FEE,
            salt: `0x${(saltByte++).toString(16).repeat(32)}` as Hex,
          },
        },
      );
      // Not known when the intent is built: a sentinel in the hook's call, written over as it runs.
      expect(program.intents[0]!.captures).toContain("amount");
      const cook = buildSauceEvmCall({
        pot: owned,
        engine: v12EngineAddress() as Hex,
        program: bytesToHex(program.bytecode),
        value: FEE,
      });
      const hash = await local.deployer.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: owned,
        data: cook.data,
        value: FEE,
        gas: GAS_LIMIT,
      });
      const published = await local.publicClient.waitForTransactionReceipt({ hash });
      expect(published.status).toBe("success");
      const [logged] = parseEventLogs({
        abi: PortalABI,
        eventName: "IntentPublished",
        logs: published.logs,
      });
      const { args } = logged!;
      const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], args.route);
      const rewardHash = keccak256(
        encodeAbiParameters(
          [EVM_REWARD_PARAM],
          [
            {
              deadline: args.rewardDeadline,
              creator: args.creator,
              prover: args.prover,
              nativeAmount: args.rewardNativeAmount,
              tokens: args.rewardTokens,
            },
          ],
        ),
      );

      const receipt = await fulfilRoute(route, rewardHash);
      expect(receipt.status).toBe("success");
      const [byName] = calledAt(receipt.logs, PERMIT2);
      expect(byName).toMatchObject({
        caller: getAddress(executor),
        data: approve(delivered, MEASURED),
      });
      expect(await local.balanceOf(delivered, RECIPIENT)).toBe(AMOUNT);
    }, 300_000);
  });

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

  describe("a hook's approve is the one call written", () => {
    /** An intent whose before hook makes `approvals` of `APPROVED`. */
    const approving = (approved: Address, delivered: Address, approvals: string) =>
      opened(
        `function main() {
  Base.Portal.send({ token: TOKEN, amount: 1 })
    .receive({ token: TOKEN, amount: 1 })
    .before(() => { ${approvals} })
    .then(() => { Token(TOKEN).transfer(RECIPIENT, 1); });
}`,
        { TOKEN: delivered, APPROVED: approved },
      );

    it("so a USDT-style token refuses it over a standing allowance, unless the writer resets it", async () => {
      const usdt = await usdtLike();
      const delivered = await token();
      const first = approving(usdt, delivered, "Token(APPROVED).approve(SPENDER, 7);");
      // The approve, then the body's transfer: nothing added.
      expect(first.route.calls).toHaveLength(2);
      expect((await fulfil(first)).status).toBe("success");
      expect(await allowance(usdt)).toBe(7n);

      // The allowance the first intent left stands, and USDT will not move it to another.
      const over = approving(usdt, delivered, "Token(APPROVED).approve(SPENDER, 9);");
      expect(over.route.calls).toHaveLength(2);
      expect((await fulfil(over)).status).toBe("reverted");
      expect(await allowance(usdt)).toBe(7n);

      // The writer's own reset, written in the hook, is made as written.
      const reset = approving(
        usdt,
        delivered,
        "Token(APPROVED).approve(SPENDER, 0); Token(APPROVED).approve(SPENDER, 9);",
      );
      expect(reset.route.calls).toHaveLength(3);
      expect((await fulfil(reset)).status).toBe("success");
      expect(await allowance(usdt)).toBe(9n);
    }, 300_000);
  });
});
