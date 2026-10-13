/**
 * What the testing kit's own suites share. NOT a `.test.ts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWalletClient,
  getAddress,
  http,
  maxUint256,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { TestChain } from "../../src/testing/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A program under `programs/`. */
export const program = (name: string): string => resolve(HERE, "programs", `${name}.sauce.ts`);

/** A recorded state file under `state/`. */
export const statePath = (name: string): string => resolve(HERE, "state", `${name}.json.gz`);

/**
 * Why a suite cannot run here (anvil missing), or false. Under CI it throws instead: a suite CI
 * skips would pass without running.
 */
export function anvilMissing(): string | false {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return false;
  } catch {
    if (process.env.CI)
      throw new Error("anvil is not on PATH, and CI must run the testing kit's suites");
    return "anvil is not on PATH";
  }
}

/** Recording, as the actions suites do it: `RECAPTURE_ANVIL_STATE=1`, the RPC from the gitignored
 *  `sdk/rpc.config.json` (chain id -> URL), never from the environment. */
export const recording = process.env.RECAPTURE_ANVIL_STATE === "1";

export function recordRpc(chainId: number): string {
  const config = resolve(HERE, "../../../sdk/rpc.config.json");
  if (!existsSync(config)) {
    throw new Error(
      `recording reads its RPC from ${config} (gitignored; chain id -> URL): it is not there`,
    );
  }
  const url = (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)[
    String(chainId)
  ];
  if (typeof url !== "string") throw new Error(`${config} gives no RPC for chain ${chainId}`);

  return url;
}

const artifact = (path: string): { abi: Abi; bytecode: Hex } => {
  const json = JSON.parse(readFileSync(path, "utf8")) as {
    abi: Abi;
    bytecode?: Hex;
    creationCode?: Hex;
  };

  return { abi: json.abi, bytecode: (json.bytecode ?? json.creationCode)! };
};
const v3Core = (name: string) =>
  artifact(
    createRequire(import.meta.url).resolve(
      `@uniswap/v3-core/artifacts/contracts/${name}.sol/${name}.json`,
    ),
  );
/** The SDK suites' plain token and Uniswap V3 liquidity helper (`sdk/test/fixtures/cli/Pools.sol`). */
const poolsFixture = (name: string) =>
  artifact(resolve(HERE, "../../../sdk/test/fixtures/cli", `${name}.json`));

export interface V3Pool {
  readonly pool: Address;
  /** What the Pot of account 0 holds, `funded` of it. */
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly funded: bigint;
}

/**
 * A Uniswap V3 pool on `chain`, set up by account 0: Uniswap's own factory and pool
 * (`@uniswap/v3-core`) over two plain 18-decimal tokens, 0.05%, at a price of 1, with liquidity over
 * the whole range; and `funded` of the input token in account 0's Pot.
 */
export async function uniswapV3Pool(chain: TestChain, funded = 10n ** 21n): Promise<V3Pool> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(chain.account(0).privateKey),
    transport: http(chain.rpcUrl),
  });
  const mined = async (hash: Hash) => {
    const receipt = await chain.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setting up the pool: ${hash} reverted`);

    return receipt;
  };
  const deploy = async ({ abi, bytecode }: { abi: Abi; bytecode: Hex }, args: unknown[] = []) =>
    getAddress(
      (await mined(await wallet.deployContract({ abi, bytecode, args, chain: null })))
        .contractAddress!,
    );
  const write = async (address: Address, abi: Abi, functionName: string, args: unknown[]) =>
    mined(await wallet.writeContract({ address, abi, functionName, args, chain: null }));

  const token = poolsFixture("PoolsToken");
  const tokenIn = await deploy(token, ["IN", 18]);
  const tokenOut = await deploy(token, ["OUT", 18]);
  const factory = v3Core("UniswapV3Factory");
  const factoryAddress = await deploy(factory);
  await write(factoryAddress, factory.abi, "createPool", [tokenIn, tokenOut, 500]);
  const pool = getAddress(
    (await chain.client.readContract({
      address: factoryAddress,
      abi: factory.abi,
      functionName: "getPool",
      args: [tokenIn, tokenOut, 500],
    })) as Address,
  );
  const { abi: poolAbi } = v3Core("UniswapV3Pool");
  await write(pool, poolAbi, "initialize", [2n ** 96n]);
  const liquidity = poolsFixture("PoolsLiquidity");
  const helper = await deploy(liquidity);
  const owner = chain.account(0);
  for (const address of [tokenIn, tokenOut]) {
    await write(address, token.abi, "mint", [owner.address, 10n ** 24n]);
    await write(address, token.abi, "approve", [helper, maxUint256]);
  }
  // The whole range, in the 0.05% tier's tick spacing of 10.
  await write(helper, liquidity.abi, "mint", [pool, -887_270, 887_270, 10n ** 22n]);
  await write(tokenIn, token.abi, "mint", [owner.pot, funded]);

  return { pool, tokenIn, tokenOut, funded };
}
