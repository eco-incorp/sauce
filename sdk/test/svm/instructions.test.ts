import { AccountRole, address } from "@solana/kit";
import {
  BUFFER_HEADER_BYTES,
  BUFFER_SEED_BYTES,
  CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
  CLOSE_BUFFER_DISCRIMINATOR,
  EXECUTE_AND_CLOSE_DISCRIMINATOR,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  FINALIZE_BUFFER_DISCRIMINATOR,
  INIT_BUFFER_DISCRIMINATOR,
  MAX_BUFFER_CAPACITY,
  PDA_GROWTH_STEP,
  WRITE_BUFFER_DISCRIMINATOR,
  buildCloseBufferCheckedInstruction,
  buildCloseBufferInstruction,
  buildExecuteAndCloseInstruction,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
  buildFinalizeBufferInstruction,
  buildInitBufferInstructions,
  buildStagingPlan,
  buildWriteBufferInstruction,
  stagedArgsBudget,
} from "../../src/svm/index.js";

const PROGRAM_ID = address("Stake11111111111111111111111111111111111111");
const PAYER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BUFFER = address("So11111111111111111111111111111111111111112");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
/** A representative 32-byte PDA seed (e.g. an intent hash) — the u8 index is gone. */
const SEED = new Uint8Array(32).fill(0x07);

describe("engine constants", () => {
  it("match the engine crate values (generated from svm/abi/engine-abi.json)", () => {
    expect(BUFFER_HEADER_BYTES).toBe(112); // 80 → 112: dropped version/index/epoch, added the 32-byte seed@80
    expect(BUFFER_SEED_BYTES).toBe(32); // caller-supplied PDA seed
    expect(MAX_BUFFER_CAPACITY).toBe(0xffff); // the last addressable 16-bit pc
    expect(PDA_GROWTH_STEP).toBe(10240); // MAX_PERMITTED_DATA_INCREASE
  });

  it("staged args budget follows the measured 939 - 33N packet line", () => {
    expect(stagedArgsBudget(0)).toBe(939);
    expect(stagedArgsBudget(6)).toBe(939 - 33 * 6);
    expect(stagedArgsBudget(10)).toBe(939 - 33 * 10);
  });
});

describe("buildExecuteInstruction", () => {
  const bytecode = new Uint8Array([0x01, 0xaa, 0x00]); // BYTE_1 0xAA, STOP
  const userA = address("So11111111111111111111111111111111111111112");
  const userB = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  it("prefixes the bytecode with the execute discriminator", () => {
    const instruction = buildExecuteInstruction({ programId: PROGRAM_ID, bytecode, accounts: [] });

    expect(instruction.data).toEqual(new Uint8Array([...EXECUTE_DISCRIMINATOR, 0x01, 0xaa, 0x00]));
    expect(instruction.programAddress).toBe(PROGRAM_ID);
  });

  it("the account list IS the user-account index space (no fixed prefix)", () => {
    const instruction = buildExecuteInstruction({
      programId: PROGRAM_ID,
      bytecode,
      accounts: [
        { address: userA, role: AccountRole.WRITABLE },
        { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
        { address: userB, role: AccountRole.READONLY },
      ],
    });

    // user-account index i = instruction account i
    expect(instruction.accounts).toEqual([
      { address: userA, role: AccountRole.WRITABLE },
      { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
      { address: userB, role: AccountRole.READONLY },
    ]);
  });

  it("a signerless account list is valid (NoSigner is lazy)", () => {
    const instruction = buildExecuteInstruction({ programId: PROGRAM_ID, bytecode, accounts: [] });

    expect(instruction.accounts).toEqual([]);
  });
});

describe("buildExecuteFromAccountInstruction — the v2 payload grammar", () => {
  const user = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  it("prepends the buffer READ-ONLY: the user tail is byte-identical to inline execute", () => {
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [
        { address: user, role: AccountRole.WRITABLE },
        { address: PAYER, role: AccountRole.READONLY_SIGNER },
      ],
    });

    expect(instruction.accounts).toEqual([
      { address: BUFFER, role: AccountRole.READONLY },
      { address: user, role: AccountRole.WRITABLE },
      { address: PAYER, role: AccountRole.READONLY_SIGNER },
    ]);
  });

  it("pinless, argless: the payload is exactly the required flags byte [0x00] — never empty", () => {
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
    });

    expect(instruction.data).toEqual(new Uint8Array([...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, 0x00]));
  });

  it("pin: flags 0x01 + the 32-byte content-hash pin", () => {
    const pin = new Uint8Array(32).fill(0xcd);
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: pin,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, 0x01, ...pin]),
    );
  });

  it("args ride after the flags byte (pinless) and after the pin (pinned)", () => {
    const args = new Uint8Array([0xca, 0xfe]);
    const pin = new Uint8Array(32).fill(0xef);

    const pinless = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      args,
    });
    expect(pinless.data).toEqual(
      new Uint8Array([...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, 0x00, 0xca, 0xfe]),
    );

    const pinned = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: pin,
      args,
    });
    expect(pinned.data).toEqual(
      new Uint8Array([...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, 0x01, ...pin, 0xca, 0xfe]),
    );
  });

  it("rejects a pin that is not exactly 32 bytes", () => {
    expect(() =>
      buildExecuteFromAccountInstruction({
        programId: PROGRAM_ID,
        buffer: BUFFER,
        accounts: [],
        expectedSha256: new Uint8Array(31),
      }),
    ).toThrow("expectedSha256 must be exactly 32 bytes, got 31");
  });
});

describe("buffer lifecycle builders", () => {
  it("init_buffer payload is seed[32] + capacity u32 LE (exactly 36 bytes); one instruction under one growth step", () => {
    const instructions = buildInitBufferInstructions({
      programId: PROGRAM_ID,
      payer: PAYER,
      buffer: BUFFER,
      seed: SEED,
      capacity: 4096,
    });

    expect(instructions).toHaveLength(1); // 112 + 4096 = 4208 ≤ 10240
    expect(instructions[0].data).toEqual(
      new Uint8Array([...INIT_BUFFER_DISCRIMINATOR, ...SEED, 0x00, 0x10, 0x00, 0x00]),
    );
    expect(instructions[0].data).toHaveLength(8 + 36); // disc + seed(32) + capacity(4)
    expect(instructions[0].accounts).toEqual([
      { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
      { address: BUFFER, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ]);
  });

  it("a 16 KB buffer needs two init instructions (create + one grow), all one transaction", () => {
    const instructions = buildInitBufferInstructions({
      programId: PROGRAM_ID,
      payer: PAYER,
      buffer: BUFFER,
      seed: SEED,
      capacity: 16 * 1024,
    });

    expect(instructions).toHaveLength(2); // 112 + 16384 = 16496 → 2 x 10240 steps
    expect(instructions[0].data).toEqual(instructions[1].data);
    expect(instructions[0].data).not.toBe(instructions[1].data);
  });

  it("init_buffer emits only the missing growth steps and validates capacity + seed length", () => {
    const grown = buildInitBufferInstructions({
      programId: PROGRAM_ID,
      payer: PAYER,
      buffer: BUFFER,
      seed: SEED,
      capacity: 16 * 1024,
      currentBytes: 10240,
    });

    expect(grown).toHaveLength(1);
    expect(() =>
      buildInitBufferInstructions({
        programId: PROGRAM_ID,
        payer: PAYER,
        buffer: BUFFER,
        seed: SEED,
        capacity: MAX_BUFFER_CAPACITY + 1,
      }),
    ).toThrow(`buffer capacity must be 1-${MAX_BUFFER_CAPACITY} bytes, got 65536`);
    expect(() =>
      buildInitBufferInstructions({
        programId: PROGRAM_ID,
        payer: PAYER,
        buffer: BUFFER,
        seed: new Uint8Array(31),
        capacity: 100,
      }),
    ).toThrow("buffer seed must be exactly 32 bytes, got 31 bytes");
  });

  it("write_buffer payload is offset u32 LE + the chunk; [authority RS, buffer W]", () => {
    const chunk = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const instruction = buildWriteBufferInstruction({
      programId: PROGRAM_ID,
      authority: PAYER,
      buffer: BUFFER,
      offset: 0x1234,
      chunk,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...WRITE_BUFFER_DISCRIMINATOR, 0x34, 0x12, 0x00, 0x00, ...chunk]),
    );
    expect(instruction.accounts).toEqual([
      { address: PAYER, role: AccountRole.READONLY_SIGNER },
      { address: BUFFER, role: AccountRole.WRITABLE },
    ]);
  });

  it("finalize_buffer payload is len u32 LE + the 32-byte sha256 (exactly 36 payload bytes)", () => {
    const sha256 = new Uint8Array(32).fill(0xab);
    const instruction = buildFinalizeBufferInstruction({
      programId: PROGRAM_ID,
      authority: PAYER,
      buffer: BUFFER,
      length: 5000,
      sha256,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...FINALIZE_BUFFER_DISCRIMINATOR, 0x88, 0x13, 0x00, 0x00, ...sha256]),
    );
    expect(instruction.data).toHaveLength(8 + 36);
    expect(() =>
      buildFinalizeBufferInstruction({
        programId: PROGRAM_ID,
        authority: PAYER,
        buffer: BUFFER,
        length: 1,
        sha256: new Uint8Array(16),
      }),
    ).toThrow("sha256 must be exactly 32 bytes, got 16");
  });

  it("close_buffer carries no payload; [authority WS, buffer W]", () => {
    const instruction = buildCloseBufferInstruction({
      programId: PROGRAM_ID,
      authority: PAYER,
      buffer: BUFFER,
    });

    expect(instruction.data).toEqual(CLOSE_BUFFER_DISCRIMINATOR);
    expect(instruction.data).not.toBe(CLOSE_BUFFER_DISCRIMINATOR); // fresh copy
    expect(instruction.accounts).toEqual([
      { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
      { address: BUFFER, role: AccountRole.WRITABLE },
    ]);
  });
});

describe("execute_from_account slice (foreign-account path)", () => {
  it("flags 0x02 + offset,len u32 LE ride after the flags byte (pinless foreign)", () => {
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      slice: { offset: 0x70, len: 0x1234 },
    });

    // [disc][flags=0x02][offset u32 LE][len u32 LE]
    expect(instruction.data).toEqual(
      new Uint8Array([
        ...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
        0x02,
        0x70,
        0x00,
        0x00,
        0x00,
        0x34,
        0x12,
        0x00,
        0x00,
      ]),
    );
  });

  it("pin + slice: flags 0x03, pin precedes the slice, both precede args", () => {
    const pin = new Uint8Array(32).fill(0xcd);
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [],
      expectedSha256: pin,
      slice: { offset: 1, len: 2 },
      args: new Uint8Array([0xaa]),
    });

    expect(instruction.data).toEqual(
      new Uint8Array([
        ...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
        0x03,
        ...pin,
        1,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        0xaa,
      ]),
    );
  });
});

describe("buildExecuteAndCloseInstruction", () => {
  const authority = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  it("lists the buffer WRITABLE first, authority in the user tail, same payload grammar", () => {
    const pin = new Uint8Array(32).fill(0xef);
    const instruction = buildExecuteAndCloseInstruction({
      programId: PROGRAM_ID,
      buffer: BUFFER,
      accounts: [{ address: authority, role: AccountRole.WRITABLE_SIGNER }],
      expectedSha256: pin,
    });

    expect(instruction.accounts).toEqual([
      { address: BUFFER, role: AccountRole.WRITABLE }, // NOT read-only: it gets reaped
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
    ]);
    expect(instruction.data).toEqual(
      new Uint8Array([...EXECUTE_AND_CLOSE_DISCRIMINATOR, 0x01, ...pin]),
    );
  });
});

describe("buildCloseBufferCheckedInstruction", () => {
  it("carries the 32-byte pin; [authority WS, buffer W]", () => {
    const pin = new Uint8Array(32).fill(0x11);
    const instruction = buildCloseBufferCheckedInstruction({
      programId: PROGRAM_ID,
      authority: PAYER,
      buffer: BUFFER,
      expectedSha256: pin,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...CLOSE_BUFFER_CHECKED_DISCRIMINATOR, ...pin]),
    );
    expect(instruction.accounts).toEqual([
      { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
      { address: BUFFER, role: AccountRole.WRITABLE },
    ]);
    expect(() =>
      buildCloseBufferCheckedInstruction({
        programId: PROGRAM_ID,
        authority: PAYER,
        buffer: BUFFER,
        expectedSha256: new Uint8Array(16),
      }),
    ).toThrow("expectedSha256 must be exactly 32 bytes, got 16");
  });
});

describe("buildStagingPlan", () => {
  it("pins the engine staging protocol: 8/12/20 transactions for 4/8/16 KB", () => {
    expect(buildStagingPlan(4 * 1024).transactions).toEqual({
      init: 1,
      writes: 5,
      finalize: 1,
      execute: 1,
      total: 8,
    });
    expect(buildStagingPlan(8 * 1024).transactions).toEqual({
      init: 1,
      writes: 9,
      finalize: 1,
      execute: 1,
      total: 12,
    });
    expect(buildStagingPlan(16 * 1024).transactions).toEqual({
      init: 1,
      writes: 17,
      finalize: 1,
      execute: 1,
      total: 20,
    });
  });

  it("chunks cover the bytecode exactly, in order, at the 1,000-byte default", () => {
    const plan = buildStagingPlan(2500);

    expect(plan.chunks).toEqual([
      { offset: 0, length: 1000 },
      { offset: 1000, length: 1000 },
      { offset: 2000, length: 500 },
    ]);
    expect(plan.capacity).toBe(2500);
  });

  it("init instruction counts follow the 10,240-byte growth step (header included)", () => {
    expect(buildStagingPlan(4 * 1024).initInstructionCount).toBe(1); // 4176
    expect(buildStagingPlan(16 * 1024).initInstructionCount).toBe(2); // 16464
    expect(buildStagingPlan(MAX_BUFFER_CAPACITY).initInstructionCount).toBe(7); // 65615
  });

  it("rejects out-of-range inputs", () => {
    expect(() => buildStagingPlan(0)).toThrow(
      `bytecode length must be 1-${MAX_BUFFER_CAPACITY} bytes, got 0`,
    );
    expect(() => buildStagingPlan(MAX_BUFFER_CAPACITY + 1)).toThrow(
      `bytecode length must be 1-${MAX_BUFFER_CAPACITY} bytes, got 65536`,
    );
    expect(() => buildStagingPlan(100, 0)).toThrow("chunk size must be a positive integer, got 0");
  });
});
