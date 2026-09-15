#!/usr/bin/env node
// Exercise the published entry points from a clean consumer, without workspace
// dependencies or a separately installed compiler hiding a broken bundle.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const work = mkdtempSync(join(tmpdir(), "sauce-package-check-"));
try {
  execFileSync("npm", ["run", "prepack"], { cwd: root, stdio: "inherit" });
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", work],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const [{ filename }] = JSON.parse(output);
  writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(work, filename)],
    {
      cwd: work,
      stdio: "inherit",
    },
  );
  const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
  writeFileSync(
    join(work, "smoke.mjs"),
    `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    import { dirname, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { compile, encodeCompactArguments, decodeCompactArguments } from '${name}/compiler';
    const source = new TextEncoder().encode('function main(x: Uint256): Uint256 { return x + 1; }');
    for (const target of ['evm', 'svm']) {
      const a = compile({ target, compactArgs: true, resolve: () => source });
      assert.equal(a.isaRevision, 'stack-compact-v1');
      assert.equal(a.entryEncoding, 'compact-v1');
      const data = encodeCompactArguments(a.entrySchema, [7n]);
      assert.deepEqual(decodeCompactArguments(a.entrySchema, data), [7n]);
      assert.throws(() => decodeCompactArguments(a.entrySchema, data.slice(0, -1)));
    }
    const root = resolve(dirname(fileURLToPath(import.meta.resolve('${name}/compiler'))), '../..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'engine-performance.json'), 'utf8'));
    for (const [file, expected] of Object.entries(manifest.artifacts)) {
      assert.equal(createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), expected, file);
    }
    for (const cluster of ['devnet', 'mainnet']) {
      const wire = JSON.parse(readFileSync(resolve(root, 'vendor/performance/engine-wire-' + cluster + '.json'), 'utf8'));
      assert.equal(wire.cluster, cluster);
      assert.equal(wire.chainId, cluster === 'mainnet' ? 1399811149 : 1399811150);
      assert.equal(wire.isa.revision, 'stack-compact-v1');
      assert.ok(manifest.artifacts['vendor/performance/engine-' + cluster + '.so']);
    }
    console.log('Clean package install: compact compiler/codec and both cluster artifacts verified');
  `,
  );
  execFileSync(process.execPath, [join(work, "smoke.mjs")], { cwd: work, stdio: "inherit" });
} finally {
  rmSync(work, { recursive: true, force: true });
}
