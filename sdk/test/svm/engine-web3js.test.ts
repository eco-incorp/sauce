import { AccountRole } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";

import {
  buildExecuteFromAccountInstruction,
  buildWriteBufferInstruction,
  bytecodeSha256,
  deriveBufferPda,
  toWeb3JsInstruction,
} from "../../src/svm/engine-web3js.js";
import { buildWriteBufferInstruction as kitBuildWriteBuffer } from "../../src/svm/instructions.js";
import { deriveBufferPda as kitDeriveBufferPda } from "../../src/svm/pda.js";

// Arbitrary valid base58 pubkeys — the conversion is structural, addresses are opaque.
const PROGRAM = new PublicKey("11111111111111111111111111111111");
const AUTHORITY = new PublicKey("So11111111111111111111111111111111111111112");
const BUFFER = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const OTHER = new PublicKey("Sysvar1nstructions1111111111111111111111111");

describe("svm/engine/web3js adapter", () => {
  it("toWeb3JsInstruction decodes all four account roles and copies data verbatim", () => {
    const ix = {
      programAddress: PROGRAM.toBase58(),
      accounts: [
        { address: OTHER.toBase58(), role: AccountRole.WRITABLE_SIGNER },
        { address: BUFFER.toBase58(), role: AccountRole.WRITABLE },
        { address: AUTHORITY.toBase58(), role: AccountRole.READONLY_SIGNER },
        { address: PROGRAM.toBase58(), role: AccountRole.READONLY },
      ],
      data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    };

    const v1 = toWeb3JsInstruction(ix as never);

    expect(v1.programId.equals(PROGRAM)).toBe(true);
    expect(v1.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ]);
    expect(v1.data).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  });

  it("a wrapped builder is byte-identical to the kit builder it wraps", () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5]);
    const v1 = buildWriteBufferInstruction({
      programId: PROGRAM,
      authority: AUTHORITY,
      buffer: BUFFER,
      offset: 7,
      chunk,
    });
    const kit = kitBuildWriteBuffer({
      programId: PROGRAM.toBase58() as never,
      authority: AUTHORITY.toBase58() as never,
      buffer: BUFFER.toBase58() as never,
      offset: 7,
      chunk,
    });

    expect(Uint8Array.from(v1.data)).toEqual(kit.data);
    expect(v1.programId.toBase58()).toEqual(kit.programAddress);
    expect(v1.keys.map((k) => k.pubkey.toBase58())).toEqual(
      (kit.accounts ?? []).map((a) => a.address),
    );
    // Signer bit = 0b10, writable bit = 0b01 in kit's AccountRole encoding.
    expect(v1.keys.map((k) => [k.isSigner, k.isWritable])).toEqual(
      (kit.accounts ?? []).map((a) => [(a.role & 0b10) !== 0, (a.role & 0b01) !== 0]),
    );
  });

  it("buildExecuteFromAccountInstruction lists the buffer first and read-only", () => {
    const v1 = buildExecuteFromAccountInstruction({
      programId: PROGRAM,
      buffer: BUFFER,
      accounts: [{ pubkey: AUTHORITY, isSigner: true, isWritable: true }],
    });

    expect(v1.keys[0].pubkey.equals(BUFFER)).toBe(true);
    expect(v1.keys[0].isWritable).toBe(false);
  });

  it("deriveBufferPda matches the SDK async kit derivation (identical seed scheme)", async () => {
    const seed = new Uint8Array(32).fill(7);
    const v1Pda = deriveBufferPda(PROGRAM, AUTHORITY, seed);
    const kit = await kitDeriveBufferPda(
      PROGRAM.toBase58() as never,
      AUTHORITY.toBase58() as never,
      seed,
    );
    expect(v1Pda.toBase58()).toEqual(kit.address);
  });

  it("deriveBufferPda rejects a non-32-byte seed", () => {
    expect(() => deriveBufferPda(PROGRAM, AUTHORITY, new Uint8Array(16))).toThrow();
  });

  it("bytecodeSha256 matches the known sha256 vectors", () => {
    // sha256("") — the canonical empty-input digest.
    expect(Buffer.from(bytecodeSha256(new Uint8Array())).toString("hex")).toEqual(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(bytecodeSha256(new Uint8Array([1, 2, 3]))).toHaveLength(32);
  });
});
