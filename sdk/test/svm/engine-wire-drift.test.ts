/**
 * DRIFT GUARDS for the two RELEASED programs — the engine's wire artifact and the kitchen's Anchor
 * IDL, both fetched and digest-pinned by `sync-engine-artifacts.mjs`.
 *
 * The bug they exist to prevent is the one that let BYTECODE_FORMAT_EPOCH rot: a constant
 * transcribed by hand from another repo, with nothing to notice when the other repo moved. That is
 * exactly `svm/kitchen.ts`'s position — Anchor emits an IDL, not TypeScript, so every discriminator,
 * seed and bound in it is a hand copy. Here they are compared against the artifact itself.
 *
 * Discriminators are checked THROUGH THE BUILDERS rather than against an exported table: they are
 * the first eight bytes each builder emits, which is the thing that actually has to be right, and
 * it keeps the module's discriminator table private.
 *
 * Both suites skip without their artifact rather than fail, because the artifacts are release
 * downloads and not every checkout has run the sync. The engine-abi drift guard beside this one is
 * NOT skippable for the opposite reason: its artifact is vendored in-repo.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  AccountRole,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  buildCloseCodeBufferInstruction,
  buildClosePotInstruction,
  buildCookAndPayFromAccountInstruction,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
  ENGINE_FAULTS,
  EXECUTION_FEE_CONFIG_DISCRIMINATOR,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildInitializeExecutionFeeInstruction,
  buildSetExecutionFeeInstruction,
  buildWithdrawExecutionFeesInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildWriteCodeBufferInstruction,
  CODE_BUFFER_SEED,
  CODE_SEED,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  GROWTH_STEP,
  HEAP_FRAME_BYTES,
  MAX_CODE_LEN,
  MAX_POT_LEN,
  POT_SEED,
} from "../../src/svm/index.js";
import { KITCHEN_ERROR } from "./kitchen-errors.js";

const WIRE_JSON = process.env.SAUCE_ENGINE_WIRE_JSON;
const IDL_JSON = process.env.SAUCE_KITCHEN_IDL_JSON;

// Skipping is a local-developer convenience, never a CI outcome — a guard that silently stops
// guarding is the failure mode this file exists to prevent. CI fetches both artifacts, so an absent
// one is a failure there.
if (process.env.CI) {
  // Set-but-missing is the case worth naming: the describes below gate on existsSync, so a variable
  // pointing at a path that is not there skips them — and jest prints a skipped suite and a passing
  // one identically. Checking the FILES, not just the variables, is what closes that.
  const missing = (
    [
      ["SAUCE_ENGINE_WIRE_JSON", WIRE_JSON],
      ["SAUCE_KITCHEN_IDL_JSON", IDL_JSON],
    ] as const
  ).filter(([, path]) => path === undefined || !existsSync(path));

  if (missing.length > 0) {
    throw new Error(
      `these drift guards must never skip in CI, but ${missing
        .map(([name, path]) => `${name}=${path ?? "(unset)"}`)
        .join(", ")} does not point at a readable file. The sync step prints both and CI appends ` +
        `them to $GITHUB_ENV.`,
    );
  }
}

const describeWire = WIRE_JSON && existsSync(WIRE_JSON) ? describe : describe.skip;
const describeIdl = IDL_JSON && existsSync(IDL_JSON) ? describe : describe.skip;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
/**
 * Reads an artifact LAZILY, memoized.
 *
 * Jest executes the body of a `describe.skip`, so reading at describe scope turns a legitimately
 * skipped suite into "Test suite failed to run" with 0 tests — which is what a local run without
 * these artifacts got. Deferring the read to the first assertion keeps the skip a skip.
 */
const reader = <T>(path: string | undefined): (() => T) => {
  let cached: T | undefined;

  return () => (cached ??= JSON.parse(readFileSync(path as string, "utf8")) as T);
};

/** Stand-in addresses — the drift under test is in the DATA, so the accounts only have to be valid. */
const ADDR = (n: string): Address => `${n}${"1".repeat(43 - n.length)}` as Address;
const KITCHEN = ADDR("K");
const OWNER = ADDR("A");
const ENGINE = ADDR("E");
const CODE_BUFFER = ADDR("B");
const CODE = ADDR("C");
const POT = ADDR("P");
const FEE_CONFIG = ADDR("F");
const PROGRAM_DATA = ADDR("D");
const FEE_ADMIN = {
  kitchen: KITCHEN,
  authority: OWNER,
  programData: PROGRAM_DATA,
  feeConfig: FEE_CONFIG,
} as const;
const SALT = new Uint8Array(32).fill(7);
const SHA = new Uint8Array(32).fill(9);
const BUFFER_ACCOUNTS = { kitchen: KITCHEN, owner: OWNER, codeBuffer: CODE_BUFFER, code: CODE };

/**
 * Assertions over the SDK's OWN constants and builders — no release artifact, so not gated. They
 * were inside the IDL-gated block, where a local `pnpm test` ran neither.
 */
describe("kitchen constants and bounds (no artifact needed)", () => {
  // Client-side, so the bound is visible without a simulation — the kitchen's own
  // `CapacityOutOfRange` is otherwise the only place it appears.
  it.each([0, -1, MAX_CODE_LEN + 1, 1.5])("rejects a code buffer capacity of %s", (capacity) => {
    expect(() =>
      buildCreateCodeBufferInstruction({ ...BUFFER_ACCOUNTS, nonce: 0n, capacity }),
    ).toThrow(/capacity must be an integer/);
  });

  it("accepts the bounds themselves", () => {
    expect(() =>
      buildCreateCodeBufferInstruction({ ...BUFFER_ACCOUNTS, nonce: 0n, capacity: 1 }),
    ).not.toThrow();
    expect(() =>
      buildCreateCodeBufferInstruction({ ...BUFFER_ACCOUNTS, nonce: 0n, capacity: MAX_CODE_LEN }),
    ).not.toThrow();
  });
});

describeWire("released engine wire drift guard", () => {
  const wire = reader<{
    instructions: Record<string, { discriminator: string }>;
    faults: Record<string, number>;
    memory: { requiredHeapFrameBytes: number };
  }>(WIRE_JSON);

  it("the SDK's execute discriminators match the released engine's own wire artifact", () => {
    expect(hex(EXECUTE_DISCRIMINATOR)).toBe(wire().instructions.execute!.discriminator);
    expect(hex(EXECUTE_FROM_ACCOUNT_DISCRIMINATOR)).toBe(
      wire().instructions.executeFromAccount!.discriminator,
    );
  });

  // Through the builders, as the kitchen's are below: the first eight bytes each one emits.
  it.each([
    [
      "cookAndPay",
      buildCookAndPayInstruction({
        engineProgram: ENGINE,
        bytecode: new Uint8Array([1]),
        feeConfig: FEE_CONFIG,
        feePayer: OWNER,
        maxExecutionFee: 0n,
      }),
    ],
    [
      "cookAndPayFromAccount",
      buildCookAndPayFromAccountInstruction({
        engineProgram: ENGINE,
        code: CODE,
        feeConfig: FEE_CONFIG,
        feePayer: OWNER,
        maxExecutionFee: 0n,
      }),
    ],
    [
      "cookAndPayFromAccountPinned",
      buildCookAndPayFromAccountPinnedInstruction({
        engineProgram: ENGINE,
        code: CODE,
        expectedSha256: SHA,
        feeConfig: FEE_CONFIG,
        feePayer: OWNER,
        maxExecutionFee: 0n,
      }),
    ],
  ] as const)("the %s builder emits the released engine's discriminator", (name, built) => {
    expect(hex(Uint8Array.from(built.data!).slice(0, 8))).toBe(
      wire().instructions[name]!.discriminator,
    );
  });

  // `ENGINE_FAULTS` is what names an engine refusal (a cook's fee above its cap, a pin that is not
  // the staged bytes) without the artifact, so it has to be the release's table exactly.
  it("ENGINE_FAULTS is the released engine's fault table", () => {
    expect(ENGINE_FAULTS).toEqual(wire().faults);
  });

  it("declares the legacy and direct paid instructions, without staging", () => {
    expect(Object.keys(wire().instructions).sort()).toEqual([
      "closeAccount",
      "cookAndPay",
      "cookAndPayFromAccount",
      "cookAndPayFromAccountPinned",
      "execute",
      "executeFromAccount",
    ]);
  });

  // Decoding a failed simulation depends on this number: `Custom(11)` is what a staging instruction
  // sent to the released engine comes back as, and it is meaningless without the mapping.
  it("still maps InvalidInstruction to fault code 11", () => {
    expect(wire().faults.InvalidInstruction).toBe(11);
  });

  /**
   * The engine publishes the heap frame it needs; the SDK publishes the one it asks for. If the
   * request ever falls under the requirement, every cook dies with an SBF access violation before
   * running an opcode — and from the kitchen that reads as a bare `ProgramFailedToComplete`, with
   * nothing pointing at the heap. Asserted as a floor, not equality: asking for more is fine.
   */
  it("the heap frame the SDK requests covers what the engine requires", () => {
    expect(wire().memory.requiredHeapFrameBytes).toBeGreaterThan(0);
    expect(HEAP_FRAME_BYTES).toBeGreaterThanOrEqual(wire().memory.requiredHeapFrameBytes);
  });
});

describeIdl("kitchen IDL drift guard", () => {
  const idl = reader<{
    instructions: {
      name: string;
      discriminator: number[];
      args: { name: string; type: unknown }[];
    }[];
    constants: { name: string; value: string }[];
    errors: { name: string; code: number }[];
  }>(IDL_JSON);
  const discriminatorOf = (name: string): string => {
    const found = idl().instructions.find((i) => i.name === name);
    if (found === undefined) throw new Error(`the kitchen IDL declares no instruction ${name}`);

    return hex(new Uint8Array(found.discriminator));
  };
  const constantOf = (name: string): string => {
    const found = idl().constants.find((c) => c.name === name);
    if (found === undefined) throw new Error(`the kitchen IDL declares no constant ${name}`);

    return found.value;
  };
  /** The bytes a builder puts on the wire, minus its arguments. */
  const emitted = (instruction: Instruction): string =>
    hex(Uint8Array.from(instruction.data!).slice(0, 8));

  const BUILT: Record<string, Instruction> = {
    create_pot: buildCreatePotInstruction({
      kitchen: KITCHEN,
      owner: OWNER,
      engineProgram: ENGINE,
      pot: POT,
      salt: SALT,
      space: 128,
    }),
    close_pot: buildClosePotInstruction({
      kitchen: KITCHEN,
      owner: OWNER,
      engineProgram: ENGINE,
      pot: POT,
      salt: SALT,
    }),
    cook: buildCookInstruction({
      kitchen: KITCHEN,
      owner: OWNER,
      engineProgram: ENGINE,
      potSalt: SALT,
      pot: POT,
      feeConfig: FEE_CONFIG,
      bytecode: new Uint8Array([1, 2, 3]),
      maxExecutionFee: 0n,
    }),
    cook_from_account: buildCookFromAccountInstruction({
      kitchen: KITCHEN,
      owner: OWNER,
      engineProgram: ENGINE,
      codeBuffer: CODE_BUFFER,
      code: CODE,
      potSalt: SALT,
      pot: POT,
      feeConfig: FEE_CONFIG,
      maxExecutionFee: 0n,
    }),
    create_code_buffer: buildCreateCodeBufferInstruction({
      ...BUFFER_ACCOUNTS,
      nonce: 0n,
      capacity: 1024,
    }),
    grow_code_buffer: buildGrowCodeBufferInstruction(BUFFER_ACCOUNTS),
    write_code_buffer: buildWriteCodeBufferInstruction({
      ...BUFFER_ACCOUNTS,
      offset: 0,
      chunk: new Uint8Array([1]),
    }),
    finalize_code_buffer: buildFinalizeCodeBufferInstruction({
      ...BUFFER_ACCOUNTS,
      len: 3,
      expectedSha256: SHA,
    }),
    close_code_buffer: buildCloseCodeBufferInstruction(BUFFER_ACCOUNTS),
    initialize_execution_fee: buildInitializeExecutionFeeInstruction({
      ...FEE_ADMIN,
      initialFee: 25_000n,
    }),
    set_execution_fee: buildSetExecutionFeeInstruction({ ...FEE_ADMIN, fee: 0n }),
    withdraw_execution_fees: buildWithdrawExecutionFeesInstruction({
      ...FEE_ADMIN,
      recipient: OWNER,
    }),
  };

  it.each(Object.keys(BUILT))("%s emits the discriminator the IDL declares", (name) => {
    expect(emitted(BUILT[name]!)).toBe(discriminatorOf(name));
  });

  it.each(["cook", "cook_from_account"])(
    "%s carries salt, canonical bump, payload and fee cap",
    async (name) => {
      const [, bump] = await getProgramDerivedAddress({
        programAddress: KITCHEN,
        seeds: [new TextEncoder().encode(POT_SEED), getAddressEncoder().encode(OWNER), SALT],
      });
      const bytes = Uint8Array.from(BUILT[name]!.data!);
      expect(bytes.slice(8, 40)).toEqual(SALT);
      expect(bytes[40]).toBe(bump);
      expect(bytes.slice(41)).toEqual(
        name === "cook"
          ? new Uint8Array([3, 0, 0, 0, 1, 2, 3, ...new Uint8Array(8)])
          : new Uint8Array(9),
      );
      const args = idl().instructions.find((i) => i.name === name)!.args;
      expect(args.map((arg) => arg.name)).toEqual([
        "pot_salt",
        "pot_bump",
        name === "cook" ? "bytecode" : "pin",
        "max_execution_fee",
      ]);
      expect(args[1]!.type).toBe("u8");
    },
  );

  /**
   * The direction the per-builder cases cannot cover: they prove every builder is right, not that
   * every instruction HAS one. A kitchen that gains an instruction the SDK cannot call is exactly
   * the silent gap this file exists for.
   */
  it("has a builder for every instruction the kitchen declares", () => {
    expect(
      idl()
        .instructions.map((i) => i.name)
        .sort(),
    ).toEqual(Object.keys(BUILT).sort());
  });

  // Seeds are `bytes` in the IDL — the byte list of the ASCII prefix, not a quoted string.
  it.each([
    ["POT_SEED", POT_SEED],
    ["CODE_BUFFER_SEED", CODE_BUFFER_SEED],
    ["CODE_SEED", CODE_SEED],
  ])("%s matches the IDL's declared seed bytes", (name, seed) => {
    expect(constantOf(name)).toBe(`[${[...Buffer.from(seed, "utf8")].join(", ")}]`);
  });

  it.each([
    ["GROWTH_STEP", GROWTH_STEP],
    ["MAX_CODE_LEN", MAX_CODE_LEN],
    ["MAX_POT_LEN", MAX_POT_LEN],
  ])("%s matches the IDL's declared bound", (name, value) => {
    expect(constantOf(name)).toBe(String(value));
  });

  // The fee config's account discriminator: what `decodeExecutionFeeConfig` (and the engine's direct
  // cooks) check before trusting the account.
  it("EXECUTION_FEE_CONFIG_DISCRIMINATOR is the IDL's ExecutionFeeConfig discriminator", () => {
    const accounts = (idl() as unknown as { accounts: { name: string; discriminator: number[] }[] })
      .accounts;
    const config = accounts.find((account) => account.name === "ExecutionFeeConfig");

    expect(config).toBeDefined();
    expect(hex(EXECUTION_FEE_CONFIG_DISCRIMINATOR)).toBe(
      hex(new Uint8Array(config!.discriminator)),
    );
  });

  // The e2e suites assert failures by Anchor error CODE (`kitchen-bench.ts#KITCHEN_ERROR`) rather
  // than by log text, because reading logs off a failed transaction aborted them on CI. That makes
  // the numbers a wire contract, so they are pinned to the IDL here — a renumbered error fails
  // loudly instead of quietly turning those rejection tests into "it failed somehow".
  it.each(Object.entries(KITCHEN_ERROR))("%s is IDL error code %s", (name, code) => {
    const declared = idl().errors.find((e) => e.name === name);

    expect(declared).toBeDefined();
    expect(declared!.code).toBe(code);
  });

  // A cook names its interpreter as a READ-ONLY account: the kitchen CPIs into it, and a writable
  // or signing engine slot would be a different trust story than the one the module documents.
  it("a cook passes the engine as a read-only, non-signing account", () => {
    const cook = buildCookInstruction({
      kitchen: KITCHEN,
      owner: OWNER,
      engineProgram: ENGINE,
      potSalt: SALT,
      pot: POT,
      feeConfig: FEE_CONFIG,
      bytecode: new Uint8Array([1]),
      maxExecutionFee: 0n,
    });

    expect(cook.accounts![1]).toEqual({ address: ENGINE, role: AccountRole.READONLY });
  });
});
