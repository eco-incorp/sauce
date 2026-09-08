/**
 * DRIFT GUARD for the SVM wire contract.
 *
 * The bug this exists to prevent: the SDK once hand-copied every engine constant,
 * carried BYTECODE_FORMAT_EPOCH = 2 while the engine's value was 4, then the field
 * was deleted — and no test anywhere could notice. The SDK now DERIVES its wire
 * constants from the engine's generated svm/abi/engine-abi.json (via
 * gen-engine-abi.mjs → engine-abi.generated.ts). This test reads that artifact
 * fresh from the pinned dep and asserts the generated module agrees with it — so a
 * repin that changes the wire fails here if the generated module wasn't regenerated
 * (CI's git-diff catches the same drift structurally; this additionally catches a
 * NEW artifact key the generator silently dropped).
 *
 * Offline/private-dep safe: the git dep's tree (incl. svm/abi/engine-abi.json) is
 * present after `pnpm install`; no Solana/Rust toolchain needed. Skips cleanly if
 * a pin predates the artifact (older release/beta commits) — the same OPTIONAL
 * posture the generator and V12RuntimeBytecode use.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUFFER_HEADER_BYTES,
  BUFFER_SEED,
  BUFFER_SEED_BYTES,
  BUFFER_OFFSET_AUTHORITY,
  BUFFER_OFFSET_LEN,
  BUFFER_OFFSET_HASH,
  BUFFER_OFFSET_SEED,
  EXECUTE_FLAG_HAS_PIN,
  EXECUTE_FLAG_HAS_SLICE,
  FLAG_FINALIZED,
  KIND_BUFFER,
  MAX_BUFFER_CAPACITY,
  ENGINE_ABI,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  EXECUTE_AND_CLOSE_DISCRIMINATOR,
  INIT_BUFFER_DISCRIMINATOR,
  WRITE_BUFFER_DISCRIMINATOR,
  FINALIZE_BUFFER_DISCRIMINATOR,
  CLOSE_BUFFER_DISCRIMINATOR,
  CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
} from "../../src/svm/index.js";

const ABI_PATH = [
  resolve(
    process.cwd(),
    "..",
    "compiler",
    "node_modules",
    "sauce",
    "svm",
    "abi",
    "engine-abi.json",
  ),
  resolve(process.cwd(), "..", "node_modules", "sauce", "svm", "abi", "engine-abi.json"),
].find(existsSync);

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

const describeIfArtifact = ABI_PATH === undefined ? describe.skip : describe;

describeIfArtifact("SVM engine ABI drift guard", () => {
  const abi = JSON.parse(readFileSync(ABI_PATH as string, "utf8"));

  it("the generated ENGINE_ABI mirror equals the pinned artifact byte-for-byte (minus $comment)", () => {
    const { $comment: _drop, ...rest } = abi;
    expect(ENGINE_ABI).toEqual(rest);
  });

  it("every artifact top-level key is represented in the generated mirror (no silently-dropped field)", () => {
    const artifactKeys = Object.keys(abi)
      .filter((k) => k !== "$comment")
      .sort();
    expect(Object.keys(ENGINE_ABI).sort()).toEqual(artifactKeys);
  });

  it("the derived scalar constants match the artifact", () => {
    expect(BUFFER_HEADER_BYTES).toBe(abi.bufferHeaderBytes);
    expect(BUFFER_SEED_BYTES).toBe(abi.bufferSeedBytes);
    expect(BUFFER_SEED).toBe(abi.bufferSeedPrefix);
    expect(KIND_BUFFER).toBe(abi.kindBuffer);
    expect(MAX_BUFFER_CAPACITY).toBe(abi.maxBufferCapacity);
    expect(FLAG_FINALIZED).toBe(abi.headerFlags.finalized);
    expect(EXECUTE_FLAG_HAS_PIN).toBe(abi.executeFlags.hasPin);
    expect(EXECUTE_FLAG_HAS_SLICE).toBe(abi.executeFlags.hasSlice);
  });

  it("the header offsets used by the SDK match the artifact", () => {
    expect(BUFFER_OFFSET_AUTHORITY).toBe(abi.headerOffsets.authority);
    expect(BUFFER_OFFSET_LEN).toBe(abi.headerOffsets.len);
    expect(BUFFER_OFFSET_HASH).toBe(abi.headerOffsets.contentSha256);
    expect(BUFFER_OFFSET_SEED).toBe(abi.headerOffsets.seed);
  });

  it("every discriminator matches the artifact (all 8 instructions), keyed by name", () => {
    const byName: Record<string, Uint8Array> = {
      execute: EXECUTE_DISCRIMINATOR,
      execute_from_account: EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
      execute_and_close: EXECUTE_AND_CLOSE_DISCRIMINATOR,
      init_buffer: INIT_BUFFER_DISCRIMINATOR,
      write_buffer: WRITE_BUFFER_DISCRIMINATOR,
      finalize_buffer: FINALIZE_BUFFER_DISCRIMINATOR,
      close_buffer: CLOSE_BUFFER_DISCRIMINATOR,
      close_buffer_checked: CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
    };
    // Every artifact instruction has a matching exported constant, and vice-versa.
    const artifactNames = (abi.instructions as { name: string; discriminator: string }[])
      .map((ix) => ix.name)
      .sort();
    expect(Object.keys(byName).sort()).toEqual(artifactNames);
    for (const ix of abi.instructions as { name: string; discriminator: string }[]) {
      expect(hex(byName[ix.name])).toBe(ix.discriminator);
    }
  });
});
