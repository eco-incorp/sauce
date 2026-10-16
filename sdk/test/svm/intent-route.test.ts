/**
 * The synchronous Solana route builders the intent lowering uses (`svm/intent-route.ts`), held to
 * the asynchronous ones `svm-portal-kitchen.e2e.test.ts` executes: the same accounts derived, the
 * same route calls committed, the same names resolved.
 */
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Instruction } from "@solana/kit";
import { bytesToHex, getAddress } from "viem";

import { requireChain } from "../../src/chains/canonical.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { bindEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { resolveSvmAccountName, resolveSvmAccountNameSync } from "../../src/svm/account-names.js";
import {
  svmCookRoute,
  svmIntentExecutor,
  svmIntentPotOf,
  svmRentExempt,
  svmTransferRoute,
} from "../../src/svm/intent-route.js";
import {
  associatedTokenAccount,
  svmExecutorPda,
  svmIntentCookInstruction,
  svmIntentPot,
  svmIntentPotInstruction,
  svmRouteCalls,
} from "../../src/svm/portal.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../src/svm/token-program.js";
import {
  memoizedAssociatedTokenAccountSync,
  memoizedFindProgramAddressSync,
} from "../../src/svm/venues/pda-memo.js";

const PORTAL = address("5nCJDkRg8mhj9XHkjuFoR6Mcs6VcDZVsCbZ7pTJhRFEF");
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = address(v12SvmEngineProgramId());
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WALLET = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const SOLANA = requireChain("solana");

describe("the synchronous derivations", () => {
  it("find what kit's asynchronous search finds, bump included", async () => {
    const seeds = [new TextEncoder().encode("intent-route"), new Uint8Array(32).fill(7)];
    expect(memoizedFindProgramAddressSync(PORTAL, seeds)).toEqual(
      await getProgramDerivedAddress({ programAddress: PORTAL, seeds }),
    );
  });

  it("derive the Portal's executor, its Pot and token accounts as portal.ts does", async () => {
    expect(svmIntentExecutor(PORTAL)).toBe(await svmExecutorPda(PORTAL));
    expect(svmIntentPotOf({ portal: PORTAL, kitchen: KITCHEN })).toBe(
      await svmIntentPot({ portal: PORTAL, kitchen: KITCHEN }),
    );
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      expect(
        memoizedAssociatedTokenAccountSync({ owner: WALLET, mint: USDC, tokenProgram: program }),
      ).toBe(await associatedTokenAccount(WALLET, USDC, program));
    }
  });
});

describe("a cook's route", () => {
  /** Pays the Pot's USDC to a token account: its accounts declared, as a program's are. */
  const SWEEP = `function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>) {
  transfer(USDC, tokenProgram, source, dest, authority, 1000000);
}`;

  it("is the calls portal.ts's builders make, committed with the fill's flags", async () => {
    const program = compileSauceProgram("solana", SWEEP);
    const executor = await svmExecutorPda(PORTAL);
    const pot = await svmIntentPot({ portal: PORTAL, kitchen: KITCHEN });
    const potAccount = await associatedTokenAccount(pot, USDC, TOKEN_PROGRAM_ID);
    const executorAccount = await associatedTokenAccount(executor, USDC, TOKEN_PROGRAM_ID);
    const dest = await associatedTokenAccount(WALLET, USDC, TOKEN_PROGRAM_ID);
    const route = svmCookRoute({
      portal: PORTAL,
      kitchen: KITCHEN,
      engine: ENGINE,
      bytecode: program.bytecode,
      manifest: program.manifest!,
      accounts: {
        tokenProgram: { value: TOKEN_PROGRAM_ID, kind: "program" },
        source: { value: potAccount, kind: "address" },
        dest: { value: dest, kind: "address" },
        authority: { value: "pot", kind: "pot" },
      },
      executionFee: 5_000n,
      delivered: [{ mint: USDC, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6, amount: 1_000_000n }],
      potExists: false,
      // The Pot's token account exists: the route only moves the delivery into it.
      existing: new Set([potAccount]),
    });
    const transfer: Instruction = {
      programAddress: TOKEN_PROGRAM_ID,
      accounts: [
        { address: executorAccount, role: AccountRole.WRITABLE },
        { address: USDC, role: AccountRole.READONLY },
        { address: potAccount, role: AccountRole.WRITABLE },
        { address: executor, role: AccountRole.READONLY_SIGNER },
      ],
      data: Uint8Array.from([12, ...new Uint8Array(new BigUint64Array([1_000_000n]).buffer), 6]),
    };
    const expected = await svmRouteCalls(
      PORTAL,
      [
        await svmIntentPotInstruction({ portal: PORTAL, kitchen: KITCHEN, engineProgram: ENGINE }),
        transfer,
        await svmIntentCookInstruction({
          portal: PORTAL,
          kitchen: KITCHEN,
          engineProgram: ENGINE,
          bytecode: program.bytecode,
          manifest: program.manifest!,
          resolution: {
            tokenProgram: TOKEN_PROGRAM_ID,
            source: potAccount,
            dest,
            authority: { address: pot, signer: false },
          },
          maxExecutionFee: 5_000n,
        }),
      ],
      [{ mint: USDC }],
    );

    expect(route.calls).toEqual(expected);
    expect(route.pot).toBe(pot);
    expect(route.nativeAmount).toBe(svmRentExempt(10_240) + 5_000n);
    expect(route.creates.map((created) => created.address)).toEqual([pot]);
    expect(route.tokens).toEqual([
      { token: bytesToHex(new Uint8Array(getAddressEncoder().encode(USDC))), amount: 1_000_000n },
    ]);
  });
});

describe("a route of transfers", () => {
  it("creates the wallet's account where it is missing, and pays it", () => {
    const route = svmTransferRoute({
      portal: PORTAL,
      transfers: [
        { mint: USDC, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6, recipient: WALLET, amount: 3n },
        { mint: USDC, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6, recipient: WALLET, amount: 4n },
      ],
    });
    // One account, created once; the delivery summed.
    expect(route.calls).toHaveLength(3);
    expect(route.creates).toHaveLength(1);
    expect(route.nativeAmount).toBe(2_039_280n);
    expect(route.tokens.map((token) => token.amount)).toEqual([7n]);
    const there = svmTransferRoute({
      portal: PORTAL,
      transfers: [
        { mint: USDC, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6, recipient: WALLET, amount: 3n },
      ],
      existing: new Set([route.creates[0]!.address]),
    });
    expect(there.calls).toHaveLength(1);
    expect(there.nativeAmount).toBe(0n);
  });

  it("delivers an empty account's rent beside a Token-2022 account's, whose size is a bound", () => {
    const route = svmTransferRoute({
      portal: PORTAL,
      transfers: [
        {
          mint: USDC,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          decimals: 6,
          recipient: WALLET,
          amount: 3n,
        },
      ],
    });
    expect(route.nativeAmount).toBe(svmRentExempt(195) + svmRentExempt(0));
  });
});

describe("the account names a route resolves before anything is read", () => {
  const context = {
    chain: SOLANA,
    owner: svmIntentExecutor(PORTAL),
    pot: svmIntentPotOf({ portal: PORTAL, kitchen: KITCHEN }),
    via: "kitchen" as const,
  };

  it.each([
    "self",
    "owner",
    "pot",
    "system",
    "self:USDC",
    `${WALLET}:USDC`,
    "mint:USDC",
    "program:USDC",
    `pda:${KITCHEN}:"seed",self,u64:7,mint:USDC`,
  ])("%s resolves as the asynchronous resolver does", async (name) => {
    expect(resolveSvmAccountNameSync(name, context)).toEqual(
      await resolveSvmAccountName(name, context),
    );
  });

  it("refuses what only the cluster could tell", () => {
    expect(() => resolveSvmAccountNameSync(`slot:${WALLET}:USDC.pool`, context)).toThrow(
      /read from the pool on the cluster/,
    );
    expect(() => resolveSvmAccountNameSync(`self:${WALLET}`, context)).toThrow(
      /not one solana registers/,
    );
  });
});

describe("main's Address argument, bound into an intent", () => {
  it("takes a Solana key in base58 as its 32-byte word, and an EVM address as ever", () => {
    const source = "function main(to: Address, from: Address) { }";
    const bound = bindEntryArguments(source, [
      WALLET,
      "0x658d45d9DEB56768ca379C50daEcde116Db44521",
    ]);
    expect(bound.constants.to).toBe(
      BigInt(bytesToHex(new Uint8Array(getAddressEncoder().encode(WALLET)))),
    );
    expect(bound.constants.from).toBe(
      BigInt(getAddress("0x658d45d9DEB56768ca379C50daEcde116Db44521")),
    );
  });
});
