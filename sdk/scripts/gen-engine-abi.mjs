#!/usr/bin/env node
// Generates sdk/src/svm/engine-abi.generated.ts from the pinned `sauce` dep's
// svm/abi/engine-abi.json.
//
// WHY THIS EXISTS. sdk/src/svm/engine.ts used to re-declare every SVM wire
// constant by hand, with a comment saying "any change there must be reflected
// here, byte for byte." Nothing enforced it: the SDK carried BYTECODE_FORMAT_EPOCH
// = 2 while the engine's value was 4, two repos one constant three values, and no
// test anywhere could notice. The engine now emits svm/abi/engine-abi.json,
// generated from its live Rust constants and CI-asserted byte-equal to them
// (tests/abi_artifact.rs). This script consumes that artifact so the SDK's
// constants are DERIVED from the engine, never hand-copied.
//
// WHY GENERATE A COMMITTED .ts (not import the JSON at runtime). `sauce` is a
// dev-only dep of the compiler — it is NOT shipped in the published package, the
// same reason engine.so / the EVM artifacts are vendored. A published consumer
// cannot resolve svm/abi/engine-abi.json at its own runtime. So the values are
// materialized into a committed TS module; CI regenerates and `git diff`s it
// (drift → red), and a jest drift test (engine-abi-drift.test.ts) additionally
// asserts every artifact key is mapped (so a NEW engine field can't be silently
// dropped — the exact gap that let epoch rot).
//
// OPTIONAL by design: older pins predate the artifact. When it is absent the
// committed copy is left intact and a note is logged — never fatal — mirroring
// how sync-engine-artifacts treats V12RuntimeBytecode.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SDK_DIR, "..");

// Same dep-resolution rule as sync-engine-artifacts: `sauce` is a compiler devDep,
// exposed under a stable symlink there (or hoisted at the root). Never hardcode
// the SHA-pinned pnpm store path.
const ABI_CANDIDATES = [
  resolve(REPO_ROOT, "compiler", "node_modules", "sauce", "svm", "abi", "engine-abi.json"),
  resolve(REPO_ROOT, "node_modules", "sauce", "svm", "abi", "engine-abi.json"),
];
const OUT = resolve(SDK_DIR, "src", "svm", "engine-abi.generated.ts");

const SNAKE = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
const hexToByteList = (hex) => {
  const bytes = hex.match(/.{2}/g) ?? [];
  return bytes.map((b) => `0x${b}`).join(", ");
};

/** Reads the artifact and writes the generated module. Returns {generated, abiPath}. */
export function generateEngineAbi() {
  const abiPath = ABI_CANDIDATES.find(existsSync);
  if (abiPath === undefined) return { generated: false, abiPath: undefined };

  const abi = JSON.parse(readFileSync(abiPath, "utf8"));

  const off = abi.headerOffsets;
  const offsetLines = Object.keys(off)
    .sort()
    .map((k) => `export const BUFFER_OFFSET_${SNAKE(k)} = ${off[k]};`)
    .join("\n");

  const discLines = abi.instructions
    .map(
      (ix) =>
        `export const ${SNAKE(ix.name)}_DISCRIMINATOR = /* ${ix.discriminator} */ new Uint8Array([${hexToByteList(ix.discriminator)}]);`,
    )
    .join("\n");

  // A structural literal copy of the artifact (minus $comment) — the jest drift
  // test deep-equals THIS against the freshly-read artifact, and asserts every
  // artifact key is represented here.
  const structural = JSON.stringify(
    Object.fromEntries(Object.entries(abi).filter(([k]) => k !== "$comment")),
    null,
    2,
  ).replace(/\n/g, "\n  ");

  const ts = `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-engine-abi.mjs from the pinned \`sauce\` dep's
// svm/abi/engine-abi.json (itself generated from the engine's Rust constants and
// CI-asserted byte-equal to them). Run \`pnpm --filter './sdk' sync-engine-artifacts\`
// after a repin; CI regenerates and \`git diff\`s this, and engine-abi-drift.test.ts
// asserts every artifact key is mapped. See engine.ts for how it is consumed.

/** Structural mirror of svm/abi/engine-abi.json (minus \`$comment\`) — the drift test's ground truth. */
export const ENGINE_ABI = ${structural} as const;

// ── sizes / discriminants ──
export const BUFFER_HEADER_BYTES = ${abi.bufferHeaderBytes};
export const BUFFER_SEED_BYTES = ${abi.bufferSeedBytes};
export const BUFFER_SEED = ${JSON.stringify(abi.bufferSeedPrefix)};
export const KIND_BUFFER = ${abi.kindBuffer};
export const MAX_BUFFER_CAPACITY = ${abi.maxBufferCapacity};

// ── header flags ──
export const FLAG_FINALIZED = ${abi.headerFlags.finalized};

// ── execute_from_account / execute_and_close payload flags ──
export const EXECUTE_FLAG_HAS_PIN = ${abi.executeFlags.hasPin};
export const EXECUTE_FLAG_HAS_SLICE = ${abi.executeFlags.hasSlice};

// ── buffer header offsets ──
${offsetLines}

// ── instruction discriminators (Anchor sha256("global:<name>")[..8]) ──
${discLines}
`;

  writeFileSync(OUT, ts);
  return { generated: true, abiPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { generated, abiPath } = generateEngineAbi();
  if (generated)
    console.log(`[gen-engine-abi] wrote src/svm/engine-abi.generated.ts from ${abiPath}`);
  else
    console.log(
      "[gen-engine-abi] svm/abi/engine-abi.json absent from the pinned engine — kept the committed " +
        "engine-abi.generated.ts (older pins predate the artifact).",
    );
}
