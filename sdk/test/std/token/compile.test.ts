/**
 * `@sauce/token` compile conformance, from the CONSUMER side: the library at sdk/src/std/token built
 * through the published `@eco-incorp/sauce-compiler`, for both targets.
 *
 * Five things are asserted here and nowhere else in this repo:
 *   1. every exported method compiles on both arms, at the signature each arm actually declares, and
 *      a method only one account model has (`ownerOf`) compiles on its arm and is refused on the other;
 *   2. the SPL Token program id the library pins its `require`s to, counted in the emitted bytecode;
 *   3. the ERC-20 selectors the EVM writes spell out by hand, counted the same way;
 *   4. what the library demands of its caller, which only a compile failure can show — the manifest
 *      cannot, being exactly `main`'s own `Account` params;
 *   5. the packaging invariant that there is deliberately NO neutral `token.js`, so a package with no
 *      arm for the target fails on the IMPORT rather than on a missing export.
 *
 * Execution — the compiled bytecode actually running on a real engine and returning the right value —
 * lives in `test/std/token/svm.e2e.test.ts` and `test/std/token/evm.e2e.test.ts`. Both are gated on
 * an env var pointing at a `main`-lineage engine, because the engine artifacts this repo pins
 * (`artifacts/svm/engine.so`, and the V12 runtime `sync-engine-artifacts` generates) come from the
 * `release/beta` lineage and can no longer execute what the published Rust compiler emits. Each of
 * those files documents the divergence; this suite runs unconditionally because compiling needs no
 * engine at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { address, getAddressCodec } from "@solana/kit";
import { toFunctionSelector } from "viem";
import { Permit2ABI } from "../../../src/protocols/permit2/abis.js";
import { CASES, compileStdToken, compileWith, SVM_ONLY_CASES, TOKEN_DIR } from "./harness.js";
import type { AccountEntry } from "./harness.js";

// `requires` is the role the slot demands of whatever account is attached there. Every account in
// this library is a bare `Account` parameter, which is `readonly`; nothing is inferred from the CPI.
const slot = (index: number, name: string): AccountEntry => ({
  kind: "slot",
  index,
  name,
  requires: "readonly",
});

const caseNamed = (method: string) => {
  const testCase = CASES.find((entry) => entry.method === method);
  if (!testCase) throw new Error(`no case named ${method}`);

  return testCase;
};

const svmEntry = (method: string): string =>
  (SVM_ONLY_CASES.find((entry) => entry.method === method) ?? caseNamed(method)).svm;

const manifestOf = (method: string): AccountEntry[] => {
  const { manifest } = compileStdToken(svmEntry(method), "svm");
  if (!manifest) throw new Error("the svm target must emit a manifest");

  return manifest.accounts;
};

/**
 * The SPL Token program id as hex, derived from the canonical base58 address rather than copied from
 * the library. A copy would agree with the library's constant however wrong that constant was, which
 * is the one thing this must not do.
 */
const SPL_TOKEN_PROGRAM = Buffer.from(
  getAddressCodec().encode(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
).toString("hex");

/** How many times the compiled program carries the id inline — one per `require` that pins it. */
const pinnedProgramIds = (method: string): number =>
  Buffer.from(compileStdToken(svmEntry(method), "svm").bytecode)
    .toString("hex")
    .split(SPL_TOKEN_PROGRAM).length - 1;

describe("@sauce/token: every exported method compiles on both targets", () => {
  it.each(CASES)("$method", ({ evm, svm }) => {
    const compiledForEvm = compileStdToken(evm, "evm");
    const compiledForSvm = compileStdToken(svm, "svm");

    expect(compiledForEvm.bytecode.length).toBeGreaterThan(0);
    expect(compiledForSvm.bytecode.length).toBeGreaterThan(0);
    // The manifest is the SVM attach contract; the EVM has no accounts to attach.
    expect(compiledForEvm.manifest).toBeUndefined();
    expect(compiledForSvm.manifest).toBeDefined();
  });
});

describe("@sauce/token: the methods only the SPL arm has", () => {
  it.each(SVM_ONLY_CASES)("$method compiles for Solana, reading the one account", ({ method }) => {
    expect(manifestOf(method)).toEqual([slot(0, "account")]);
  });

  it.each(SVM_ONLY_CASES)("$method is not exported for the EVM", ({ method, svm }) => {
    // Refused at the import, naming the method, rather than compiled into something that guesses.
    expect(() => compileStdToken(svm.replace(/: Account\b/g, ": Address"), "evm")).toThrow(
      `\`${method}\` is not exported by module`,
    );
  });
});

describe("@sauce/token: the SPL Token program id", () => {
  // Every `require(… == SPL_TOKEN_PROGRAM)` compiles the id inline, so counting occurrences counts the
  // guards. Nothing else in CI can: the guards only *fire* on an engine, and both e2e suites that own
  // one are env-gated. Without this, flipping a digit of the constant — or deleting the guards
  // outright — is green here, which is exactly the failure the library's own comments warn about.
  //
  // A read pins the account's owner. A write pins the owner and, separately, the callee it CPIs into,
  // so the count also catches losing one of the two. And because an unreachable function is never
  // emitted, a read's count stays at one: were the library's three writes lowered in too, it would be
  // five, so this is also where a regression in that pruning would surface.
  it.each([
    ["balanceOf", 1],
    ["ownerOf", 1],
    ["totalSupply", 1],
    ["decimals", 1],
    ["allowance", 1],
    ["transfer", 2],
    ["transferFrom", 2],
    ["approve", 2],
  ])("%s pins it %i time(s)", (method, expected) => {
    expect(pinnedProgramIds(method)).toBe(expected);
  });
});

describe("@sauce/token: the ERC-20 selectors the EVM writes spell out", () => {
  // The writes build raw calldata for `evm.call`, so each selector is a hex literal written into the
  // library rather than one the compiler derives from `erc20.abi.json`. A wrong digit still compiles,
  // and on a run with no engine nothing else here would notice. So, as with the program id above,
  // each is derived from its canonical signature, never copied from the library. A write carries
  // its own selector exactly once and no other write's; `approve` also carries `allowance`, the read
  // that decides whether a reset is needed.
  const SIGNATURES = [
    "transfer(address,uint256)",
    "transferFrom(address,address,uint256)",
    "approve(address,uint256)",
    "allowance(address,address)",
  ];

  const selectorCounts = (method: string): Record<string, number> => {
    const bytecode = Buffer.from(compileStdToken(caseNamed(method).evm, "evm").bytecode).toString(
      "hex",
    );

    return Object.fromEntries(
      SIGNATURES.map((signature) => [
        signature,
        bytecode.split(toFunctionSelector(signature).slice(2)).length - 1,
      ]),
    );
  };

  it.each([
    ["transfer", ["transfer(address,uint256)"]],
    ["transferFrom", ["transferFrom(address,address,uint256)"]],
    ["approve", ["approve(address,uint256)", "allowance(address,address)"]],
  ])("%s", (method, carried) => {
    expect(selectorCounts(method)).toEqual(
      Object.fromEntries(
        SIGNATURES.map((signature) => [signature, carried.includes(signature) ? 1 : 0]),
      ),
    );
  });
});

describe("@sauce/token: the EVM pulls", () => {
  // `permit` (EIP-2612) and `permitTransferFrom` (Permit2) move tokens INTO the program on the
  // holder's signature. They are EVM-only: an SPL transfer is authorised by the signer of the
  // transaction, so there is nothing for a signature to stand in for.
  const PERMIT =
    'import { permit } from "@sauce/token"; function main(token: Address, owner: Address, spender: Address, value: Uint256, deadline: Uint256, v: Uint256, r: Uint256, s: Uint256): void { permit(token, owner, spender, value, deadline, v, r, s); }';
  const PERMIT2 =
    'import { permitTransferFrom } from "@sauce/token"; function main(token: Address, owner: Address, amount: Uint256, nonce: Uint256, deadline: Uint256, signature: bytes, permit2: Address): void { permitTransferFrom(token, owner, amount, nonce, deadline, signature, permit2); }';
  const hexOf = (entry: string): string =>
    Buffer.from(compileStdToken(entry, "evm").bytecode).toString("hex");
  const count = (bytecode: string, signature: string): number =>
    bytecode.split(toFunctionSelector(signature).slice(2)).length - 1;

  it("permit calls EIP-2612's permit, and reads the nonce", () => {
    const bytecode = hexOf(PERMIT);
    expect(count(bytecode, "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")).toBe(
      1,
    );
    // OpenZeppelin `safePermit`'s proof that the permit ran — the nonce moved by exactly one — reads
    // it through one helper, called before and after; the e2e suite proves both reads happen.
    expect(count(bytecode, "nonces(address)")).toBe(1);
  });

  it("permitTransferFrom binds the registry's Permit2 SignatureTransfer", () => {
    expect(
      count(
        hexOf(PERMIT2),
        "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)",
      ),
    ).toBe(1);
  });

  it("binds the registry's Permit2 ABI, whole", () => {
    // `permit2.abi.json` beside the module is the registry's `Permit2ABI`, not a fragment of it: the
    // registry evidence pins every function in it against every deployed Permit2.
    const shipped = JSON.parse(readFileSync(join(TOKEN_DIR, "permit2.abi.json"), "utf8"));
    expect(shipped).toEqual(JSON.parse(JSON.stringify(Permit2ABI)));
  });

  it("neither exists on Solana", () => {
    for (const entry of [PERMIT, PERMIT2]) {
      expect(() =>
        compileStdToken(entry.replace("permit2: Address", "permit2: Account"), "svm"),
      ).toThrow();
    }
  });
});

describe("@sauce/token: what the library demands of its caller", () => {
  // The manifest is exactly `main`'s declared `Account` params — an empty `main` with the same
  // signature yields the identical one — so it cannot witness anything about the library. A compile
  // failure can.
  it("a write does not compile unless the caller declares an Account for the callee", () => {
    const withoutTokenProgram =
      'import { transfer } from "@sauce/token"; function main(token: Address, source: Account, dest: Account, authority: Account, amount: Uint256): void { transfer(token, source, dest, authority, amount); }';

    expect(() => compileStdToken(withoutTokenProgram, "svm")).toThrow(
      "expected an account, found a number",
    );
  });

  it("a write does not compile with a plain address in the callee position", () => {
    // `svm.call`'s callee is an account the caller attaches, not a value — so an `Address` is refused
    // rather than compiled into a call against a key nobody attached.
    const addressAsCallee =
      'import { transfer } from "@sauce/token"; function main(token: Address, tokenProgram: Address, source: Account, dest: Account, authority: Account, amount: Uint256): void { transfer(token, tokenProgram, source, dest, authority, amount); }';

    expect(() => compileStdToken(addressAsCallee, "svm")).toThrow(
      "expected an account, found a number",
    );
  });

  it("a read demands no program account", () => {
    // The counterpart, and the real content of "a read-only import does not drag the callee in".
    // Importing the library brings `transfer`/`transferFrom`/`approve` into scope and each CPIs into
    // the SPL Token program, but an unreachable function is never emitted, so none of them reaches
    // the bytecode. The counts above are the evidence rather than this comment: a read pins the
    // program id ONCE, where lowering the three writes in would put it there five times.
    expect(manifestOf("balanceOf")).toEqual([slot(0, "account")]);
  });
});

describe("@sauce/token: the attach order the e2e suites resolve by name", () => {
  // These pin the CASES entries above, not library behaviour: on 0.4.x the manifest is `main`'s
  // `Account` params in declaration order, so what they protect is the agreement between those
  // signatures and the accounts `svm.e2e.test.ts` attaches. Change a signature there, change this.
  it.each([
    ["transfer", ["tokenProgram", "source", "dest", "authority"]],
    ["transferFrom", ["tokenProgram", "source", "dest", "authority"]],
    ["approve", ["tokenProgram", "source", "delegate", "authority"]],
  ])("%s", (method, names) => {
    expect(manifestOf(method)).toEqual(names.map((name, index) => slot(index, name)));
  });
});

describe("@sauce/token: packaging", () => {
  const entry =
    'import { balanceOf } from "@sauce/token"; function main(): Uint256 { return balanceOf(1n, 2n); }';

  it("a package with no arm for the target fails on the import, not on a missing export", () => {
    // The package ships two arms and no neutral body, because a token program is inherently
    // target-specific. A neutral file that merely RESOLVED would be worse than none: an empty one
    // turns this into "balanceOf is not exported by @sauce/token" (pointing at the symbol, not the
    // real problem), and one that declared the surface would have to guess signatures the two arms
    // do not share. With no neutral file the arm probe's miss is what it is — the package could not
    // be imported for this target.
    // Absence is a returned `undefined`, never a throw — a throw means "present but unreadable" and
    // would make this a hard read failure rather than the missing arm it is meant to be.
    const compileArmless = () =>
      compileWith({
        target: "evm",
        resolve: (path) => (path === "main.js" ? Buffer.from(entry) : undefined),
        resolvePackage: () => "node_modules/@sauce/token/token.js",
      });

    expect(compileArmless).toThrow(/failed to import module "@sauce\/token"/);
  });

  it("an uninstalled package reports PackageNotFound, keeping the host resolver’s own cause", () => {
    const compileUninstalled = () =>
      compileWith({
        target: "evm",
        resolve: (path) => {
          if (path === "main.js") return Buffer.from(entry);
          throw new Error(`no such module: ${path}`);
        },
        resolvePackage: () => {
          throw new Error("nothing under node_modules");
        },
      });

    expect(compileUninstalled).toThrow(/`@sauce\/token` is not installed under node_modules/);
    expect(compileUninstalled).toThrow(/nothing under node_modules/);
  });
});
