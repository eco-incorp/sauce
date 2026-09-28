/**
 * The ABI bindings action programs call through (`src/abis.ts`). Offline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector, type AbiFunction } from "viem";

import {
  BINDING_NAMES,
  bindingMethods,
  canonicalSignature,
  contractsFor,
  type BindingName,
} from "../src/abis.js";
import { CHAIN_KEY_SET, NAMESPACE_KEYS } from "../../sdk/dist/routes/accessor-index.js";
import { BalancerV2VaultABI } from "../../sdk/dist/protocols/balancer-v2/index.js";
import { DODOV2ProxyABI } from "../../sdk/dist/protocols/dodo/index.js";
import { MaverickV2RouterABI } from "../../sdk/dist/protocols/maverick/index.js";
import { StargatePoolABI } from "../../sdk/dist/protocols/stargate/index.js";

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
    // `approve`/`transfer` go through the SDK's `token/safe`, which decodes no output, so a token
    // returning no `bool` (USDT) does not revert — `erc20-writes.exec.test.ts` executes it.
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

  it("the quotes a bridge pays are view calls, so the program issues them as static calls", () => {
    assert.equal(bindingMethods("IStargatePool").quoteSend!.fn.stateMutability, "view");
    assert.equal(bindingMethods("IWarpRoute").quoteGasPayment!.fn.stateMutability, "view");
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
    assert.equal(fromSdk, 28, "a registry-sourced method was added or dropped — update this count");
  });

  it("the methods the registry declares with their deployed types come from it, selector unchanged", () => {
    // Each was a local fragment while the registry spelled it differently or lacked it —
    // SwapRouter02 and the deadline-free Universal Router / six-argument RouterNG overloads
    // missing, Curve indices `uint128`, Balancer's `poolId` a `uint256`, Stargate's `to` a
    // `uint256`, Permit2's expiration a `uint64`. The selectors are the deployed ones, dispatched
    // in `sdk/test/fixtures/registry-abi`.
    const fromRegistry: [BindingName, string, string, string, string][] = [
      ["ISwapRouter02", "exactInputSingle", "uniswap-v3", "UniswapV3SwapRouter02ABI", "0x04e45aaf"],
      ["ISwapRouter02", "exactInput", "uniswap-v3", "UniswapV3SwapRouter02ABI", "0xb858183f"],
      ["IUniversalRouter", "execute", "uniswap-v4", "UniswapV4UniversalRouterABI", "0x24856bc3"],
      ["ICurvePool", "exchange", "curve", "CurveThreePoolABI", "0x3df02124"],
      ["ICurveRouterNG", "exchange", "curve", "CurveRouterNGABI", "0xc872a3c5"],
      ["IBalancerV2Vault", "swap", "balancer-v2", "BalancerV2VaultABI", "0x52bbbe29"],
      ["IBalancerV2Vault", "batchSwap", "balancer-v2", "BalancerV2VaultABI", "0x945bcec9"],
      ["IStargatePool", "send", "stargate", "StargatePoolABI", "0xc7c7f5b3"],
      ["IPermit2", "approve", "permit2", "Permit2ABI", "0x87517c45"],
    ];
    for (const [binding, method, protocol, abiExport, selector] of fromRegistry) {
      const bound = bindingMethods(binding)[method]!;
      assert.deepEqual(bound.source, { kind: "sdk", protocol, abiExport }, `${binding}.${method}`);
      assert.equal(toFunctionSelector(bound.fn), selector, `${binding}.${method}`);
    }
  });

  it("the router overloads are bound with their deployed mutability and outputs", () => {
    // Both are payable on-chain; the local RouterNG fragment said nonpayable. A binding never
    // attaches value, so the mutability changes no bytecode — but it is now the deployed one.
    const execute = bindingMethods("IUniversalRouter").execute!.fn;
    assert.equal(execute.stateMutability, "payable");
    assert.deepEqual(execute.outputs, []);
    const exchange = bindingMethods("ICurveRouterNG").exchange!.fn;
    assert.equal(exchange.stateMutability, "payable");
    assert.deepEqual(
      exchange.outputs.map((o) => o.type),
      ["uint256"],
      "the amount received, which a chained action spends",
    );
  });

  it("a registry method whose output no action reads is bound output-free", () => {
    // The registry declares these outputs, and the contracts return them; a program measures a
    // batch swap's output as a balance delta and never reads Stargate's receipts.
    const unread: [BindingName, string, readonly unknown[]][] = [
      ["IBalancerV2Vault", "batchSwap", BalancerV2VaultABI],
      ["IStargatePool", "send", StargatePoolABI],
    ];
    for (const [binding, method, abi] of unread) {
      const bound = bindingMethods(binding)[method]!;
      const declared = (abi as AbiFunction[]).find(
        (item) =>
          item.type === "function" && canonicalSignature(item) === canonicalSignature(bound.fn),
      )!;
      assert.ok(
        declared.outputs.length > 0,
        `the registry declares ${binding}.${method}'s outputs`,
      );
      assert.deepEqual(bound.fn.outputs, [], `${binding}.${method} decodes nothing`);
      assert.equal(bound.fn.stateMutability, declared.stateMutability, `${binding}.${method}`);
    }
  });

  it("a fragment is local only while the registry ABI for its contract lacks the function", () => {
    // When one of these starts passing the check, the registry gained the function: bind it there.
    const registryAbiFor: [BindingName, string, readonly unknown[]][] = [
      ["IDodoProxy", "dodoSwapV1", DODOV2ProxyABI],
      ["IMaverickV2Router", "exactInputMultiHop", MaverickV2RouterABI],
      ["IStargatePool", "quoteSend", StargatePoolABI],
    ];
    for (const [binding, method, abi] of registryAbiFor) {
      const bound = bindingMethods(binding)[method]!;
      assert.equal(bound.source.kind, "local", `${binding}.${method}`);
      const signature = canonicalSignature(bound.fn);
      const declared = (abi as AbiFunction[]).filter(
        (item) => item.type === "function" && canonicalSignature(item) === signature,
      );
      assert.deepEqual(declared, [], `the registry now declares ${signature}`);
    }
  });

  it("contractsFor is deterministic and names only what it was given", () => {
    const a = contractsFor(["IErc20", "IAaveV3Pool", "IErc20"]);
    assert.deepEqual(Object.keys(a), ["IAaveV3Pool", "IErc20"]);
    assert.deepEqual(a, contractsFor(["IAaveV3Pool", "IErc20"]));
  });
});
