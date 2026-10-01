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

import { encodeAbiParameters, getAddress, zeroAddress, type Address, type Hex } from "viem";

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
import { ecoRoutesPortal } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { connect, endpointsFor, ok, type Connected } from "./harness.js";

const SDK_TEST = join(dirname(fileURLToPath(import.meta.url)), "../../sdk/test");
const PORTAL_CREATION = (
  JSON.parse(readFileSync(join(SDK_TEST, "evm/fixtures/Portal.json"), "utf8")) as {
    creationCode: Hex;
  }
).creationCode;

/** An owner nobody holds the key of, with nothing: no Pot, no native currency, no tokens. */
const NOBODY: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
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
    local = await startChain("arbitrum", await freePort());
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    // The real eco-routes Portal, where the SDK records it, for the publish rehearsal.
    await local.plant(
      `${PORTAL_CREATION}${encodeAbiParameters([{ type: "address" }], [zeroAddress]).slice(2)}` as Hex,
      ecoRoutesPortal("arbitrum") as Address,
    );
    mcp = await connect(endpointsFor({ [String(local.chain.id)]: local.rpcUrl }));
  });

  after(async () => {
    await mcp?.close();
    await local?.stop();
    // Every byte the server sent, across every test: never the endpoint.
    assert.ok(!mcp.received.join("\n").includes(local.rpcUrl.replace("http://", "")));
  });

  const pot = getAddress(v12PredictPot(NOBODY, `0x${"00".repeat(32)}`) as Address);
  const pay = { source: PAY, chain: "arbitrum", args: [RECIPIENT, "1500000"] };

  it("reads the Kitchen's fee for the cook, and that the Pot is not deployed", async () => {
    const tx = ok(await mcp.call("sauce_tx", { ...pay, owner: NOBODY }));
    assert.equal(tx.to, pot);
    assert.equal(tx.value, FEE.toString());
    assert.ok((tx.notes as string[]).some((note) => /It is NOT deployed/.test(note)));
    const predicted = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: NOBODY }));
    assert.equal(predicted.pot, pot);
    assert.equal(predicted.deployed, false);
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
    assert.ok(
      (funded.assumed as Array<{ because: string }>).some((each) => /--fund/.test(each.because)),
    );
  });

  it("builds a deployment the owner's own wallet signs, then sees the Pot deployed", async () => {
    const unsigned = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: OWNER.address }));
    assert.equal(unsigned.deployed, false);
    // Signed and sent here, outside the server, with a key it never saw.
    await local.send(local.owner, unsigned.to as Address, unsigned.data as Hex);
    const after = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: OWNER.address }));
    assert.equal(after.deployed, true);
    const tx = ok(await mcp.call("sauce_tx", { ...pay, owner: OWNER.address }));
    assert.ok((tx.notes as string[]).some((note) => /It is deployed/.test(note)));
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
    const short = ok(await mcp.call("sauce_publish", args));
    assert.equal(short.ok, false, "with nothing to fund the reward, publishAndFund reverts");
    const out = ok(await mcp.call("sauce_publish", { ...args, assumeBalance: ["USDC:1"] }));
    assert.equal(out.ok, true);
    assert.deepEqual(
      (out.transactions as Array<{ status: string }>).map((tx) => tx.status),
      ["success", "success"],
    );
    assert.equal(await local.balanceOf(usdc, NOBODY), 0n);
  });
});
