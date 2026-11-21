/**
 * Which release the engine-executing suites run on. Unset (or "default"): the installed compiler's
 * own row, the SDK's defaults. "legacy": the earlier release that row's `alsoRunsOn` names, from the
 * artifacts `sync-engine-artifacts.mjs#writeLegacyArtifacts` writes to `src/artifacts/legacy/`. Every
 * program the suites run then also proves the claim `alsoRunsOn` makes for it.
 * SAUCE_TEST_EVM_ARM and SAUCE_TEST_SVM_ARM are read here and nowhere else.
 *
 * NOT a `.test.ts`, so jest never collects it.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { V12_RELEASE_SETS, v12ReleaseSet, type V12ReleaseSet } from "../src/deployments/index.js";

export type ReleaseArm = "default" | "legacy";

const VARIABLE = { evm: "SAUCE_TEST_EVM_ARM", svm: "SAUCE_TEST_SVM_ARM" } as const;
const COMPONENT = { evm: "v12-evm", svm: "v12-svm" } as const;
const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/artifacts");

/** The arm `target`'s suites run on: its variable's value, "default" when unset. */
export function releaseArm(target: "evm" | "svm"): ReleaseArm {
  const value = process.env[VARIABLE[target]] ?? "default";
  if (value !== "default" && value !== "legacy") {
    throw new Error(`${VARIABLE[target]} is "${value}": set it to "legacy", or leave it unset`);
  }

  return value;
}

/**
 * The row the legacy arm of `target` runs: the newest row with a public package that pins the first
 * engine the installed row's `alsoRunsOn` lists for it (as `readLegacyArtifacts` picks).
 */
export function legacyRow(target: "evm" | "svm"): V12ReleaseSet {
  const component = COMPONENT[target];
  const version = v12ReleaseSet().alsoRunsOn?.[component]?.[0];
  if (version === undefined) {
    throw new Error(`the installed row's alsoRunsOn lists no ${component} engine`);
  }
  const row = [...V12_RELEASE_SETS]
    .reverse()
    .find((r) => r[component].version === version && r.npm !== undefined);
  if (row === undefined)
    throw new Error(`no row with a public package pins ${component} ${version}`);

  return row;
}

/** Where the sync wrote the legacy arm's artifacts: `src/artifacts/legacy/<compiler>`. */
export const legacyArtifactsDir = (target: "evm" | "svm" = "evm"): string =>
  resolve(ARTIFACTS, "legacy", legacyRow(target).compiler);

/** Whether the artifact the legacy arm of `target` is built on is there. */
export const hasLegacyArtifacts = (target: "evm" | "svm" = "evm"): boolean =>
  existsSync(
    resolve(
      legacyArtifactsDir(target),
      target === "evm" ? "V12RuntimeBytecode.json" : "svm/engine-devnet.so",
    ),
  );
