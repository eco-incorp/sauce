/**
 * What the testing kit's own suites share. NOT a `.test.ts`.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
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

/** Contract code by its keccak256, `<codeHash>.hex`: what `fetch-contract-code` fetches from chain. */
const CODE_CACHE = resolve(HERE, "../../../node_modules/.cache/sauce-contract-code");

interface StateAccount {
  code?: string;
  codeHash?: string;
}

interface EvmStateFile {
  genesis: { alloc: Record<string, StateAccount> };
}

/** The code `codeHash` names, from `CODE_CACHE`; undefined if it is not there or fails the hash. */
function cachedCode(codeHash: string): string | undefined {
  const path = join(CODE_CACHE, `${codeHash}.hex`);
  if (!existsSync(path)) return undefined;
  const code = readFileSync(path, "utf8").trim().toLowerCase();

  return /^0x([0-9a-f]{2})+$/.test(code) && keccak256(code as Hex) === codeHash ? code : undefined;
}

/** A replayable copy of a committed state file, with its code put back. */
export interface ReplayedState {
  readonly path: string;
  remove(): void;
}

/**
 * A committed EVM state file pins third-party contract code by its keccak256 (`codeHash`) instead of
 * holding it; `pnpm --filter './sdk' fetch-contract-code` reads that code from the chain into
 * `CODE_CACHE`. This writes the file the kit replays: `state`'s, with each `codeHash` entry's code
 * put back from the cache, in a directory of its own. `remove()` deletes it.
 */
export function replayState(state: string): ReplayedState {
  const file = JSON.parse(gunzipSync(readFileSync(state)).toString("utf8")) as EvmStateFile;
  const missing: string[] = [];
  for (const [address, entry] of Object.entries(file.genesis.alloc)) {
    if (entry.codeHash === undefined) continue;
    const code = cachedCode(entry.codeHash);
    if (code === undefined) {
      missing.push(`${address} (${entry.codeHash})`);
      continue;
    }
    entry.code = code;
    delete entry.codeHash;
  }
  if (missing.length > 0) {
    throw new Error(
      `${relative(process.cwd(), state)} pins the code of ${missing.length} account(s) that ` +
        `${CODE_CACHE} does not hold (or holds failing its hash): ${missing.join(", ")}. Run ` +
        "`pnpm --filter './sdk' fetch-contract-code`, which reads them from the chain and holds " +
        "each to its hash",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "sauce-testing-state-"));
  const path = join(dir, "state.json.gz");
  writeFileSync(path, gzipSync(JSON.stringify(file)));

  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * After recording `state`: each account's code moved into `CODE_CACHE` and replaced by its
 * `codeHash`, the form the file is committed in. 0xef-led code (an EIP-7702 delegation) stays.
 */
export function pinStateCode(state: string): void {
  const file = JSON.parse(gunzipSync(readFileSync(state)).toString("utf8")) as EvmStateFile;
  for (const entry of Object.values(file.genesis.alloc)) {
    if (entry.code === undefined || /^0xef/i.test(entry.code)) continue;
    const code = entry.code.toLowerCase();
    const codeHash = keccak256(code as Hex);
    if (cachedCode(codeHash) === undefined) {
      mkdirSync(CODE_CACHE, { recursive: true });
      const temporary = join(CODE_CACHE, `${codeHash}.hex.${process.pid}.tmp`);
      writeFileSync(temporary, code);
      renameSync(temporary, join(CODE_CACHE, `${codeHash}.hex`));
    }
    delete entry.code;
    entry.codeHash = codeHash;
  }
  writeFileSync(state, gzipSync(JSON.stringify(file), { level: 9 }));
}

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
  // Every later block a second past the pool's first. What a mint costs depends on whether its
  // block falls in the second the pool's oracle last observed: in it the oracle writes nothing, in a
  // later one it writes a new observation. On a chain on the wall clock, the mint's gas could be
  // estimated in the initialization's second and the mint mined in the next, short of that write.
  await chain.increaseTime(1);
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

/**
 * An executable that stands in for anvil, `source` run by Node as CommonJS: `startAnvil` spawns it
 * as `<path> --port <port> --silent ...args`. It lives in a directory of its own, where it may write.
 */
export function fakeAnvil(source: string): { readonly path: string; readonly dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sauce-testing-fake-anvil-"));
  const path = join(dir, "anvil");
  writeFileSync(
    path,
    `#!${process.execPath}\nconst port = Number(process.argv[process.argv.indexOf("--port") + 1]);\n${source}\n`,
    { mode: 0o755 },
  );

  return { path, dir };
}

/** The processes this one started that still run, but the `ps` that lists them. */
export function children(): { readonly pid: number; readonly command: string }[] {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const found = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);

      return found !== null && Number(found[2]) === process.pid && !found[3]!.startsWith("ps ")
        ? [{ pid: Number(found[1]), command: found[3]! }]
        : [];
    });
}

/** Whether process `pid` is gone, or goes within `ms`. */
export async function gone(pid: number, ms = 5_000): Promise<boolean> {
  for (const end = Date.now() + ms; ; await new Promise((ok) => setTimeout(ok, 50))) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() > end) return false;
  }
}
