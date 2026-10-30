import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  http,
  keccak256,
  numberToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POT_SCHEMA, PotStore } from "../../src/cli/pot-store.js";
import { sdkCompilerVersion, v12ReleaseSet } from "../../src/deployments/releases.js";
import { v12PotGateSalt, v12PredictPot } from "../../src/deployments/pot.js";
import {
  checkSignedCookPot,
  cookNonceUsed,
  encodeCookSigned,
  signedCookTypedData,
  verifyPotBinding,
  verifySignedCook,
  v12Kitchen,
  v12KitchenAbi,
  v12Pot,
  type EvmPotBindingInput,
  type SignedCookExecution,
} from "../../src/evm/engine.js";
import { deployReleaseStack, type ReleaseStackArtifacts } from "../../src/evm/release-stack.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { readInstalledCompilerProvenance } from "../../scripts/lib/compiler-provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(here, "../../src/artifacts");
const candidatePath = process.env.SAUCE_LOCAL_CANDIDATE;
const coexistenceSuite = candidatePath ? describe : describe.skip;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const port = freePortSync();
const transport = http(`http://127.0.0.1:${port}`);
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: owner, transport });
let anvil: ChildProcess;
let directory: string;

coexistenceSuite("actual retained service A and opted-in CREATE3 service B", () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "sauce-create3-coexistence-"));
    anvil = await spawnAnvil(port);
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("keeps actual old compiler/engine/Pot work across a real Kitchen upgrade and new profile selection", async () => {
    const require = createRequire(import.meta.url);
    const compilerDirectory =
      process.env.SAUCE_RETAINED_COMPILER_DIR ??
      resolve(
        here,
        "../../../node_modules/.pnpm/@eco-incorp+sauce-compiler@2.6.0/node_modules/@eco-incorp/sauce-compiler",
      );
    const compilerPackage = readJson<{ name: string; version: string }>(
      join(compilerDirectory, "package.json"),
    );
    expect(compilerPackage).toMatchObject({ name: "@eco-incorp/sauce-compiler", version: "2.6.0" });
    const retainedCompilerProvenance = readInstalledCompilerProvenance(compilerDirectory);
    expect(retainedCompilerProvenance.compiler).toBe(compilerPackage.version);
    const retainedCompiler = require(join(compilerDirectory, "node/sauce_wasm.js")) as {
      compile(options: { target: "evm"; resolve(path: string): Uint8Array | undefined }): {
        bytecode: Uint8Array;
      };
    };
    const oldProgram = toHex(
      retainedCompiler.compile({
        target: "evm",
        resolve: (path) =>
          path === "main.js"
            ? new TextEncoder().encode("function main(): Uint256 { return 41; }")
            : undefined,
      }).bytecode,
    );
    const historical = v12ReleaseSet(compilerPackage.version);
    const historicalDeployments = readJson<{ evm: ReleaseStackArtifacts["deployments"] }>(
      join(artifacts, "V12Deployments.json"),
    ).evm;
    const historicalRuntime = readJson<{ runtimeCreationCode: Hex }>(
      join(artifacts, "V12RuntimeBytecode.json"),
    ).runtimeCreationCode;
    const historicalPot = readJson<{ bytecode: Hex }>(join(artifacts, "V12Pot.json"));
    expect(keccak256(historicalPot.bytecode)).toBe(historical["kitchen-evm"].potInitCodeHash);
    const oldStack = await deployReleaseStack(
      { publicClient, walletClient, testClient },
      owner.address,
      {
        deployments: historicalDeployments,
        runtimeCreationCode: historicalRuntime,
        routerBytecode: readJson<{ bytecode: Hex }>(join(artifacts, "Router.json")).bytecode,
        kitchen: readJson<{ abi: Abi; bytecode: Hex }>(join(artifacts, "V12Kitchen.json")),
        kitchenProxyBytecode: readJson<{ bytecode: Hex }>(join(artifacts, "V12KitchenProxy.json"))
          .bytecode,
      },
    );
    expect(oldStack.engine).toBe(getAddress(historical["v12-evm"].engine!));
    const send = async (to: Address, data: Hex) => {
      const hash = await walletClient.sendTransaction({
        account: owner,
        chain: null,
        to,
        data,
        gas: 30_000_000n,
      });
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    };
    const oldSalt = numberToHex(301, { size: 32 });
    await send(oldStack.kitchen, v12Kitchen.encodeDeployPot(owner.address, oldSalt));
    const oldPot = getCreate2Address({
      from: oldStack.kitchen,
      salt: v12PotGateSalt(owner.address, oldSalt, false),
      bytecodeHash: historical["kitchen-evm"].potInitCodeHash as Hex,
    });
    const chainId = await publicClient.getChainId();
    const oldBinding = await verifyPotBinding(publicClient, {
      pot: oldPot,
      owner: owner.address,
      userSalt: oldSalt,
      kind: "private",
      kitchen: oldStack.kitchen,
      chainId,
      compiler: compilerPackage.version,
      engine: oldStack.engine,
      router: oldStack.router,
      engineCodeHash: keccak256((await publicClient.getCode({ address: oldStack.engine }))!),
      routerCodeHash: keccak256((await publicClient.getCode({ address: oldStack.router }))!),
      release: {
        compiler: historical.compiler,
        compilerWasmSha256: retainedCompilerProvenance.wasmSha256,
        "v12-evm": historical["v12-evm"].version,
        "kitchen-evm": historical["kitchen-evm"].version,
      },
      wireProfile: "sauce-compiler-2.6.0",
      storageProfile: "kitchen-evm-1.3.0",
    });
    const store = new PotStore(directory);
    expect(
      store.save({
        schema: POT_SCHEMA,
        chain: "ethereum",
        chainId,
        pot: oldPot,
        owner: owner.address,
        salt: oldSalt,
        kind: "private",
        kitchen: oldStack.kitchen,
        engine: oldBinding.engine,
        release: oldBinding.release,
        binding: oldBinding,
        sdk: "LOCAL",
        origin: "imported",
        recordedAt: new Date().toISOString(),
      }),
    ).toBe("created");
    const answer = async (pot: Address, engine: Address, program: Hex, compiler: string) => {
      const result = await publicClient.call({
        account: owner.address,
        to: pot,
        data: v12Pot.encodeCook(engine, program, compiler),
      });
      return BigInt(result.data!);
    };
    expect(await answer(oldPot, oldBinding.engine, oldProgram, oldBinding.compiler)).toBe(41n);

    const candidate = readJson<
      EvmPotBindingInput & { deployments: ReleaseStackArtifacts["deployments"] }
    >(candidatePath!);
    expect(candidate.compiler).toBe(sdkCompilerVersion());
    expect(candidate.router).toBe(oldStack.router);
    const candidateDirectory = dirname(candidatePath!);
    const candidateRuntime = readJson<{ runtimeCreationCode: Hex }>(
      join(candidateDirectory, "V12RuntimeBytecode.json"),
    ).runtimeCreationCode;
    const candidateKitchen = readJson<{ bytecode: Hex }>(
      join(candidateDirectory, "V12Kitchen.json"),
    );
    // Canonical CreateX child fixture executes real constructors; it never replaces old Pot code or proxy storage.
    const deployComponent = async (
      reference: ReleaseStackArtifacts["deployments"]["contracts"]["engine"],
      creationCode: Hex,
    ) => {
      const child = getCreate2Address({
        from: candidate.deployments.factory,
        salt: reference.guardedSalt,
        bytecodeHash: keccak256("0x67363d3d37363d34f03d5260086018f3"),
      });
      expect(getContractAddress({ from: child, nonce: 1n })).toBe(getAddress(reference.address));
      expect(
        await publicClient.getCode({ address: getAddress(reference.address) }),
      ).toBeUndefined();
      expect(keccak256(creationCode)).toBe(reference.initCodeHash);
      await testClient.setCode({ address: child, bytecode: "0x363d3d37363d34f0" });
      await testClient.setNonce({ address: child, nonce: 1 });
      await send(child, creationCode);
    };
    await deployComponent(candidate.deployments.contracts.engine, candidateRuntime);
    await deployComponent(
      candidate.deployments.contracts.kitchenImplementation,
      candidateKitchen.bytecode,
    );
    await send(
      oldStack.kitchen,
      encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "upgradeToAndCall",
        args: [getAddress(candidate.deployments.contracts.kitchenImplementation.address), "0x"],
      }),
    );
    expect(
      await publicClient.readContract({
        address: oldStack.kitchen,
        abi: v12KitchenAbi,
        functionName: "owner",
      }),
    ).toBe(owner.address);
    const persisted = store.recordsOf(chainId, oldPot)[0]!.binding!;
    expect(persisted).toEqual(oldBinding);
    expect(await verifyPotBinding(publicClient, persisted)).toEqual(oldBinding);
    expect(persisted.compiler).toBe("2.6.0");
    expect(persisted.release.compilerWasmSha256).toBe(retainedCompilerProvenance.wasmSha256);
    expect(persisted.engine).not.toBe(candidate.engine);
    // Fresh ordinary work is compiled by the retained compiler after the Kitchen/default profile change.
    const nextOldProgram = toHex(
      retainedCompiler.compile({
        target: "evm",
        resolve: (path) =>
          path === "main.js"
            ? new TextEncoder().encode("function main(): Uint256 { return 43; }")
            : undefined,
      }).bytecode,
    );
    expect(await answer(oldPot, persisted.engine, nextOldProgram, persisted.compiler)).toBe(43n);
    const oldEvalProgram = toHex(
      retainedCompiler.compile({
        target: "evm",
        resolve: (path) =>
          path === "main.js"
            ? new TextEncoder().encode(
                [
                  "function main(): Uint256 {",
                  "  const nested = program((): Uint256 => 47);",
                  '  const [answer] = abi.decode(eval(nested.code.concat(nested.args)), ["Uint256"]);',
                  "  return answer;",
                  "}",
                ].join("\n"),
              )
            : undefined,
      }).bytecode,
    );
    expect(await answer(oldPot, persisted.engine, oldEvalProgram, persisted.compiler)).toBe(47n);
    expect(await checkSignedCookPot(publicClient, oldPot, persisted)).toEqual({
      ok: true,
      owner: owner.address,
    });
    const relayer = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const signed: SignedCookExecution = {
      chainId,
      pot: oldPot,
      engine: persisted.engine,
      compiler: persisted.compiler,
      program: oldEvalProgram,
      maxExecutionFee: 0n,
      nonce: 7001n,
      deadline: (await publicClient.getBlock()).timestamp + 3600n,
      submitter: relayer.address,
    };
    const signature = await owner.signTypedData(signedCookTypedData(signed));
    expect(
      await verifySignedCook({ ...signed, signature, owner: owner.address }, publicClient),
    ).toBe(true);
    const signedTransaction = encodeCookSigned({ ...signed, signature });
    expect(await cookNonceUsed(publicClient, oldPot, signed.nonce)).toBe(false);
    const signedAnswer = await publicClient.call({
      account: relayer.address,
      to: signedTransaction.to,
      data: signedTransaction.data,
      value: signedTransaction.value,
    });
    expect(BigInt(signedAnswer.data!)).toBe(47n);
    const signedHash = await walletClient.sendTransaction({
      account: relayer,
      chain: null,
      to: signedTransaction.to,
      data: signedTransaction.data,
      value: signedTransaction.value,
      gas: 10_000_000n,
    });
    expect((await publicClient.waitForTransactionReceipt({ hash: signedHash })).status).toBe(
      "success",
    );
    expect(await cookNonceUsed(publicClient, oldPot, signed.nonce)).toBe(true);
    expect(await verifyPotBinding(publicClient, persisted)).toEqual(oldBinding);

    const newSalt = numberToHex(302, { size: 32 });
    const newPot = getAddress(v12PredictPot(owner.address, newSalt, candidate.kitchen));
    await send(candidate.kitchen, v12Kitchen.encodeDeployPot(owner.address, newSalt));
    const newBinding = await verifyPotBinding(publicClient, {
      ...candidate,
      pot: newPot,
      owner: owner.address,
      userSalt: newSalt,
      kind: "private",
      chainId,
    });
    expect(newBinding.scheme).toBe("create3");
    expect(newBinding.engine).toBe(candidate.engine);
    await expect(
      verifyPotBinding(publicClient, {
        ...newBinding,
        engine: oldStack.engine,
        engineCodeHash: oldBinding.engineCodeHash,
      }),
    ).rejects.toThrow(/compatibility/);
    expect(await verifyPotBinding(publicClient, newBinding)).toEqual(newBinding);
    expect(
      store.save({
        schema: POT_SCHEMA,
        chain: "ethereum",
        chainId,
        pot: newPot,
        owner: owner.address,
        salt: newSalt,
        kind: "private",
        kitchen: candidate.kitchen,
        engine: newBinding.engine,
        release: newBinding.release,
        binding: newBinding,
        sdk: "LOCAL",
        origin: "deployed",
        recordedAt: new Date().toISOString(),
      }),
    ).toBe("created");
    expect(store.recordsOf(chainId, newPot)[0]!.binding).toEqual(newBinding);
    const newProgram = toHex(
      compileSauceProgram("ethereum", "function main(): Uint256 { return 44; }").bytecode,
    );
    expect(await answer(newPot, newBinding.engine, newProgram, newBinding.compiler)).toBe(44n);
    expect(await answer(oldPot, persisted.engine, nextOldProgram, persisted.compiler)).toBe(43n);
    await expect(
      verifyPotBinding(publicClient, {
        ...persisted,
        engine: candidate.engine,
        engineCodeHash: candidate.engineCodeHash,
      }),
    ).rejects.toThrow(/provenance/);
    await testClient.setCode({ address: oldPot, bytecode: "0x" });
    await expect(verifyPotBinding(publicClient, persisted)).rejects.toThrow(/has no code/);
    expect(store.recordsOf(chainId, oldPot)[0]!.binding).toEqual(oldBinding);
    expect(
      await publicClient.getCode({
        address: v12PredictPot(owner.address, oldSalt, candidate.kitchen),
      }),
    ).toBeUndefined();
  }, 120_000);
});
