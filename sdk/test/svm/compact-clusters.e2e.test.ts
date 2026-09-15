import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, encodeCompactArguments } from "../../src/compiler.js";
import { execute, expectFail, expectOk, startEngine, toBigInt } from "./engine-harness.js";

// Run the packaged binaries themselves. No environment gate: a package without
// either cluster's ELF cannot pass its release validation.
describe.each(["devnet", "mainnet"] as const)("compact package on %s", (cluster) => {
  const root = resolve(process.cwd(), "../vendor/performance");
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
    const harness = await startEngine(1_700_000_000n, resolve(root, `engine-${cluster}.so`));
    const result = expectOk(await execute(harness, payload(args), {}));
    const expected = cluster === "mainnet" ? 1399811149n : 1399811150n;
    expect(toBigInt(result.returnData)).toBe(expected + 15n);
    const wire = JSON.parse(readFileSync(resolve(root, `engine-wire-${cluster}.json`), "utf8"));
    expect(wire.chainId).toBe(Number(expected));
    expect(wire.isa.revision).toBe(artifact.isaRevision);
  });

  it("rejects a truncated compact suffix", async () => {
    const harness = await startEngine(1_700_000_000n, resolve(root, `engine-${cluster}.so`));
    expectFail(await execute(harness, payload(args.slice(0, -1)), {}));
  });
});
