/**
 * `@sauce/zk` (sdk/src/std/zk), compiled through the SDK as a program for a chain imports it: what
 * compiles where, what the library spells out by hand, and what it refuses.
 *
 * The library writes its calls raw, so each selector it carries is derived here from its signature
 * and found in the emitted bytecode, and the handler it declares is held to the callback's
 * signature. Execution — a query through AxiomV2Query's own implementation, its callback through
 * the Router's fallback, the body run in the handler's cook — is `axiom.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { keccak256, toFunctionSelector, toHex } from "viem";

import { deployments } from "../../../src/protocols/axiom-v2/addresses.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const DIR = join(process.cwd(), "src", "std", "zk");
const SOURCE = readFileSync(join(DIR, "zk.evm.js"), "utf8");
const HANDLER = readFileSync(join(DIR, "axiom.handler.js"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8")) as {
  handlers: { selector: string; program: string; readOnly?: boolean }[];
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);

const CALLBACK = "axiomV2Callback(uint64,address,bytes32,uint256,bytes32[],bytes)";
const SEND_QUERY =
  "sendQuery(uint64,bytes32,(uint8,uint16,bytes32[],bytes),(address,bytes),(uint64,uint32,uint256),bytes32,address,bytes)";

/** A query as a program sends one, its parts `main`'s arguments. */
const query = (fields: string): string => `import { Zk } from "@sauce/zk";

function main(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256, vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256): void {
  Zk.axiom({ ${fields} }).then((results) => {
    evm.sstore(0x01, results[0]);
  });
}`;
const QUERY = query(
  "dataQueryHash, dataQuery, computeQuery: { k, resultLen, vkey, computeProof }, maxFeePerGas",
);

describe("what the library writes out by hand", () => {
  it.each([SEND_QUERY, "axiomQueryFee()", "proofVerificationGas()"])(
    "%s's selector is derived from its signature, and in a query's bytecode",
    (signature) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      expect(hex(compile(QUERY).bytecode)).toContain(selector);
    },
  );

  it("its transient slot is keccak256 of sauce.zk.nonce", () => {
    expect(SOURCE).toContain(`const SAUCE_ZK_NONCE = ${keccak256(toHex("sauce.zk.nonce"))};`);
  });

  it("declares one handler, for AxiomV2Query's callback", () => {
    expect(MANIFEST.handlers).toEqual([{ selector: CALLBACK, program: "axiom.handler.js" }]);
    expect(toFunctionSelector(CALLBACK)).toBe("0xdc5cd53c");
    expect(SOURCE).toContain(`(0xed2d9ba0)`);
  });
});

describe("what compiles where", () => {
  it.each(deployments.map((d) => [d.chainName, d.addresses.query!] as const))(
    "the handler, on %s, names the chain's AxiomV2Query",
    (chainName, address) => {
      const handler = compile(HANDLER, chainName.toLowerCase());
      expect(hex(handler.bytecode)).toContain(address.slice(2).toLowerCase());
    },
  );

  it.each(["ethereum", "base"])("a query, on %s", (chain) => {
    expect(compile(QUERY, chain).bytecode.length).toBeGreaterThan(0);
  });

  it("a query of subqueries alone, `{ k: 0, resultLen }`", () => {
    expect(
      compile(query("dataQueryHash, dataQuery, computeQuery: { k: 0, resultLen }, maxFeePerGas"))
        .bytecode.length,
    ).toBeGreaterThan(0);
  });

  it("a query with every field given", () => {
    expect(
      compile(
        query(
          "dataQueryHash, dataQuery, computeQuery: { k, resultLen, vkey, computeProof }, maxFeePerGas, callbackGasLimit: 200000, queryFee: 4000000000000000, refundee: 0x000000000000000000000000000000000000dEaD, salt: 7, sourceChainId: 8453",
        ),
      ).bytecode.length,
    ).toBeGreaterThan(0);
  });

  it("not on a chain AxiomV2Query is not deployed on", () => {
    expect(() => compile(HANDLER, "arbitrum")).toThrow(/AxiomV2/);
    expect(() => compile(QUERY, "arbitrum")).toThrow(/AxiomV2/);
  });
});

describe("what it refuses", () => {
  it.each([
    [
      "an unknown field",
      "dataQueryHash, dataQuery, computeQuery: { k, resultLen }, maxFeePerGas, schema: 1",
      "`Zk.axiom` takes no `schema`",
    ],
    [
      "a query without its gas price",
      "dataQueryHash, dataQuery, computeQuery: { k, resultLen }",
      "`Zk.axiom` needs `dataQueryHash`, `dataQuery` and `computeQuery`",
    ],
    [
      "a compute query without its degree",
      "dataQueryHash, dataQuery, computeQuery: { resultLen }, maxFeePerGas",
      "`computeQuery` is `{ k, resultLen, vkey, computeProof }`",
    ],
  ])("%s", (_, fields, message) => {
    expect(() => compile(query(fields))).toThrow(message);
  });

  it("a query with no body", () => {
    expect(() =>
      compile(`import { Zk } from "@sauce/zk";

function main(dataQueryHash: Uint256, dataQuery: bytes, resultLen: Uint256, maxFeePerGas: Uint256): void {
  Zk.axiom({ dataQueryHash, dataQuery, computeQuery: { k: 0, resultLen }, maxFeePerGas });
}`),
    ).toThrow("a request has no body");
  });
});
