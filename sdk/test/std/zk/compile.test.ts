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
import { ERC1271_HANDLER } from "../../../src/routes/erc1271.js";
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
const PROOF_CALLBACK = "handleProof(bytes32,bytes,bytes)";

/** A proof request as a program makes one. */
const RISC0 = `import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, input: bytes, maxPrice: Uint256): void {
  Zk.risc0({
    imageId,
    imageUrl,
    input,
    offer: { maxPrice, rampUpPeriod: 60, lockTimeout: 600, timeout: 1200, lockCollateral: 0 },
  })
    .then((journal) => {
      evm.sstore(0x01, journal.length);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}`;

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

  it("declares a handler per callback, each on the chains its protocol is on", () => {
    expect(MANIFEST.handlers).toEqual([
      {
        selector: CALLBACK,
        program: "sql.handler.js",
        readOnly: false,
        requires: ["SpaceAndTime.CallbackExecutor"],
      },
      {
        selector: PROOF_CALLBACK,
        program: "risc0.handler.js",
        readOnly: false,
        requires: ["Boundless.Market"],
      },
      // The core's one ERC-1271 handler, as the core declares it, where Boundless's market is.
      { ...ERC1271_HANDLER, requires: ["Boundless.Market"] },
    ]);
    expect(toFunctionSelector(PROOF_CALLBACK)).toBe("0xa12da43f");
  });

  it.each([
    "submitRequest((uint256,((address,uint96),(uint8,bytes),bytes4),string,(uint8,bytes),(uint256,uint256,uint64,uint32,uint32,uint32,uint256)),bytes)",
    "eip712DomainSeparator()",
    "requestIsLocked(uint256)",
    "requestIsFulfilled(uint256)",
    "slash(uint256)",
    "withdraw(uint256)",
  ])(
    "Boundless's %s: its selector derived from its signature, in a request's bytecode",
    (signature) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      expect(hex(compile(RISC0).bytecode)).toContain(selector);
    },
  );

  it("the EIP-712 type hashes are the market's type strings, each with the types it references", () => {
    const CALLBACK_TYPE = "Callback(address addr,uint96 gasLimit)";
    const INPUT_TYPE = "Input(uint8 inputType,bytes data)";
    const OFFER_TYPE =
      "Offer(uint256 minPrice,uint256 maxPrice,uint64 rampUpStart,uint32 rampUpPeriod,uint32 lockTimeout,uint32 timeout,uint256 lockCollateral)";
    const PREDICATE_TYPE = "Predicate(uint8 predicateType,bytes data)";
    const REQUIREMENTS_TYPE = "Requirements(Callback callback,Predicate predicate,bytes4 selector)";
    const PROOF_REQUEST_TYPE =
      "ProofRequest(uint256 id,Requirements requirements,string imageUrl,Input input,Offer offer)";
    for (const [name, type] of [
      ["CALLBACK", CALLBACK_TYPE],
      ["PREDICATE", PREDICATE_TYPE],
      ["REQUIREMENTS", REQUIREMENTS_TYPE + CALLBACK_TYPE + PREDICATE_TYPE],
      ["INPUT", INPUT_TYPE],
      ["OFFER", OFFER_TYPE],
      [
        "PROOF_REQUEST",
        PROOF_REQUEST_TYPE +
          CALLBACK_TYPE +
          INPUT_TYPE +
          OFFER_TYPE +
          PREDICATE_TYPE +
          REQUIREMENTS_TYPE,
      ],
    ]) {
      expect(SOURCE).toContain(`const SAUCE_ZK_${name}_TYPEHASH = ${keccak256(toHex(type!))};`);
    }
    expect(SOURCE).toContain(`const SAUCE_ZK_RISC0 = ${keccak256(toHex("sauce.zk.risc0"))};`);
    const inner = BigInt(keccak256(toHex("sauce.storage.ZkRisc0"))) - 1n;
    const location =
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
    expect(SOURCE).toContain(
      `const SAUCE_ZK_RISC0_NAMESPACE = 0x${location.toString(16).padStart(64, "0")};`,
    );
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

  it("the SDK installs every handler on Base, with @sauce/async's expire", () => {
    const install = packageInstall("base", "@sauce/zk");
    expect(install.handlers.map((handler) => handler.signature)).toEqual([
      CALLBACK,
      PROOF_CALLBACK,
      "isValidSignature(bytes32,bytes)",
      "expire(bytes32)",
    ]);
    expect(install.handlers.find((h) => h.signature.startsWith("isValid"))!.readOnly).toBe(true);
    expect(install.skipped).toEqual([]);
  });

  it("the SDK skips Boundless's handlers on Ethereum, which has no market", () => {
    const install = packageInstall("ethereum", "@sauce/zk");
    expect(install.handlers.map((handler) => handler.signature)).toEqual([
      CALLBACK,
      "expire(bytes32)",
    ]);
    expect(install.skipped.map((s) => s.missing)).toEqual(["Boundless.Market", "Boundless.Market"]);
  });

  it("the SDK skips every handler on a chain with neither", () => {
    const install = packageInstall("arbitrum", "@sauce/zk");
    expect(install.handlers.map((handler) => handler.signature)).toEqual(["expire(bytes32)"]);
    expect(install.skipped.map((s) => s.missing)).toEqual([
      "SpaceAndTime.CallbackExecutor",
      "Boundless.Market",
      "Boundless.Market",
    ]);
  });

  it("Boundless's callback handler, on Base, names its market", () => {
    const callback = compile(readFileSync(join(DIR, "risc0.handler.js"), "utf8"), "base");
    expect(hex(callback.bytecode)).toContain("fd152dadc5183870710fe54f939eae3ab9f0fe82");
  });

  it("approves a request's hash with @sauce/async's ERC-1271, whose one handler answers for it", () => {
    expect(SOURCE).toContain("approveHash(");
    const install = packageInstall("base", "@sauce/zk");
    const erc1271 = install.handlers.find((h) => h.signature.startsWith("isValidSignature"))!;
    expect(erc1271.program).toBe("@sauce/async/erc1271.handler.js");
  });

  it("a query's `.catch` with Zk.cancel names no Boundless contract on Ethereum, which has none", () => {
    expect(hex(compile(QUERY, "ethereum").bytecode)).not.toContain(
      toFunctionSelector("slash(uint256)").slice(2),
    );
  });

  it("a proof request on Base, and not on Ethereum", () => {
    expect(compile(RISC0, "base").bytecode.length).toBeGreaterThan(0);
    expect(() => compile(RISC0, "ethereum")).toThrow(/Boundless/);
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
    [
      "an unknown field",
      "query: plan, payment, version: 1",
      "`version` is not a member of `SqlQuery`",
    ],
    ["a query without its payment", "query: plan", "`Zk.sql` needs `query`"],
    ["a payment without its query", "payment", "`Zk.sql` needs `query`"],
  ])("%s", (_, fields, message) => {
    expect(() => compile(query(fields))).toThrow(message);
  });

  it.each([
    [
      "a proof request without its offer",
      "imageId, imageUrl, input",
      "`Zk.risc0` needs `imageId` and `imageUrl`",
    ],
    [
      "an offer without its timeout",
      "imageId, imageUrl, offer: { maxPrice: 1, rampUpPeriod: 1, lockTimeout: 1, lockCollateral: 0 }",
      "`offer` is `{ maxPrice, rampUpPeriod, lockTimeout, timeout, lockCollateral }`",
    ],
    [
      "an unknown field",
      "imageId, imageUrl, offer: {}, journal: 1",
      "`journal` is not a member of `ProofRequest`",
    ],
  ])("%s", (_, fields, message) => {
    expect(() =>
      compile(
        `import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, input: bytes): void {
  Zk.risc0({ ${fields} }).then((journal) => {
    evm.sstore(0x01, journal.length);
  });
}`,
        "base",
      ),
    ).toThrow(message);
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
