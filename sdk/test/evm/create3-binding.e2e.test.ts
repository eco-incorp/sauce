import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  numberToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { v12PredictPot } from "../../src/deployments/pot.js";
import {
  authenticatePotRuntime,
  verifyPotBinding,
  v12Kitchen,
  v12KitchenAbi,
  v12Pot,
  type EvmPotBinding,
  type EvmPotBindingInput,
} from "../../src/evm/engine.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { startGatedEngine, type GatedEngine } from "./gated-engine.js";
import { COMPILER_PROVENANCE } from "../../src/embedded/compiler.generated.js";

const runtimePath =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const candidateSuite = process.env.SAUCE_LOCAL_CANDIDATE && runtimePath ? describe : describe.skip;
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const port = freePortSync();
const transport = http(`http://127.0.0.1:${port}`);
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: owner, transport });
let anvil: ChildProcess;
let stack: GatedEngine;

candidateSuite("actual LOCAL CREATE3 release binding", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(port);
    stack = await startGatedEngine(
      { publicClient, testClient, walletClient },
      owner.address,
      readFileSync(runtimePath!, "utf8").trim() as Hex,
    );
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  const send = async (to: Address, data: Hex) => {
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain: null,
      to,
      data,
      gas: 10_000_000n,
    });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
  };

  it.each(["private", "private-fixed-router", "shared"] as const)(
    "authenticates and executes new work on %s",
    async (kind) => {
      const salt = numberToHex(kind === "private" ? 101 : kind === "shared" ? 103 : 102, {
        size: 32,
      });
      const potOwner = kind === "shared" ? zeroAddress : owner.address;
      const routerFixed = kind !== "private";
      const predicted = getAddress(v12PredictPot(potOwner, salt, stack.kitchen, routerFixed));
      const onchain = await publicClient.call({
        to: stack.kitchen,
        data: v12Kitchen.encodePredictPot(potOwner, salt, routerFixed),
      });
      expect(onchain.data?.slice(-40).toLowerCase()).toBe(predicted.slice(2).toLowerCase());
      await send(
        stack.kitchen,
        kind === "shared"
          ? v12Kitchen.encodeDeploySharedPot(salt)
          : v12Kitchen.encodeDeployPot(potOwner, salt, routerFixed),
      );
      const binding = await stack.bindingOf(predicted);
      expect(binding.kind).toBe(kind);
      expect(binding.scheme).toBe("create3");
      expect(binding.profileHash).toBeDefined();
      expect(Object.keys(binding.profile!).sort()).toEqual(
        [
          "scheme",
          "helperInitCodeHash",
          "runtimeSize",
          "runtimeTemplateHash",
          "immutableReferences",
        ].sort(),
      );
      expect("source" in binding).toBe(false);
      expect("deployments" in binding).toBe(false);
      expect(await verifyPotBinding(publicClient, binding)).toEqual(binding);
      const program = toHex(
        compileSauceProgram("ethereum", "function main(): Uint256 { return 42; }").bytecode,
      );
      const result = await publicClient.call({
        account: owner.address,
        to: predicted,
        data: v12Pot.encodeCook(binding.engine, program, binding.compiler),
      });
      expect(BigInt(result.data!)).toBe(42n);
    },
  );

  it("checks every real immutable copy and all remaining runtime bytes", async () => {
    const binding = await stack.bindingOf(stack.pot);
    const code = (await publicClient.getCode({ address: stack.pot }))!;
    expect(authenticatePotRuntime(code, binding.profile!, binding)).toBe(binding.codeHash);
    for (const [field, references] of Object.entries(binding.profile!.immutableReferences)) {
      for (const reference of references) {
        const changed =
          `${code.slice(0, 2 + reference.start * 2)}${"ff".repeat(32)}${code.slice(2 + (reference.start + 32) * 2)}` as Hex;
        expect(() => authenticatePotRuntime(changed, binding.profile!, binding)).toThrow(
          new RegExp(field),
        );
      }
    }
    const changed = `0x${code.slice(2, 4) === "ff" ? "fe" : "ff"}${code.slice(4)}` as Hex;
    expect(() => authenticatePotRuntime(changed, binding.profile!, binding)).toThrow();
  });

  it("refuses disappeared existing code and unknown or mismatched profiles without replacement", async () => {
    const binding = await stack.bindingOf(stack.pot);
    await expect(
      verifyPotBinding(publicClient, {
        ...binding,
        pot: v12PredictPot(owner.address, numberToHex(999, { size: 32 }), stack.kitchen),
      }),
    ).rejects.toThrow(/has no code/);
    await expect(
      verifyPotBinding(publicClient, { ...binding, profile: undefined, profileHash: undefined }),
    ).rejects.toThrow(/historical|release|profile|commitment/);
    await expect(
      verifyPotBinding(publicClient, { ...binding, router: zeroAddress }),
    ).rejects.toThrow(/Router/);
  });

  it("retains bounded exact-compiler probe bytes and rejects changed programs", async () => {
    const binding = await stack.bindingOf(stack.pot);
    expect(binding.compatibilityProbe?.compilerWasmSha256).toBe(COMPILER_PROVENANCE.wasmSha256);
    expect(binding.compatibilityProbe?.compiler).toBe(binding.compiler);
    expect(await verifyPotBinding(publicClient, binding)).toEqual(binding);
    for (const program of ["0x", "0x1", `0x${"00".repeat(1025)}`] as Hex[]) {
      await expect(
        verifyPotBinding(publicClient, {
          ...binding,
          compatibilityProbe: { ...binding.compatibilityProbe!, program },
        }),
      ).rejects.toThrow(/compatibility probe/);
    }
    await expect(
      verifyPotBinding(publicClient, {
        ...binding,
        compatibilityProbe: { ...binding.compatibilityProbe!, compiler: "different" },
      }),
    ).rejects.toThrow(/compatibility probe/);
    const refusedProgram = "0x00" as Hex;
    await expect(
      verifyPotBinding(publicClient, {
        ...binding,
        compatibilityProbe: { ...binding.compatibilityProbe!, program: refusedProgram },
      }),
    ).rejects.toThrow();
    const withoutDigest = JSON.parse(JSON.stringify(binding));
    delete withoutDigest.compatibilityProbe.compilerWasmSha256;
    await expect(verifyPotBinding(publicClient, withoutDigest)).rejects.toThrow(
      /compatibility probe/,
    );
  });

  it("rejects self-asserted compiler/WASM/program provenance before any RPC", async () => {
    const binding = await stack.bindingOf(stack.pot);
    let requests = 0;
    const refuseRpc = async () => {
      requests++;
      throw new Error("untrusted probe reached RPC");
    };
    const noRpc = {
      ...publicClient,
      getChainId: refuseRpc,
      getCode: refuseRpc,
      readContract: refuseRpc,
      request: refuseRpc,
    };
    const tampered: EvmPotBindingInput[] = [
      { ...binding, compatibilityProbe: { ...binding.compatibilityProbe!, program: "0x00" } },
      {
        ...binding,
        compiler: "untrusted-compiler",
        release: { ...binding.release, compiler: "untrusted-compiler" },
        compatibilityProbe: { ...binding.compatibilityProbe!, compiler: "untrusted-compiler" },
      },
      {
        ...binding,
        release: { ...binding.release, compilerWasmSha256: "00".repeat(32) },
        compatibilityProbe: { ...binding.compatibilityProbe!, compilerWasmSha256: "00".repeat(32) },
      },
    ];
    for (const input of tampered) {
      await expect(verifyPotBinding(noRpc, input)).rejects.toThrow(
        /trusted compiler|compatibility probe/,
      );
    }
    expect(requests).toBe(0);
  });

  it("uses raw eth_call without entering the CCIP-read-capable call action", async () => {
    const binding = await stack.bindingOf(stack.pot);
    let enteredCallAction = false;
    const rawOnly = {
      ...publicClient,
      call: async () => {
        enteredCallAction = true;
        throw new Error("CCIP-capable call action must not run");
      },
    };
    expect(await verifyPotBinding(rawOnly, binding)).toEqual(binding);
    expect(enteredCallAction).toBe(false);
  });

  it("verifies a fee-paying cook without funding the caller or changing chain state", async () => {
    await send(
      stack.kitchen,
      encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "setExecutionFee",
        args: [1234n],
      }),
    );
    const balance = await publicClient.getBalance({ address: owner.address });
    try {
      const binding = await stack.bindingOf(stack.pot);
      const kitchenBalance = await publicClient.getBalance({ address: stack.kitchen });
      await testClient.setBalance({ address: owner.address, value: 0n });
      expect(await verifyPotBinding(publicClient, binding)).toEqual(binding);
      expect(await publicClient.getBalance({ address: owner.address })).toBe(0n);
      expect(await publicClient.getBalance({ address: stack.kitchen })).toBe(kitchenBalance);
    } finally {
      await testClient.setBalance({ address: owner.address, value: balance });
      await send(
        stack.kitchen,
        encodeFunctionData({
          abi: v12KitchenAbi,
          functionName: "setExecutionFee",
          args: [0n],
        }),
      );
    }
  });

  it("rejects a different release Router for fixed and Shared Pots", async () => {
    for (const kind of ["private-fixed-router", "shared"] as const) {
      const salt = numberToHex(kind === "shared" ? 203 : 202, { size: 32 });
      const potOwner = kind === "shared" ? zeroAddress : owner.address;
      await send(
        stack.kitchen,
        kind === "shared"
          ? v12Kitchen.encodeDeploySharedPot(salt)
          : v12Kitchen.encodeDeployPot(potOwner, salt, true),
      );
      const pot = getAddress(v12PredictPot(potOwner, salt, stack.kitchen, true));
      const binding: EvmPotBinding = await stack.bindingOf(pot);
      expect(() =>
        authenticatePotRuntime(
          ("0x" + "00".repeat(binding.profile!.runtimeSize)) as Hex,
          binding.profile!,
          binding,
        ),
      ).toThrow();
      const code = (await publicClient.getCode({ address: pot }))!;
      expect(() =>
        authenticatePotRuntime(code, binding.profile!, { ...binding, router: stack.engine }),
      ).toThrow(/fixedRouter/);
    }
  });
});
