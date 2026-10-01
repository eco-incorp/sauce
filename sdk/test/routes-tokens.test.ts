/**
 * Token symbols in a program — `USDC.transfer(to, amount)`, `USDC.balanceOf(x)`, `pool.USDC` — as
 * the compiler resolves them from the extensions manifest (`src/routes/extensions.ts`): each symbol
 * is its chain's token, typed so a write is `@sauce/token`'s SafeERC20 function, a read the `IERC20`
 * call, and a holder's `.USDC` that holder's balance.
 *
 * The claims are byte claims against the program written out by hand. What the programs DO on a
 * chain — a standard token, USDT's empty return, a `false` return, no code — is
 * `test/std/token/evm.e2e.test.ts`'s matrix.
 */
import { SVM_TOKEN_REGISTRY } from "../src/routes/token-registry.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceRoute, type SauceCompileOptions } from "../src/routes/sauce-route.js";

// Base USDC -- pinned fixture, matching src/verify/vectors.ts's own Base USDC constant.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x6666666666666666666666666666666666666666" as const;
const SVM_EXECUTION = {
  code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  accounts: [],
} as const;

const bytecode = (chain: string, source: string, options: SauceCompileOptions = {}): number[] =>
  Array.from(
    compileSauceRoute(chain, source, { pot: POT, engine: ENGINE }, options).compiled.bytecode[0]!,
  );

/** The same write, spelled as a direct `@sauce/token` call against a literal token address. */
const libraryProgram = (token: string, write: string, args: string): number[] =>
  bytecode(
    "base",
    `import { ${write} } from "@sauce/token";\nfunction main() { ${write}(${token}, ${args}); }`,
  );

function evmOptions() {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base" as const,
    creator: "0x3333333333333333333333333333333333333333" as const,
    prover: "0x4444444444444444444444444444444444444444" as const,
    rewardDeadline: 1000n,
  };
}

describe("a token write is @sauce/token's SafeERC20 function, the token first", () => {
  it.each([
    ["transfer", `${TO}, 5n`],
    ["approve", `${TO}, 5n`],
    ["transferFrom", `${TO}, ${TO}, 5n`],
  ])("USDC.%s(...)", (write, args) => {
    expect(bytecode("base", `USDC.${write}(${args});`)).toEqual(
      libraryProgram(`${USDC}n`, write, args),
    );
  });

  it("with no tokens option at all: the chain's registry names the token", () => {
    expect(bytecode("base", `USDC.transfer(${TO}, 5n);`)).toEqual(
      libraryProgram(`${USDC}n`, "transfer", `${TO}, 5n`),
    );
  });

  it("options.tokens overrides the registry, per key", () => {
    const OTHER = "0x5555555555555555555555555555555555555555" as const;
    const overridden = bytecode("base", `USDC.transfer(${TO}, 5n);`, { tokens: { USDC: OTHER } });
    expect(overridden).toEqual(libraryProgram(`${OTHER}n`, "transfer", `${TO}, 5n`));
    expect(overridden).not.toEqual(libraryProgram(`${USDC}n`, "transfer", `${TO}, 5n`));
  });

  it("a write returns nothing, so reading its result is refused", () => {
    expect(() =>
      bytecode("base", `function main() { const ok = USDC.transfer(${TO}, 5n); }`),
    ).toThrow();
  });

  it("a write with the wrong arguments is refused", () => {
    expect(() => bytecode("base", `USDC.transfer(${TO});`)).toThrow(/transfer/);
  });

  it("a program's own `transfer` is the program's, and does not change the token's", () => {
    expect(() =>
      bytecode(
        "base",
        `function transfer(a: Uint256): Uint256 { return a; }\nfunction main() { USDC.transfer(${TO}, transfer(5n)); }`,
      ),
    ).not.toThrow();
  });

  it("an explicit IERC20.at(x).transfer(...) is the raw ABI call, not the SafeERC20 one", () => {
    const raw = bytecode(
      "base",
      `import { IERC20 } from "./artifacts/IERC20.json";\nfunction main() { IERC20.at(${USDC}).transfer(${TO}, 5n); }`,
    );
    expect(raw).not.toEqual(libraryProgram(`${USDC}n`, "transfer", `${TO}, 5n`));
  });

  it("a local named like a symbol is the program's: it has no token methods", () => {
    expect(() =>
      bytecode("base", `function main() { let USDC = 1n; USDC.transfer(${TO}, 5n); }`),
    ).toThrow();
  });

  it("openRoute end to end: one cook() call", () => {
    const built = openRoute("base", `USDC.transfer(${TO}, 5n);`, evmOptions()).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
    const withTokens = openRoute("ethereum", `USDC.transfer(${TO}, 5n);`, {
      ...evmOptions(),
      tokenDefines: { USDC },
    }).reward(0n);
    expect(withTokens.intent.route.calls).toHaveLength(1);
  });
});

describe("a token read is the IERC20 call", () => {
  const read = (body: string) => bytecode("base", `function main(): Uint256 { return ${body}; }`);
  const typed = (holder: string) =>
    bytecode(
      "base",
      `import { IERC20 } from "./artifacts/IERC20.json";\nfunction main(): Uint256 { return IERC20.at(${USDC}).balanceOf(${holder}); }`,
    );

  it("USDC.balanceOf(x)", () => {
    expect(read("USDC.balanceOf(ctx.self())")).toEqual(typed("ctx.self()"));
  });

  it("a holder's .USDC is its balance, for a literal or a variable", () => {
    const holder = "0x1111111111111111111111111111111111111122";
    expect(read(`${holder}.USDC`)).toEqual(read(`USDC.balanceOf(${holder})`));
    expect(bytecode("base", "function main(pool: Address): Uint256 { return pool.USDC; }")).toEqual(
      bytecode("base", "function main(pool: Address): Uint256 { return USDC.balanceOf(pool); }"),
    );
  });

  it("self.USDC is the Pot's balance", () => {
    expect(read("self.USDC")).toEqual(read("USDC.balanceOf(self)"));
  });

  it("each chain's symbol is its own token", () => {
    const hex = (bytes: number[]) => Buffer.from(bytes).toString("hex");
    const baseUsdc = USDC.slice(2).toLowerCase();
    expect(hex(bytecode("base", "function main(): Uint256 { return self.USDC; }"))).toContain(
      baseUsdc,
    );
    expect(
      hex(bytecode("ethereum", "function main(): Uint256 { return self.USDC; }")),
    ).not.toContain(baseUsdc);
  });

  it("another chain's token is spelled with its chain", () => {
    expect(bytecode("ethereum", "function main(): Uint256 { return Base.USDC; }")).toEqual(
      bytecode("ethereum", `function main(): Uint256 { return ${USDC}; }`),
    );
  });
});

describe("a symbol the chain lacks", () => {
  it("is refused with the chains that register it", () => {
    expect(() => bytecode("ronin", `USDC.transfer(${TO}, 5n);`)).toThrow(
      "`USDC` is not a token ronin registers",
    );
  });

  it("a symbol no chain registers is an undeclared name", () => {
    expect(() => bytecode("base", "function main(): Uint256 { return self.NOTATOKEN; }")).toThrow();
  });
});

describe("on an svm destination the token syntax is refused by name", () => {
  const svm = (source: string, options: SauceCompileOptions = {}) =>
    compileSauceRoute("solana", source, SVM_EXECUTION, options);

  it("a write", () => {
    expect(() => svm(`USDC.transfer(${TO}, 5n);`)).toThrow(/the ERC20 token syntax is EVM-only/);
    expect(() => svm(`USDC.transfer(${TO}, 5n);`, { tokens: { USDC } })).toThrow(/svm/i);
  });

  it("a holder's balance", () => {
    expect(() => svm("function main() { return self.USDC; }")).toThrow(/svm/i);
    expect(() =>
      svm("function main(pot: Uint256) { return pot.USDC; }", { accessors: false }),
    ).toThrow(/the ERC20 token syntax is EVM-only/);
  });

  it("openRoute to an svm destination", () => {
    expect(() =>
      openRoute("solana", `USDC.transfer(${TO}, 5n);`, {
        execution: SVM_EXECUTION,
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: "0x3333333333333333333333333333333333333333",
        prover: "0x4444444444444444444444444444444444444444",
        rewardDeadline: 1000n,
        tokenDefines: { USDC },
      }),
    ).toThrow(/svm/i);
  });

  it("a bare registered symbol is the mint's key, a value the program compiles with", () => {
    const usdc = SVM_TOKEN_REGISTRY["mainnet-beta"].find((row) => row.symbol === "USDC")!;
    const compiled = svm(
      "function main(account: Account): Uint256 { return balanceOf(USDC, account); }",
      { ambient: ["@sauce/token"] },
    );
    expect(Buffer.from(compiled.compiled.bytecode[0]!).toString("hex")).toContain(
      usdc.address.slice(2),
    );
  });
});
