/**
 * `@sauce/zk` (sdk/src/std/zk), compiled through the SDK as a program for a chain imports it: what
 * compiles where, what the library spells out by hand, and what it refuses.
 *
 * The library writes its calls raw, so each selector, tag and storage namespace it carries is
 * derived here from its definition and found in the source and the emitted bytecode, and the handler
 * it declares is held to the callback's signature. Execution — a query through Space and Time's own
 * QueryRouter and CallbackExecutor, the callback through the Router's fallback, the body run in the
 * handler's cook, the timeout and the refund — is `sql.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeAbiParameters, keccak256, toFunctionSelector, toHex } from "viem";

import { deployments } from "../../../src/protocols/space-and-time/addresses.js";
import { packageInstall } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const DIR = join(process.cwd(), "src", "std", "zk");
const SOURCE = readFileSync(join(DIR, "zk.evm.js"), "utf8");
const HANDLER = readFileSync(join(DIR, "sql.handler.js"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8")) as {
  handlers: { selector: string; program: string; readOnly?: boolean; requires?: string[] }[];
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);

const CALLBACK = "queryCallback(bytes32,bytes,bytes)";

/** A query as a program asks one, its parts `main`'s arguments. */
const query = (fields: string): string => `import { Zk } from "@sauce/zk";

function main(plan: bytes, payment: Uint256, parameters: bytes): void {
  Zk.sql({ ${fields} })
    .then((result) => {
      evm.sstore(0x01, Zk.cell(result, 0, 0) + Zk.rows(result));
    })
    .catch((e) => {
      Zk.cancel(e);
    });
}`;
const QUERY = query("query: plan, payment");

describe("what the library writes out by hand", () => {
  it.each([
    "requestQuery((bytes32,bytes,bytes,bytes),(uint256,uint64,address,bytes4,bytes),(uint256,address,uint64))",
    "PAYMENT_TOKEN()",
    "cancelQuery(bytes32,(uint256,address,uint64))",
  ])("%s's selector is derived from its signature, and in a query's bytecode", (signature) => {
    const selector = toFunctionSelector(signature).slice(2);
    expect(SOURCE).toContain(`hex\`${selector}\``);
    expect(hex(compile(QUERY).bytecode)).toContain(selector);
  });

  it("names the callback queryCallback(bytes32,bytes,bytes), and Timeout(bytes32) as @sauce/async does", () => {
    expect(SOURCE).toContain(`const SAUCE_ZK_QUERY_CALLBACK = ${toFunctionSelector(CALLBACK)};`);
    expect(SOURCE).toContain(`const SAUCE_ZK_TIMEOUT = ${toFunctionSelector("Timeout(bytes32)")};`);
  });

  it("its tag, its version and its namespace are the hashes it says", () => {
    expect(SOURCE).toContain(`const SAUCE_ZK_SQL = ${keccak256(toHex("sauce.zk.sql"))};`);
    expect(SOURCE).toContain(`const SAUCE_ZK_LATEST = ${keccak256(toHex("latest"))};`);
    const inner = BigInt(keccak256(toHex("sauce.storage.Zk"))) - 1n;
    const location =
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
    expect(SOURCE).toContain(
      `const SAUCE_ZK_NAMESPACE = 0x${location.toString(16).padStart(64, "0")};`,
    );
  });

  it("declares one handler, for the callback, on chains with Space and Time's executor", () => {
    expect(MANIFEST.handlers).toEqual([
      {
        selector: CALLBACK,
        program: "sql.handler.js",
        readOnly: false,
        requires: ["SpaceAndTime.CallbackExecutor"],
      },
    ]);
  });
});

describe("what compiles where", () => {
  it.each(deployments.map((d) => [d.chainName, d.addresses.callbackExecutor!] as const))(
    "the handler, on %s, names the chain's CallbackExecutor",
    (chainName, executor) => {
      const handler = compile(HANDLER, chainName.toLowerCase());
      expect(hex(handler.bytecode)).toContain(executor.slice(2).toLowerCase());
    },
  );

  it.each(["ethereum", "base"])(
    "the SDK installs the handler on %s, with @sauce/async's expire",
    (chain) => {
      const install = packageInstall(chain, "@sauce/zk");
      expect(install.handlers.map((handler) => handler.signature)).toEqual([
        CALLBACK,
        "expire(bytes32)",
      ]);
      expect(install.skipped).toEqual([]);
    },
  );

  it("the SDK skips the handler on a chain without Space and Time", () => {
    const install = packageInstall("arbitrum", "@sauce/zk");
    expect(install.handlers.map((handler) => handler.signature)).toEqual(["expire(bytes32)"]);
    expect(install.skipped).toEqual([
      { selector: CALLBACK, missing: "SpaceAndTime.CallbackExecutor" },
    ]);
  });

  it.each(["ethereum", "base"])("a query, on %s, naming the chain's QueryRouter", (chain) => {
    const router = deployments.find((d) => d.chainName.toLowerCase() === chain)!.addresses
      .queryRouter!;
    expect(hex(compile(QUERY, chain).bytecode)).toContain(router.slice(2).toLowerCase());
  });

  it("a query with every field given", () => {
    expect(
      compile(
        query(
          "query: plan, payment, parameters, metadata: hex`01`, timeout: 600, gasLimit: 400000, maxGasPrice: 30000000000",
        ),
      ).bytecode.length,
    ).toBeGreaterThan(0);
  });

  it("not on a chain without Space and Time", () => {
    expect(() => compile(HANDLER, "arbitrum")).toThrow(/SpaceAndTime/);
    expect(() => compile(QUERY, "arbitrum")).toThrow(/SpaceAndTime/);
  });
});

describe("what it refuses", () => {
  it.each([
    ["an unknown field", "query: plan, payment, version: 1", "`Zk.sql` takes no `version`"],
    ["a query without its payment", "query: plan", "`Zk.sql` needs `query`"],
    ["a payment without its query", "payment", "`Zk.sql` needs `query`"],
  ])("%s", (_, fields, message) => {
    expect(() => compile(query(fields))).toThrow(message);
  });

  it("a query with no body", () => {
    expect(() =>
      compile(`import { Zk } from "@sauce/zk";

function main(plan: bytes, payment: Uint256): void {
  Zk.sql({ query: plan, payment });
}`),
    ).toThrow("a request has no body");
  });
});
