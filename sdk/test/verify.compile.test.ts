/**
 * @eco-incorp/sauce/verify — the pins, re-derived from source on every run.
 *
 * `SETTLE_PROGRAM`, `SETTLE_WIRE.PROGRAM_BYTES` and `SETTLE_WIRE.PROGRAM_HASH` are constants in a
 * package that also ships the claims they support, which is only worth anything if something
 * recompiles them. This suite is that something: it compiles `settleSource()` with the published
 * `@eco-incorp/sauce-compiler` exactly as `src/recipes/index.ts` documents — same entry, same
 * resolver, same base dirs — and compares. The v1 corpus it replaces could not do this; its compiler
 * no longer exists.
 *
 * It then closes the round trip the appended-args model rests on: encode a payload from known
 * values, decode it back, and require the SAME values out. The negative controls beside each are the
 * point — a round trip that only ever runs on well-formed input proves the encoder and the decoder
 * agree with each other, not that either is right.
 */
import { existsSync, readFileSync } from "fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "path";
import { keccak256 } from "viem";
import type { Hex } from "viem";

import { SAUCE_BASE_DIRS, settleSource } from "../src/recipes/index.js";
import {
  decodeSettleProgram,
  encodeSettleProgram,
  validateSettleProgram,
  SettleDecodeError,
  SETTLE_PROGRAM,
  SETTLE_WIRE,
} from "../src/verify/index";

// Required via `createRequire` for the same reason `test/helpers.ts` does: the package's `node`
// condition is a CommonJS build that reads its sibling `.wasm` off disk at load, and jest's ESM
// transform does not resolve that sibling.
const { compile } = createRequire(import.meta.url)("sauce-compiler") as {
  compile: (options: {
    target: "evm" | "svm";
    entry?: string;
    resolve: (path: string) => Uint8Array | undefined;
  }) => { bytecode: Uint8Array };
};

/** The resolved compiler's own manifest. `./package.json` is not in the package's `exports` map, so
 *  requiring it directly throws — resolve the entry and walk up. Not every `package.json` on that walk
 *  is the manifest: the package already ships `web/package.json`, which is only `{"type":"module"}`,
 *  so anchor on the one that NAMES the package rather than the first one found. */
function compilerPackage(): { name: string; version: string } {
  let dir = dirname(createRequire(import.meta.url).resolve("sauce-compiler"));
  for (let up = 0; up < 10; up++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf-8")) as Partial<{
        name: string;
        version: string;
      }>;
      if (parsed.name === "@eco-incorp/sauce-compiler" && parsed.version)
        return { name: parsed.name, version: parsed.version };
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the @eco-incorp/sauce-compiler manifest");
}

/** jest cwd is `sdk/`; the workspaces sit beside it under the repo root. */
const REPO_ROOT = resolve(process.cwd(), "..");
const WORKSPACE_MANIFESTS = [
  "package.json",
  "sdk/package.json",
  "actions/package.json",
  "dev-tools/package.json",
] as const;

/** The compile `src/recipes/index.ts` documents to partners, run for real. */
function compileSettle(): Hex {
  const { bytecode } = compile({
    target: "evm",
    entry: "settle.sauce.ts",
    resolve: (path) => {
      if (path.endsWith("settle.sauce.ts")) return new TextEncoder().encode(settleSource());
      const key = path.replace(/^\.\//, "");
      const found = SAUCE_BASE_DIRS.map((dir) => join(dir, key)).find(existsSync);

      return found === undefined ? undefined : readFileSync(found);
    },
  });

  return ("0x" + Buffer.from(bytecode).toString("hex")) as Hex;
}

const TOKENS = [
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0x4200000000000000000000000000000000000006",
  "0x0000000000000000000000000000000000ff00aa",
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
] as Hex[];
const RECIPIENT = "0xcafecafecafecafecafecafecafecafecafecafe" as Hex;

describe("the settle program pin, recompiled", () => {
  const compiled = compileSettle();

  it("compiles to exactly SETTLE_WIRE.PROGRAM_BYTES", () => {
    expect((compiled.length - 2) / 2).toBe(SETTLE_WIRE.PROGRAM_BYTES);
  });

  it("reproduces the committed SETTLE_PROGRAM byte for byte", () => {
    expect(compiled).toBe(SETTLE_PROGRAM.toLowerCase());
  });

  it("hashes to the pinned SETTLE_WIRE.PROGRAM_HASH", () => {
    expect(keccak256(compiled)).toBe(SETTLE_WIRE.PROGRAM_HASH);
  });

  it("is deterministic — a second compile is the same bytes", () => {
    expect(compileSettle()).toBe(compiled);
  });

  // The dependency is a caret range, so the pins above can stay green while a resolved 0.7.x that
  // did not change codegen quietly makes `PROGRAM_COMPILER` name a producer that is not the one
  // that ran. Assert the resolved version, or the provenance string records nothing.
  it("was produced by the compiler SETTLE_WIRE.PROGRAM_COMPILER names", () => {
    const { name, version } = compilerPackage();
    expect(`${name}@${version}`).toBe(SETTLE_WIRE.PROGRAM_COMPILER);
  });

  /**
   * The version ABOVE is the one resolved from `sdk/`. It is not necessarily the one a consumer
   * gets: the published package is the ROOT `@eco-incorp/sauce`, and each workspace declares
   * `sauce-compiler` separately. Bumping one leaves the pins asserted against a compiler nobody
   * installs — which is exactly what happened here: root moved to ^0.7.0 while `sdk`, `actions` and
   * `dev-tools` stayed on ^0.5.0, and 0.7.0 emits 370 bytes where 0.5.0 emits 391. Every pin above
   * stayed green while a consumer's own settle hashed to something `validateSettleProgram` rejects.
   */
  it("every workspace declares the SAME compiler range, so the pin describes what ships", () => {
    const declared = WORKSPACE_MANIFESTS.map((rel) => {
      const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, rel), "utf8")) as {
        dependencies?: Record<string, string>;
      };

      return [rel, manifest.dependencies?.["sauce-compiler"]] as const;
    });

    // Named individually so a failure says WHICH workspace drifted, not just that one did.
    for (const [rel, spec] of declared) {
      expect([rel, spec]).toEqual([rel, declared[0]![1]]);
    }
    // …and that shared range must be the major.minor the pin names.
    const pinned = SETTLE_WIRE.PROGRAM_COMPILER.split("@").pop()!;
    expect(declared[0]![1]).toBe(`npm:@eco-incorp/sauce-compiler@^${pinned}`);
  });
});

describe("encode → decode round trip on the real compiled program", () => {
  for (const count of [1, 2, 5]) {
    for (const minOut of [0n, 1234567890123456789012n]) {
      it(`recovers ${count} token(s) with minOut=${minOut}`, () => {
        const tokens = TOKENS.slice(0, count);
        const payload = encodeSettleProgram(tokens, minOut, RECIPIENT, SETTLE_PROGRAM);
        const decoded = validateSettleProgram(payload);

        expect(decoded.tokens).toEqual(tokens);
        expect(decoded.minOut).toBe(minOut);
        expect(decoded.recipient).toBe(RECIPIENT);
        expect(decoded.floorToken).toBe(tokens[0]);
        expect(decoded.program).toBe(SETTLE_PROGRAM.toLowerCase());
        expect(decoded.argsSize).toBe(128 + 32 * count);
      });
    }
  }

  it("the program half is identical across every arity and every minOut", () => {
    const programs = new Set(
      [1, 2, 5].flatMap((count) =>
        [0n, 7n].map(
          (minOut) =>
            decodeSettleProgram(
              encodeSettleProgram(TOKENS.slice(0, count), minOut, RECIPIENT, SETTLE_PROGRAM),
            ).program,
        ),
      ),
    );
    expect(programs.size).toBe(1);
  });
});

describe("negative controls", () => {
  const payload = encodeSettleProgram(TOKENS.slice(0, 2), 42n, RECIPIENT, SETTLE_PROGRAM);
  /** Byte `index` of the payload, as its two hex characters' position in the string. */
  const at = (index: number): number => 2 + index * 2;
  const flipByte = (hex: Hex, index: number): Hex =>
    (hex.slice(0, at(index)) +
      (parseInt(hex.slice(at(index), at(index) + 2), 16) ^ 0xff).toString(16).padStart(2, "0") +
      hex.slice(at(index) + 2)) as Hex;

  it("one flipped program byte fails the hash pin — at the first byte, the middle and the last", () => {
    for (const index of [
      0,
      Math.floor(SETTLE_WIRE.PROGRAM_BYTES / 2),
      SETTLE_WIRE.PROGRAM_BYTES - 1,
    ]) {
      const tampered = flipByte(payload, index);
      expect(tampered).not.toBe(payload);
      // Still structurally decodable — which is exactly why the hash pin has to exist.
      expect(decodeSettleProgram(tampered).minOut).toBe(42n);
      expect(() => validateSettleProgram(tampered)).toThrow(SettleDecodeError);
      try {
        validateSettleProgram(tampered);
      } catch (e) {
        expect((e as SettleDecodeError).code).toBe("PROGRAM_HASH");
      }
    }
  });

  it("an altered recipient word decodes to the ALTERED value, never silently to the original", () => {
    // The recipient's low byte is the last byte of head slot 2.
    const recipientLowByte = SETTLE_WIRE.PROGRAM_BYTES + 3 * SETTLE_WIRE.WORD_BYTES - 1;
    const tampered = flipByte(payload, recipientLowByte);
    const decoded = validateSettleProgram(tampered);

    expect(decoded.recipient).not.toBe(RECIPIENT);
    expect(BigInt(decoded.recipient)).toBe(BigInt(RECIPIENT) ^ 0xffn);
  });

  it("an altered token word decodes to the ALTERED token", () => {
    const firstTokenLowByte = SETTLE_WIRE.PROGRAM_BYTES + 5 * SETTLE_WIRE.WORD_BYTES - 1;
    const decoded = validateSettleProgram(flipByte(payload, firstTokenLowByte));

    expect(BigInt(decoded.tokens[0]!)).toBe(BigInt(TOKENS[0]!) ^ 0xffn);
    expect(BigInt(decoded.tokens[1]!)).toBe(BigInt(TOKENS[1]!));
  });

  it("a truncated tail is rejected rather than read past the end", () => {
    for (const drop of [1, 16, 32, 64]) {
      const truncated = payload.slice(0, payload.length - drop * 2) as Hex;
      expect(() => validateSettleProgram(truncated)).toThrow(SettleDecodeError);
      try {
        validateSettleProgram(truncated);
      } catch (e) {
        expect((e as SettleDecodeError).code).toBe("ARGS_TRUNCATED");
      }
    }
  });
});
