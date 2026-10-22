import { AccountRole, address } from "@solana/kit";
import {
  COOK_AND_PAY_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR,
  decodeExecutionFeeConfig,
  ENGINE_FAULTS,
  engineFaultName,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  EXECUTION_FEE_CONFIG_DISCRIMINATOR,
  assertNoExecutePin,
  buildCookAndPayFromAccountInstruction,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
} from "../../src/svm/index.js";

const PROGRAM_ID = address("Stake11111111111111111111111111111111111111");
const PAYER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BUFFER = address("So11111111111111111111111111111111111111112");
const STAKE_CODE = address("StakeConfig11111111111111111111111111111111");

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

/**
 * The engine's direct paid cooks. Their wire is `process_instruction`'s at v12-svm 1.3.0: the
 * discriminator, `max_execution_fee` as a u64 LE, then the bytecode (`cookAndPay`), nothing
 * (`cookAndPayFromAccount`) or the 32-byte pin (`…Pinned`); the accounts are the program's tail,
 * after the code account for the staged two, then the payer, the System Program and the fee config
 * — the three `execution_fee::authorize` takes off the end. `direct-engine.e2e.test.ts` runs them.
 */
describe("the direct paid cook builders", () => {
  const FEE_CONFIG = address("SysvarRent111111111111111111111111111111111");
  const SYSTEM = address("11111111111111111111111111111111");
  const CAP = 0x0102_0304_0506_0708n;
  const CAP_LE = [0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01];
  const tail = [{ address: BUFFER, role: AccountRole.WRITABLE }];
  const payment = { feeConfig: FEE_CONFIG, feePayer: PAYER, maxExecutionFee: CAP };
  const suffix = [
    { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM, role: AccountRole.READONLY },
    { address: FEE_CONFIG, role: AccountRole.WRITABLE },
  ];

  it("cookAndPay: the fee cap then the bytecode; the tail, then the three payment accounts", () => {
    const instruction = buildCookAndPayInstruction({
      engineProgram: PROGRAM_ID,
      bytecode: new Uint8Array([0x01, 0xaa, 0x00]),
      tail,
      ...payment,
    });

    expect(instruction.programAddress).toBe(PROGRAM_ID);
    expect(instruction.data).toEqual(
      new Uint8Array([...COOK_AND_PAY_DISCRIMINATOR, ...CAP_LE, 0x01, 0xaa, 0x00]),
    );
    expect(instruction.accounts).toEqual([...tail, ...suffix]);
  });

  it("cookAndPayFromAccount: the fee cap alone, the code account first", () => {
    const instruction = buildCookAndPayFromAccountInstruction({
      engineProgram: PROGRAM_ID,
      code: STAKE_CODE,
      tail,
      ...payment,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...COOK_AND_PAY_FROM_ACCOUNT_DISCRIMINATOR, ...CAP_LE]),
    );
    expect(instruction.accounts).toEqual([
      { address: STAKE_CODE, role: AccountRole.READONLY },
      ...tail,
      ...suffix,
    ]);
  });

  it("cookAndPayFromAccountPinned: the fee cap then the 32-byte pin", () => {
    const pin = new Uint8Array(32).fill(0x5a);
    const instruction = buildCookAndPayFromAccountPinnedInstruction({
      engineProgram: PROGRAM_ID,
      code: STAKE_CODE,
      expectedSha256: pin,
      ...payment,
    });

    expect(instruction.data).toEqual(
      new Uint8Array([...COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR, ...CAP_LE, ...pin]),
    );
    expect(instruction.accounts).toEqual([
      { address: STAKE_CODE, role: AccountRole.READONLY },
      ...suffix,
    ]);
  });

  it("refuses a pin that is not 32 bytes, and a cap that is not a u64", () => {
    expect(() =>
      buildCookAndPayFromAccountPinnedInstruction({
        engineProgram: PROGRAM_ID,
        code: STAKE_CODE,
        expectedSha256: new Uint8Array(31),
        ...payment,
      }),
    ).toThrow(/exactly 32 bytes/);
    for (const maxExecutionFee of [-1n, 1n << 64n]) {
      expect(() =>
        buildCookAndPayInstruction({
          engineProgram: PROGRAM_ID,
          bytecode: new Uint8Array(),
          ...payment,
          maxExecutionFee,
        }),
      ).toThrow(/u64 of lamports/);
    }
  });
});

describe("decodeExecutionFeeConfig", () => {
  const config = (fee: bigint): Uint8Array => {
    const data = new Uint8Array(16);
    data.set(EXECUTION_FEE_CONFIG_DISCRIMINATOR, 0);
    new DataView(data.buffer).setBigUint64(8, fee, true);

    return data;
  };

  it("reads the fee after the account discriminator", () => {
    expect(decodeExecutionFeeConfig(config(25_000n))).toBe(25_000n);
    expect(decodeExecutionFeeConfig(config(0n))).toBe(0n);
  });

  it("refuses anything that is not exactly a config: a lookalike is not a fee of zero", () => {
    expect(() => decodeExecutionFeeConfig(new Uint8Array(16))).toThrow(/not a Kitchen/);
    expect(() => decodeExecutionFeeConfig(config(1n).subarray(0, 15))).toThrow(/not a Kitchen/);
    expect(() => decodeExecutionFeeConfig(new Uint8Array([...config(1n), 0]))).toThrow(
      /not a Kitchen/,
    );
  });
});

describe("engineFaultName", () => {
  it("names the engine's fault codes, and nothing it does not use", () => {
    expect(engineFaultName(84)).toBe("ExecutionFeeExceedsMaximum");
    expect(engineFaultName(ENGINE_FAULTS.CodeHashMismatch)).toBe("CodeHashMismatch");
    expect(engineFaultName(0)).toBe("Revert");
    expect(engineFaultName(9999)).toBeUndefined();
  });

  it("names each code once, so a code reads back as the one fault it is", () => {
    const codes = Object.values(ENGINE_FAULTS);

    expect(new Set(codes).size).toBe(codes.length);
    for (const [name, code] of Object.entries(ENGINE_FAULTS)) {
      expect(engineFaultName(code)).toBe(name);
    }
  });
});
