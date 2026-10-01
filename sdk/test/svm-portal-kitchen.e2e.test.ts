/**
 * A Sauce program as an intent's route on Solana: the released Kitchen's `cook`, issued by the
 * eco-routes Portal's executor, on the Pot the executor owns — the Solana counterpart of an EVM
 * intent's cook on the Executor's shared Pot.
 *
 * In one LiteSVM bank: the released engine and Kitchen at their release ids (`engine-harness.ts`,
 * the Kitchen priced, so the cook pays a fee), and eco-routes' programs as mainnet runs them (the
 * pinned dump). Two intents from Arbitrum, each filled by a solver through the real Portal:
 *
 *  1. the route creates the executor's Pot (`create_pot`, the executor its owner and rent payer,
 *     the rent delivered as the route's native amount);
 *  2. the route moves the delivered USDC from the executor's token account into the Pot's, then
 *     cooks a program on the Pot that pays it to a recipient (the executor the cook's owner and
 *     fee payer, the fee delivered as the native amount).
 *
 * Each route's call accounts are committed with the flags the fill transaction gives them
 * (`svmRouteCalls`): a different set hashes to another intent, and the fill refuses it.
 *
 * GATED on the engine artifacts like every engine-executing suite.
 */
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressCodec,
  lamports,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import { bytesToHex, pad, type Hex } from "viem";

import { v12SvmEngineProgramId } from "../src/deployments/index.js";
import { hashIntent } from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import type { Intent } from "../src/routes/types.js";
import {
  associatedTokenAccount,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  buildPortalFulfillInstruction,
  buildSetExecutionFeeInstruction,
  deriveProgramDataPda,
  MAX_POT_LEN,
  svmExecutorPda,
  svmIntentCookInstruction,
  svmIntentPot,
  svmIntentPotInstruction,
  svmRouteCalls,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import { encodePortalCalldataWithAccounts } from "../src/svm/intent.js";
import {
  describeSvm,
  ENGINE_SO,
  sendInstructions,
  setMint,
  setTokenAccount,
  startEngine,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { loadEcoRoutes, programId } from "./svm/eco-routes-svm.js";

const NOW = 1_790_000_000n;
const FEE = 5_000n;
const AMOUNT = 1_000_000n;
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
const CLAIMANT: Hex = pad("0x658d45d9DEB56768ca379C50daEcde116Db44521");

/** Pays `amount` of the mint from the Pot's token account to `dest`: the Pot signs, through the
 *  engine. */
const SWEEP = [
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>) {",
  "  transfer(MINT, tokenProgram, source, dest, authority, AMOUNT);",
  "}",
  "",
].join("\n");

describeSvm(
  "an intent's route cooks on the Portal executor's Pot, through the released Kitchen",
  () => {
    let harness: EngineHarness;
    let solver: KeyPairSigner;
    let executor: Address;
    let pot: Address;
    const engine = address(v12SvmEngineProgramId());

    async function fill(route: Intent["route"], salt: string) {
      const intent: Intent = {
        sourceChainId: 42161n,
        destination: 1399811149n,
        route: { ...route, salt: `0x${salt.repeat(32)}` },
        reward: {
          deadline: NOW + 86_400n,
          creator: toUniversalAddress("0x658d45d9DEB56768ca379C50daEcde116Db44521"),
          prover: toUniversalAddress("0xEC08fb4647f3f50d1162a578d481266687C60fc5"),
          nativeAmount: 0n,
          tokens: [],
        },
      };
      const fulfill = await buildPortalFulfillInstruction({
        intent,
        portal: PORTAL,
        solver,
        claimant: CLAIMANT,
        tokenPrograms: { [USDC]: TOKEN_PROGRAM_ID },
      });
      harness.svm.expireBlockhash();
      const transaction = await buildExecuteTransaction({
        payer: solver,
        instructions: [
          buildHeapFramePrepend(),
          getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
          fulfill,
        ],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
      });
      const result = harness.svm.sendTransaction(transaction);
      if (result instanceof FailedTransactionMetadata) {
        throw new Error(
          `the fill failed: ${String(result.err())}\n${result.meta().logs().join("\n")}`,
        );
      }

      return hashIntent(intent).intentHash;
    }

    beforeAll(async () => {
      harness = await startEngine(NOW, ENGINE_SO as string, engine);
      // Priced: the executor pays the cook's fee from what the route delivers.
      const { address: programData } = await deriveProgramDataPda(harness.kitchen);
      const priced = await sendInstructions(harness, [
        buildSetExecutionFeeInstruction({
          kitchen: harness.kitchen,
          authority: harness.payer.address,
          programData,
          feeConfig: harness.feeConfig,
          fee: FEE,
        }),
      ]);
      if (!priced.ok) throw new Error(`pricing the Kitchen failed: ${priced.err}`);
      loadEcoRoutes(harness.svm);
      solver = await generateKeyPairSigner();
      harness.svm.airdrop(solver.address, lamports(10_000_000_000n));
      setMint(harness, USDC, 6);
      setTokenAccount(
        harness,
        await associatedTokenAccount(solver.address, USDC, TOKEN_PROGRAM_ID),
        USDC,
        solver.address,
        10n * AMOUNT,
      );
      executor = await svmExecutorPda(PORTAL);
      pot = await svmIntentPot({ portal: PORTAL, kitchen: harness.kitchen });
    }, 120_000);

    it("creates the executor's Pot from a route, then cooks a program on it from another", async () => {
      // 1. The Pot, its rent the route's native amount.
      const rent = harness.svm.minimumBalanceForRentExemption(BigInt(MAX_POT_LEN));
      await fill(
        {
          salt: "0x",
          deadline: NOW + 3600n,
          portal: universalOfSvmKey(PORTAL),
          nativeAmount: rent + 10_000_000n,
          tokens: [],
          calls: await svmRouteCalls(PORTAL, [
            await svmIntentPotInstruction({
              portal: PORTAL,
              kitchen: harness.kitchen,
              engineProgram: engine,
            }),
          ]),
        } as Intent["route"],
        "01",
      );
      expect(harness.svm.getAccount(pot).exists).toBe(true);

      // 2. The cook: USDC into the Pot's account, then the program pays it out.
      const potAccount = await associatedTokenAccount(pot, USDC, TOKEN_PROGRAM_ID);
      setTokenAccount(harness, potAccount, USDC, pot, 0n);
      const recipient = setTokenAccount(
        harness,
        (await generateKeyPairSigner()).address,
        USDC,
        (await generateKeyPairSigner()).address,
        0n,
      );
      const program = compileSauceProgram("solana", SWEEP, {
        defines: {
          MINT: BigInt(bytesToHex(new Uint8Array(getAddressCodec().encode(USDC)))),
          AMOUNT,
        },
      });
      const executorAccount = await associatedTokenAccount(executor, USDC, TOKEN_PROGRAM_ID);
      const transfer: Instruction = {
        programAddress: TOKEN_PROGRAM_ID,
        accounts: [
          { address: executorAccount, role: AccountRole.WRITABLE },
          { address: USDC, role: AccountRole.READONLY },
          { address: potAccount, role: AccountRole.WRITABLE },
          { address: executor, role: AccountRole.READONLY_SIGNER },
        ],
        data: Uint8Array.from([12, ...new Uint8Array(new BigUint64Array([AMOUNT]).buffer), 6]),
      };
      const cook = await svmIntentCookInstruction({
        portal: PORTAL,
        kitchen: harness.kitchen,
        engineProgram: engine,
        bytecode: program.bytecode,
        manifest: program.manifest!,
        resolution: {
          tokenProgram: TOKEN_PROGRAM_ID,
          source: potAccount,
          dest: recipient,
          authority: { address: pot, signer: false },
        },
        maxExecutionFee: FEE,
      });
      const feeBefore = harness.svm.getBalance(harness.feeConfig) ?? 0n;
      // Each call committed with only its own flags: the executor read-only in the transfer, while
      // the cook's fee makes it writable in the transaction. The Portal hashes the transaction's
      // flags, so this route is another intent, and the fill is refused.
      const own = (instruction: Instruction) => ({
        target: universalOfSvmKey(instruction.programAddress),
        data: encodePortalCalldataWithAccounts({
          instructionData: new Uint8Array(instruction.data!),
          accounts: instruction.accounts!.map((meta) => ({
            pubkey: meta.address,
            isSigner: false,
            isWritable:
              meta.role === AccountRole.WRITABLE || meta.role === AccountRole.WRITABLE_SIGNER,
          })),
        }),
        value: 0n,
      });
      await expect(
        fill(
          {
            salt: "0x",
            deadline: NOW + 3600n,
            portal: universalOfSvmKey(PORTAL),
            nativeAmount: FEE,
            tokens: [{ token: universalOfSvmKey(USDC), amount: AMOUNT }],
            calls: [own(transfer), own(cook)],
          } as Intent["route"],
          "03",
        ),
      ).rejects.toThrow(/InvalidIntentHash/);
      await fill(
        {
          salt: "0x",
          deadline: NOW + 3600n,
          portal: universalOfSvmKey(PORTAL),
          nativeAmount: FEE,
          tokens: [{ token: universalOfSvmKey(USDC), amount: AMOUNT }],
          calls: await svmRouteCalls(PORTAL, [transfer, cook], [{ mint: USDC }]),
        } as Intent["route"],
        "02",
      );
      expect(tokenAmount(harness, recipient)).toBe(AMOUNT);
      expect(tokenAmount(harness, potAccount)).toBe(0n);
      expect(tokenAmount(harness, executorAccount)).toBe(0n);
      // The executor paid the Kitchen's fee, out of the route's native amount.
      expect((harness.svm.getBalance(harness.feeConfig) ?? 0n) - feeBefore).toBe(FEE);
    });
  },
);
