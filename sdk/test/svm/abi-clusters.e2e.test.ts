import { existsSync, readFileSync } from "node:fs";
import { encodeAbiParameters, hexToBytes } from "viem";
import { compile } from "../../src/compiler.js";
import { execute, expectOk, startEngine, svmArtifactsPresent, toBigInt } from "./engine-harness.js";

/** Both clusters come from the v12-svm release, each pinned by tag AND digest in
 *  `sync-engine-artifacts.mjs`. The digest pin keeps the released binary as the source of truth. */
const ENGINE_SO = {
  devnet: process.env.SAUCE_RUST_ENGINE_SO,
  mainnet: process.env.SAUCE_RUST_ENGINE_MAINNET_SO,
} as const;
const WIRE_JSON = {
  devnet: process.env.SAUCE_ENGINE_WIRE_JSON,
  mainnet: process.env.SAUCE_ENGINE_WIRE_MAINNET_JSON,
} as const;

const CLUSTERS = ["devnet", "mainnet"] as const;
// The harness's own gate (engine, kitchen program, kitchen IDL) AND this suite's per-cluster inputs.
// Checking only the cluster files let a checkout with engines but no kitchen RUN the suite and crash
// on an undefined IDL path instead of skipping.
const clustersPresent =
  svmArtifactsPresent &&
  [...Object.values(ENGINE_SO), ...Object.values(WIRE_JSON)].every(
    (path) => path !== undefined && existsSync(path),
  );

// Engine-gated like every other suite here: skip locally when the release artifacts are absent, and
// fail in CI, which always supplies them. The skip is `describe.skip.each` over the real cluster list
// rather than `describe.each([])`, because jest rejects an empty table as a FAILURE — which made this
// the one engine-gated suite that failed, instead of skipping, on a checkout without the engines.
if (!clustersPresent && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_ENGINE_SO / SAUCE_RUST_ENGINE_MAINNET_SO / SAUCE_ENGINE_WIRE_JSON / " +
      "SAUCE_ENGINE_WIRE_MAINNET_JSON are unset or missing in CI. This suite must never skip here — " +
      'see the "Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const describeClusters = clustersPresent ? describe.each(CLUSTERS) : describe.skip.each(CLUSTERS);

describeClusters("ABI argument package on %s", (cluster) => {
  const engineSo = ENGINE_SO[cluster];
  const wireJson = WIRE_JSON[cluster];
  const source = `function main(rows: Uint256[][], i: Uint256): Uint256 {
    const row = rows[i];
    row[0] = row[0] + 3;
    return row[0] + rows[i][1] + ctx.chainId();
  }`;
  const artifact = compile({
    target: "svm",
    resolve: () => new TextEncoder().encode(source),
  });
  const args = hexToBytes(
    encodeAbiParameters([{ type: "uint256[][]" }, { type: "uint256" }], [[[], [5n, 7n]], 1n]),
  );
  const payload = (data: Uint8Array) => ({
    bytecode: Uint8Array.from([...artifact.bytecode, ...data]),
    manifest: artifact.manifest!,
  });

  it("executes ABI argument decoding, checked SET_ELEMENT mutation and the correct cluster ID", async () => {
    const harness = await startEngine(1_700_000_000n, engineSo as string);
    const result = expectOk(await execute(harness, payload(args), {}));
    const expected = cluster === "mainnet" ? 1399811149n : 1399811150n;
    expect(toBigInt(result.returnData)).toBe(expected + 15n);
    const wire = JSON.parse(readFileSync(wireJson as string, "utf8"));
    expect(wire.chainId).toBe(Number(expected));
    expect(wire.isa.revision).toBe(artifact.isaRevision);
  });
});
