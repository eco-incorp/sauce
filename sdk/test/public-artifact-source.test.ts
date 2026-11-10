import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const table = JSON.parse(readFileSync(join(repo, "sdk/src/deployments/releases.json"), "utf8"));

function fixture(scenario?: string) {
  const root = mkdtempSync(join(tmpdir(), "sauce-public-source-"));
  const script = join(root, "sdk/scripts/sync-engine-artifacts.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(join(repo, "sdk/scripts/sync-engine-artifacts.mjs"), script);
  mkdirSync(join(root, "node_modules/@uniswap"), { recursive: true });
  for (const name of ["viem", "sauce-compiler", "@uniswap/v3-core"])
    symlinkSync(join(repo, "node_modules", name), join(root, "node_modules", name));
  const contents = join(root, "contents/package/sdk/dist");
  mkdirSync(join(contents, "deployments"), { recursive: true });
  cpSync(join(repo, "sdk/dist/artifacts"), join(contents, "artifacts"), { recursive: true });
  const shipped = structuredClone(table);
  shipped.releases = shipped.releases.filter(
    (row: { compiler: string }) => row.compiler !== "2.6.2",
  );
  writeFileSync(join(contents, "deployments/releases.json"), JSON.stringify(shipped));
  const deploymentsPath = join(contents, "artifacts/V12Deployments.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8"));
  deployments.compiler = "2.6.1";
  if (scenario === "derived identity changed")
    deployments.evm.contracts.engine.address = "0x0000000000000000000000000000000000000001";
  writeFileSync(deploymentsPath, JSON.stringify(deployments));
  if (scenario === "asset digest changed") {
    const path = join(contents, "artifacts/V12RuntimeBytecode.json");
    const runtime = JSON.parse(readFileSync(path, "utf8"));
    runtime.runtimeCreationCode = "0x00";
    writeFileSync(path, JSON.stringify(runtime));
  }
  const cache = join(root, "node_modules/.cache/sauce-engine-releases/npm/sauce-1.0.0");
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, "package.tgz");
  execFileSync("tar", ["-czf", archive, "-C", join(root, "contents"), "package"]);
  const local = structuredClone(table);
  const target = local.releases.find((row: { compiler: string }) => row.compiler === "2.6.2");
  target.npm = {
    version: "1.0.0",
    compiler: "2.6.1",
    integrity: `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`,
  };
  const registry = join(root, "sdk/src/deployments/releases.json");
  mkdirSync(dirname(registry), { recursive: true });
  const output = join(root, "sdk/dist/artifacts/V12Deployments.json");
  const run = () => {
    writeFileSync(registry, JSON.stringify(local));
    return spawnSync(process.execPath, [script], {
      env: { ...process.env, SAUCE_ARTIFACT_SOURCE: "npm" },
      encoding: "utf8",
    });
  };
  return { root, local, target, output, run };
}

describe("public artifacts from an explicitly pinned earlier compiler row", () => {
  it("verifies source provenance and emits the target compiler compatibility metadata", () => {
    const f = fixture();
    try {
      const result = f.run();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(f.output, "utf8")).compiler).toBe("2.6.2");
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it.each([
    "unknown source",
    "source row changed",
    "target digest changed",
    "asset digest changed",
    "derived identity changed",
  ])("refuses %s before writing artifacts", (scenario) => {
    const f = fixture(scenario);
    try {
      if (scenario === "unknown source") f.target.npm.compiler = "0.0.0";
      if (scenario === "source row changed")
        f.local.releases.find((row: { compiler: string }) => row.compiler === "2.6.1")[
          "v12-evm"
        ].version = "0.0.0";
      if (scenario === "target digest changed")
        f.target["v12-evm"].assets["runtime.creation.hex"] = `0x${"00".repeat(32)}`;
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refused, nothing written");
      expect(existsSync(f.output)).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
