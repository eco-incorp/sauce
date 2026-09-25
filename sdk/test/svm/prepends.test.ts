import { AccountRole, address, generateKeyPairSigner } from "@solana/kit";
import type { KeyPairSigner } from "@solana/kit";
import {
  NATIVE_MINT,
  buildAtaPrepend,
  buildComputeBudgetPrepend,
  buildWrapSolPrepends,
} from "../../src/svm/index.js";

const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const OWNER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MINT = address("So11111111111111111111111111111111111111112");

let payer: KeyPairSigner;

beforeAll(async () => {
  payer = await generateKeyPairSigner();
});

describe("buildComputeBudgetPrepend", () => {
  it("emits only SetComputeUnitLimit when no price is given", () => {
    const instructions = buildComputeBudgetPrepend({ unitLimit: 200_000 });

    expect(instructions).toHaveLength(1);
    expect(instructions[0].programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
    // 0x02 = SetComputeUnitLimit, then u32 LE 200000 = 0x00030d40
    expect(instructions[0].data).toEqual(new Uint8Array([0x02, 0x40, 0x0d, 0x03, 0x00]));
  });

  it("appends SetComputeUnitPrice when a price is given", () => {
    const instructions = buildComputeBudgetPrepend({ unitLimit: 200_000, microLamportsPerCu: 5n });

    expect(instructions).toHaveLength(2);
    expect(instructions[1].programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
    // 0x03 = SetComputeUnitPrice, then u64 LE 5
    expect(instructions[1].data).toEqual(
      new Uint8Array([0x03, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );
  });
});

describe("buildAtaPrepend", () => {
  it("builds a CreateAssociatedTokenIdempotent instruction for the derived ata", async () => {
    const { ata, instruction } = await buildAtaPrepend({ payer, owner: OWNER, mint: MINT });

    expect(instruction.programAddress).toBe(ATA_PROGRAM);
    // 0x01 = CreateIdempotent — safe to prepend when the ATA already exists
    expect(instruction.data).toEqual(new Uint8Array([0x01]));
    expect(instruction.accounts).toMatchObject([
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: OWNER, role: AccountRole.READONLY },
      { address: MINT, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ]);
  });
});

describe("buildWrapSolPrepends", () => {
  it("emits create-wSOL-ata + SOL transfer + SyncNative against the derived wSOL ata", async () => {
    const { wsolAta, instructions } = await buildWrapSolPrepends({
      payer,
      owner: OWNER,
      lamports: 7n,
    });
    const { ata } = await buildAtaPrepend({ payer, owner: OWNER, mint: NATIVE_MINT });

    expect(wsolAta).toBe(ata);
    expect(instructions).toHaveLength(3);

    const [createAta, transfer, sync] = instructions;
    expect(createAta.programAddress).toBe(ATA_PROGRAM);
    expect(createAta.accounts?.[1]).toMatchObject({ address: wsolAta, role: AccountRole.WRITABLE });

    expect(transfer.programAddress).toBe(SYSTEM_PROGRAM);
    // u32 LE 2 = SystemInstruction::Transfer, then u64 LE 7 lamports
    expect(transfer.data).toEqual(
      new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );
    expect(transfer.accounts).toMatchObject([
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: wsolAta, role: AccountRole.WRITABLE },
    ]);

    expect(sync.programAddress).toBe(TOKEN_PROGRAM);
    // 0x11 = SyncNative
    expect(sync.data).toEqual(new Uint8Array([0x11]));
    expect(sync.accounts?.[0]).toMatchObject({ address: wsolAta, role: AccountRole.WRITABLE });
  });
});
