/**
 * Deploys a runnable v12 engine on a local fork, for the `actions` fork tests.
 *
 * NOT a `.test.ts`, so the runner never collects it.
 *
 * A released engine re-derives `CREATE2(KITCHEN, gateSalt(potId), POT_INITCODEHASH)` and runs only
 * when that lands on its caller, so raw calldata to the engine is refused with an empty revert — no
 * reason string. The caller has to be a REAL Pot of the Kitchen the engine was built against: the
 * hash pins Pot init code byte for byte, and owner and salt are constructor immutables, so nothing
 * hand-rolled answers `gateSalt()` correctly.
 *
 * Copying the Kitchen's runtime to the baked address works because the engine only ever hashes that
 * address. The Pot hash is immutable; the Router and fee must be configured in Kitchen storage.
 *
 * `executionFee` is NOT in code — it lives in the Kitchen's ERC-7201 storage, and `setCode` replaces
 * code without touching storage. On a fork of a chain where the Kitchen is already deployed, that
 * storage arrives populated and every cook then owes a real fee, so this zeroes the slot. Without it
 * the fee is charged against a Kitchen whose etched implementation is not the live proxy, and each
 * cook dies on an empty revert that reads exactly like a gate refusal.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from "viem";
import type { Address, Chain, Hex, PublicClient, WalletClient } from "viem";

export const v12PotAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
]);

/** The Pot salt these harnesses mint under. */
export const POT_SALT = `0x${"00".repeat(31)}07` as Hex;

/// keccak256(abi.encode(uint256(keccak256("sauce.storage.Kitchen")) - 1)) & ~bytes32(uint256(0xff)) —
/// the Kitchen's ERC-7201 base slot, whose first field is `executionFee`.
const KITCHEN_STORAGE_LOCATION =
  "0x5384a20a2274531eff1a9d6e0fd4a21c7fd0f38287b942efdb9af2a20efe5a00" as Hex;

const ZERO_WORD = `0x${"00".repeat(32)}` as Hex;

/** One of the synced v12 artifacts, from wherever `sync-engine-artifacts` put it. */
export function artifact<T>(repoRoot: string, name: string): T {
  const candidates = [
    resolve(repoRoot, `sdk/dist/artifacts/${name}.json`),
    resolve(repoRoot, `sdk/src/artifacts/${name}.json`),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `${name}.json not found (looked in ${candidates.join(", ")}). Run ` +
        "`pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`.",
    );
  }

  return JSON.parse(readFileSync(found, "utf-8")) as T;
}

export interface GatedEngine {
  engine: Address;
  pot: Address;
}

/**
 * Deploys the engine, materializes the Kitchen at the address the gate hashes, and mints the Pot.
 *
 * `setCode` and `setStorage` are passed in, so the caller's own test client writes the state.
 */
export async function startGatedEngine(
  repoRoot: string,
  clients: { publicClient: PublicClient; walletClient: WalletClient; chain: Chain },
  owner: Address,
  runtimeCreationCode: Hex,
  setCode: (address: Address, code: Hex) => Promise<unknown>,
  setStorage: (address: Address, slot: Hex, value: Hex) => Promise<unknown>,
): Promise<GatedEngine> {
  const { publicClient, walletClient, chain } = clients;

  const deploy = async (data: Hex): Promise<Address> => {
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain,
      data,
      gas: 30_000_000n,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    if (!contractAddress) throw new Error("a deployment produced no contract address");

    return contractAddress;
  };

  // Deployed, not etched: the constructor appends the engine's own address as a trailing code word
  // and EVAL staticcalls it, so a copy at another address reaches a codeless account — which
  // succeeds with empty returndata rather than reverting.
  const engine = await deploy(runtimeCreationCode);
  const code = await publicClient.getCode({ address: engine });
  if (!code || code.length < 1000)
    throw new Error(`V12 runtime deployed only ${code?.length ?? 0} hex chars`);

  const gate = artifact<{ kitchen: Address; potInitCodeHash: Hex; router: Address }>(
    repoRoot,
    "V12EngineGate",
  );
  const kitchen = artifact<{ abi: readonly unknown[]; bytecode: Hex }>(repoRoot, "V12Kitchen");

  const built = await deploy(kitchen.bytecode);
  const kitchenCode = await publicClient.getCode({ address: built });
  if (!kitchenCode) throw new Error(`the Kitchen deployed at ${built} has no code`);
  await setCode(gate.kitchen, kitchenCode);
  await setStorage(gate.kitchen, KITCHEN_STORAGE_LOCATION, ZERO_WORD);

  const routerDeployment = await deploy(artifact<{ bytecode: Hex }>(repoRoot, "Router").bytecode);
  const routerCode = await publicClient.getCode({ address: routerDeployment });
  if (!routerCode) throw new Error("the Router deployment has no code");
  await setCode(gate.router, routerCode);
  // Router follows executionFee in the Kitchen's ERC-7201 namespace.
  await setStorage(
    gate.kitchen,
    toHex(BigInt(KITCHEN_STORAGE_LOCATION) + 1n, { size: 32 }),
    pad(gate.router, { size: 32 }),
  );

  // Refuse a mismatched Kitchen/engine pair before executing any program.
  const live = (await publicClient.readContract({
    abi: kitchen.abi,
    address: gate.kitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== gate.potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the Kitchen at ${gate.kitchen} reports potInitCodeHash ${live}, not the ` +
        `${gate.potInitCodeHash} the engine was built against.`,
    );
  }

  const mint = await walletClient.sendTransaction({
    account: owner,
    chain,
    data: encodeFunctionData({
      abi: kitchen.abi,
      args: [owner, POT_SALT],
      functionName: "deployPot",
    }),
    gas: 30_000_000n,
    to: gate.kitchen,
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });

  const pot = getCreate2Address({
    bytecodeHash: gate.potInitCodeHash,
    from: gate.kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, POT_SALT]),
    ),
  });
  if (!(await publicClient.getCode({ address: pot })))
    throw new Error(`no Pot was minted at the derived address ${pot}`);

  const potRouter = await publicClient.readContract({
    abi: parseAbi(["function router() view returns (address)"]),
    address: pot,
    functionName: "router",
  });
  if (potRouter.toLowerCase() !== gate.router.toLowerCase()) {
    throw new Error("the Pot did not inherit the Kitchen's configured Router");
  }

  return { engine, pot };
}

/** Wraps a program in the `cook` the Pot expects. */
export const cookData = (engine: Address, bytecode: Uint8Array): Hex =>
  encodeFunctionData({
    abi: v12PotAbi,
    args: [engine, `0x${Buffer.from(bytecode).toString("hex")}` as Hex],
    functionName: "cook",
  });
