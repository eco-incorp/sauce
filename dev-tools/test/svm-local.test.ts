/**
 * Local SVM e2e smoke: boot the packaged gated engine in-process and run a program through a kitchen
 * cook — the local orchestration a developer uses to e2e-test their SVM programs (dev-tools/README).
 * Run with: npm --filter './dev-tools' test.
 *
 * Skips when no engine binary is resolvable (a bare checkout with neither `--fetch-v12-engines` nor an
 * installed package), so it never hard-fails a credential-less run — the same gate the SDK suites use.
 */
import { compile } from "sauce-compiler";

import { svmEnginePath } from "@eco-incorp/sauce-source/svm/engine-artifacts";
import { runSvmProgramLocally } from "../src/svm-local";

// CI exports its verified cache paths; the SDK reads no environment, so the test passes them in.
const artifacts = {
  engineSo: process.env.SAUCE_ENGINE_SO ?? process.env.SAUCE_RUST_ENGINE_SO,
  kitchenSo: process.env.SAUCE_KITCHEN_SO,
  kitchenIdlJson: process.env.SAUCE_KITCHEN_IDL_JSON,
};

const engineAvailable = (): boolean => {
  try {
    svmEnginePath("devnet", artifacts.engineSo);
    return true;
  } catch {
    return false;
  }
};

async function main(): Promise<void> {
  if (!engineAvailable()) {
    console.log(
      "svm-local: no engine binary — run `pnpm --filter './sdk' sync-engine-artifacts " +
        "--fetch-v12-engines` (or install the package) — skipped",
    );
    return;
  }

  const { bytecode, manifest } = compile({
    target: "svm",
    entry: "main.ts",
    resolve: (path) =>
      path === "main.ts"
        ? new TextEncoder().encode("function main(): Uint256 { return 42n; }")
        : undefined,
  });
  if (!manifest) throw new Error("SVM compilation must include an account manifest");
  const result = await runSvmProgramLocally(bytecode, manifest, { artifacts });
  if (result.err !== null) {
    console.error(`  ✗ local SVM cook rejected: ${result.err}\n${result.logs.join("\n")}`);
    process.exit(1);
  }
  console.log("  ✓ local SVM e2e: the gated engine ran a kitchen cook in-process");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
