/**
 * `compileSauceProgram` — a standalone program for a chain, with the chain's ambient names — and
 * `encodeEntryArguments`, the values for its `main(...)`.
 */
import {
  bytesToHex,
  concatHex,
  encodeAbiParameters,
  hexToBytes,
  numberToHex,
  pad,
  type Hex,
} from "viem";

import {
  decodeEntryArguments,
  encodeEntryArguments,
  mainParams,
  mainReturnType,
  mainSignature,
} from "../src/routes/entry.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";
import * as routes from "../src/routes/index.js";

const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x3333333333333333333333333333333333333333";
const PROVER = "0x4444444444444444444444444444444444444444";

const SPLIT = `
// Pays each recipient \`amount\` of \`token\` and, when \`alsoUsdc\`, as much in the chain's USDC.
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool): void {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
`;

describe("compileSauceProgram", () => {
  it("is on the routes namespace, with encodeEntryArguments", () => {
    expect(routes.compileSauceProgram).toBe(compileSauceProgram);
    expect(routes.encodeEntryArguments).toBe(encodeEntryArguments);
  });

  it("compiles one source for any chain, each with its own names", () => {
    const base = compileSauceProgram("base", SPLIT);
    const arbitrum = compileSauceProgram("arbitrum", SPLIT);
    const usdc = (chain: string) =>
      (routes.registryTokenAddress(routes.chain(chain).chain, "USDC") as bigint)
        .toString(16)
        .padStart(40, "0");
    expect(bytesToHex(base.bytecode)).toContain(usdc("base"));
    expect(bytesToHex(arbitrum.bytecode)).toContain(usdc("arbitrum"));
    expect(bytesToHex(base.bytecode)).not.toContain(usdc("arbitrum"));
    expect(base.entryEncoding).toBe("abi-v1");
    expect(base.entryParams).toEqual([
      { name: "token", type: "Address" },
      { name: "recipients", type: "Address[]" },
      { name: "amount", type: "Uint256" },
      { name: "alsoUsdc", type: "bool" },
    ]);
  });

  it("gives a program the chain's ambient names, which compileSauceRoute leaves out", () => {
    const body = "require(chainId == 8453n);\ntransfer(USDC, RECIPIENT, 5n);\n";
    const defines = { RECIPIENT: BigInt(RECIPIENT) };
    expect(compileSauceProgram("base", body, { defines }).bytecode.length).toBeGreaterThan(0);
    // compileSauceRoute adds none of it, deliberately: chainId and `transfer` are undeclared there.
    expect(() =>
      compileSauceRoute("base", body, { pot: RECIPIENT, engine: RECIPIENT }, { defines }),
    ).toThrow();
  });

  it("reports ABI-v1, and on Solana the accounts apart from the arguments", () => {
    expect(compileSauceProgram("base", SPLIT).entryEncoding).toBe("abi-v1");
    const svm = compileSauceProgram(
      "solana",
      "function main(vault: Account<Writable>, amount: Uint256) {\n  require(vault.dataLen > amount);\n}\n",
    );
    expect(svm.entryEncoding).toBe("abi-v1");
    expect(svm.entryParams).toEqual([{ name: "amount", type: "Uint256" }]);
    expect(svm.manifest).toEqual({
      accounts: [{ kind: "slot", index: 0, name: "vault", requires: "writable" }],
    });
  });
});

describe("main's signature", () => {
  it("compiles a typed helper beside main, with every annotation as written", () => {
    const source = [
      "function pay(token: Address, to: Address[], amount: Uint256): void {",
      "  for (let i = 0; i < to.length; i = i + 1) {",
      "    transfer(token, to[i], amount);",
      "  }",
      "}",
      "function owed(amount: Uint256): Uint256 {",
      "  return amount * 2n;",
      "}",
      "function main(token: Address, to: Address[], amount: Uint256) {",
      "  pay(token, to, owed(amount));",
      "  USDC.transfer(to[0], amount);",
      "}",
    ].join("\n");
    // Through the token rewrite, which parses the annotations with the program.
    const program = compileSauceProgram("ethereum", source, {});
    expect(program.entryParams).toEqual([
      { name: "token", type: "Address" },
      { name: "to", type: "Address[]" },
      { name: "amount", type: "Uint256" },
    ]);
  });

  it("reads main's parameters, an unannotated one a Uint256", () => {
    expect(mainParams("function main(a, b: bool, c: Uint256[]) {}")).toEqual([
      { name: "a", type: "Uint256" },
      { name: "b", type: "bool" },
      { name: "c", type: "Uint256[]" },
    ]);
    expect(mainParams("USDC.transfer(x, 1n);")).toEqual([]);
  });

  it("spells out a record an interface names, so a value for it can be encoded", () => {
    const source = [
      "interface Leg {",
      "  pool: Address;",
      "  fee: Uint256;",
      "}",
      "interface Route {",
      "  legs: Leg[];",
      "  to: Address;",
      "}",
      "function main(route: Route, extra: Leg, amount: Uint256): void {",
      "  require(route.legs.length > 0n && extra.fee < amount);",
      "}",
    ].join("\n");
    const program = compileSauceProgram("base", source, {});
    expect(program.entryParams).toEqual([
      { name: "route", type: "{ legs: { pool: Address, fee: Uint256 }[], to: Address }" },
      { name: "extra", type: "{ pool: Address, fee: Uint256 }" },
      { name: "amount", type: "Uint256" },
    ]);
    const encoded = encodeEntryArguments(program, [
      { legs: [{ pool: RECIPIENT, fee: 500n }], to: RECIPIENT },
      { pool: RECIPIENT, fee: 3000n },
      1n,
    ]);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("reads the module's own main: not one nested in a function or bodyless, and past type parameters", () => {
    const nested =
      "function helper(): Uint256 {\n  function main(z: Address): Uint256 {\n    return 1;\n  }\n  return 2;\n}\n";
    const overload = "function main(a: Address): Address;\n";
    const own = "function main(b: Uint256): Uint256 {\n  return b;\n}\n";
    for (const source of [
      `${nested}${own}`,
      `function helper(): Uint256 {function main(z: Address): Uint256 { return 1; } return 2; }\n${own}`,
      `${overload}${own}`,
      `declare ${overload}${own}`,
      "function main<T>(b: Uint256): Uint256 {\n  return b;\n}\n",
      `export ${own}`,
      `// function main(z: Address) {}\n${own}`,
    ]) {
      expect(mainParams(source)).toEqual([{ name: "b", type: "Uint256" }]);
      expect(mainSignature(source)?.names).toEqual(["b"]);
      expect(mainReturnType(source)).toBe("Uint256");
    }
    expect(mainSignature(nested)).toBeUndefined();
    expect(mainParams(`${overload}const x: Uint256 = 1;\n`)).toEqual([]);
  });

  it("reads each parameter's name and type, and the return type, past comments in the signature", () => {
    const source = [
      "function main(",
      "  to: Address, // who is paid",
      "  /* in base units, fees included */ amount /* : Address */: Uint256,",
      "): /* what arrived */ Uint256 {",
      "  return amount;",
      "}",
    ].join("\n");
    const params = [
      { name: "to", type: "Address" },
      { name: "amount", type: "Uint256" },
    ];
    expect(mainParams(source)).toEqual(params);
    expect(mainSignature(source)?.names).toEqual(["to", "amount"]);
    expect(mainReturnType(source)).toBe("Uint256");
    expect(mainSignature("function main(): /* nothing */ void {}")?.returnsValue).toBe(false);
    const program = compileSauceProgram("base", source, {});
    expect(program.entryParams).toEqual(params);
    expect(bytesToHex(encodeEntryArguments(program, [RECIPIENT, 5n]))).toBe(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [RECIPIENT, 5n]),
    );
    // Bound, it is the program that returns the amount.
    expect(compileSauceProgram("base", source, { args: [RECIPIENT, 5n] }).bytecode).toEqual(
      compileSauceProgram("base", "function main(): Uint256 {\n  return 5;\n}\n").bytecode,
    );
  });
});

describe("main's arguments bound by args", () => {
  it("refuses one the module declares too, which the bound define would replace outside main", () => {
    // `owed` reads the module's `fee`; `main`'s parameter shadows it in `main` alone.
    const fee = [
      "const fee: Uint256 = 30;",
      "function owed(amount: Uint256): Uint256 {",
      "  return (amount * fee) / 10000;",
      "}",
      "function main(amount: Uint256, fee: Uint256): Uint256 {",
      "  return owed(amount) + fee;",
      "}",
    ].join("\n");
    expect(() => compileSauceProgram("base", fee)).not.toThrow();
    expect(() => compileSauceProgram("base", fee, { args: [10000n, 5n] })).toThrow(
      "argument 2 (fee: Uint256): the module declares fee too",
    );
    const payee = [
      `const payee: Address = ${CREATOR};`,
      "function owner(): Address {",
      "  return payee;",
      "}",
      "function main(payee: Address): Address {",
      "  return owner();",
      "}",
    ].join("\n");
    expect(() => compileSauceProgram("base", payee, { args: [RECIPIENT] })).toThrow(
      "argument 1 (payee: Address): the module declares payee too",
    );
    // A signed argument is a `let` of `main`'s own, which shadows the module's in `main` alone.
    const signed = [
      "const delta: Int256 = 30;",
      "function start(): Int256 {",
      "  return delta;",
      "}",
      "function main(delta: Int256): Int256 {",
      "  return start() + delta;",
      "}",
    ].join("\n");
    expect(compileSauceProgram("base", signed, { args: [-5n] }).bytecode).toEqual(
      compileSauceProgram("base", "function main(): Int256 {\n  return 25;\n}\n").bytecode,
    );
  });

  it("refuses one named like a value of the chain, which the bound define would replace outside main", () => {
    // `paid` reads the chain's USDC; `main`'s parameter shadows it in `main` alone.
    const paid = "function paid(): Address {\n  return USDC;\n}\n";
    expect(() =>
      compileSauceProgram(
        "base",
        `${paid}function main(USDC: Address): Address {\n  return paid();\n}\n`,
        {
          args: [RECIPIENT],
        },
      ),
    ).toThrow("USDC is main's parameter, given in args; it is not also a define (USDC on base)");
    expect(() =>
      compileSauceProgram(
        "base",
        "function main(chainId: Uint256): Uint256 {\n  return chainId;\n}\n",
        {
          args: [5n],
        },
      ),
    ).toThrow(
      "chainId is main's parameter, given in args; it is not also a define (chainId on base)",
    );
    expect(() =>
      compileSauceProgram(
        "base",
        "function main(Asset: Address): Address {\n  return Asset;\n}\n",
        {
          args: [RECIPIENT],
          tokens: { Asset: CREATOR },
        },
      ),
    ).toThrow("Asset is main's parameter, given in args; it is not also a define (Asset on base)");
    expect(() =>
      compileSauceProgram(
        "solana",
        "function main(USDC: Uint256): Uint256 {\n  return USDC;\n}\n",
        {
          args: [5n],
        },
      ),
    ).toThrow("USDC is main's parameter, given in args; it is not also a define (USDC on solana)");
    // A signed argument is a `let` of `main`'s own, which leaves the chain's USDC to `paid`.
    expect(
      compileSauceProgram(
        "base",
        `${paid}function main(USDC: Int256): Address {\n  return paid();\n}\n`,
        {
          args: [-5n],
        },
      ).bytecode,
    ).toEqual(
      compileSauceProgram("base", "function main(): Address {\n  return USDC;\n}\n").bytecode,
    );
  });
});

describe("encodeEntryArguments", () => {
  const params = [
    { name: "token", type: "Address" },
    { name: "recipients", type: "Address[]" },
    { name: "amount", type: "Uint256" },
    { name: "alsoUsdc", type: "bool" },
    { name: "leg", type: "{ amount: Uint256, to: Address }" },
    { name: "memo", type: "bytes" },
  ];
  const values = [
    RECIPIENT,
    [RECIPIENT, CREATOR],
    "1000",
    true,
    { amount: 5n, to: PROVER },
    "0xbeef",
  ];

  it("encodes ABI-v1 as abi.encode of the parameters, with no selector", () => {
    const untupled = params.filter((param) => param.name !== "leg");
    const encoded = encodeEntryArguments(
      { entryEncoding: "abi-v1", entryParams: untupled },
      values.filter((_, index) => params[index]!.name !== "leg"),
    );
    const expected = encodeAbiParameters(
      [
        { type: "address" },
        { type: "address[]" },
        { type: "uint256" },
        { type: "bool" },
        { type: "bytes" },
      ],
      [RECIPIENT, [RECIPIENT, CREATOR], 1000n, true, "0xbeef"],
    );
    expect(bytesToHex(encoded)).toBe(expected);
  });

  it("puts a tuple parameter behind an offset, though abi.encode inlines one of fixed-size fields", () => {
    const LEG = [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ];
    const word = (value: bigint): Hex => numberToHex(value, { size: 32 });
    const program = {
      entryEncoding: "abi-v1" as const,
      entryParams: [
        { name: "amount", type: "Uint256" },
        { name: "leg", type: "{ amount: Uint256, to: Address }" },
      ],
    };
    const encoded = encodeEntryArguments(program, [1000n, { amount: 5n, to: PROVER }]);
    // One head word per parameter, as main reads them: the amount, then where the leg's fields are.
    expect(bytesToHex(encoded)).toBe(concatHex([word(1000n), word(0x40n), word(5n), pad(PROVER)]));
    const inline = encodeAbiParameters(
      [{ type: "uint256" }, { type: "tuple", components: LEG }],
      [1000n, { amount: 5n, to: PROVER }],
    );
    expect(bytesToHex(encoded)).not.toBe(inline);
    // A tuple given positionally encodes the same.
    expect(encodeEntryArguments(program, [1000n, [5, PROVER]])).toEqual(encoded);
    // Read back, strictly: abi.encode's inline layout is not one main reads.
    expect(decodeEntryArguments(program, encoded)).toEqual([1000n, { amount: 5n, to: PROVER }]);
    expect(() => decodeEntryArguments(program, hexToBytes(inline))).toThrow(
      /not the canonical encoding/,
    );

    // Inside an array, as inside another tuple, such a tuple is inline, as abi.encode writes it.
    const legs = {
      entryEncoding: "abi-v1" as const,
      entryParams: [{ name: "legs", type: "{ amount: Uint256, to: Address }[]" }],
    };
    expect(bytesToHex(encodeEntryArguments(legs, [[{ amount: 5n, to: PROVER }]]))).toBe(
      encodeAbiParameters([{ type: "tuple[]", components: LEG }], [[{ amount: 5n, to: PROVER }]]),
    );
  });

  it("encodes ABI-v1 against the compiled program's declared parameters", () => {
    const program = compileSauceProgram(
      "base",
      "function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool, leg: { amount: Uint256, to: Address }, memo: bytes) {}",
    );
    expect(program.entryParams).toEqual(params);
    expect(program.entryEncoding).toBe("abi-v1");
    expect(encodeEntryArguments(program, values)).toEqual(
      encodeEntryArguments({ entryEncoding: "abi-v1", entryParams: params }, values),
    );
    expect(decodeEntryArguments(program, encodeEntryArguments(program, values))).toEqual([
      RECIPIENT,
      [RECIPIENT, CREATOR],
      1000n,
      true,
      { amount: 5n, to: PROVER },
      "0xbeef",
    ]);
  });

  it("reads a record type's fields separated by ;, as a formatter writes them", () => {
    const comma = compileSauceProgram(
      "base",
      "function main(legs: { amount: Uint256, to: Address }[]) {}",
    );
    const semicolon = compileSauceProgram(
      "base",
      "function main(legs: { amount: Uint256; to: Address }[]) {}",
    );
    expect(semicolon.entryParams).toEqual([
      { name: "legs", type: "{ amount: Uint256; to: Address }[]" },
    ]);
    const legs = [[{ amount: 5n, to: PROVER }]];
    expect(encodeEntryArguments(semicolon, legs)).toEqual(encodeEntryArguments(comma, legs));
  });

  it("names the parameter and what it takes when a value is wrong", () => {
    const program = { entryEncoding: "abi-v1" as const, entryParams: params };
    const at = (index: number, value: unknown) => {
      const wrong = [...values];
      wrong[index] = value as never;

      return () => encodeEntryArguments(program, wrong);
    };
    expect(() => encodeEntryArguments(program, values.slice(1))).toThrow(
      /main takes 6 arguments \(token: Address, recipients: Address\[\], amount: Uint256, alsoUsdc: bool, leg: \{ amount: Uint256, to: Address \}, memo: bytes\), got 5/,
    );
    expect(at(0, "0x12")).toThrow(/argument 1 \(token: Address\): '0x12' is not an address/);
    expect(at(1, [RECIPIENT, 7])).toThrow(
      /argument 2 \(recipients: Address\[\]\)\[1\]: 7 is not an address/,
    );
    expect(at(2, "-1")).toThrow(/argument 3 \(amount: Uint256\): '-1' is not an unsigned integer/);
    expect(at(2, 1.5)).toThrow(/is not an unsigned integer/);
    expect(at(2, `0x1${"0".repeat(64)}`)).toThrow(/below 2\^256/);
    expect(at(3, "yes")).toThrow(/argument 4 \(alsoUsdc: bool\): 'yes' is not a bool/);
    expect(at(4, { amount: 5 })).toThrow(/a tuple with exactly the fields amount, to/);
    expect(at(4, [5])).toThrow(/a tuple of 2 fields \(amount, to\)/);
    expect(at(5, "0xbee")).toThrow(/argument 6 \(memo: bytes\).*is not bytes/);
    expect(() =>
      encodeEntryArguments(
        { entryEncoding: "abi-v1", entryParams: [{ name: "x", type: "Point" }] },
        [1],
      ),
    ).toThrow(/'Point' is not a type an entry argument can be encoded for/);
  });
});
