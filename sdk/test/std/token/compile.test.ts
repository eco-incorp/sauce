/**
 * `@sauce/token` compile conformance, from the CONSUMER side: the library at sdk/src/std/token built
 * through the published `@eco-incorp/sauce-compiler`, for both targets.
 *
 * Seven things are asserted here and nowhere else in this repo:
 *   1. every exported method compiles on both arms, at the signature each arm actually declares, and
 *      a method only one account model has (`ownerOf`, the checked writes) compiles on its arm and is
 *      refused on the other;
 *   2. the two token program ids (legacy SPL Token and Token-2022) the library pins its `require`s
 *      to, counted in the emitted bytecode;
 *   3. the reason each of those SPL checks reverts with, counted the same way;
 *   4. that the legacy writes compile to the bytes they compiled to before the arm took Token-2022;
 *   5. the ERC-20 selectors the EVM writes spell out by hand, counted the same way;
 *   6. what the library demands of its caller, which only a compile failure can show — the manifest
 *      cannot, being exactly `main`'s own `Account` params;
 *   7. the packaging invariant that there is deliberately NO neutral `token.js`, so a package with no
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, getAddressCodec } from "@solana/kit";
import { toFunctionSelector } from "viem";
import { Permit2ABI } from "../../../src/protocols/permit2/abis.js";
import {
  CASES,
  compileStdToken,
  compileStdTokenSvmArm,
  compileWith,
  SVM_ONLY_CASES,
  TOKEN_DIR,
} from "./harness.js";
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
 * A token program's id as hex, derived from the canonical base58 address rather than copied from the
 * library. A copy would agree with the library's constant however wrong that constant was, which is
 * the one thing this must not do.
 */
const programId = (base58: string): string =>
  Buffer.from(getAddressCodec().encode(address(base58))).toString("hex");

const SPL_TOKEN_PROGRAM = programId("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = programId("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** How many times the compiled program carries `id` inline — one per comparison that pins it. */
const pinned = (method: string, id: string): number =>
  Buffer.from(compileStdToken(svmEntry(method), "svm").bytecode)
    .toString("hex")
    .split(id).length - 1;

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
  it.each([
    ["ownerOf", ["account"]],
    ["transferChecked", ["tokenProgram", "source", "mint", "dest", "authority"]],
    ["approveChecked", ["tokenProgram", "source", "mint", "delegate", "authority"]],
  ])("%s compiles for Solana, taking %j", (method, names) => {
    expect(manifestOf(method)).toEqual(names.map((name, index) => slot(index, name)));
  });

  it.each(SVM_ONLY_CASES)("$method is not exported for the EVM", ({ method, svm }) => {
    // Refused at the import, naming the method, rather than compiled into something that guesses.
    expect(() => compileStdToken(svm.replace(/: Account\b/g, ": Address"), "evm")).toThrow(
      `\`${method}\` is not exported by module`,
    );
  });
});

describe("@sauce/token: the token program ids", () => {
  // Every comparison with a program id compiles the id inline, so counting occurrences counts the
  // guards. Nothing else in CI can: the guards only *fire* on an engine, and both e2e suites that own
  // one are env-gated. Without this, flipping a digit of a constant — or deleting a guard outright — is
  // green here, which is exactly the failure the library's own comments warn about.
  //
  // A read pins the account's owner to either program, once each. A legacy write pins the
  // source's owner and, separately, the callee it CPIs into, both to legacy SPL Token alone, so the
  // count also catches losing one of the two; a checked write pins its callee to either program and
  // compares every account with the callee. And because an unreachable function is never emitted, a
  // read's counts stay as they are: were the library's writes lowered in too, they would grow, so
  // this is also where a regression in that pruning would surface.
  it.each([
    ["balanceOf", 1, 1],
    ["ownerOf", 1, 1],
    ["totalSupply", 1, 1],
    ["decimals", 1, 1],
    ["allowance", 1, 1],
    ["transfer", 2, 0],
    ["transferFrom", 2, 0],
    ["approve", 2, 0],
    ["transferChecked", 1, 1],
    ["approveChecked", 1, 1],
  ])("%s pins SPL Token %i time(s) and Token-2022 %i", (method, spl, token2022) => {
    expect(pinned(method, SPL_TOKEN_PROGRAM)).toBe(spl);
    expect(pinned(method, TOKEN_2022_PROGRAM)).toBe(token2022);
  });
});

describe("@sauce/token: the reason each SPL check reverts with", () => {
  // Every `require` in the SPL arm names what it refused, and the engine returns that text as the
  // failed cook's return data. Only an engine can make a check FIRE, and `svm.e2e.test.ts` asserts
  // each reason there; this pins, with no engine, which reasons each method's program carries — the
  // UTF-8 bytes, counted — so a dropped or reworded reason fails here too. They are the whole cost
  // of naming the failure (a reason compiles byte for byte), which on Solana comes out of a
  // 1,232-byte transaction: a write's four add 65 bytes.
  const REASONS = [
    "not a token account",
    "wrong mint",
    "not a mint",
    "uninitialized mint",
    "not the token program",
    "amount over u64",
    "wrong decimals",
    "transfer hook",
  ];
  const occurrences = (haystack: Buffer, needle: Buffer): number => {
    let count = 0;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count++;

    return count;
  };
  const reasonsIn = (method: string): Record<string, number> => {
    const bytecode = Buffer.from(compileStdToken(svmEntry(method), "svm").bytecode);

    return Object.fromEntries(
      REASONS.map((reason) => [reason, occurrences(bytecode, Buffer.from(reason))]).filter(
        ([, count]) => count !== 0,
      ),
    );
  };
  const TOKEN_ACCOUNT = { "not a token account": 1, "wrong mint": 1 };
  // The owner and the size check both say "not a mint": either way the account is no mint.
  const MINT = { "not a mint": 2, "uninitialized mint": 1 };
  const WRITE = { "not the token program": 1, ...TOKEN_ACCOUNT, "amount over u64": 1 };
  // A checked write also refuses a mint its callee does not own and decimals not the mint's, and a
  // transfer a hook program.
  const APPROVE_CHECKED = { ...WRITE, "not a mint": 1, "wrong decimals": 1 };
  const TRANSFER_CHECKED = { ...APPROVE_CHECKED, "transfer hook": 1 };

  it.each([
    ["balanceOf", TOKEN_ACCOUNT],
    ["ownerOf", TOKEN_ACCOUNT],
    ["allowance", TOKEN_ACCOUNT],
    ["totalSupply", MINT],
    ["decimals", MINT],
    ["transfer", WRITE],
    ["transferFrom", WRITE],
    ["approve", WRITE],
    ["transferChecked", TRANSFER_CHECKED],
    ["approveChecked", APPROVE_CHECKED],
  ])("%s", (method, expected) => {
    expect(reasonsIn(method)).toEqual(expected);
  });
});

describe("@sauce/token: the legacy writes, byte for byte", () => {
  // Taking Token-2022 changed what the reads accept, and added the checked writes beside the legacy
  // ones; it did not touch `transfer`, `transferFrom` or `approve`. The arm as it was is kept as a
  // fixture, and each legacy write compiles to the same bytes against it as against the library: a
  // program that moved SPL tokens before compiles to the program it compiled to then.
  const legacyArm = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "legacy-token.svm.sauce.ts"),
    "utf8",
  );

  it.each(["transfer", "transferFrom", "approve"])("%s", (method) => {
    const entry = caseNamed(method).svm;
    const now = Buffer.from(compileStdToken(entry, "svm").bytecode).toString("hex");

    expect(now).toBe(Buffer.from(compileStdTokenSvmArm(entry, legacyArm).bytecode).toString("hex"));
  });

  it("the fixture is the legacy arm, not the library", () => {
    // Else the comparison above would hold however the library changed.
    expect(legacyArm).not.toContain("TOKEN_2022_PROGRAM");
    expect(legacyArm).toContain("export function transfer(");
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
    // Importing the library brings every write into scope and each CPIs into a token program, but an
    // unreachable function is never emitted, so none of them reaches the bytecode. The counts above
    // are the evidence rather than this comment: a read pins legacy SPL Token ONCE, where lowering
    // the writes in would put it there several times over.
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
    ["transferChecked", ["tokenProgram", "source", "mint", "dest", "authority"]],
    ["approveChecked", ["tokenProgram", "source", "mint", "delegate", "authority"]],
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
