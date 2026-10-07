/**
 * Stands up the released v12 EVM stack on an anvil — engine, Router, Kitchen implementation and
 * Kitchen proxy — for suites that execute compiler-emitted bytecode.
 *
 * NOT a `.test.ts`, so jest never collects it.
 *
 * **The engine cannot be called directly.** It re-derives `CREATE2(KITCHEN, gateSalt(potId),
 * POT_INITCODEHASH)` and runs only when that lands on its caller, so an `eth_call` straight to the
 * engine reverts with empty returndata — no reason string, nothing to match on. Both constants are
 * baked into the released artifact, so the caller has to be a REAL Pot, minted by CREATE2 from the
 * one Kitchen address the engine was built against, with init code hashing to exactly the pinned
 * hash.
 *
 * **Everything is deployed from its creation code, at its release address.** Each release address
 * is CREATE3 through CreateX: CreateX CREATE2s a 16-byte proxy child whose only job is to CREATE the
 * contract at its own nonce 1. This installs that proxy child (`363d3d37363d34f0`, CreateX's code,
 * not the stack's) at the address the release's guarded salt derives, and sends it each contract's
 * creation code, so every contract lands where `V12Deployments.json` says and runs its real
 * constructor — the engine binds its own identity for the Pot's `EVAL` relay, the Kitchen proxy is
 * initialized with an owner. No runtime is copied anywhere.
 *
 * The Kitchen is left with its owner (the harness account) and a zero execution fee, so no cook
 * needs `value`. Its Router is the release's, at the release's Router address: passed to the
 * implementation's constructor for a kitchen-evm release that takes it (1.0.0 and earlier), and set
 * with `setRouter` — the way a fresh deploy sets it — for one that keeps it in storage.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
} from "viem";
import type { Abi, Address, Hex, PublicClient, TestClient, WalletClient } from "viem";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

const artifact = (name: string): { abi: Abi; bytecode: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as {
    abi: Abi;
    bytecode: Hex;
  };

/** `kitchen` and `potInitCodeHash`, written by `sync-engine-artifacts` from the engine release's
 *  own manifest: the two anchors the released engine gates every cook on. */
export const gateAnchors = (): { kitchen: Address; potInitCodeHash: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, "V12EngineGate.json"), "utf8")) as {
    kitchen: Address;
    potInitCodeHash: Hex;
  };

interface ContractRef {
  address: Address;
  guardedSalt: Hex;
  initCodeHash?: Hex;
}

/** The release's CREATE3 inputs, from `V12Deployments.json`. */
const deployments = (): {
  factory: Address;
  contracts: Record<"engine" | "router" | "kitchen" | "kitchenImplementation", ContractRef>;
} =>
  (
    JSON.parse(readFileSync(resolve(ARTIFACTS, "V12Deployments.json"), "utf8")) as {
      evm: {
        factory: Address;
        contracts: Record<"engine" | "router" | "kitchen" | "kitchenImplementation", ContractRef>;
      };
    }
  ).evm;

/** The Pot salt every harness mints under. One Pot is enough: suites name their own accounts. */
export const POT_SALT = `0x${"00".repeat(31)}07` as Hex;

/** CreateX's `_PROXY_CHILD_BYTECODE` (the initcode it CREATE2s) and the runtime that leaves. */
const PROXY_CHILD_INITCODE = "0x67363d3d37363d34f03d5260086018f3" as Hex;
const PROXY_CHILD_RUNTIME = "0x363d3d37363d34f0" as Hex;

export interface GatedEngine {
  /** The engine, at its release address (`v12EngineAddress()`), deployed from creation code: its
   *  constructor bound that identity for the Pot's `EVAL` relay. */
  engine: Address;
  /** The Router the Kitchen hands every new Pot, at its release address. */
  router: Address;
  /** The Kitchen proxy, at the address the engine's gate hashes. Owned by the harness account. */
  kitchen: Address;
  /** The Pot every program runs as. `ctx.self()` is this, not the engine. */
  pot: Address;
  /** Wraps a program in the `cook` the Pot expects. */
  cookData: (program: Hex) => Hex;
  /** What a cook must pay. Zero here: the harness sets the Kitchen's fee to zero. */
  fee: bigint;
}

/**
 * Deploys the stack at its release addresses and mints the harness Pot.
 *
 * `owner` must be an account the caller can send from AND set as the `from` of an `eth_call`:
 * `Pot.cook` is `onlyOwner`, and viem's `publicClient.call` sends no `from` by default, so a read
 * that omits it reverts with `NotOwner()` rather than running anything. It also owns the Kitchen.
 */
export const startGatedEngine = async (
  clients: { publicClient: PublicClient; walletClient: WalletClient; testClient: TestClient },
  owner: Address,
  runtimeCreationCode: Hex,
): Promise<GatedEngine> => {
  const { publicClient, walletClient, testClient } = clients;
  const { kitchen: gateKitchen, potInitCodeHash } = gateAnchors();
  const { factory, contracts } = deployments();
  const kitchenAbi = artifact("V12Kitchen").abi;

  const send = async (to: Address, data: Hex): Promise<void> => {
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain: null,
      data,
      gas: 30_000_000n,
      to,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`a harness transaction to ${to} reverted`);
  };

  /** CREATE3 at `ref.address`: install CreateX's proxy child at the salt's CREATE2 address and let
   *  it CREATE `initCode` at its nonce 1. Clears whatever the address held first, which is what a
   *  replayed chain carrying an older deployment needs. */
  const create3 = async (ref: ContractRef, initCode: Hex): Promise<Address> => {
    const child = getCreate2Address({
      bytecodeHash: keccak256(PROXY_CHILD_INITCODE),
      from: factory,
      salt: ref.guardedSalt,
    });
    const at = getContractAddress({ from: child, nonce: 1n });
    if (at !== getAddress(ref.address)) {
      throw new Error(`the release's salt derives ${at}, not the recorded ${ref.address}`);
    }
    if (ref.initCodeHash !== undefined && keccak256(initCode) !== ref.initCodeHash) {
      throw new Error(`the initcode for ${ref.address} does not hash to its recorded address`);
    }
    await testClient.setCode({ address: at, bytecode: "0x" });
    await testClient.setNonce({ address: at, nonce: 0 });
    await testClient.setCode({ address: child, bytecode: PROXY_CHILD_RUNTIME });
    await testClient.setNonce({ address: child, nonce: 1 });
    await send(child, initCode);
    if (!(await publicClient.getCode({ address: at }))) {
      throw new Error(`nothing was created at ${at}`);
    }

    return at;
  };

  const engine = await create3(contracts.engine, runtimeCreationCode);
  const router = await create3(contracts.router, artifact("Router").bytecode);
  // Which Kitchen era this release is, read off its ABI the way v12's own deploy tooling does
  // (`release-artifacts.mjs#initCode`): kitchen-evm up to 1.0.0 took the Router as its constructor
  // argument and held it immutably; later releases take nothing and keep the Router in storage,
  // set with `setRouter`.
  const takesRouter =
    (
      kitchenAbi.find((entry) => entry.type === "constructor") as
        { inputs: readonly unknown[] } | undefined
    )?.inputs.length === 1;
  const settable = kitchenAbi.some(
    (entry) => entry.type === "function" && entry.name === "setRouter",
  );
  const implementation = await create3(
    contracts.kitchenImplementation,
    takesRouter
      ? concat([
          artifact("V12Kitchen").bytecode,
          encodeAbiParameters([{ type: "address" }], [router]),
        ])
      : artifact("V12Kitchen").bytecode,
  );
  // KitchenProxy(logic, initialOwner, initialExecutionFee): initialization refuses a zero fee, so it
  // is priced at one wei here and made free below — the same order a Kitchen deploy follows.
  const kitchen = await create3(
    contracts.kitchen,
    concat([
      artifact("V12KitchenProxy").bytecode,
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [implementation, owner, 1n],
      ),
    ]),
  );
  if (kitchen !== getAddress(gateKitchen)) {
    throw new Error(`the Kitchen landed at ${kitchen}, but the engine gates on ${gateKitchen}`);
  }
  if (settable) {
    await send(
      kitchen,
      encodeFunctionData({ abi: kitchenAbi, functionName: "setRouter", args: [router] }),
    );
  }
  await send(
    kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "setExecutionFee", args: [0n] }),
  );

  // The assertion that makes a mismatched Kitchen fail HERE, naming the cause, rather than surfacing
  // as an unexplained empty revert from the gate in whichever test runs first.
  const live = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the Kitchen at ${kitchen} reports potInitCodeHash ${live}, but the engine was built ` +
        `against ${potInitCodeHash}: every Pot it mints would land at an address the gate rejects.`,
    );
  }

  await send(
    kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "deployPot", args: [owner, POT_SALT] }),
  );
  const pot = getCreate2Address({
    bytecodeHash: potInitCodeHash,
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, POT_SALT]),
    ),
  });
  if (!(await publicClient.getCode({ address: pot }))) {
    throw new Error(`no Pot was minted at the derived address ${pot}`);
  }

  const potRouter = await publicClient.readContract({
    abi: artifact("V12Pot").abi,
    address: pot,
    functionName: "router",
  });
  if (String(potRouter).toLowerCase() !== router.toLowerCase()) {
    throw new Error("the Pot did not inherit the Kitchen's configured Router");
  }

  const fee = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    cookData: (program) =>
      encodeFunctionData({
        abi: artifact("V12Pot").abi,
        args: [engine, program],
        functionName: "cook",
      }),
    engine,
    fee,
    kitchen,
    pot,
    router,
  };
};
