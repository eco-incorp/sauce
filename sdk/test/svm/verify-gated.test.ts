import { createHash } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { EXECUTE_DISCRIMINATOR, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR } from "../../src/svm/engine.js";
import { svmSettleRefs, svmSettleSource } from "../../src/svm/recipes/index.js";
import {
  decodePortalCalldataWithAccounts,
  decodeSvmSettleExecution,
  encodePortalCalldataWithAccounts,
  extractSvmSettleFromCalls,
  verifySvmSettleExecution,
} from "../../src/svm/verify.js";
import { compileSource } from "../helpers";

const owner = new Uint8Array(32).fill(0x11);
const salt = new Uint8Array(32).fill(0x22);
const bump = 253;
const addressFor = (seed: number) => getAddressDecoder().decode(new Uint8Array(32).fill(seed));
const pot = addressFor(0x33);
const code = addressFor(0x44);
const expected = { minOut: 777n, splCount: 1n };
const refs = svmSettleRefs(1);
const users = refs.map((ref, index) => ({ address: addressFor(index + 1), ref }));
const compiled = compileSource(svmSettleSource(1), "svm", {
  defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
});

// kitchen-svm-v1.0.0 cpi.rs: discriminator | owner | salt | bump | inline bytes;
// accounts: optional code, then the user tail, then the signing Pot.
const inline = {
  instructionData: new Uint8Array([
    ...EXECUTE_DISCRIMINATOR,
    ...owner,
    ...salt,
    bump,
    ...compiled.bytecode,
  ]),
  accounts: [...users, pot],
};
const staged = {
  instructionData: new Uint8Array([...EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, ...owner, ...salt, bump]),
  accounts: [code, ...users, pot],
};

const portalEnvelope = encodePortalCalldataWithAccounts({
  instructionData: inline.instructionData,
  accounts: inline.accounts.map((account) => ({
    pubkey: typeof account === "string" ? account : account.address,
    isSigner: false,
    isWritable: true,
  })),
});

describe("released gated SVM execution decoding", () => {
  it("keeps the first token program and every inline account at its actual position", () => {
    const result = verifySvmSettleExecution({ ...inline, ...expected });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe("inline-bytecode");
    expect(result.hadBufferAccount).toBe(false);
    expect(result.accounts).toEqual(
      Object.fromEntries(users.map((account) => [account.ref, account.address])),
    );
    expect(result.gate).toEqual({ owner: addressFor(0x11), salt, bump, pot });
    expect(result.labeledRefsConsistent).toBe(true);
  });

  it("separates staged code and trailing Pot from the settlement accounts", () => {
    const pin = new Uint8Array(createHash("sha256").update(compiled.bytecode).digest());
    const result = verifySvmSettleExecution({
      ...staged,
      ...expected,
      bytecode: compiled.bytecode,
      pin,
    });
    expect(result.genuine).toBe(true);
    expect(result.codeAccount).toBe(code);
    expect(result.gate?.pot).toBe(pot);
    expect(result.accounts.owner).toBe(users[5]!.address);
    expect(result.escrowCount).toBe(1);
  });

  it("extracts raw gated instructions from a Portal envelope with the same account positions", () => {
    const data = portalEnvelope;
    const result = extractSvmSettleFromCalls([{ data, target: addressFor(0x55) }], expected);
    expect(result?.genuine).toBe(true);
    expect(result?.wireFormat).toBe("gated-v1");
    expect(result?.accounts.tokenProgram0).toBe(users[0]!.address);
    expect(result?.gate?.pot).toBe(pot);
  });

  it.each([0, 6, 8, 255])(
    "rejects a Portal account count of %i instead of the seven encoded accounts",
    (count) => {
      const malformed = new Uint8Array(Buffer.from(portalEnvelope.slice(2), "hex"));
      malformed[4 + inline.instructionData.length] = count;
      expect(() => decodePortalCalldataWithAccounts(malformed)).toThrow(/accountCount must equal/);
      expect(extractSvmSettleFromCalls([{ data: malformed }], expected)).toBeNull();
    },
  );

  it("rejects trailing Portal data that fulfillment cannot reconstruct", () => {
    const malformed = portalEnvelope + "deadbeef";
    expect(() => decodePortalCalldataWithAccounts(malformed)).toThrow(/trailing bytes/);
    expect(extractSvmSettleFromCalls([{ data: malformed }], expected)).toBeNull();
  });

  it.each([32, 33])("rejects a non-Borsh boolean at account offset %i", (fieldOffset) => {
    const malformed = new Uint8Array(Buffer.from(portalEnvelope.slice(2), "hex"));
    malformed[4 + inline.instructionData.length + 1 + 4 + fieldOffset] = 2;
    expect(() => decodePortalCalldataWithAccounts(malformed)).toThrow(/not canonical Borsh/);
    expect(extractSvmSettleFromCalls([{ data: malformed }], expected)).toBeNull();
  });

  it("refuses an 8-byte legacy instruction unless legacy inspection is explicitly selected", () => {
    const legacy = { instructionData: EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, accounts: users };
    expect(() => decodeSvmSettleExecution(legacy)).toThrow(/at least 73 bytes/);
    expect(
      decodeSvmSettleExecution({ ...legacy, wireFormat: "legacy-ungated" }).gate,
    ).toBeUndefined();
  });

  it("rejects truncated gate headers and trailing staged instruction bytes", () => {
    expect(() =>
      decodeSvmSettleExecution({ ...staged, instructionData: staged.instructionData.slice(0, 72) }),
    ).toThrow(/at least 73 bytes/);
    expect(() =>
      decodeSvmSettleExecution({
        ...staged,
        instructionData: new Uint8Array([...staged.instructionData, 0]),
      }),
    ).toThrow(/after its header/);
  });

  it("rejects missing gate accounts and invalid addresses", () => {
    expect(() => decodeSvmSettleExecution({ ...inline, accounts: users })).toThrow(/trailing Pot/);
    expect(() => decodeSvmSettleExecution({ ...staged, accounts: [...users, pot] })).toThrow(
      /leading code account/,
    );
    expect(() =>
      decodeSvmSettleExecution({ ...inline, accounts: [...users, "not a public key"] }),
    ).toThrow();
  });

  it("does not let a matching staged pin authenticate altered inline bytecode", () => {
    const changed = inline.instructionData.slice();
    changed[73] ^= 0xff;
    const pin = new Uint8Array(createHash("sha256").update(compiled.bytecode).digest());
    expect(
      verifySvmSettleExecution({ ...inline, instructionData: changed, ...expected, pin }).genuine,
    ).toBe(false);
  });
});
