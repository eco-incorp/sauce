/**
 * `sauce where`: one program compiled for many chains, with nothing reached — the chains it
 * compiles on with its size, and the ones it does not, grouped by the reason.
 */
import { readFileSync } from "node:fs";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo } from "../src/cli/run.js";
import { whereCommand } from "../src/cli/where.js";

const files = nodeIo();
const file = "../docs/examples/pay.sauce.ts";
const text = readFileSync(file, "utf8");

describe("sauce where", () => {
  it("lists the chains a program compiles on, and why the others refuse", () => {
    const out = whereCommand({ file, text }, files);
    const json = out.json as {
      compiles: number;
      chains: { chain: string; compiles: boolean; reason?: string }[];
    };
    const by = new Map(json.chains.map((each) => [each.chain, each]));
    expect(by.get("base")).toMatchObject({ compiles: true });
    expect(by.get("solana")?.compiles).toBe(true);
    expect(by.get("bsc")).toMatchObject({ compiles: false, reason: "`USDC` is not a token there" });
    expect(out.text).toMatch(/✓ base +evm {2}supported {2}\d+ bytes/);
    expect(out.text).toMatch(/✗ `USDC` is not a token there \(\d+\): .*bsc/);
  });

  it("takes the chains named, or only the supported ones", () => {
    const some = whereCommand(
      { file, text, chains: [requireChain("base"), requireChain("bsc")] },
      files,
    ).json as { compiles: number; chains: unknown[] };
    expect(some).toMatchObject({ compiles: 1 });
    expect(some.chains).toHaveLength(2);
    const supported = whereCommand({ file, text, supported: true }, files).json as {
      chains: { support: string }[];
    };
    expect(supported.chains.every((each) => each.support === "supported")).toBe(true);
  });
});
