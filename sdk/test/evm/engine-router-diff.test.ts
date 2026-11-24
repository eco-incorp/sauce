/**
 * Engine 1.5.0 is engine 1.4.0 with only the fixed Router changed.
 *
 * The engine compiles in one fixed Router (`FIXED_ROUTER_ENC`), and every existing dynamic Pot moves
 * from the 1.4.0 engine to the 1.5.0 one, which is safe only if nothing but that constant differs.
 * `scripts/lib/engine-diff.mjs` checks it (`scripts/engine-diff.mjs` runs it on the digest-verified
 * release files, before the row is committed); this holds the same check in the suite, on the
 * creation code the sync wrote, from then on. No chain.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToBytes, type Hex } from "viem";

import { encodedRouter, routerOnlyDiff } from "../../scripts/lib/engine-diff.mjs";
import { v12ReleaseSet } from "../../src/deployments/index.js";
import { legacyArtifactsDir } from "../release-arm.js";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

const PUSH20 = 0x73;
const BEFORE_ROUTER = "0x1111111111111111111111111111111111111111";
const AFTER_ROUTER = "0x2222222222222222222222222222222222222222";
/** The mask's first byte is 0x94, so a Router starting with it encodes to a first byte of zero. */
const ZERO_ENCODING_ROUTER = `0x94${"11".repeat(19)}`;

/** A 100-byte code of one filler byte, with `router`'s PUSH20 at `at`. */
function code(router: string, at = 10, length = 100): Uint8Array {
  const bytes = new Uint8Array(length).fill(0xaa);
  bytes[at] = PUSH20;
  bytes.set(encodedRouter(router), at + 1);

  return bytes;
}

describe("routerOnlyDiff", () => {
  it("accepts a code whose only change is the fixed Router's PUSH20 payload", () => {
    expect(
      routerOnlyDiff(code(BEFORE_ROUTER), code(AFTER_ROUTER), BEFORE_ROUTER, AFTER_ROUTER),
    ).toEqual({
      ok: true,
      sites: [10],
    });
  });

  it("refuses a second differing byte outside the site, naming it", () => {
    const after = code(AFTER_ROUTER);
    after[50] = 0xbb;
    expect(routerOnlyDiff(code(BEFORE_ROUTER), after, BEFORE_ROUTER, AFTER_ROUTER)).toEqual({
      ok: false,
      problem: "byte 50 differs outside a fixed-Router site",
    });

    // The PUSH20 opcode itself is not payload.
    const retyped = code(AFTER_ROUTER);
    retyped[10] = 0x72;
    expect(routerOnlyDiff(code(BEFORE_ROUTER), retyped, BEFORE_ROUTER, AFTER_ROUTER)).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it("refuses codes of different lengths", () => {
    expect(
      routerOnlyDiff(code(BEFORE_ROUTER), code(AFTER_ROUTER, 10, 101), BEFORE_ROUTER, AFTER_ROUTER),
    ).toEqual({
      ok: false,
      problem: "the creation codes differ in length (100 and 101 bytes)",
    });
  });

  it("refuses a Router whose encoding starts with a zero byte: its push may be narrower", () => {
    expect(encodedRouter(ZERO_ENCODING_ROUTER)[0]).toBe(0);
    for (const [before, after] of [
      [ZERO_ENCODING_ROUTER, AFTER_ROUTER],
      [BEFORE_ROUTER, ZERO_ENCODING_ROUTER],
    ] as const) {
      expect(routerOnlyDiff(code(before), code(after), before, after)).toMatchObject({
        ok: false,
        problem: expect.stringMatching(/starts with a zero byte/),
      });
    }
  });

  it("refuses a code with no site for the earlier Router", () => {
    const bare = new Uint8Array(100).fill(0xaa);
    expect(routerOnlyDiff(bare, bare, BEFORE_ROUTER, AFTER_ROUTER)).toEqual({
      ok: false,
      problem: "no fixed-Router site in the earlier engine",
    });
  });

  it("refuses sites that are not the same in both codes", () => {
    const moved = routerOnlyDiff(
      code(BEFORE_ROUTER, 10),
      code(AFTER_ROUTER, 30),
      BEFORE_ROUTER,
      AFTER_ROUTER,
    );
    // The earlier Router left in place is not the later one's constant.
    const unchanged = routerOnlyDiff(
      code(BEFORE_ROUTER),
      code(BEFORE_ROUTER),
      BEFORE_ROUTER,
      AFTER_ROUTER,
    );
    for (const result of [moved, unchanged]) {
      expect(result).toEqual({
        ok: false,
        problem: "the fixed-Router sites differ between the two engines",
      });
    }
  });
});

describe("the released engines", () => {
  it("engine 1.5.0 is engine 1.4.0 with only the fixed Router changed", () => {
    const [installed, earlier] = [v12ReleaseSet(), v12ReleaseSet("2.6.3")];
    const files = {
      after: join(ARTIFACTS, "V12RuntimeBytecode.json"),
      before: join(legacyArtifactsDir("evm", "1.4.0"), "V12RuntimeBytecode.json"),
    };
    for (const file of Object.values(files)) {
      if (!existsSync(file)) {
        throw new Error(`${file} is missing: run pnpm --filter './sdk' sync-engine-artifacts`);
      }
    }
    const creation = (file: string): Uint8Array => {
      const released: { runtimeCreationCode: Hex } = JSON.parse(readFileSync(file, "utf8"));

      return hexToBytes(released.runtimeCreationCode);
    };

    // E1's one site, measured on its release's creation code.
    expect(
      routerOnlyDiff(
        creation(files.before),
        creation(files.after),
        earlier["kitchen-evm"].fixedRouter!,
        installed["kitchen-evm"].fixedRouter!,
      ),
    ).toEqual({ ok: true, sites: [571] });
  });
});
