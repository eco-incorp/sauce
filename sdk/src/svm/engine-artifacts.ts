/**
 * Locate the SVM engine binaries the SDK SHIPS.
 *
 * `sync-engine-artifacts --fetch-v12-engines` copies the digest-pinned `engine-{devnet,mainnet}.so`,
 * `kitchen.so` and the wire/IDL JSON into `artifacts/svm` next to this module — `dist/artifacts/svm`
 * in an installed package, `src/artifacts/svm` in a from-source tree — and `files: ["sdk/dist"]`
 * carries them into the tarball. This is the ONLY way a downstream consumer gets the engine:
 * `eco-incorp/v12` is private, so the release-fetch path is closed to them. These resolvers are what
 * let a consumer load the gated engine + kitchen into LiteSVM and run their own local e2e tests with
 * no credentials.
 *
 * Each resolver takes an optional explicit path (a locally built engine, a verified cache) and
 * otherwise returns the packaged binary. None reads the environment: a path is configuration, and
 * configuration is passed by the caller.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EngineCluster = "devnet" | "mainnet";

/** Directory holding the packaged SVM binaries, resolved relative to this compiled module. */
export const SVM_ARTIFACTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "svm",
);

/**
 * Explicit artifact paths, each used instead of the packaged binary it names. An unset field falls
 * back to the packaged one.
 */
export interface SvmEngineArtifactPaths {
  engineSo?: string;
  kitchenSo?: string;
  kitchenIdlJson?: string;
}

function required(explicit: string | undefined, name: string, option: string): string {
  const path = explicit ?? resolve(SVM_ARTIFACTS_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      explicit === undefined
        ? `SVM engine artifact '${name}' not found at ${path}. It ships in the published package; ` +
            `from a source checkout run \`pnpm --filter './sdk' sync-engine-artifacts ` +
            `--fetch-v12-engines\`, or pass its path as ${option}.`
        : `SVM engine artifact '${name}' not found at ${path}, the path passed as ${option}.`,
    );
  }
  return path;
}

/**
 * Absolute path to the engine `.so` for a cluster (default `devnet`): `path` when given, else the
 * packaged binary. Throws if absent.
 */
export function svmEnginePath(cluster: EngineCluster = "devnet", path?: string): string {
  return required(path, `engine-${cluster}.so`, "`svmEnginePath(cluster, path)`");
}

/** Absolute path to the kitchen program `.so`: `path` when given, else the packaged one. Throws if
 *  absent. */
export function svmKitchenPath(path?: string): string {
  return required(path, "kitchen.so", "`svmKitchenPath(path)`");
}

/** Absolute path to the kitchen Anchor IDL JSON: `path` when given, else the packaged one. Throws if
 *  absent. */
export function svmKitchenIdlPath(path?: string): string {
  return required(path, "kitchen-idl.json", "`svmKitchenIdlPath(path)`");
}

/** The full set a local LiteSVM harness needs to run a kitchen-gated cook, each piece from `paths`
 *  when given and packaged otherwise. Throws if any piece is absent, so a caller gets one clear error
 *  rather than a partial set. */
export function svmEngineArtifacts(
  cluster: EngineCluster = "devnet",
  paths: SvmEngineArtifactPaths = {},
): Required<SvmEngineArtifactPaths> {
  return {
    engineSo: svmEnginePath(cluster, paths.engineSo),
    kitchenSo: svmKitchenPath(paths.kitchenSo),
    kitchenIdlJson: svmKitchenIdlPath(paths.kitchenIdlJson),
  };
}
