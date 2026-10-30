import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import { loadLocalCandidate } from "../scripts/lib/local-candidate-artifacts.mjs";
import { readInstalledCompilerProvenance } from "../scripts/lib/compiler-provenance.mjs";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidatePath = process.env.SAUCE_LOCAL_CANDIDATE_MANIFEST;
const describeCandidate = candidatePath ? describe : describe.skip;

// Positive cases use the runtime build's real manifest, never invented executable bytes.
describeCandidate("LOCAL CREATE3 candidate artifacts", () => {
  it("ingests the actual paired profile without changing historical releases or SVM artifacts", () => {
    const releases = readFileSync(join(SDK, "src/deployments/releases.json"));
    const svm = readFileSync(join(SDK, "src/artifacts/svm/kitchen.so"));
    const loaded = loadLocalCandidate(candidatePath!);
    expect(loaded.artifacts.V12EngineGate.scheme).toBe("create3");
    expect(loaded.artifacts.V12EngineGate.potInitCodeHash).toBeUndefined();
    expect(loaded.artifacts.V12PotProfile).toEqual(loaded.binding.profile);
    expect(loaded.binding.router).toBe(loaded.artifacts.V12EngineGate.fixedRouter);
    expect(loaded.binding.engine).toBe(getAddress(loaded.deployments.contracts.engine.address));
    expect(loaded.binding.release.compiler).toBe(loaded.binding.compiler);
    expect(loaded.binding.release.router).toBe(loaded.binding.router);
    expect(loaded.binding.release["v12-evm"]).toMatch(/^LOCAL:/);
    expect(loaded.binding.release["kitchen-evm"]).toMatch(/^LOCAL:/);
    expect(loaded.binding.release.compilerWasmSha256).toBe(
      readInstalledCompilerProvenance().wasmSha256,
    );
    expect(Object.keys(loaded.artifacts).some((name) => name.includes("svm"))).toBe(false);
    expect(readFileSync(join(SDK, "src/deployments/releases.json"))).toEqual(releases);
    expect(readFileSync(join(SDK, "src/artifacts/svm/kitchen.so"))).toEqual(svm);
  });

  it.each(["compiler", "compilerWasmSha256", "release.compilerWasmSha256"])(
    "rejects mismatched actual compiler provenance in %s",
    (field) => {
      const manifest = JSON.parse(readFileSync(candidatePath!, "utf8"));
      if (field === "release.compilerWasmSha256")
        manifest.release.compilerWasmSha256 = "00".repeat(32);
      else manifest[field] = field === "compiler" ? "uninstalled-compiler" : "00".repeat(32);
      const directory = mkdtempSync(join(tmpdir(), "sauce-local-compiler-"));
      try {
        manifest.assets = Object.fromEntries(
          Object.entries(manifest.assets).map(([name, asset]) => {
            const value = asset as { path: string; sha256: string };
            return [name, { ...value, path: resolve(dirname(candidatePath!), value.path) }];
          }),
        );
        const path = join(directory, "manifest.json");
        writeFileSync(path, JSON.stringify(manifest));
        expect(() => loadLocalCandidate(path)).toThrow(
          /compiler.*mismatch|compiler.*does not match/i,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each(["engine", "router", "kitchen"])(
    "rejects a mismatched %s before writing artifacts",
    (field) => {
      const manifest = JSON.parse(readFileSync(candidatePath!, "utf8"));
      manifest[field] =
        field === "kitchen"
          ? "0x0000000000000000000000000000000000000001"
          : { ...manifest[field], address: "0x0000000000000000000000000000000000000001" };
      const directory = mkdtempSync(join(tmpdir(), "sauce-local-candidate-"));
      try {
        // Resolve paths before moving only the manifest to its mutation directory.
        manifest.assets = Object.fromEntries(
          Object.entries(manifest.assets).map(([name, asset]) => {
            const value = asset as { path: string; sha256: string };
            return [name, { ...value, path: resolve(dirname(candidatePath!), value.path) }];
          }),
        );
        const path = join(directory, "manifest.json");
        writeFileSync(path, JSON.stringify(manifest));
        expect(() => loadLocalCandidate(path)).toThrow(/mismatch|does not match|derives/i);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects profile immutable layout drift even with an updated file digest", () => {
    const directory = mkdtempSync(join(tmpdir(), "sauce-local-profile-"));
    try {
      const manifest = JSON.parse(readFileSync(candidatePath!, "utf8"));
      manifest.assets = Object.fromEntries(
        Object.entries(manifest.assets).map(([name, asset]) => {
          const value = asset as { path: string; sha256: string };
          return [name, { ...value, path: resolve(dirname(candidatePath!), value.path) }];
        }),
      );
      const profile = JSON.parse(readFileSync(manifest.assets.potProfile.path, "utf8"));
      profile.immutableReferences.owner[0].start += 1;
      const bytes = Buffer.from(JSON.stringify(profile));
      const profilePath = join(directory, "pot-profile.json");
      writeFileSync(profilePath, bytes);
      manifest.assets.potProfile = {
        path: profilePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      const path = join(directory, "manifest.json");
      writeFileSync(path, JSON.stringify(manifest));
      expect(() => loadLocalCandidate(path)).toThrow(/profile|immutable|layout/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("LOCAL candidate boundary", () => {
  it("does not reinterpret a published artifact as a candidate manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "sauce-not-a-candidate-"));
    try {
      const path = join(directory, "gate.json");
      writeFileSync(path, JSON.stringify({ scheme: "create3" }));
      expect(() => loadLocalCandidate(path)).toThrow(/LOCAL|schema|candidate/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
