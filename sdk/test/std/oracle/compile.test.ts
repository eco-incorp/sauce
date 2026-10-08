/**
 * `@sauce/oracle` (sdk/src/std/oracle), compiled through the SDK as a program for a chain imports
 * it: what compiles, what the library spells out by hand, and what it refuses.
 *
 * The library writes its event, its storage namespace and the forwarder's call by hand, so each is
 * derived here from its definition and found in the source and the emitted bytecode. Execution — a
 * request, a report through Chainlink's KeystoneForwarder, the body run in the handler's cook — is
 * `evm.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeAbiParameters, keccak256, toFunctionSelector, toHex } from "viem";

import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const SOURCE = readFileSync(join(process.cwd(), "src", "std", "oracle", "oracle.evm.js"), "utf8");

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);

const REQUEST = `import { Oracle } from "@sauce/oracle";

function main(owner: Address, pair: bytes, limit: Uint256): void {
  Oracle.cre({ owner, args: pair })
    .then((report) => {
      const [price] = abi.decode(report, ["Uint256"]);
      require(price <= limit, "above the limit");
      evm.sstore(1, price);
    })
    .catch((err) => {
      log(err);
    });
}`;

const HANDLER = `import { onReport } from "@sauce/oracle";

function main(caller: Address, value: Uint256, data: bytes): void {
  onReport(Chainlink.KeystoneForwarder, caller, data);
}`;

describe("what the library writes out by hand", () => {
  it("the request event is keccak256 of OracleRequest(bytes32,address,bytes), in the request", () => {
    const topic = keccak256(toHex("OracleRequest(bytes32,address,bytes)")).slice(2);
    expect(SOURCE).toContain(`const ORACLE_REQUEST = 0x${topic};`);
    expect(hex(compile(REQUEST).bytecode)).toContain(topic);
  });

  it("its namespace is ERC-7201's location for sauce.storage.Oracle, in the request", () => {
    const inner = BigInt(keccak256(toHex("sauce.storage.Oracle"))) - 1n;
    const location = (
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn
    )
      .toString(16)
      .padStart(64, "0");
    expect(SOURCE).toContain(`const SAUCE_ORACLE_NAMESPACE = 0x${location};`);
    expect(hex(compile(REQUEST).bytecode)).toContain(location);
  });

  it("the call it answers is IReceiver's onReport(bytes,bytes)", () => {
    expect(SOURCE).toContain(
      `\`onReport(bytes,bytes)\` (${toFunctionSelector("onReport(bytes,bytes)")})`,
    );
  });

  it("a handler compiled for a chain names that chain's forwarder", () => {
    for (const [chain, forwarder] of [
      ["ethereum", "0b93082d9b3c7c97facd250082899bacf3af3885"],
      ["base", "f8344cfd5c43616a4366c34e3eee75af79a74482"],
    ] as const) {
      expect(hex(compile(HANDLER, chain).bytecode)).toContain(forwarder);
    }
  });
});

describe("what compiles", () => {
  it("a request's body and `.catch` are one program for this chain, reading what they capture", () => {
    const program = compile(REQUEST);
    expect(program.bodies).toHaveLength(1);
    expect(program.bodies[0]!.destination.slug).toBe("base");
    expect(program.bodies[0]!.captures).toEqual(["body.limit"]);
  });

  it("`await` folds onto the same `then`, and `args` may be left out", () => {
    const program = compile(`import { Oracle } from "@sauce/oracle";

function main(owner: Address): void {
  await Oracle.cre({ owner });
  evm.sstore(1, 1);
}`);
    expect(program.bodies).toHaveLength(1);
  });

  it("the handler takes the Router's arguments", () => {
    expect(compile(HANDLER).entryParams.map((p) => p.type)).toEqual([
      "Address",
      "Uint256",
      "bytes",
    ]);
  });
});

describe("what it refuses", () => {
  const refuses = (source: string, message: string): void => {
    expect(() => compile(source)).toThrow(message);
  };
  const program = (call: string): string => `import { Oracle } from "@sauce/oracle";

function main(owner: Address): void {
  ${call}.then(() => {});
}`;

  it("a request with no workflow owner", () => {
    refuses(program("Oracle.cre({ args: hex`01` })"), "`Oracle.cre` needs an `owner`");
  });

  it("a field it does not take, by its name", () => {
    refuses(
      program("Oracle.cre({ owner, source: hex`01` })"),
      "`Oracle.cre` takes no `source`: its fields are owner and args",
    );
  });

  it("anything but one object", () => {
    refuses(program("Oracle.cre()"), "`Oracle.cre(...)` takes one object");
    expect(() => compile(program("Oracle.cre(owner)"))).toThrow();
  });

  it("a request with no body", () => {
    refuses(
      `import { Oracle } from "@sauce/oracle";
function main(owner: Address): void {
  Oracle.cre({ owner });
}`,
      "a request has no body",
    );
  });

  it("an import on Solana, where no arm exists", () => {
    expect(() =>
      compile(
        `import { Oracle } from "@sauce/oracle";
function main() {}`,
        "solana",
      ),
    ).toThrow();
  });
});
