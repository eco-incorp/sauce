import { AccountRole, address } from "@solana/kit";
import {
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  assertNoExecutePin,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
} from "../../src/svm/index.js";

const PROGRAM_ID = address("Stake11111111111111111111111111111111111111");
const PAYER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BUFFER = address("So11111111111111111111111111111111111111112");
/** A representative 32-byte PDA seed (e.g. an intent hash) — the u8 index is gone. */

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

describe("buildExecuteFromAccountInstruction", () => {
  it("puts the code account first and carries no payload beyond the discriminator", () => {
    const instruction = buildExecuteFromAccountInstruction({
      programId: PROGRAM_ID,
      code: BUFFER,
      accounts: [{ address: PAYER, role: AccountRole.WRITABLE }],
    });

    // The released engine reads account 0's data verbatim, so there is no flags byte, no pin and no
    // slice — the grammar the pre-release engine took here is gone with it.
    expect(instruction.data).toEqual(EXECUTE_FROM_ACCOUNT_DISCRIMINATOR);
    expect(instruction.accounts).toEqual([
      { address: BUFFER, role: AccountRole.READONLY },
      { address: PAYER, role: AccountRole.WRITABLE },
    ]);
  });
});

/**
 * The guard both pin-accepting surfaces call — `StagedBufferRef.expectedSha256` through
 * `buildSauceSvmCall`, and `SimulateStagedOpts.expectedSha256` through the client's staged
 * transaction. Tested here rather than only through the route, because the client path needs a live
 * RPC to reach and would otherwise be wired but unproven.
 */
describe("assertNoExecutePin", () => {
  it("passes when no pin is supplied — the only shape the engine can honour", () => {
    expect(() => assertNoExecutePin(undefined)).not.toThrow();
  });

  it("throws for any pin, and names where the enforceable one lives", () => {
    expect(() => assertNoExecutePin(new Uint8Array(32).fill(7))).toThrow(
      /expectedSha256 cannot be enforced/,
    );
    // The message has to be actionable, not just a refusal: staging is where a pin works.
    expect(() => assertNoExecutePin(new Uint8Array(32))).toThrow(
      /buildFinalizeCodeBufferInstruction/,
    );
  });

  // A wrong-length pin is still a pin: rejecting on length would imply a correct length exists.
  it("throws for a wrong-length pin too", () => {
    expect(() => assertNoExecutePin(new Uint8Array(4))).toThrow(/cannot be enforced/);
  });
});
