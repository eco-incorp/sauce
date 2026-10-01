/**
 * The engine's two Solana entry points, executed side by side on the released `engine-devnet.so`
 * and `kitchen.so` in LiteSVM:
 *
 * - through the Kitchen — `cook`/`cook_from_account`, which charge the fee and CPI the engine's gated
 *   `execute`/`executeFromAccount`, signing the owner's Pot;
 * - direct — the engine's own `cookAndPay`, `cookAndPayFromAccount` and
 *   `cookAndPayFromAccountPinned`, which charge the same fee themselves and run the program as the
 *   transaction's top-level instruction.
 *
 * What each test pins is a difference (or a sameness) a caller has to know to choose between them:
 * the fee and its cap, whose authority the program acts with, the staged and pinned forms, and the
 * invoke-stack depth left for the program's own calls.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI (`engine-harness.ts`).
 */
import { AccountRole, generateKeyPairSigner, getAddressCodec, lamports } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";

import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookAndPayFromAccountInstruction,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildHeapFramePrepend,
  buildSetExecutionFeeInstruction,
  deriveProgramDataPda,
  ENGINE_FAULTS,
  type TailAccount,
} from "../../src/svm/index.js";
import { longestChains, type Via } from "./cpi-depth.js";
import {
  describeSvm,
  expectFail,
  expectOk,
  HARNESS_POT_SALT,
  randomAddress,
  sendInstructions,
  setMint,
  setTokenAccount,
  stageProgram,
  startEngine,
  TOKEN_PROGRAM,
  tokenAmount,
  toBigInt,
  type EngineHarness,
  type RunResult,
  type StagedProgram,
} from "./engine-harness.js";
import { KITCHEN_ERROR } from "./kitchen-errors.js";

const codec = getAddressCodec();
const word = (key: Address): bigint => toBigInt(new Uint8Array(codec.encode(key)));

const VIAS: readonly Via[] = ["kitchen", "engine"];

/** A program compiled for Solana as the CLI compiles one, with its bytecode and manifest. */
const program = (source: string) => compileSauceProgram("solana", source);

describeSvm("the engine's two Solana entry points: through the Kitchen, and direct", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  /** Prices the Kitchen at `fee` — which prices both entry points, as there is one config. */
  const setFee = async (fee: bigint): Promise<void> => {
    const { address: programData } = await deriveProgramDataPda(harness.kitchen);
    expectOk(
      await sendInstructions(harness, [
        buildSetExecutionFeeInstruction({
          kitchen: harness.kitchen,
          authority: harness.payer.address,
          programData,
          feeConfig: harness.feeConfig,
          fee,
        }),
      ]),
    );
  };

  afterEach(async () => {
    await setFee(0n);
  });

  /** The cook instruction for `via`, inline: the Kitchen's `cook` or the engine's `cookAndPay`. */
  const cook = (
    via: Via,
    bytecode: Uint8Array,
    tail: readonly TailAccount[],
    maxExecutionFee = 0n,
  ): Instruction =>
    via === "kitchen"
      ? buildCookInstruction({
          kitchen: harness.kitchen,
          owner: harness.payer.address,
          engineProgram: harness.programId,
          potSalt: HARNESS_POT_SALT,
          pot: harness.pot,
          feeConfig: harness.feeConfig,
          bytecode,
          maxExecutionFee,
          tail,
        })
      : buildCookAndPayInstruction({
          engineProgram: harness.programId,
          feeConfig: harness.feeConfig,
          feePayer: harness.payer.address,
          maxExecutionFee,
          bytecode,
          tail,
        });

  /** The staged cook for `via`: the Kitchen's `cook_from_account`, or the engine's pinned one. */
  const cookStaged = (
    via: Via,
    staged: StagedProgram,
    tail: readonly TailAccount[],
    maxExecutionFee = 0n,
  ): Instruction =>
    via === "kitchen"
      ? buildCookFromAccountInstruction({
          kitchen: harness.kitchen,
          owner: harness.payer.address,
          codeBuffer: staged.codeBuffer,
          code: staged.code,
          engineProgram: harness.programId,
          potSalt: HARNESS_POT_SALT,
          pot: harness.pot,
          feeConfig: harness.feeConfig,
          maxExecutionFee,
          tail,
        })
      : buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: harness.programId,
          code: staged.code,
          expectedSha256: staged.sha256,
          feeConfig: harness.feeConfig,
          feePayer: harness.payer.address,
          maxExecutionFee,
          tail,
        });

  const run = (instruction: Instruction): Promise<RunResult> =>
    sendInstructions(harness, [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      instruction,
    ]);

  const balance = (at: Address): bigint => harness.svm.getBalance(at) ?? 0n;

  /** The custom error code a failed cook carries, as LiteSVM prints it. */
  const customCode = (result: RunResult): number => {
    const failed = expectFail(result);
    const code = /code: (\d+)/.exec(failed.err)?.[1];
    if (code === undefined) throw new Error(`no custom error in ${failed.err}`);

    return Number(code);
  };

  const VOID = program("function main() {}").bytecode;

  describe("the fee", () => {
    it.each(VIAS)(
      "a cook %s pays the Kitchen's fee into its fee config, and nothing more",
      async (via) => {
        const FEE = 7_000n;
        await setFee(FEE);
        const payer = balance(harness.payer.address);
        const treasury = balance(harness.feeConfig);

        expectOk(await run(cook(via, VOID, [], FEE)));

        // The treasury gains exactly the fee; the payer loses it plus the one signature's fee.
        expect(balance(harness.feeConfig) - treasury).toBe(FEE);
        expect(payer - balance(harness.payer.address)).toBe(FEE + 5_000n);
      },
    );

    it.each(VIAS)(
      "a cook %s whose max_execution_fee is below the fee is refused, paying nothing",
      async (via) => {
        const FEE = 7_000n;
        await setFee(FEE);
        const treasury = balance(harness.feeConfig);

        const code = customCode(await run(cook(via, VOID, [], FEE - 1n)));

        // The Kitchen refuses with its own error; the engine with its fault — the same check.
        expect(code).toBe(
          via === "kitchen"
            ? KITCHEN_ERROR.ExecutionFeeExceedsMaximum
            : ENGINE_FAULTS.ExecutionFeeExceedsMaximum,
        );
        expect(balance(harness.feeConfig)).toBe(treasury);
      },
    );

    it("a direct cook validates the fee config even at a zero fee: a lookalike is refused", async () => {
      const lookalike = randomAddress();
      harness.svm.setAccount({
        address: lookalike,
        data: new Uint8Array(16),
        executable: false,
        lamports: lamports(10_000_000n),
        programAddress: harness.kitchen,
        space: 16n,
      });

      const refused = await run(
        buildCookAndPayInstruction({
          engineProgram: harness.programId,
          feeConfig: lookalike,
          feePayer: harness.payer.address,
          maxExecutionFee: 0n,
          bytecode: VOID,
        }),
      );

      expect(customCode(refused)).toBe(ENGINE_FAULTS.InvalidFeeConfig);
    });
  });

  describe("whose authority the program acts with", () => {
    it.each(VIAS)(
      "%s: ctx.self() is the engine program, and ctx.msgSender() the first signer",
      async (via) => {
        const signer = await generateKeyPairSigner();
        const self = program("function main(): Uint256 { return ctx.self(); }").bytecode;
        const sender = program(
          "function main(who: Account<Signer>): Uint256 { return ctx.msgSender(); }",
        ).bytecode;
        const tail = [{ address: signer.address, role: AccountRole.READONLY_SIGNER, signer }];

        expect(toBigInt(expectOk(await run(cook(via, self, []))).returnData)).toBe(
          word(harness.programId),
        );
        expect(toBigInt(expectOk(await run(cook(via, sender, tail))).returnData)).toBe(
          word(signer.address),
        );
      },
    );

    /** Moves 400 of a fresh mint from `source` (owned by `owner`) with `authority` signing. */
    const transferFrom = async (via: Via, owner: Address, authority: TailAccount) => {
      const mint = setMint(harness, randomAddress(), 6);
      const source = setTokenAccount(harness, randomAddress(), mint, owner, 1_000n);
      const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      const { bytecode } = compileSauceProgram(
        "solana",
        "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>) {\n" +
          "  transfer(MINT, tokenProgram, source, dest, authority, 400n);\n" +
          "}",
        { defines: { MINT: word(mint) } },
      );
      const result = await run(
        cook(via, bytecode, [
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: source, role: AccountRole.WRITABLE },
          { address: dest, role: AccountRole.WRITABLE },
          authority,
        ]),
      );

      return { result, source, dest };
    };

    it.each(VIAS)("%s: a transfer the signing wallet authorizes moves its tokens", async (via) => {
      const wallet = harness.payer;
      const { result, dest } = await transferFrom(via, wallet.address, {
        address: wallet.address,
        role: AccountRole.READONLY_SIGNER,
      });

      expectOk(result);
      expect(tokenAmount(harness, dest)).toBe(400n);
    });

    it("through the Kitchen the Pot signs: a transfer from the Pot's tokens moves them", async () => {
      const { result, dest } = await transferFrom("kitchen", harness.pot, {
        address: harness.pot,
        role: AccountRole.READONLY,
      });

      expectOk(result);
      expect(tokenAmount(harness, dest)).toBe(400n);
    });

    it("direct, nothing signs for the Pot: the same transfer from the Pot's tokens fails", async () => {
      const { result, source } = await transferFrom("engine", harness.pot, {
        address: harness.pot,
        role: AccountRole.READONLY,
      });

      // The SPL transfer the program makes is refused for the authority's missing signature, which
      // fails the transaction outright — a CPI's failure is never the caller's to handle.
      expect(expectFail(result).err).toMatch(/MissingRequiredSignature/);
      expect(tokenAmount(harness, source)).toBe(1_000n);
    });

    it("direct, the Pot's storage cannot be written: svm.sstore needs the account to sign", async () => {
      const write = program(
        "function main(state: Account<Writable, Signer>) { svm.sstore(state, 0n, hex`2a`); }",
      ).bytecode;
      const pot = { address: harness.pot, role: AccountRole.WRITABLE };

      expectOk(await run(cook("kitchen", write, [pot])));
      expect(customCode(await run(cook("engine", write, [pot])))).toBe(
        ENGINE_FAULTS.AccountNotSigner,
      );
    });
  });

  describe("staged programs", () => {
    let staged: StagedProgram;
    const RETURNS = program("function main(): Uint256 { return 42n; }").bytecode;

    beforeAll(async () => {
      staged = await stageProgram(harness, RETURNS, 7n);
    });

    it.each(VIAS)("%s runs a finalized Kitchen code buffer", async (via) => {
      expect(toBigInt(expectOk(await run(cookStaged(via, staged, []))).returnData)).toBe(42n);
    });

    it("direct and unpinned, the engine runs whatever the code account holds", async () => {
      const result = await run(
        buildCookAndPayFromAccountInstruction({
          engineProgram: harness.programId,
          code: staged.code,
          feeConfig: harness.feeConfig,
          feePayer: harness.payer.address,
          maxExecutionFee: 0n,
        }),
      );

      expect(toBigInt(expectOk(result).returnData)).toBe(42n);
    });

    it("direct and pinned, a digest that is not the staged bytes' is refused before the fee", async () => {
      const FEE = 7_000n;
      await setFee(FEE);
      const treasury = balance(harness.feeConfig);
      const wrong = new Uint8Array(staged.sha256);
      wrong[0]! ^= 1;

      // Even with a cap the fee exceeds: the pin is checked first.
      const refused = await run(
        buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: harness.programId,
          code: staged.code,
          expectedSha256: wrong,
          feeConfig: harness.feeConfig,
          feePayer: harness.payer.address,
          maxExecutionFee: 0n,
        }),
      );

      expect(customCode(refused)).toBe(ENGINE_FAULTS.CodeHashMismatch);
      expect(balance(harness.feeConfig)).toBe(treasury);
    });

    it.each(VIAS)("a staged cook %s pays the fee too", async (via) => {
      const FEE = 3_000n;
      await setFee(FEE);
      const treasury = balance(harness.feeConfig);

      expectOk(await run(cookStaged(via, staged, [], FEE)));
      expect(balance(harness.feeConfig) - treasury).toBe(FEE);
    });
  });

  // Every runtime feature is on here, SIMD-0268 included, so the invoke stack is 9 deep;
  // `direct-engine-depth.e2e.test.ts` measures the 5-deep stack mainnet runs.
  it("CPI depth with SIMD-0268's 9-deep invoke stack: a direct cook leaves one more level", async () => {
    const { longest, height, refusals } = await longestChains(harness, 100n);

    // What stops each chain is the runtime's invoke-depth limit, nothing else.
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) expect(refusal).toMatch(/CallDepth/);
    // Both reach the deepest height; the Kitchen's own frame is the one the direct cook does not
    // spend, so it fits one engine frame — one level of the program's own CPIs — more.
    expect(height).toBe(9);
    expect(longest).toEqual({ kitchen: 8, engine: 9 });
  });
});
