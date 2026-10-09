/**
 * What the testing kit's own suites share. NOT a `.test.ts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
