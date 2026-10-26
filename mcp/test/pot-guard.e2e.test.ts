/**
 * The tools refuse a cook whose Pot the deployed Kitchen does not put where the SDK predicts it,
 * as the `sauce` command does (`sdk/test/cli-pot-guard.e2e.test.ts`): on a local anvil with the
 * released gated stack (`sdk/test/cli-anvil.ts`), the Kitchen proxy pointed at
 * `MispredictingKitchen`, `sauce_tx` and `sauce_simulate` are error results naming both addresses;
 * pointed back at the release, the same calls succeed.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { encodeDeployData, getAddress, pad, type Address, type Hex } from "viem";

import { RUNTIME_HEX_PATH, startChain, type LocalChain } from "../../sdk/test/cli-anvil.js";
import mispredicting from "../../sdk/test/evm/fixtures/MispredictingKitchen.json" with { type: "json" };
import {
  v12KitchenAddress,
  v12KitchenImplementationAddress,
} from "../../sdk/dist/deployments/index.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { connect, endpointsFor, failed, ok, type Connected } from "./harness.js";

/** EIP-1967's implementation slot, which the Kitchen's UUPS proxy delegates through. */
const IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** Where the mispredicting Kitchen says every Pot is: an address with no code. */
const ELSEWHERE = getAddress("0x00000000000000000000000000000000005e1f00");
/** An owner with no Pot. */
const NOBODY: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

describe(
  "the tools check the Pot against the deployed Kitchen",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let local: LocalChain;
    let mcp: Connected;
    let mispredictingKitchen: Address;
    const kitchen = getAddress(v12KitchenAddress());
    const implementation = getAddress(v12KitchenImplementationAddress());
    const pot = getAddress(v12PredictPot(NOBODY, `0x${"00".repeat(32)}`) as Address);
    const cook = { source: PROGRAM, chain: "ethereum", owner: NOBODY, args: ["41"] };

    before(async () => {
      local = await startChain("ethereum");
      mispredictingKitchen = await local.plant(
        encodeDeployData({
          abi: mispredicting.abi,
          bytecode: mispredicting.creationCode as Hex,
          args: [implementation, ELSEWHERE],
        }),
      );
      mcp = await connect(endpointsFor({ [String(local.chain.id)]: local.rpcUrl }));
    });

    after(async () => {
      await mcp?.close();
      await local?.stop();
    });

    const implement = (address: Address) =>
      local.testClient.setStorageAt({
        address: kitchen,
        index: IMPLEMENTATION_SLOT,
        value: pad(address),
      });

    it("refuses sauce_tx and sauce_simulate while the Kitchen predicts another Pot", async () => {
      await implement(mispredictingKitchen);
      try {
        for (const tool of ["sauce_tx", "sauce_simulate"]) {
          const said = failed(await mcp.call(tool, cook));
          assert.match(said, /this SDK does not match the deployed Kitchen/, tool);
          assert.match(said, /Upgrade @eco-incorp\/sauce/, tool);
          assert.ok(said.includes(pot) && said.includes(ELSEWHERE), `${tool}: ${said}`);
        }
      } finally {
        await implement(implementation);
      }
      assert.equal(await local.publicClient.getCode({ address: pot }), undefined);
    });

    it("builds and rehearses as ever on the released Kitchen", async () => {
      const tx = ok(await mcp.call("sauce_tx", cook));
      assert.equal(tx.pot, pot);
      const simulated = ok(await mcp.call("sauce_simulate", cook));
      assert.equal(simulated.ok, true);
    });
  },
);
