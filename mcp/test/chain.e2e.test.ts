/**
 * The tools against a chain: a local anvil running the released gated stack (`sdk/test/cli-anvil.ts`,
 * the harness the `sauce` command's own chain suites use), reached only through a `--config`-style
 * endpoint. The server reads the Kitchen's fee and the Pot, rehearses the cook through the
 * simulate machinery, and rehearses an intent's publish — and the one transaction that lands here
 * is signed by the test, with a key the server never sees, from the unsigned transaction the
 * server built: the remote-compile, local-sign split the server exists for.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  formatUnits,
  getAddress,
  zeroAddress,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

import {
  FEE,
  fixture,
  OWNER,
  placePortal,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { ecoRoutesPortal } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { connect, endpointsFor, failed, ok, type Connected } from "./harness.js";

const SDK_TEST = join(dirname(fileURLToPath(import.meta.url)), "../../sdk/test");
const PORTAL_CREATION = (
  JSON.parse(readFileSync(join(SDK_TEST, "evm/fixtures/Portal.json"), "utf8")) as {
    creationCode: Hex;
  }
).creationCode;

/** An owner nobody holds the key of, with nothing: no Pot, no native currency, no tokens. */
const NOBODY: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
/** An owner whose Pot, not deployed, holds USDC: for reading balances, apart from NOBODY's. */
const HOLDER: Address = "0x7777777777777777777777777777777777777777";
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");
const INTENT = [
  "Base(() => {",
  "  USDC.transfer(RECIPIENT, 5n);",
  "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
  "",
].join("\n");

/**
 * Runtime code answering each listed function with fixed words, and reverting anything else: a
 * stand-in for a Uniswap V3 pool's five reads, with no pool behind them.
 */
function answering(answers: ReadonlyArray<readonly [string, readonly bigint[]]>): Hex {
  const hex = (value: bigint | number, bytes: number) =>
    BigInt.asUintN(bytes * 8, BigInt(value))
      .toString(16)
      .padStart(bytes * 2, "0");
  // selector = calldata >> 224; one DUP1 PUSH4 EQ PUSH2 JUMPI per function; else revert.
  const head = 6 + answers.length * 11 + 4;
  let at = head;
  const bodies = answers.map(([, words]) => {
    const body =
      "5b" +
      words.map((word, index) => `7f${hex(word, 32)}61${hex(index * 32, 2)}52`).join("") +
      `61${hex(words.length * 32, 2)}6000f3`;
    const start = at;
    at += body.length / 2;

    return { start, body };
  });
  const dispatch = answers
    .map(([signature], index) => {
      const selector = toFunctionSelector(signature).slice(2);

      return `8063${selector}1461${hex(bodies[index]!.start, 2)}57`;
    })
    .join("");

  return `0x60003560e01c${dispatch}600080fd${bodies.map((each) => each.body).join("")}`;
}

/** An intent whose body is a program, so it cooks on the destination's shared intent Pot. */
const COOKED = [
  "Base(",
  "  () => {",
  "    const got = Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).balanceOf(ctx.self());",
  "    Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).transfer(RECIPIENT, got);",
  "  },",
  "  { tokens: [{ token: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n, amount: 5n }] },",
  ").reward({ tokens: [{ token: USDC, amount: 7n }] });",
  "",
].join("\n");

/** A port nothing is listening on, so this suite never collides with another's anvil. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

describe("the tools against a chain", { skip: RUNTIME_HEX_PATH === undefined }, () => {
  let local: LocalChain;
  /** The intent's destination, which only a call's own rpcUrl reaches. */
  let base: LocalChain;
  let baseUsdc: Address;
  let basePortal: Address;
  let mcp: Connected;
  let usdc: Address;

  before(async () => {
    local = await startChain("arbitrum", await freePort());
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    // The real eco-routes Portal, where the SDK records it, for the publish rehearsal.
    await local.plant(
      `${PORTAL_CREATION}${encodeAbiParameters([{ type: "address" }], [zeroAddress]).slice(2)}` as Hex,
      ecoRoutesPortal("arbitrum") as Address,
    );
    base = await startChain("base", await freePort());
    baseUsdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    basePortal = (await placePortal(base)).portal;
    mcp = await connect(endpointsFor({ [String(local.chain.id)]: local.rpcUrl }));
  });

  after(async () => {
    await mcp?.close();
    await local?.stop();
    await base?.stop();
    // Every byte the server sent, across every test: never an endpoint.
    for (const chain of [local, base]) {
      assert.ok(!mcp.received.join("\n").includes(chain.rpcUrl.replace("http://", "")));
    }
  });

  const pot = getAddress(v12PredictPot(NOBODY, `0x${"00".repeat(32)}`) as Address);
  const pay = { source: PAY, chain: "arbitrum", args: [RECIPIENT, "1500000"] };

  it("reads the Kitchen's fee for the cook, and that the Pot is not deployed", async () => {
    const tx = ok(await mcp.call("sauce_tx", { ...pay, owner: NOBODY }));
    assert.equal(tx.to, pot);
    assert.equal(tx.value, FEE.toString());
    assert.equal(tx.from, NOBODY, "who signs it");
    assert.deepEqual(tx.kitchenFee, {
      wei: FEE.toString(),
      native: formatUnits(FEE, 18),
      readFrom: "arbitrum",
    });
    assert.ok((tx.notes as string[]).some((note) => /It is NOT deployed/.test(note)));
    assert.ok(!(tx.notes as string[]).some((note) => /--|sauce pot/.test(note)), "no flags");
    const predicted = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: NOBODY }));
    assert.equal(predicted.pot, pot);
    assert.equal(predicted.deployed, false);
    assert.equal((predicted.kitchenFee as { wei: string }).wei, FEE.toString());
  });

  it("reads what the Pot holds: native, and each token the chain registers", async () => {
    const holderPot = getAddress(v12PredictPot(HOLDER, `0x${"00".repeat(32)}`) as Address);
    await local.mint(usdc, holderPot, 2_500_000n);
    type Held = {
      native: { wei: string };
      tokens: Array<{
        symbol: string;
        address: string;
        balance: string | null;
        formatted: string | null;
      }>;
    };
    const out = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: HOLDER }));
    assert.equal(out.pot, holderPot);
    const held = out.balances as Held;
    assert.equal(held.native.wei, "0");
    const row = held.tokens.find((token) => token.symbol === "USDC")!;
    assert.deepEqual(
      [getAddress(row.address), row.balance, row.formatted],
      [usdc, "2500000", "2.5"],
    );
    // A registered token with no code on this chain reads as unknown, not as zero.
    assert.ok(held.tokens.some((token) => token.symbol !== "USDC" && token.balance === null));
    const bare = ok(
      await mcp.call("sauce_pot", { chain: "arbitrum", owner: HOLDER, balances: false }),
    );
    assert.equal(bare.balances, undefined);
    assert.equal(bare.deployed, false, "still says whether it is deployed");
  });

  it("rehearses the cook on a Pot not deployed yet, holding an assumed balance", async () => {
    const out = ok(
      await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, assumeBalance: ["USDC:2"] }),
    ) as Record<string, unknown> & {
      transfers: Array<{ token: string; from: string; to: string; amount: string }>;
    };
    assert.equal(out.ok, true);
    assert.equal(out.path, "eth_simulateV1");
    assert.deepEqual(out.deployPot, {
      kitchen: getAddress(v12KitchenAddress()),
      owner: NOBODY,
      salt: `0x${"00".repeat(32)}`,
    });
    assert.ok(
      out.transfers.some(
        (transfer) =>
          getAddress(transfer.token) === usdc &&
          getAddress(transfer.to) === RECIPIENT &&
          transfer.amount === "1500000",
      ),
      "the transfer the cook made",
    );
    // A rehearsal: nothing landed.
    assert.equal(await local.publicClient.getCode({ address: pot }), undefined);
    assert.equal(await local.balanceOf(usdc, RECIPIENT), 0n);
  });

  it("returns a revert as a result, decoded, and credits what a keyless fund would pull", async () => {
    const reverts = ok(
      await mcp.call("sauce_simulate", {
        source: 'function main() {\n  throw "not today";\n}\n',
        chain: "arbitrum",
        owner: NOBODY,
      }),
    );
    assert.equal(reverts.ok, false);
    assert.equal(reverts.reason, 'the program threw "not today"');
    const funded = ok(
      await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, fund: ["USDC:1.5"] }),
    );
    assert.equal(funded.ok, true);
    // The command's reason, in the tool's words: the input, not the flag.
    const because = (funded.assumed as Array<{ because: string }>).map((each) => each.because);
    assert.ok(
      because.some((each) => /\bfund\b/.test(each)),
      because.join("; "),
    );
    assert.ok(!because.some((each) => each.includes("--")), because.join("; "));
  });

  it("builds a deployment the owner's own wallet signs, then sees the Pot deployed", async () => {
    const unsigned = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: OWNER.address }));
    assert.equal(unsigned.deployed, false);
    // Signed and sent here, outside the server, with a key it never saw.
    await local.send(local.owner, unsigned.to as Address, unsigned.data as Hex);
    const after = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: OWNER.address }));
    assert.equal(after.deployed, true);
    assert.ok((after.notes as string[]).some((note) => /do not send the deployment/.test(note)));
    const tx = ok(await mcp.call("sauce_tx", { ...pay, owner: OWNER.address }));
    assert.ok((tx.notes as string[]).some((note) => /It is deployed/.test(note)));
    // Named by its address alone, the Pot's owner is read from the chain: who signs.
    const byPot = ok(await mcp.call("sauce_tx", { ...pay, pot: after.pot }));
    assert.equal(byPot.to, after.pot);
    assert.equal(getAddress(byPot.from as Address), getAddress(OWNER.address));
  });

  it("fetches a transaction by hash and takes it apart", async () => {
    const unsigned = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: RECIPIENT }));
    const hash = await local.send(local.deployer, unsigned.to as Address, unsigned.data as Hex);
    const out = ok(await mcp.call("sauce_inspect", { hex: hash, chain: "arbitrum" }));
    assert.match(JSON.stringify(out), /deployPot/);
    assert.match(JSON.stringify(out), new RegExp(unsigned.pot as string, "i"));
  });

  it("reaches the chain through the call's rpcUrl, over a server's own endpoint or with none", async () => {
    // A server whose own endpoint for the chain refuses connections, and one with none at all.
    for (const endpoints of [
      endpointsFor({ [String(local.chain.id)]: "http://127.0.0.1:9/dead" }),
      endpointsFor({}),
    ]) {
      const caller = await connect(endpoints);
      try {
        const pot = ok(
          await caller.call("sauce_pot", {
            chain: "arbitrum",
            owner: NOBODY,
            rpcUrl: local.rpcUrl,
          }),
        );
        assert.equal(pot.deployed, false);
        const rehearsal = ok(
          await caller.call("sauce_simulate", {
            ...pay,
            owner: NOBODY,
            assumeBalance: ["USDC:2"],
            rpcUrl: local.rpcUrl,
          }),
        );
        assert.equal(rehearsal.ok, true);
        const tx = ok(
          await caller.call("sauce_tx", { ...pay, owner: NOBODY, rpcUrl: local.rpcUrl }),
        );
        assert.equal(tx.value, FEE.toString(), "the fee read through the call's endpoint");
        assert.ok(!caller.received.join("\n").includes(local.rpcUrl.replace("http://", "")));
      } finally {
        await caller.close();
      }
    }
  });

  it("reads a pool's price now, and puts the limits slippageBps from it", async () => {
    const weth = registered(local.chain, "WETH");
    const [token0, token1] = [weth, usdc].sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : 1,
    );
    const pair = { chain: "arbitrum", base: "WETH", quote: "USDC" };
    const quoted = ok(await mcp.call("sauce_price", { ...pair, price: "2700" }));
    const sqrtPriceX96 = BigInt(quoted.sqrtPriceX96 as string);
    const pool: Address = "0x9999999999999999999999999999999999999999";
    await local.testClient.setCode({
      address: pool,
      bytecode: answering([
        ["slot0()", [sqrtPriceX96, -197_000n, 1n, 1n, 1n, 0n, 1n]],
        ["liquidity()", [123_456_789n]],
        ["fee()", [500n]],
        ["token0()", [BigInt(token0!)]],
        ["token1()", [BigInt(token1!)]],
      ]),
    });
    const out = ok(await mcp.call("sauce_price", { ...pair, pool, slippageBps: 30 })) as Record<
      string,
      unknown
    > & { pool: Record<string, unknown>; limits: { feePpm: number } };
    assert.equal(Math.round(Number(out.price)), 2700);
    assert.equal(out.sqrtPriceX96, sqrtPriceX96.toString());
    assert.deepEqual(out.pool, {
      address: pool,
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick: -197_000,
      liquidity: "123456789",
      feePpm: 500,
      readFrom: "arbitrum",
    });
    assert.equal(out.limits.feePpm, 500, "the pool's own fee, when feePpm is not given");
    const given = ok(await mcp.call("sauce_price", { ...pair, pool, slippageBps: 30, feePpm: 0 }));
    assert.equal((given.limits as { feePpm: number }).feePpm, 0);

    // A pool of another pair, and an address that is not a pool, are refused by name.
    const other = failed(await mcp.call("sauce_price", { ...pair, quote: `${RECIPIENT}:6`, pool }));
    assert.match(other, /the pool trades 0x\w+ and 0x\w+, not WETH and /);
    const token = failed(await mcp.call("sauce_price", { ...pair, pool: usdc }));
    assert.match(token, /reading the pool's .* failed .*: is .* a V3-style pool on this chain\?/);
  });

  it("rehearses an intent's publish from a wallet that does not hold the reward yet", async () => {
    const args = {
      source: INTENT,
      chain: "arbitrum",
      defines: { RECIPIENT },
      intentDeadline: 2_000_000_000,
      intentCreator: NOBODY,
      from: NOBODY,
      dryRun: true,
    };
    const short = ok(await mcp.call("sauce_intent_publish", args));
    assert.equal(short.ok, false, "with nothing to fund the reward, publishAndFund reverts");
    const out = ok(await mcp.call("sauce_intent_publish", { ...args, assumeBalance: ["USDC:1"] }));
    assert.equal(out.ok, true);
    assert.deepEqual(
      (out.transactions as Array<{ status: string }>).map((tx) => tx.status),
      ["success", "success"],
    );
    assert.equal(await local.balanceOf(usdc, NOBODY), 0n);
    // The other side is the destination's, and its tool is named.
    const notes = (out.notes as string[]).join(" ");
    assert.match(notes, /sauce_intent_fill with the same inputs/);
    assert.doesNotMatch(notes, /sauce fill|--/);
  });

  it("checks the Pot an intent's cook needs on its destination, through rpcUrls", async () => {
    type PotCheck = { destination: string; pot: string; deployed: boolean | null };
    const args = {
      source: COOKED,
      chain: "arbitrum",
      defines: { RECIPIENT },
      intentDeadline: 2_000_000_000,
      intentCreator: NOBODY,
      intentExecutionFee: String(FEE),
    };
    const unchecked = ok(await mcp.call("sauce_compile", args));
    assert.deepEqual(
      (unchecked.intentPots as PotCheck[]).map((check) => [check.destination, check.deployed]),
      [["base", null]],
      "no endpoint for the destination, so not checked",
    );
    const checked = ok(
      await mcp.call("sauce_compile", { ...args, rpcUrls: { base: base.rpcUrl } }),
    );
    const [pot] = checked.intentPots as PotCheck[];
    assert.deepEqual([pot!.destination, pot!.deployed], ["base", false]);
    const notes = (checked.notes as string[]).join(" ");
    assert.match(notes, /is not deployed there, so no solver can fill it yet/);
    assert.match(notes, /sauce_pot \(its unsigned deployment, which any account may send\)/);
    assert.doesNotMatch(notes, /--|sauce pot/);
  });

  it("rehearses a solver filling the intent on its destination, through the call's endpoint", async () => {
    type Fill = {
      ok: boolean;
      destination: string;
      portal: string;
      calls: Array<{ kind: string; status: string }>;
    };
    const args = {
      source: INTENT,
      chain: "arbitrum",
      defines: { RECIPIENT },
      intentDeadline: 2_000_000_000,
      intentCreator: NOBODY,
    };
    const block = await base.publicClient.getBlockNumber();
    for (const reach of [{ rpcUrl: base.rpcUrl }, { rpcUrls: { base: base.rpcUrl } }]) {
      const out = ok(await mcp.call("sauce_intent_fill", { ...args, ...reach })) as {
        ok: boolean;
        chain: string;
        intents: Fill[];
      };
      assert.equal(out.ok, true);
      assert.equal(out.chain, "arbitrum");
      const [fill] = out.intents;
      assert.equal(fill!.destination, "base");
      assert.equal(getAddress(fill!.portal), basePortal);
      assert.deepEqual(
        fill!.calls.map((call) => [call.kind, call.status]),
        [
          ["approve", "success"],
          ["fulfill", "success"],
        ],
      );
    }
    // A rehearsal: nothing landed on the destination.
    assert.equal(await base.publicClient.getBlockNumber(), block);
    assert.equal(await base.balanceOf(baseUsdc, RECIPIENT), 0n);
    // The server has no endpoint of its own for the destination.
    assert.match(
      failed(await mcp.call("sauce_intent_fill", args)),
      /Rehearsing a fill needs an RPC endpoint for base .* Pass rpcUrl with the call/,
    );
  });
});
