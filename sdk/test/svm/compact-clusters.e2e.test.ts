import { existsSync, readFileSync } from "node:fs";
import { compile, encodeCompactArguments } from "../../src/compiler.js";
import { execute, expectFail, expectOk, startEngine, toBigInt } from "./engine-harness.js";

/** Both clusters come from the v12-svm release, each pinned by tag AND digest in
 *  `sync-engine-artifacts.mjs`. They were briefly committed under `vendor/performance` while the
 *  engine carrying UNPACK was unreleased; a checked-in binary is a second source of truth that the
 *  digest pin exists precisely to avoid. */
const ENGINE_SO = {
  devnet: process.env.SAUCE_RUST_ENGINE_SO,
  mainnet: process.env.SAUCE_RUST_ENGINE_MAINNET_SO,
} as const;
const WIRE_JSON = {
  devnet: process.env.SAUCE_ENGINE_WIRE_JSON,
  mainnet: process.env.SAUCE_ENGINE_WIRE_MAINNET_JSON,
} as const;

const describeClusters = [...Object.values(ENGINE_SO), ...Object.values(WIRE_JSON)].every(
  (path) => path !== undefined && existsSync(path),
)
  ? describe.each(["devnet", "mainnet"] as const)
  : describe.each([] as ("devnet" | "mainnet")[]);

describeClusters("compact package on %s", (cluster) => {
  const engineSo = ENGINE_SO[cluster];
  const wireJson = WIRE_JSON[cluster];
  const source = `function main(rows: Uint256[][], i: Uint256): Uint256 {
    const row = rows[i];
    row[0] = row[0] + 3;
    return row[0] + rows[i][1] + ctx.chainId();
  }`;
  const artifact = compile({
    target: "svm",
    compactArgs: true,
    resolve: () => new TextEncoder().encode(source),
  });
  const args = encodeCompactArguments(artifact.entrySchema!, [[[], [5n, 7n]], 1n]);
  const payload = (data: Uint8Array) => ({
    bytecode: Uint8Array.from([...artifact.bytecode, ...data]),
    manifest: artifact.manifest!,
  });

  it("executes UNPACK, checked SET_ELEMENT mutation and the correct cluster ID", async () => {
    const harness = await startEngine(1_700_000_000n, engineSo as string);
    const result = expectOk(await execute(harness, payload(args), {}));
    const expected = cluster === "mainnet" ? 1399811149n : 1399811150n;
    expect(toBigInt(result.returnData)).toBe(expected + 15n);
    const wire = JSON.parse(readFileSync(wireJson as string, "utf8"));
    expect(wire.chainId).toBe(Number(expected));
    expect(wire.isa.revision).toBe(artifact.isaRevision);
  });

  it("rejects a truncated compact suffix", async () => {
    const harness = await startEngine(1_700_000_000n, engineSo as string);
    expectFail(await execute(harness, payload(args.slice(0, -1)), {}));
  });
});
