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
 * Every function honors the matching `SAUCE_*` env override first — that is how CI points the suite
 * at its verified cache — then falls back to the packaged binary.
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

function required(envPath: string | undefined, name: string, envHint: string): string {
  const path = envPath ?? resolve(SVM_ARTIFACTS_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      `SVM engine artifact '${name}' not found at ${path}. It ships in the published package; from a ` +
        `source checkout run \`pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines\`, or set ` +
        `${envHint}.`,
    );
  }
  return path;
}

/** Absolute path to the packaged engine `.so` for a cluster (default `devnet`). Throws if absent. */
export function svmEnginePath(cluster: EngineCluster = "devnet"): string {
  const env =
    cluster === "mainnet"
      ? process.env.SAUCE_RUST_ENGINE_MAINNET_SO
      : (process.env.SAUCE_ENGINE_SO ?? process.env.SAUCE_RUST_ENGINE_SO);
  const hint = cluster === "mainnet" ? "SAUCE_RUST_ENGINE_MAINNET_SO" : "SAUCE_RUST_ENGINE_SO";
  return required(env, `engine-${cluster}.so`, hint);
}

/** Absolute path to the packaged kitchen program `.so`. Throws if absent. */
export function svmKitchenPath(): string {
  return required(process.env.SAUCE_KITCHEN_SO, "kitchen.so", "SAUCE_KITCHEN_SO");
}

/** Absolute path to the packaged kitchen Anchor IDL JSON. Throws if absent. */
export function svmKitchenIdlPath(): string {
  return required(process.env.SAUCE_KITCHEN_IDL_JSON, "kitchen-idl.json", "SAUCE_KITCHEN_IDL_JSON");
}

/** The full packaged set a local LiteSVM harness needs to run a kitchen-gated cook. Throws if any
 *  piece is absent, so a caller gets one clear error rather than a partial set. */
export function svmEngineArtifacts(cluster: EngineCluster = "devnet"): {
  engineSo: string;
  kitchenSo: string;
  kitchenIdlJson: string;
} {
  return {
    engineSo: svmEnginePath(cluster),
    kitchenSo: svmKitchenPath(),
    kitchenIdlJson: svmKitchenIdlPath(),
  };
}
