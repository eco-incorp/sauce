import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { encodeAbiParameters, type Hex } from "viem";
import type { CompileOptions, CompileResult } from "sauce-compiler";
import { local, type TestChain } from "../../src/testing/index.js";
import { buildSauceEvmCall } from "../../src/testing/sdk.js";

const { compile } = createRequire(import.meta.url)("sauce-compiler") as {
  compile(options: CompileOptions): CompileResult;
};
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const factory = "0x00000000000000000000000000000000000000f1";
const maxAddress = (1n << 160n) - 1n;

describe("guarded raw-word examples on the released engine", () => {
  let chain: TestChain;
  before(async () => {
    chain = await local();
    await chain.deployPot();
    // Even dirty words' masked targets return successfully, so only the guard can reject them.
    for (const address of [
      factory,
      "0x000000000000000000000000000000000000beef",
      "0xffffffffffffffffffffffffffffffffffffffff",
    ] as const) {
      await chain.test.setCode({ address, bytecode: "0x600160005260206000f3" });
    }
  });
  after(() => chain?.stop());

  for (const name of ["call", "erc20"]) {
    for (const spelling of ["js", "ts"]) {
      for (const optimize of [false, true]) {
        it(`${name}.${spelling}, optimize=${optimize}: checks raw address words before effects`, async () => {
          const source = readFileSync(join(root, "sauce", spelling, `${name}.${spelling}`));
          const resolveModule = (path: string) => {
            const key = path.replace(/^\.\//, "");
            if (key === "main.js") return source;
            for (const dir of [root, join(root, "node_modules")]) {
              const file = join(dir, key);
              if (existsSync(file)) return readFileSync(file);
            }
            return undefined;
          };
          const options: CompileOptions = {
            target: "evm",
            entry: "main.js",
            optimize,
            resolve: resolveModule,
          };
          const result = compile(options);
          const twin = spelling === "js" ? "ts" : "js";
          const twinSource = readFileSync(join(root, "sauce", twin, `${name}.${twin}`));
          const other = compile({
            ...options,
            resolve: (path) =>
              path.replace(/^\.\//, "") === "main.js" ? twinSource : resolveModule(path),
          });
          assert.deepEqual(result.bytecode, other.bytecode);
          assert.deepEqual(result.entryParams, other.entryParams);
          assert.deepEqual(
            result.entryParams.map((p) => p.type),
            name === "call" ? ["uint256", "uint256", "uint256"] : ["uint256", "uint256"],
          );
          const args = name === "call" ? [BigInt(factory), maxAddress, 0n] : [maxAddress, 0n];
          const cook = async (values: bigint[]) => {
            const payload = (`0x${Buffer.from(result.bytecode).toString("hex")}` +
              encodeAbiParameters(result.entryParams, values).slice(2)) as Hex;
            const call = buildSauceEvmCall({
              pot: chain.account().pot,
              engine: chain.engine,
              program: payload,
              value: 0n,
            });
            return chain.client.call({
              account: chain.account().address,
              to: call.to,
              data: call.data,
              gas: 5_000_000n,
            });
          };
          assert.equal(BigInt((await cook(args)).data!), 1n);
          for (const slot of name === "call" ? [0, 1, 2] : [0]) {
            for (const word of [(1n << 160n) + 0xbeefn, (1n << 256n) - 1n]) {
              const dirty = args.map((value, i) => (i === slot ? word : value));
              await assert.rejects(cook(dirty), /revert/i);
            }
          }
          assert.equal(BigInt((await cook(args)).data!), 1n);
        });
      }
    }
  }
});
