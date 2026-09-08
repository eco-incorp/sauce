/**
 * Packet-budget accounting for the staged execute path.
 *
 * The `939 − 33·N` figure in engine.ts is a MEASURED serialized-transaction size
 * for one specific shape (pin present, NO slice, N extra user accounts), pinned by
 * the engine's `tests/payload_args.rs` against PACKET_DATA_SIZE = 1232. It is not a
 * formula to rescale by editing a term: the new `HAS_SLICE` field adds 8 bytes when
 * present (→ budget − 8), and omitting the pin frees 32 (→ budget + 32).
 *
 * This test locks the part of that budget the SDK actually controls — the exact
 * byte-contribution of each execute_from_account payload shape — so a change to the
 * payload grammar can't silently move the budget out from under stagedArgsBudget.
 * The transaction-envelope constants (293 fixed, 33/account) are the engine's own
 * measurement; the drift guard (engine-abi-drift.test.ts) is what keeps the wire
 * grammar this test encodes in lockstep with that measurement across a repin.
 */
import { address } from "@solana/kit";
import {
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  buildExecuteFromAccountInstruction,
  stagedArgsBudget,
} from "../../src/svm/index.js";

const PROGRAM_ID = address("Stake11111111111111111111111111111111111111");
const BUFFER = address("So11111111111111111111111111111111111111112");
const DISC = EXECUTE_FROM_ACCOUNT_DISCRIMINATOR.length; // 8

/** Payload bytes AFTER the discriminator (what counts against the args budget). */
const payloadLen = (ix: { data?: { length: number } }): number => (ix.data?.length ?? 0) - DISC;

describe("staged execute packet budget", () => {
  it("the shipped shape (pinned, no slice, no args) contributes flags(1) + pin(32) = 33 payload bytes", () => {
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: new Uint8Array(32),
    });
    expect(payloadLen(ix)).toBe(1 + 32);
  });

  it("adding the slice costs exactly 8 more bytes (offset u32 + len u32)", () => {
    const pinned = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: new Uint8Array(32),
    });
    const pinnedSliced = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: new Uint8Array(32),
      slice: { offset: 0, len: 0 },
    });
    expect(payloadLen(pinnedSliced) - payloadLen(pinned)).toBe(8);
  });

  it("omitting the pin frees exactly 32 bytes", () => {
    const pinned = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: new Uint8Array(32),
    });
    const pinless = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
    });
    expect(payloadLen(pinned) - payloadLen(pinless)).toBe(32);
  });

  it("the args budget follows the measured 939 − 33·N line for the shipped (pinned, sliceless) shape", () => {
    // Mirrors engine tests/payload_args.rs — see engine.ts. The SDK never emits a
    // slice on the managed staged path, so this line is the one that governs it.
    expect(stagedArgsBudget(0)).toBe(939);
    expect(stagedArgsBudget(6)).toBe(939 - 33 * 6);
    expect(stagedArgsBudget(10)).toBe(939 - 33 * 10);
  });
});
