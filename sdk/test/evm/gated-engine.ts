/**
 * Stands up a runnable v12 engine on an anvil, for suites that execute compiler-emitted bytecode.
 *
 * NOT a `.test.ts`, so jest never collects it.
 *
 * **The engine cannot be called directly any more.** It re-derives
 * `CREATE2(KITCHEN, gateSalt(potId), POT_INITCODEHASH)` and runs only when that lands on its caller,
 * so an `eth_call` straight to the engine reverts with empty returndata — no reason string, nothing
 * to match on. Both constants are baked into the released artifact, which is what makes this setup
 * fiddly and what makes it unavoidable: the caller has to be a REAL Pot, minted by CREATE2 from the
 * one Kitchen address the engine was built against, with init code hashing to exactly the pinned
 * hash. No stand-in satisfies that — the hash pins the init code byte for byte, and a Pot's owner
 * and salt are constructor-set immutables, so a copied runtime answers `gateSalt()` wrongly.
 *
 * What DOES work, and is what this does: deploy the real `Kitchen` anywhere, copy its runtime to the
 * baked address, and let it mint the Pot itself. The engine never calls the Kitchen — it only hashes
 * its address — and the Kitchen's `router` and `potInitCodeHash` are immutables living in code, so a
 * copied runtime is a fully working Kitchen. It is left UNINITIALIZED on purpose: `executionFee()`
 * then reads unset ERC-7201 storage and quotes zero, so no cook needs `value`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
} from "viem";
import type { Address, Hex, PublicClient, TestClient, WalletClient } from "viem";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

const artifact = (name: string): { abi: readonly unknown[]; bytecode: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as {
    abi: readonly unknown[];
    bytecode: Hex;
  };

/** `kitchen`, `potInitCodeHash` and `router`, written by `sync-engine-artifacts` from the engine
 *  release's own manifest and the kitchen release's `addresses.json`. */
export const gateAnchors = (): { kitchen: Address; potInitCodeHash: Hex; router: Address } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, "V12EngineGate.json"), "utf8")) as {
    kitchen: Address;
    potInitCodeHash: Hex;
    router: Address;
  };

/** The Pot salt every harness mints under. One Pot is enough: suites name their own accounts. */
export const POT_SALT = `0x${"00".repeat(31)}07` as Hex;

export interface GatedEngine {
  /** The engine, at its own deployed address — NOT a fixed one. Its constructor appends that
   *  address as a trailing code word and `EVAL` staticcalls it, so an engine installed by `setCode`
   *  at some other address has a dangling self-reference. */
  engine: Address;
  /** The Pot every program runs as. `ctx.self()` is this, not the engine. */
  pot: Address;
  /** Wraps a program in the `cook` the Pot expects. */
  cookData: (program: Hex) => Hex;
  /** What a cook must pay. Zero here, because the Kitchen is left uninitialized. */
  fee: bigint;
}

/**
 * Deploys the engine, materializes the Kitchen at its baked address, and mints the Pot.
 *
 * `owner` must be an account the caller can send from AND set as the `from` of an `eth_call`:
 * `Pot.cook` is `onlyOwner`, and viem's `publicClient.call` sends no `from` by default, so a read
 * that omits it reverts with `NotOwner()` rather than running anything.
 */
export const startGatedEngine = async (
  clients: { publicClient: PublicClient; walletClient: WalletClient; testClient: TestClient },
  owner: Address,
  runtimeCreationCode: Hex,
): Promise<GatedEngine> => {
  const { publicClient, walletClient, testClient } = clients;
  const { kitchen: gateKitchen, potInitCodeHash, router } = gateAnchors();
  const kitchenArtifact = artifact("V12Kitchen");
  const potArtifact = artifact("V12Pot");

  const deploy = async (data: Hex): Promise<Address> => {
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain: null,
      data,
      to: null,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    if (!contractAddress) throw new Error("a deployment produced no contract address");

    return contractAddress;
  };

  // Deployed, not `setCode`d: the constructor appends the engine's own address as a trailing code
  // word, and `EVAL` reads it back to resolve its self-staticcall. An engine etched at a fixed
  // address carries whichever address it was originally deployed at, so `EVAL` would staticcall a
  // codeless account — which SUCCEEDS with empty returndata rather than reverting.
  const engine = await deploy(runtimeCreationCode);

  // The Kitchen, anywhere, then copied to the address the engine hashes. `router` is a constructor
  // immutable and it is what `potInitCodeHash` is computed over, so it has to be the released one.
  const built = await deploy(
    concat([kitchenArtifact.bytecode, encodeAbiParameters([{ type: "address" }], [router]) as Hex]),
  );
  const code = await publicClient.getCode({ address: built });
  if (!code) throw new Error(`the Kitchen deployed at ${built} has no code`);
  await testClient.setCode({ address: gateKitchen, bytecode: code });

  // The assertion that makes a wrong `router` fail HERE, naming the cause, rather than surfacing as
  // an unexplained empty revert from the gate in whichever test runs first.
  const live = (await publicClient.readContract({
    abi: kitchenArtifact.abi,
    address: gateKitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the Kitchen at ${gateKitchen} reports potInitCodeHash ${live}, but the engine was built ` +
        `against ${potInitCodeHash}. Its router constructor argument (${router}) is wrong, and every ` +
        "Pot minted from it would land at an address the gate rejects.",
    );
  }

  const mint = await walletClient.sendTransaction({
    account: owner,
    chain: null,
    data: encodeFunctionData({
      abi: kitchenArtifact.abi,
      args: [owner, POT_SALT],
      functionName: "deployPot",
    }),
    to: gateKitchen,
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });

  const pot = getCreate2Address({
    bytecodeHash: potInitCodeHash,
    from: gateKitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, POT_SALT]),
    ),
  });
  const deployed = await publicClient.getCode({ address: pot });
  if (!deployed) throw new Error(`no Pot was minted at the derived address ${pot}`);

  const fee = (await publicClient.readContract({
    abi: kitchenArtifact.abi,
    address: gateKitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    cookData: (program) =>
      encodeFunctionData({ abi: potArtifact.abi, args: [engine, program], functionName: "cook" }),
    engine,
    fee,
    pot,
  };
};

/**
 * Installs a copy of a deployed engine at `at` — for a suite exercising the SDK's DEFAULT engine,
 * which is the released address and so has no code on a fresh anvil.
 *
 * Not a verbatim copy, for the reason `GatedEngine.engine` gives: the constructor appends the
 * engine's own address as the last 20 bytes of its code and `EVAL` staticcalls it, so a verbatim
 * copy would call back into the original. That trailing self-reference is rewritten to `at`. Any
 * other occurrence of the old address fails here, rather than leaving a copy that runs half of
 * itself somewhere else.
 */
export const installEngineAt = async (
  clients: { publicClient: PublicClient; testClient: TestClient },
  engine: Address,
  at: Address,
): Promise<void> => {
  const code = (await clients.publicClient.getCode({ address: engine }))?.toLowerCase();
  const self = engine.slice(2).toLowerCase();
  if (code === undefined || !code.endsWith(self) || code.indexOf(self) !== code.length - 40) {
    throw new Error(
      `the engine at ${engine} does not end in exactly one copy of its own address, so it cannot ` +
        `be relocated to ${at} by rewriting it`,
    );
  }
  await clients.testClient.setCode({
    address: at,
    bytecode: `${code.slice(0, -40)}${at.slice(2).toLowerCase()}` as Hex,
  });
};
