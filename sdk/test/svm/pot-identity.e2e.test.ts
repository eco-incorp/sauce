/**
 * Which check binds an account slot to the Pot running a Kitchen cook — what `sauce-solana`'s "The
 * Pot's key" tells a program to rely on, executed on the released engine and Kitchen in LiteSVM.
 *
 * `pot.owner == ctx.self()` does not: the engine owns every Pot, but also any keypair account
 * assigned to it, and the Kitchen hands its tail's own signatures on, so such an account signed by
 * the transaction passes. Re-deriving the Pot's address does: only the Kitchen can make that address
 * sign. The re-derived program is the skill's own block, read from the skill, so the text and this
 * test cannot drift apart.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI (`engine-harness.ts`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccountRole, generateKeyPairSigner, getAddressCodec, lamports } from "@solana/kit";
import type { Address, KeyPairSigner } from "@solana/kit";

import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildHeapFramePrepend,
  type ResolvedAccountMeta,
  type TailAccount,
} from "../../src/svm/index.js";
import {
  describeSvm,
  expectFail,
  expectOk,
  HARNESS_POT_SALT,
  sendInstructions,
  startEngine,
  toBigInt,
  type EngineHarness,
  type RunResult,
} from "./engine-harness.js";

const SKILL = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../skills/sauce-solana/SKILL.md",
);

/** The skill's re-derivation program: its one `sauce` block that derives the Pot and nothing else. */
const rederived = (): string => {
  const blocks = [...readFileSync(SKILL, "utf8").matchAll(/```sauce[^\n]*\n([^]*?)```/g)].map(
    (match) => match[1]!,
  );
  const found = blocks.filter(
    (block) => block.includes("crypto.findPDA(KITCHEN") && !block.includes("potUsdc"),
  );
  if (found.length !== 1) {
    throw new Error(`expected one Pot re-derivation block in ${SKILL}, found ${found.length}`);
  }

  return found[0]!;
};

const OWNER_CHECK =
  'function main(pot: Account<Signer>) { require(pot.owner == ctx.self(), "not an engine account"); }';

const word = (key: Address): bigint => toBigInt(new Uint8Array(getAddressCodec().encode(key)));

describeSvm("binding a slot to the Pot: the owner check, and re-deriving the address", () => {
  let harness: EngineHarness;
  let lookalike: KeyPairSigner;
  let ownerCheck: Uint8Array;
  let derived: Uint8Array;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
    // A keypair account assigned to the engine: what anyone can make with a System create_account.
    lookalike = await generateKeyPairSigner();
    harness.svm.setAccount({
      address: lookalike.address,
      data: new Uint8Array(8),
      executable: false,
      lamports: lamports(10_000_000n),
      programAddress: harness.programId,
      space: 8n,
    });
    ownerCheck = compileSauceProgram("solana", OWNER_CHECK).bytecode;
    derived = compileSauceProgram("solana", rederived(), {
      defines: { KITCHEN: word(harness.kitchen), SALT: toBigInt(HARNESS_POT_SALT) },
    }).bytecode;
  });

  /** A Kitchen cook of `bytecode` on the harness Pot, with `tail` as the program's accounts. */
  const cook = (bytecode: Uint8Array, tail: readonly TailAccount[]): Promise<RunResult> =>
    sendInstructions(harness, [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      buildCookInstruction({
        kitchen: harness.kitchen,
        owner: harness.payer.address,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        feeConfig: harness.feeConfig,
        bytecode,
        maxExecutionFee: 0n,
        tail,
      }),
    ]);

  /** The Pot, attached unsigned: the Kitchen signs for it. */
  const pot = (): TailAccount => ({ address: harness.pot, role: AccountRole.READONLY });
  const fake = (): ResolvedAccountMeta => ({
    address: lookalike.address,
    role: AccountRole.READONLY_SIGNER,
    signer: lookalike,
  });
  const wallet = (): TailAccount => ({
    address: harness.payer.address,
    role: AccountRole.READONLY_SIGNER,
  });

  it("the real Pot passes both checks", async () => {
    expectOk(await cook(ownerCheck, [pot()]));
    expectOk(await cook(derived, [pot(), wallet()]));
  });

  it("a signing account the engine owns passes the owner check: it is not proof of the Pot", async () => {
    expectOk(await cook(ownerCheck, [fake()]));
  });

  it("the same account fails the re-derived check, with the skill's message", async () => {
    const refused = expectFail(await cook(derived, [fake(), wallet()]));

    expect(new TextDecoder().decode(refused.revertData)).toBe("pot is not the wallet's Pot");
  });
});
