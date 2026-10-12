/**
 * `@sauce/signed` (sdk/src/std/signed), compiled through the SDK, and the TypeScript that signs for
 * it (`routes/signed.ts`): what the library spells out by hand, derived here from its definition,
 * and the SDK's side held to the same values.
 *
 * Execution — a signature checked, a salt used, a program run as the Pot, every refusal — is
 * `evm.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  toFunctionSelector,
  toHex,
  type Hex,
} from "viem";

import { packageHandlers, packageReader } from "../../../src/routes/handlers.js";
import { ERC1271_HANDLER, potMessageTypedData } from "../../../src/routes/erc1271.js";
import { ASYNC_INSTALLED_DEFINE, compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  SIGNED_NAMESPACE,
  cancelSaltsSource,
  encodeExecuteAcross,
  executeAcrossTypedData,
  executeTypedData,
  executionHash,
  signedSaltSlot,
} from "../../../src/routes/signed.js";

/** jest's cwd is `sdk/`. */
const DIR = join(process.cwd(), "src", "std", "signed");
const SOURCE = readFileSync(join(DIR, "signed.evm.js"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8")) as {
  handlers: { selector: string; program: string; readOnly: boolean }[];
  promises?: boolean;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);
const constant = (name: string): string => {
  const match = new RegExp(`const ${name} = (0x[0-9a-f]{64});`).exec(SOURCE);
  if (match === null) throw new Error(`no ${name} in signed.evm.js`);
  return match[1]!;
};

const POT = "0x00000000000000000000000000000000000000a1" as const;
const PROGRAM: Hex = "0xc0ffee";
const SALT: Hex = `0x${"00".repeat(31)}05`;

describe("what the library writes out by hand", () => {
  it("its namespace is ERC-7201's location for sauce.storage.Signed, the SDK's too", () => {
    const inner = BigInt(keccak256(toHex("sauce.storage.Signed"))) - 1n;
    const location = toHex(
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn,
      { size: 32 },
    );
    expect(constant("SAUCE_SIGNED_NAMESPACE")).toBe(location);
    expect(SIGNED_NAMESPACE).toBe(location);
  });

  it.each([
    [
      "SAUCE_SIGNED_DOMAIN",
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    ],
    [
      "SAUCE_SIGNED_DOMAIN_ACROSS",
      "EIP712Domain(string name,string version,address verifyingContract)",
    ],
    ["SAUCE_SIGNED_NAME", "Sauce Pot"],
    ["SAUCE_SIGNED_VERSION", "1"],
    ["SAUCE_SIGNED_EXECUTE", "Execute(bytes program,bytes32 salt,uint256 deadline)"],
    [
      "SAUCE_SIGNED_EXECUTION",
      "Execution(uint256 chainId,bytes program,bytes32 salt,uint256 deadline)",
    ],
    [
      "SAUCE_SIGNED_EXECUTIONS",
      "Executions(Execution[] executions)Execution(uint256 chainId,bytes program,bytes32 salt,uint256 deadline)",
    ],
    ["SAUCE_SIGNED_CANCELLED", "SaltsCancelled(uint256,uint256)"],
  ])("%s is keccak256 of %s", (name, text) => {
    expect(constant(name)).toBe(keccak256(toHex(text)));
  });

  it("the malleability bound is half of secp256k1's order", () => {
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    expect(BigInt(constant("SAUCE_SIGNED_HALF_ORDER"))).toBe(order / 2n);
  });

  it.each([
    ["owner()", "execute"],
    ["inFlightEngine()", "execute"],
    ["isValidSignature(bytes32,bytes)", "execute"],
    ["execute(bytes,bytes32,uint256,bytes)", "submit"],
  ])(
    "%s's selector is derived from its signature, and in the bytecode of `%s`",
    (signature, call) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      const program = compile(`import { execute, submit } from "@sauce/signed";
function main(pot: Address, program: bytes, salt: Uint256, deadline: Uint256, signature: bytes): bytes {
  return ${call === "submit" ? "submit(pot, program, salt, deadline, signature)" : "execute(program, salt, deadline, signature)"};
}`);
      expect(hex(program.bytecode)).toContain(selector);
    },
  );
});

describe("the handlers", () => {
  it.each(["base", "ethereum"])(
    "compile for %s, with no `expire`: the package parks no promise",
    (chain) => {
      expect(MANIFEST.promises).toBe(false);
      const handlers = packageHandlers(chain, "@sauce/signed");
      expect(
        handlers.map(({ signature, selector, readOnly }) => [signature, selector, readOnly]),
      ).toEqual(
        MANIFEST.handlers.map(({ selector, readOnly }) => [
          selector,
          toFunctionSelector(selector),
          readOnly,
        ]),
      );
      for (const handler of handlers) expect(handler.bytecode.length).toBeLessThan(24_555);
    },
  );

  it("isValidSignature is a view, and the two that run a program are cooks", () => {
    expect(
      Object.fromEntries(MANIFEST.handlers.map(({ selector, readOnly }) => [selector, readOnly])),
    ).toEqual({
      "execute(bytes,bytes32,uint256,bytes)": false,
      "executeAcross(bytes,bytes32,uint256,bytes32[],uint256,bytes)": false,
      "isValidSignature(bytes32,bytes)": true,
    });
  });

  it("isValidSignature is @sauce/async's one ERC-1271 handler, byte for byte", () => {
    const declared = MANIFEST.handlers.find(
      ({ selector }) => selector === "isValidSignature(bytes32,bytes)",
    );
    expect(declared).toEqual(ERC1271_HANDLER);
    const ours = packageHandlers("base", "@sauce/signed").find(
      ({ signature }) => signature === "isValidSignature(bytes32,bytes)",
    );
    const core = compile(packageReader("@sauce/signed")(declared!.program)!);
    expect(hex(ours!.bytecode)).toBe(hex(core.bytecode));
  });

  it("Signed's Handlers are the programs the handler files compile to, byte for byte", () => {
    const program = compile(`import { Signed } from "@sauce/signed";
function main(salt: Uint256): void {
  Signed.cancel(salt);
}`);
    const files = packageHandlers("base", "@sauce/signed");
    expect(program.handlers.map((h) => [h.selector, h.readOnly])).toEqual(
      files.map((file) => [BigInt(file.selector), file.readOnly]),
    );
    for (const handler of program.handlers) {
      const file = files.find((f) => BigInt(f.selector) === handler.selector)!;
      expect(hex(handler.bytecode)).toBe(hex(file.bytecode));
    }
  });

  it("an owner cook with Signed carries the handlers to install, and none once they are in place", () => {
    const source = `import { Signed } from "@sauce/signed";
function main(salt: Uint256): void {
  Signed.cancel(salt);
}`;
    const carried = compile(source);
    for (const handler of carried.handlers) {
      expect(hex(carried.bytecode)).toContain(hex(handler.bytecode));
    }
    const lean = compileSauceProgram("base", source, { defines: { [ASYNC_INSTALLED_DEFINE]: 1n } });
    for (const handler of carried.handlers) {
      expect(hex(lean.bytecode)).not.toContain(hex(handler.bytecode));
    }
  });

  it("each handler reads `main(caller, value, data)`", () => {
    for (const { program } of MANIFEST.handlers) {
      const handler = compile(packageReader("@sauce/signed")(program)!);
      expect(handler.entryParams.map((p) => p.type)).toEqual(["Address", "Uint256", "bytes"]);
    }
  });

  it("a program the owner cooks cancels salts, and reads one", () => {
    const program = compile(`import { cancel, invalidate, isUsed } from "@sauce/signed";
function main(salt: Uint256): bool {
  cancel(salt);
  invalidate(salt >> 8, 6);
  return isUsed(salt);
}`);
    expect(program.bytecode.length).toBeGreaterThan(0);
  });

  it("is EVM only: an SVM program cannot import it", () => {
    expect(() =>
      compile(
        `import { cancel } from "@sauce/signed";
cancel(1);`,
        "solana",
      ),
    ).toThrow(/failed to import module "@sauce\/signed"/);
  });
});

describe("the SDK's side", () => {
  it("signs the typed data the Pot hashes: Execute under the Pot's domain", () => {
    const typed = executeTypedData({
      pot: POT,
      chainId: 8453,
      program: PROGRAM,
      salt: SALT,
      deadline: 9n,
    });
    const domain = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
        ],
        [
          constant("SAUCE_SIGNED_DOMAIN") as Hex,
          constant("SAUCE_SIGNED_NAME") as Hex,
          constant("SAUCE_SIGNED_VERSION") as Hex,
          8453n,
          POT,
        ],
      ),
    );
    const message = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [constant("SAUCE_SIGNED_EXECUTE") as Hex, keccak256(PROGRAM), SALT, 9n],
      ),
    );
    expect(hashTypedData(typed)).toBe(keccak256(`0x1901${domain.slice(2)}${message.slice(2)}`));
  });

  it("hashes one execution per chain as the Pot does, and signs their list under no chain", () => {
    const executions = [
      { chainId: 8453, program: PROGRAM, salt: SALT, deadline: 9n },
      { chainId: 1, program: "0x01" as Hex, salt: SALT, deadline: 10n },
    ];
    const hashes = executions.map(executionHash);
    expect(hashes[0]).toBe(
      keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "uint256" },
          ],
          [constant("SAUCE_SIGNED_EXECUTION") as Hex, 8453n, keccak256(PROGRAM), SALT, 9n],
        ),
      ),
    );
    const domain = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
        [
          constant("SAUCE_SIGNED_DOMAIN_ACROSS") as Hex,
          constant("SAUCE_SIGNED_NAME") as Hex,
          constant("SAUCE_SIGNED_VERSION") as Hex,
          POT,
        ],
      ),
    );
    const message = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [
          constant("SAUCE_SIGNED_EXECUTIONS") as Hex,
          keccak256(`0x${hashes.map((hash) => hash.slice(2)).join("")}`),
        ],
      ),
    );
    expect(hashTypedData(executeAcrossTypedData({ pot: POT, executions }))).toBe(
      keccak256(`0x1901${domain.slice(2)}${message.slice(2)}`),
    );
    expect(() => encodeExecuteAcross({ pot: POT, executions, signature: "0x" }, 10)).toThrow(
      "the signature runs nothing on chain 10",
    );
  });

  it("signs the PotMessage the core's ERC-1271 handler checks, under this package's domain", () => {
    const core = readFileSync(join(process.cwd(), "src", "std", "async", "async.evm.js"), "utf8");
    const coreConstant = (name: string): string =>
      new RegExp(`const ${name} = (0x[0-9a-f]{64});`).exec(core)![1]!;
    expect(coreConstant("SAUCE_ERC1271_DOMAIN")).toBe(constant("SAUCE_SIGNED_DOMAIN"));
    expect(coreConstant("SAUCE_ERC1271_NAME")).toBe(constant("SAUCE_SIGNED_NAME"));
    expect(coreConstant("SAUCE_ERC1271_VERSION")).toBe(constant("SAUCE_SIGNED_VERSION"));
    expect(coreConstant("SAUCE_ERC1271_HALF_ORDER")).toBe(constant("SAUCE_SIGNED_HALF_ORDER"));
    // The handler writes the same check out inline, with constants of its own.
    const handler = readFileSync(
      join(process.cwd(), "src", "std", "async", "erc1271.handler.js"),
      "utf8",
    );
    for (const [name, ours] of [
      ["DOMAIN", "SAUCE_SIGNED_DOMAIN"],
      ["NAME", "SAUCE_SIGNED_NAME"],
      ["VERSION", "SAUCE_SIGNED_VERSION"],
      ["HALF_ORDER", "SAUCE_SIGNED_HALF_ORDER"],
    ] as const) {
      expect(handler).toContain(`const SAUCE_ERC1271_HANDLER_${name} = ${constant(ours)};`);
    }
    const hash = keccak256(toHex("permit"));
    const domain = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
        ],
        [
          coreConstant("SAUCE_ERC1271_DOMAIN") as Hex,
          coreConstant("SAUCE_ERC1271_NAME") as Hex,
          coreConstant("SAUCE_ERC1271_VERSION") as Hex,
          8453n,
          POT,
        ],
      ),
    );
    const message = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [coreConstant("SAUCE_ERC1271_MESSAGE") as Hex, hash],
      ),
    );
    expect(hashTypedData(potMessageTypedData({ pot: POT, chainId: 8453, hash }))).toBe(
      keccak256(`0x1901${domain.slice(2)}${message.slice(2)}`),
    );
  });

  it("binds an EIP-1271 message to the Pot and the chain", () => {
    const hash = keccak256(toHex("permit"));
    const here = hashTypedData(potMessageTypedData({ pot: POT, chainId: 8453, hash }));
    expect(here).not.toBe(hash);
    expect(hashTypedData(potMessageTypedData({ pot: POT, chainId: 1, hash }))).not.toBe(here);
  });

  it("finds a salt's word and bit where the Pot keeps them", () => {
    const salt = toHex((7n << 8n) | 200n, { size: 32 });
    expect(signedSaltSlot(salt)).toEqual({
      slot: keccak256(
        encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [7n, SIGNED_NAMESPACE]),
      ),
      bit: 1n << 200n,
    });
  });

  it("cancels salts with one invalidate per word they share, in a program that compiles", () => {
    const source = cancelSaltsSource([
      toHex((7n << 8n) | 1n, { size: 32 }),
      toHex((7n << 8n) | 4n, { size: 32 }),
      toHex(9n << 8n, { size: 32 }),
    ]);
    expect(source).toContain("invalidate(0x7, 0x12);");
    expect(source).toContain("invalidate(0x9, 0x1);");
    expect(compile(source).bytecode.length).toBeGreaterThan(0);
  });

  it("refuses a salt that is not 32 bytes", () => {
    expect(() => signedSaltSlot("0x05")).toThrow("a salt is 32 bytes as hex, not 0x05");
  });
});
