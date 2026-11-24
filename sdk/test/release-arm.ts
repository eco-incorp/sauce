/**
 * Which release the engine-executing suites run on. Unset (or "default"): the installed compiler's
 * own row, the SDK's defaults. A version the installed row's `alsoRunsOn` lists for the target
 * (`"1.4.0"` or `"1.3.0"` for EVM, `"1.4.0"` for Solana): the earlier engine release of that version,
 * from the artifacts `sync-engine-artifacts.mjs#writeLegacyArtifacts` writes to
 * `src/artifacts/legacy/`. Every program the suites run then also proves the claim `alsoRunsOn` makes
 * for it. SAUCE_TEST_EVM_ARM and SAUCE_TEST_SVM_ARM are read here and nowhere else.
 *
 * NOT a `.test.ts`, so jest never collects it.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { V12_RELEASE_SETS, v12ReleaseSet, type V12ReleaseSet } from "../src/deployments/index.js";

/** `"default"`, or an earlier engine version the installed row's `alsoRunsOn` lists. */
export type ReleaseArm = string;

const VARIABLE = { evm: "SAUCE_TEST_EVM_ARM", svm: "SAUCE_TEST_SVM_ARM" } as const;
const COMPONENT = { evm: "v12-evm", svm: "v12-svm" } as const;
const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/artifacts");

/**
 * The arm `target`'s suites run on: its variable's value, "default" when unset. A value must be an
 * engine version the installed row's `alsoRunsOn` lists for the target.
 */
export function releaseArm(target: "evm" | "svm"): ReleaseArm {
  const value = process.env[VARIABLE[target]] ?? "default";
  if (value === "default") return value;
  const listed = v12ReleaseSet().alsoRunsOn?.[COMPONENT[target]] ?? [];
  if (!listed.includes(value)) {
    throw new Error(
      `${VARIABLE[target]} is "${value}": set it to one of ${listed.join(", ")}, or leave it unset`,
    );
  }

  return value;
}

/**
 * The row the arm of engine `version` runs: the newest row with a public package that pins that
 * engine version (as `readLegacyArtifacts` picks).
 */
export function legacyRow(target: "evm" | "svm", version: string): V12ReleaseSet {
  const component = COMPONENT[target];
  const row = [...V12_RELEASE_SETS]
    .reverse()
    .find((r) => r[component].version === version && r.npm !== undefined);
  if (row === undefined)
    throw new Error(`no row with a public package pins ${component} ${version}`);

  return row;
}

/** Where the sync wrote the artifacts of engine `version`: `src/artifacts/legacy/<compiler>`. */
export const legacyArtifactsDir = (target: "evm" | "svm", version: string): string =>
  resolve(ARTIFACTS, "legacy", legacyRow(target, version).compiler);

/** Whether the artifact the arm of engine `version` is built on is there. */
export const hasLegacyArtifacts = (target: "evm" | "svm", version: string): boolean =>
  existsSync(
    resolve(
      legacyArtifactsDir(target, version),
      target === "evm" ? "V12RuntimeBytecode.json" : "svm/engine-devnet.so",
    ),
  );
