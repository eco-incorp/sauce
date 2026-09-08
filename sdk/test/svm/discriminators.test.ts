import { createHash } from "node:crypto";
import {
  CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
  CLOSE_BUFFER_DISCRIMINATOR,
  EXECUTE_AND_CLOSE_DISCRIMINATOR,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  FINALIZE_BUFFER_DISCRIMINATOR,
  INIT_BUFFER_DISCRIMINATOR,
  WRITE_BUFFER_DISCRIMINATOR,
} from "../../src/svm/index.js";
import * as svm from "../../src/svm/index.js";

// Anchor-style discriminator: sha256("global:<instruction_name>")[..8]
function anchorDiscriminator(name: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
}

// All 8 engine instructions, name → exported constant (execute_and_close +
// close_buffer_checked joined the surface with the generic-execution engine).
const DISCRIMINATORS: Record<string, Uint8Array> = {
  execute: EXECUTE_DISCRIMINATOR,
  execute_from_account: EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  execute_and_close: EXECUTE_AND_CLOSE_DISCRIMINATOR,
  init_buffer: INIT_BUFFER_DISCRIMINATOR,
  write_buffer: WRITE_BUFFER_DISCRIMINATOR,
  finalize_buffer: FINALIZE_BUFFER_DISCRIMINATOR,
  close_buffer: CLOSE_BUFFER_DISCRIMINATOR,
  close_buffer_checked: CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
};

// The Wave C memory-PDA instructions, deleted from the engine surface — their
// discriminator constants must be gone from the SDK too.
const RETIRED = ["init_stack", "init_heap", "init_frames", "init_args", "close_memory"];

describe("engine instruction discriminators", () => {
  it("covers the full 8-instruction surface", () => {
    expect(Object.keys(DISCRIMINATORS)).toHaveLength(8);
  });

  for (const [name, constant] of Object.entries(DISCRIMINATORS)) {
    it(`${name} matches sha256("global:${name}")[..8]`, () => {
      expect(constant).toEqual(anchorDiscriminator(name));
    });
  }

  it("discriminators are pairwise distinct", () => {
    const hexes = Object.values(DISCRIMINATORS).map((d) => Buffer.from(d).toString("hex"));

    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("the 5 retired memory-PDA discriminators are no longer exported", () => {
    const exportedHexes = new Set(
      Object.values(svm)
        .filter((v) => v instanceof Uint8Array && v.length === 8)
        .map((d) => Buffer.from(d as Uint8Array).toString("hex")),
    );

    for (const name of RETIRED) {
      const constantName = `${name.toUpperCase()}_DISCRIMINATOR`;

      expect(svm).not.toHaveProperty(constantName);
      expect(exportedHexes.has(Buffer.from(anchorDiscriminator(name)).toString("hex"))).toBe(false);
    }
  });
});
