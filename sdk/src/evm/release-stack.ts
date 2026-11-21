/**
 * Deploys the released v12 EVM stack — engine, Router, Kitchen implementation and Kitchen proxy — on
 * a LOCAL node (anvil), at the release addresses, from the release's creation code.
 *
 * Each release address is CREATE3 through CreateX: CreateX CREATE2s a 16-byte proxy child whose only
 * job is to CREATE the contract at its own nonce 1. This installs that proxy child
 * (`363d3d37363d34f0`, CreateX's code, not the stack's) at the address the release's guarded salt
 * derives, and sends it each contract's creation code, so every contract lands where
 * `V12Deployments.json` says and runs its real constructor — the engine binds its own identity for
 * the Pot's `EVAL` relay, the Kitchen proxy is initialized with an owner. No runtime is copied
 * anywhere. Whatever an address held before is cleared first, which a forked chain carrying an older
 * deployment needs.
 *
 * The Kitchen is left with `owner` as its owner and a zero execution fee. Its Router is the
 * release's: passed to the implementation's constructor for a kitchen-evm release that takes it
 * (1.0.0 and earlier), and set with `setRouter` — the way a fresh deploy sets it — for one that keeps
 * it in storage.
 *
 * `upgradeReleaseStack` takes such a stack to a later release, as a release's own rollout does.
 *
 * It reads no file: the caller passes the synced artifacts (`sdk/{src,dist}/artifacts`). Used by the
 * SDK's own suites (`test/evm/gated-engine.ts`) and by `@eco-incorp/sauce/testing`; not exported.
 */
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from "viem";

interface ContractRef {
  readonly address: Address;
  readonly guardedSalt: Hex;
  readonly initCodeHash?: Hex;
}

/** The synced artifacts a deployment reads. */
export interface ReleaseStackArtifacts {
  /** `V12Deployments.json`'s `evm`: the CreateX factory and each contract's CREATE3 inputs. */
  readonly deployments: {
    readonly factory: Address;
    readonly contracts: Record<
      "engine" | "router" | "kitchen" | "kitchenImplementation",
      ContractRef
    >;
  };
  /** `V12RuntimeBytecode.json`'s `runtimeCreationCode`. */
  readonly runtimeCreationCode: Hex;
  /** `Router.json`'s creation code. */
  readonly routerBytecode: Hex;
  /** `V12Kitchen.json`. */
  readonly kitchen: { readonly abi: Abi; readonly bytecode: Hex };
  /** `V12KitchenProxy.json`'s creation code. */
  readonly kitchenProxyBytecode: Hex;
}

export interface ReleaseStack {
  readonly engine: Address;
  readonly router: Address;
  readonly kitchenImplementation: Address;
  readonly kitchen: Address;
}

/** CreateX's `_PROXY_CHILD_BYTECODE` (the initcode it CREATE2s) and the runtime that leaves. */
const PROXY_CHILD_INITCODE = "0x67363d3d37363d34f03d5260086018f3" as Hex;
const PROXY_CHILD_RUNTIME = "0x363d3d37363d34f0" as Hex;

type Clients = { publicClient: PublicClient; walletClient: WalletClient; testClient: TestClient };

/** Sends `data` to `to` from `owner`, an account the node signs for. */
async function send(clients: Clients, owner: Address, to: Address, data: Hex): Promise<void> {
  const hash = await clients.walletClient.sendTransaction({
    account: owner,
    chain: null,
    data,
    gas: 30_000_000n,
    to,
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`deploying the stack: a call to ${to} reverted`);
}

/**
 * CREATE3 at `ref.address`: install CreateX's proxy child at the salt's CREATE2 address and let it
 * CREATE `initCode` at its nonce 1.
 */
async function create3(
  clients: Clients,
  owner: Address,
  factory: Address,
  ref: ContractRef,
  initCode: Hex,
): Promise<Address> {
  const { publicClient, testClient } = clients;
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
  await send(clients, owner, child, initCode);
  if (!(await publicClient.getCode({ address: at }))) {
    throw new Error(`nothing was created at ${at}`);
  }

  return at;
}

/**
 * Which Kitchen era a release is, read off its ABI the way v12's own deploy tooling does
 * (`release-artifacts.mjs#initCode`): kitchen-evm up to 1.0.0 took the Router as its constructor
 * argument and held it immutably; later releases take nothing and keep the Router in storage, set
 * with `setRouter`.
 */
const takesRouter = (kitchenAbi: Abi): boolean =>
  (
    kitchenAbi.find((entry) => entry.type === "constructor") as
      { inputs: readonly unknown[] } | undefined
  )?.inputs.length === 1;

/**
 * Deploys the stack at its release addresses, owned by `owner`, which must be an account the node
 * signs for (an anvil dev account): every deployment and setting is sent from it.
 */
export async function deployReleaseStack(
  clients: Clients,
  owner: Address,
  artifacts: ReleaseStackArtifacts,
): Promise<ReleaseStack> {
  const { factory, contracts } = artifacts.deployments;
  const kitchenAbi = artifacts.kitchen.abi;

  const engine = await create3(
    clients,
    owner,
    factory,
    contracts.engine,
    artifacts.runtimeCreationCode,
  );
  const router = await create3(clients, owner, factory, contracts.router, artifacts.routerBytecode);
  const settable = kitchenAbi.some(
    (entry) => entry.type === "function" && entry.name === "setRouter",
  );
  const kitchenImplementation = await create3(
    clients,
    owner,
    factory,
    contracts.kitchenImplementation,
    takesRouter(kitchenAbi)
      ? concat([artifacts.kitchen.bytecode, encodeAbiParameters([{ type: "address" }], [router])])
      : artifacts.kitchen.bytecode,
  );
  // KitchenProxy(logic, initialOwner, initialExecutionFee): initialization refuses a zero fee, so it
  // is priced at one wei here and made free below — the same order a Kitchen deploy follows.
  const kitchen = await create3(
    clients,
    owner,
    factory,
    contracts.kitchen,
    concat([
      artifacts.kitchenProxyBytecode,
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [kitchenImplementation, owner, 1n],
      ),
    ]),
  );
  if (settable) {
    await send(
      clients,
      owner,
      kitchen,
      encodeFunctionData({ abi: kitchenAbi, functionName: "setRouter", args: [router] }),
    );
  }
  await send(
    clients,
    owner,
    kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "setExecutionFee", args: [0n] }),
  );

  return { engine, router, kitchenImplementation, kitchen };
}

/**
 * Upgrades a stack `deployReleaseStack` stood up to the release `artifacts` describes, as the
 * release's own rollout does: its engine, Router and Kitchen implementation deployed at their
 * release addresses (CREATE3), then the Kitchen proxy, which stays where it is, upgraded to the new
 * implementation (`upgradeToAndCall(implementation, 0x)`) and given the new Router (`setRouter`).
 * Pots already minted keep their code, their Router and their engine.
 */
export async function upgradeReleaseStack(
  clients: Clients,
  owner: Address,
  artifacts: ReleaseStackArtifacts,
): Promise<ReleaseStack> {
  const { factory, contracts } = artifacts.deployments;
  const kitchenAbi = artifacts.kitchen.abi;
  const kitchen = getAddress(contracts.kitchen.address);
  if (!(await clients.publicClient.getCode({ address: kitchen }))) {
    throw new Error(
      `there is no Kitchen at ${kitchen} to upgrade: upgrade a stack deployReleaseStack deployed`,
    );
  }
  if (takesRouter(kitchenAbi)) {
    throw new Error(
      "upgrading to a Kitchen that takes its Router in its constructor is not supported",
    );
  }

  const engine = await create3(
    clients,
    owner,
    factory,
    contracts.engine,
    artifacts.runtimeCreationCode,
  );
  const router = await create3(clients, owner, factory, contracts.router, artifacts.routerBytecode);
  const kitchenImplementation = await create3(
    clients,
    owner,
    factory,
    contracts.kitchenImplementation,
    artifacts.kitchen.bytecode,
  );
  await send(
    clients,
    owner,
    kitchen,
    encodeFunctionData({
      abi: kitchenAbi,
      functionName: "upgradeToAndCall",
      args: [kitchenImplementation, "0x"],
    }),
  );
  await send(
    clients,
    owner,
    kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "setRouter", args: [router] }),
  );

  return { engine, router, kitchenImplementation, kitchen };
}
