/**
 * The ABI bindings action programs call through (`src/abis.ts`). Offline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BINDING_NAMES, bindingMethods, canonicalSignature, contractsFor } from "../src/abis.js";
import { CHAIN_KEY_SET, NAMESPACE_KEYS } from "../../sdk/dist/routes/accessor-index.js";

describe("action ABI bindings", () => {
  it("every binding resolves — each SDK-registry method has exactly the signature the action calls", () => {
    // `bindingMethods` throws when a registry ABI no longer declares the signature asked for.
    for (const name of BINDING_NAMES) assert.doesNotThrow(() => bindingMethods(name), name);
  });

  it("no binding name can collide with a route namespace, a chain accessor or a synthesized binding", () => {
    for (const name of BINDING_NAMES) {
      assert.match(name, /^I[A-Z][A-Za-z0-9]*$/, `${name} should be I-prefixed PascalCase`);
      assert.ok(!NAMESPACE_KEYS.has(name), `${name} is a protocol namespace`);
      assert.ok(!CHAIN_KEY_SET.has(name), `${name} is a chain accessor`);
      assert.ok(
        !name.includes("_"),
        `${name} could collide with a rewrite-synthesized I<Protocol>_<Contract>`,
      );
      assert.notEqual(name, "IERC20", "the route compiler injects its own IERC20 import");
      assert.notEqual(name, "IPortal", "the route compiler layers its own IPortal binding");
    }
  });

  it("ERC-20 writes are not bindings: IErc20 binds only the read", () => {
    // `approve`/`transfer` go through the SDK's `token/unchecked`, which decodes nothing, so a
    // token returning no `bool` (USDT) does not revert — `no-return-token.exec.test.ts` executes it.
    const erc20 = bindingMethods("IErc20");
    assert.deepEqual(Object.keys(erc20), ["balanceOf"]);
    assert.deepEqual(
      erc20.balanceOf!.fn.outputs.map((o) => o.type),
      ["uint256"],
    );
  });

  it("the Curve 4-argument exchange is output-free — 3pool-era pools return nothing", () => {
    assert.deepEqual(bindingMethods("ICurvePool").exchange!.fn.outputs, []);
  });

  it("records where every method comes from, with a reason for each one the registry does not supply", () => {
    let fromSdk = 0;
    for (const name of BINDING_NAMES) {
      for (const [method, bound] of Object.entries(bindingMethods(name))) {
        if (bound.source.kind === "sdk") {
          fromSdk++;
          assert.ok(bound.source.protocol && bound.source.abiExport, `${name}.${method}`);
        } else {
          assert.ok(bound.source.reason.length > 10, `${name}.${method} needs a reason`);
        }
      }
    }
    assert.equal(fromSdk, 18, "a registry-sourced method was added or dropped — update this count");
  });

  it("the selectors that were once wrong are now the deployed contracts'", () => {
    // Checked against mainnet bytecode: the Stargate V1 router has 0x9fbf10fc, not 0x13d356b9.
    assert.equal(
      canonicalSignature(bindingMethods("IStargateRouter").swap!.fn),
      "swap(uint16,uint256,uint256,address,uint256,uint256,(uint256,uint256,bytes),bytes,bytes)",
    );
    assert.equal(
      canonicalSignature(bindingMethods("IBalancerV2Vault").swap!.fn),
      "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
    );
  });

  it("contractsFor is deterministic and names only what it was given", () => {
    const a = contractsFor(["IErc20", "IAaveV3Pool", "IErc20"]);
    assert.deepEqual(Object.keys(a), ["IAaveV3Pool", "IErc20"]);
    assert.deepEqual(a, contractsFor(["IAaveV3Pool", "IErc20"]));
  });
});
