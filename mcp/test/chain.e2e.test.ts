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
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";

import { formatUnits, getAddress, toFunctionSelector, type Address, type Hex } from "viem";

import {
  FEE,
  fixture,
  OWNER,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { connect, endpointsFor, erred, failed, ok, type Connected } from "./harness.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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
/**
 * Runtime code answering each listed function with fixed words, and reverting anything else: a
 * stand-in for a V3-style pool's reads, with no pool behind them.
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
  let mcp: Connected;
  let usdc: Address;

  before(async () => {
    local = await startChain("ethereum", await freePort());
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    mcp = await connect(endpointsFor({ [String(local.chain.id)]: local.rpcUrl }));
  });

  after(async () => {
    await mcp?.close();
    await local?.stop();
    // Every byte the server sent, across every test: never an endpoint.
    assert.ok(!mcp.received.join("\n").includes(local.rpcUrl.replace("http://", "")));
  });

  const pot = getAddress(v12PredictPot(NOBODY, `0x${"00".repeat(32)}`) as Address);
  const pay = { source: PAY, chain: "ethereum", args: [RECIPIENT, "1500000"] };

  it("reads the Kitchen's fee for the cook, and that the Pot is not deployed", async () => {
    const tx = ok(await mcp.call("sauce_tx", { ...pay, owner: NOBODY }));
    assert.equal(tx.to, pot);
    assert.equal(tx.value, FEE.toString());
    assert.equal(tx.from, NOBODY, "who signs it");
    assert.deepEqual(tx.kitchenFee, {
      wei: FEE.toString(),
      native: formatUnits(FEE, 18),
      readFrom: "ethereum",
    });
    assert.ok((tx.notes as string[]).some((note) => /It is NOT deployed/.test(note)));
    assert.ok(!(tx.notes as string[]).some((note) => /--|sauce pot/.test(note)), "no flags");
    const predicted = ok(await mcp.call("sauce_pot", { chain: "ethereum", owner: NOBODY }));
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
    const out = ok(await mcp.call("sauce_pot", { chain: "ethereum", owner: HOLDER }));
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
      await mcp.call("sauce_pot", { chain: "ethereum", owner: HOLDER, balances: false }),
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
    // What stays in the Pot comes first, and a note says so, for the user to be told.
    assert.deepEqual(Object.keys(out).slice(0, 2), ["ok", "leftInPot"]);
    assert.deepEqual(out.leftInPot, [
      {
        token: usdc,
        symbol: "USDC",
        decimals: 6,
        amount: "500000",
        formatted: "0.5",
        before: "2000000",
      },
    ]);
    const notes = (out.notes ?? []) as string[];
    assert.ok(
      notes.includes(
        "After this cook the Pot holds 0.5 USDC of what it moved (leftInPot), not the owner's " +
          "wallet: only another cook moves it out. Tell the user before building the " +
          "transaction. For it to end in their wallet, the program must send it there, or name " +
          "the wallet as the recipient of the call that produces it.",
      ),
      notes.join("\n"),
    );
    // Spending all of it leaves the Pot nothing: an empty leftInPot, and no note.
    const spent = ok(
      await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, assumeBalance: ["USDC:1.5"] }),
    );
    assert.deepEqual(spent.leftInPot, []);
    assert.ok(!((spent.notes ?? []) as string[]).some((note) => note.includes("leftInPot")));
    // A rehearsal: nothing landed.
    assert.equal(await local.publicClient.getCode({ address: pot }), undefined);
    assert.equal(await local.balanceOf(usdc, RECIPIENT), 0n);
  });

  it("takes amounts in whole tokens or base units, and says when one reads like base units", async () => {
    const notesOf = async (amount: string) =>
      (ok(await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, assumeBalance: [amount] }))
        .notes ?? []) as string[];
    // Two million whole USDC may be meant: rehearsed, and said in the notes, in the tool's words.
    const large = await notesOf("USDC:2000000");
    assert.ok(
      large.includes(
        "assumeBalance USDC:2000000: that is 2 million USDC; for base units write 2000000n",
      ),
      large.join("\n"),
    );
    // Base units, written as such, and whole tokens below 10^decimals: nothing to say.
    for (const amount of ["USDC:2000000n", "USDC:2"]) {
      const notes = await notesOf(amount);
      assert.ok(!notes.some((note) => note.includes("for base units")), notes.join("\n"));
    }
  });

  it("returns a revert as an error result led by its reason, and credits what a keyless fund would pull", async () => {
    const reverts = erred(
      await mcp.call("sauce_simulate", {
        source: 'function main() {\n  throw "not today";\n}\n',
        chain: "ethereum",
        owner: NOBODY,
      }),
    );
    assert.deepEqual(Object.keys(reverts).slice(0, 2), ["reverted", "error"]);
    assert.equal(reverts.reverted, true);
    assert.equal(reverts.error, 'the program threw "not today"');
    assert.equal(reverts.ok, false);
    assert.equal(reverts.reason, 'the program threw "not today"');
    // A revert asked for is the result asked for: ok, and still reverted.
    const expected = ok(
      await mcp.call("sauce_simulate", {
        source: 'function main() {\n  throw "not today";\n}\n',
        chain: "ethereum",
        owner: NOBODY,
        expectRevert: "not today",
      }),
    );
    assert.deepEqual([expected.ok, expected.reverted, expected.asExpected], [true, true, true]);
    const unmet = erred(
      await mcp.call("sauce_simulate", {
        ...pay,
        owner: NOBODY,
        assumeBalance: ["USDC:2"],
        expectRevert: "not today",
      }),
    );
    assert.deepEqual([unmet.ok, unmet.asExpected], [false, false]);
    // Each scenario holds its own: one revert unexpected, the same revert expected.
    const scenarios = erred(
      await mcp.call("sauce_simulate", {
        source: 'function main() {\n  throw "not today";\n}\n',
        chain: "ethereum",
        owner: NOBODY,
        scenarios: [{}, { expectRevert: "not today" }],
      }),
    ) as { ok: boolean; scenarios: Array<Record<string, unknown>> };
    assert.equal(scenarios.ok, false);
    assert.deepEqual(
      scenarios.scenarios.map((each) => [each.ok, each.reverted, each.asExpected]),
      [
        [false, true, undefined],
        [true, true, true],
      ],
    );
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

  it("gives each transaction's gas, and rehearses at the block given", async () => {
    const out = ok(
      await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, assumeBalance: ["USDC:2"] }),
    ) as Record<string, unknown> & {
      transactions: Array<{ step: string; gas: string; gasKind: string }>;
    };
    assert.deepEqual(
      out.transactions.map((each) => each.step),
      ["deployPot", "cook"],
    );
    assert.equal(out.transactions[1]!.gas, out.gas);
    assert.ok(BigInt(out.transactions[0]!.gas) > 21_000n);
    assert.equal(out.sourceSha256, sha256(PAY));
    // The latest block, past viem's cache of it: an older one may predate the released stack.
    const block = (await local.publicClient.getBlockNumber({ cacheTime: 0 })).toString();
    const at = ok(
      await mcp.call("sauce_simulate", {
        ...pay,
        owner: NOBODY,
        assumeBalance: ["USDC:2"],
        block,
      }),
    );
    assert.equal(at.block, block);
    assert.match(
      failed(await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, block: "nope" })),
      /block: 'nope' is not a block number or a tag/,
    );
  });

  it("summarizes a rehearsal to what decides a trade", async () => {
    const full = ok(
      await mcp.call("sauce_simulate", { ...pay, owner: NOBODY, assumeBalance: ["USDC:2"] }),
    );
    const summary = ok(
      await mcp.call("sauce_simulate", {
        ...pay,
        owner: NOBODY,
        assumeBalance: ["USDC:2"],
        block: full.block as string,
        summary: true,
      }),
    );
    assert.deepEqual(Object.keys(summary).sort(), [
      "balanceChanges",
      "block",
      "chain",
      "gas",
      "gasKind",
      "leftInPot",
      "nativeTransfers",
      "notes",
      "ok",
      // main declares no return type: its raw return data, empty here.
      "returns",
      "sourceSha256",
      "transactions",
      "transfers",
    ]);
    assert.equal(summary.returns, "0x");
    // What it keeps is the full result's, field for field; the state overrides and logs are not.
    for (const field of [
      "ok",
      "leftInPot",
      "block",
      "transfers",
      "balanceChanges",
      "transactions",
    ]) {
      assert.deepEqual(summary[field], full[field], field);
    }
    assert.ok(full.assumed !== undefined && full.otherLogs !== undefined);
    assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length);
    // A revert keeps its reason, and what main returned is kept decoded.
    const reverts = erred(
      await mcp.call("sauce_simulate", {
        source: 'function main() {\n  throw "not today";\n}\n',
        chain: "ethereum",
        owner: NOBODY,
        summary: true,
      }),
    );
    assert.deepEqual(
      [reverts.reverted, reverts.error, reverts.ok, reverts.stage, reverts.reason],
      [true, 'the program threw "not today"', false, "cook", 'the program threw "not today"'],
    );
    const returns = ok(
      await mcp.call("sauce_simulate", {
        source: "function main(): Uint256 {\n  return 42n;\n}\n",
        chain: "ethereum",
        owner: NOBODY,
        summary: true,
      }),
    );
    assert.deepEqual([returns.returnType, returns.returned], ["Uint256", "42"]);
    assert.equal(returns.returns, undefined);
  });

  it("rehearses one program as several scenarios at one block, one result each", async () => {
    const out = erred(
      await mcp.call("sauce_simulate", {
        ...pay,
        owner: NOBODY,
        assumeBalance: ["USDC:2"],
        summary: true,
        scenarios: [
          {},
          { args: [RECIPIENT, "2500000"] },
          { args: [RECIPIENT, "2500000"], assumeBalance: ["USDC:3"] },
          { args: [RECIPIENT] },
        ],
      }),
    ) as {
      ok: boolean;
      block: string;
      sourceSha256: string;
      scenarios: Array<Record<string, unknown>>;
    };
    assert.equal(out.ok, false, "one scenario reverts, one is refused");
    assert.equal(out.sourceSha256, sha256(PAY));
    assert.deepEqual(
      out.scenarios.map((each) => [each.index, each.ok]),
      [
        [0, true],
        [1, false],
        [2, true],
        [3, false],
      ],
    );
    // Every rehearsal at the one block the call read.
    for (const each of out.scenarios.slice(0, 3)) assert.equal(each.block, out.block);
    assert.match(out.scenarios[1]!.reason as string, /./);
    // A scenario's mistake is its own result, in the tool's words.
    assert.match(out.scenarios[3]!.error as string, /takes 2 arguments/);
    assert.doesNotMatch(out.scenarios[3]!.error as string, /--args/);
    // A scenario's defines are laid over the call's, compiled into its own program.
    const defined = ok(
      await mcp.call("sauce_simulate", {
        source: "function main(): Uint256 {\n  return LIMIT;\n}\n",
        chain: "ethereum",
        owner: NOBODY,
        defines: { LIMIT: 7 },
        summary: true,
        scenarios: [{}, { defines: { LIMIT: 9 } }],
      }),
    ) as { scenarios: Array<{ returned: string }> };
    assert.deepEqual(
      defined.scenarios.map((each) => each.returned),
      ["7", "9"],
    );
  });

  it("builds a deployment the owner's own wallet signs, then sees the Pot deployed", async () => {
    const unsigned = ok(await mcp.call("sauce_pot", { chain: "ethereum", owner: OWNER.address }));
    assert.equal(unsigned.deployed, false);
    // Signed and sent here, outside the server, with a key it never saw.
    await local.send(local.owner, unsigned.to as Address, unsigned.data as Hex);
    const after = ok(await mcp.call("sauce_pot", { chain: "ethereum", owner: OWNER.address }));
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
    const unsigned = ok(await mcp.call("sauce_pot", { chain: "ethereum", owner: RECIPIENT }));
    const hash = await local.send(local.deployer, unsigned.to as Address, unsigned.data as Hex);
    const out = ok(await mcp.call("sauce_inspect", { hex: hash, chain: "ethereum" }));
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
            chain: "ethereum",
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
    const pair = { chain: "ethereum", base: "WETH", quote: "USDC" };
    const quoted = ok(await mcp.call("sauce_price", { ...pair, price: "2700" }));
    const sqrtPriceX96 = BigInt(quoted.sqrtPriceX96 as string);
    const pool: Address = "0x9999999999999999999999999999999999999999";
    // Each venue's slot0 after its price and tick: Uniswap V3's seven words, PancakeSwap V3's
    // with a uint32 feeProtocol, Aerodrome Slipstream's six (no feeProtocol).
    const slot0s = {
      "Uniswap V3": [sqrtPriceX96, -197_000n, 1n, 1n, 1n, 0n, 1n],
      "PancakeSwap V3": [sqrtPriceX96, -197_000n, 1n, 1n, 1n, 0x0d480d48n, 1n],
      "Aerodrome Slipstream": [sqrtPriceX96, -197_000n, 1n, 1n, 1n, 1n],
    } as const;
    for (const [venue, slot0] of Object.entries(slot0s)) {
      await local.testClient.setCode({
        address: pool,
        bytecode: answering([
          ["slot0()", slot0],
          ["liquidity()", [123_456_789n]],
          ["fee()", [500n]],
          ["tickSpacing()", [10n]],
          ["token0()", [BigInt(token0!)]],
          ["token1()", [BigInt(token1!)]],
        ]),
      });
      const out = ok(await mcp.call("sauce_price", { ...pair, pool, slippageBps: 30 })) as Record<
        string,
        unknown
      > & { pool: Record<string, unknown>; limits: { feePpm: number }; notes: string[] };
      assert.equal(Math.round(Number(out.price)), 2700, venue);
      assert.equal(out.sqrtPriceX96, sqrtPriceX96.toString());
      // No factory() here, so no venue is named: a pool no registry factory made.
      assert.deepEqual(out.pool, {
        address: pool,
        venue: null,
        contract: null,
        unrecognized: "it answers no factory(), so no venue is named",
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick: -197_000,
        liquidity: "123456789",
        feePpm: 500,
        tickSpacing: 10,
        readFrom: "ethereum",
      });
      assert.ok(out.notes.some((note) => /The pool's venue is not named/.test(note)));
      assert.equal(out.limits.feePpm, 500, "the pool's own fee, when feePpm is not given");
    }
    const given = ok(await mcp.call("sauce_price", { ...pair, pool, slippageBps: 30, feePpm: 0 }));
    assert.equal((given.limits as { feePpm: number }).feePpm, 0);

    // A pool of another pair, and an address that is not a pool, are refused by name.
    const other = failed(await mcp.call("sauce_price", { ...pair, quote: `${RECIPIENT}:6`, pool }));
    assert.match(other, /the pool 0x9{40} trades 0x\w+ and 0x\w+, not WETH and /);
    const token = failed(await mcp.call("sauce_price", { ...pair, pool: usdc }));
    assert.match(token, /answers none of a V3-style pool's reads on ethereum/);
  });
});
