/**
 * SVM settle verify/decode — the SVM counterpart of the EVM `/verify` checker.
 *
 * `verifySvmSettleProgram` is recompile + byte-compare: a settle program's `minOut`/`splCount` are
 * compile-time defines folded into the bytecode and its accounts are attach slots, so there is
 * nothing to parse OUT of it. Genuineness is proven by recompiling `svmSettleSource(N)` with the
 * EXPECTED defines and byte-comparing — which pins the logic, the floor and the split in one
 * comparison, since all three are the same bytes.
 */
import { createHash } from "node:crypto";
import { AccountRole, getAddressDecoder } from "@solana/kit";
import {
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
} from "../../src/svm/instructions.js";
import { svmSettleRefs, svmSettleSource } from "../../src/svm/recipes/index.js";
import {
  decodeSvmSettleExecution,
  verifySvmSettleExecution,
  verifySvmSettleProgram,
  type SvmSettleExpectation,
} from "../../src/svm/verify.js";
import { compileSource } from "../helpers";

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const PROGRAM = "CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ";
const BUFFER = "So11111111111111111111111111111111111111112";

const DEFAULT_EXPECTED: SvmSettleExpectation = { minOut: 777n, splCount: 1n };

/** What a partner does: compile the shipped source with the settlement's defines. */
function partnerCompile(escrowCount: number, expected: SvmSettleExpectation = DEFAULT_EXPECTED) {
  return compileSource(svmSettleSource(escrowCount), "svm", {
    defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
  });
}

/** A manifest carrying just the slot names, for the shape-only negative controls. */
const manifestOf = (names: readonly string[]) => ({
  accounts: names.map((name, index) => ({ kind: "slot", index, name })),
});

describe("verifySvmSettleProgram", () => {
  it("accepts a genuine settle program and reports its escrow count + refs", () => {
    for (const n of [1, 2, 5, 8]) {
      const { bytecode, manifest } = partnerCompile(n);
      const result = verifySvmSettleProgram(bytecode, manifest!, DEFAULT_EXPECTED);
      expect(result.genuine).toBe(true);
      expect(result.escrowCount).toBe(n);
      expect(result.refs).toEqual(svmSettleRefs(n));
      expect(result.mismatch).toBeUndefined();
    }
  });

  it("rejects a program whose bytecode was tampered (one flipped byte)", () => {
    const { bytecode, manifest } = partnerCompile(2);
    const tampered = bytecode.slice();
    tampered[10] ^= 0xff;
    const result = verifySvmSettleProgram(tampered, manifest!, DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBe(2); // shape still inferred from the manifest
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it("★ rejects a genuine settle compiled for a DIFFERENT minOut — the floor is bound to the bytes", () => {
    // The whole point of folding the scalars in: a program enforcing minOut=1 cannot pass as one
    // enforcing minOut=777, because they are different bytecode.
    const { bytecode, manifest } = partnerCompile(2, { minOut: 1n, splCount: 1n });
    const result = verifySvmSettleProgram(bytecode, manifest!, DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/minOut=777, splCount=1/);
  });

  it("★ rejects a genuine settle compiled for a DIFFERENT splCount — the split is bound too", () => {
    const { bytecode, manifest } = partnerCompile(3, { minOut: 777n, splCount: 2n });
    const result = verifySvmSettleProgram(bytecode, manifest!, { minOut: 777n, splCount: 1n });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(3\)/);
  });

  it("accepts it again once the expectation names the values it was actually compiled with", () => {
    const expected: SvmSettleExpectation = { minOut: 4242n, splCount: 2n };
    const { bytecode, manifest } = partnerCompile(3, expected);
    expect(verifySvmSettleProgram(bytecode, manifest!, expected).genuine).toBe(true);
  });

  it("rejects a genuine blob paired with the WRONG manifest (slot-name mismatch)", () => {
    const { bytecode } = partnerCompile(2);
    // A manifest with the right COUNT (3·2+3=9) but a wrong name at one slot.
    const badRefs = svmSettleRefs(2).map((r, i) => (i === 4 ? "not_a_settle_ref" : r));
    const result = verifySvmSettleProgram(bytecode, manifestOf(badRefs), DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/slots do not match svmSettleRefs\(2\)/);
  });

  it("rejects a manifest whose size fits no settle shape (not 3N+3)", () => {
    const { bytecode } = partnerCompile(1);
    const result = verifySvmSettleProgram(bytecode, manifestOf(["a", "b"]), DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBeNull();
    expect(result.mismatch).toMatch(/not 3N \+ 3/);
  });
});

// ── execution (calldata + accounts together) ──

const addrDecoder = getAddressDecoder();
/** A distinct valid base58 address per seed (0..255) — 32 bytes filled with `seed`. */
function makeAddr(seed: number): string {
  return addrDecoder.decode(new Uint8Array(32).fill(seed));
}
function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

interface FixtureOpts extends Partial<SvmSettleExpectation> {
  tp0?: string;
  tp1?: string;
}

/** Builds the SDK's legacy inspection format for `n` escrows. This is not executable on the released
 *  gated engine; current raw CPI coverage lives in verify-gated.test.ts. The execute payload carries no args tail —
 *  the program's values are in its bytecode. */
function buildFixture(n: number, opts: FixtureOpts = {}) {
  const { minOut = 777n, splCount = 1n, tp0 = TOKENKEG, tp1 = TOKEN_2022 } = opts;
  const expected: SvmSettleExpectation = { minOut, splCount };
  const { bytecode } = partnerCompile(n, expected);
  const refs = svmSettleRefs(n);
  const addrByRef: Record<string, string> = {};
  refs.forEach((ref, i) => {
    addrByRef[ref] =
      ref === "tokenProgram0" ? tp0 : ref === "tokenProgram1" ? tp1 : makeAddr(i + 1);
  });
  const userMetas = refs.map((ref) => ({
    address: addrByRef[ref] as never,
    role: AccountRole.READONLY,
  }));
  const pin = sha256(bytecode);
  const ix = buildExecuteFromAccountInstruction({
    programId: PROGRAM as never,
    code: BUFFER as never,
    accounts: userMetas,
  });
  return { bytecode, refs, addrByRef, userMetas, ix, pin, expected, tp0, tp1 };
}

/** The bare `{ address }` account list a raw instruction gives you. */
const bareAccounts = (ix: { accounts?: readonly { address: unknown }[] }) =>
  ix.accounts!.map((a) => ({ address: a.address as string }));

describe("decodeSvmSettleExecution: explicit legacy wire", () => {
  it("resolves account identities from a real instruction (buffer-prefixed list)", () => {
    const fx = buildFixture(2);
    const decoded = decodeSvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
    });

    expect(decoded.instruction).toBe("execute_from_account");
    expect(decoded.hadBufferAccount).toBe(true);
    expect(decoded.escrowCount).toBe(2);
    expect(decoded.refs).toEqual(svmSettleRefs(2));
    // Every ref resolved to the pubkey the fixture attached at that slot.
    for (const ref of decoded.refs) expect(decoded.accounts[ref]).toBe(fx.addrByRef[ref]);
    // No pin on this wire: the released engine's executeFromAccount carries no payload.
    expect(decoded.labeledRefsConsistent).toBeNull(); // bare {address} entries carry no ref label
  });

  it("decodes the recipes split shape (user-tail accounts with ref labels, no buffer)", () => {
    const fx = buildFixture(3);
    // Mirror `execution.accounts[]`: user tail only, each { pubkey, ref }.
    const accounts = fx.refs.map((ref) => ({
      pubkey: fx.addrByRef[ref],
      isSigner: false,
      isWritable: true,
      ref,
    }));
    const decoded = decodeSvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts,
    });

    expect(decoded.hadBufferAccount).toBe(false);
    expect(decoded.escrowCount).toBe(3);
    expect(decoded.accounts.owner).toBe(fx.addrByRef.owner);
    expect(decoded.labeledRefsConsistent).toBe(true);
  });

  it("reports labeledRefsConsistent=false when an entry carries a wrong ref label", () => {
    const fx = buildFixture(2);
    const accounts = fx.refs.map((ref, i) => ({
      pubkey: fx.addrByRef[ref],
      ref: i === 4 ? "not_a_ref" : ref,
    }));
    const decoded = decodeSvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts,
    });
    expect(decoded.labeledRefsConsistent).toBe(false);
    // Identities still resolve positionally regardless of the bogus label.
    expect(decoded.accounts[fx.refs[4]!]).toBe(fx.addrByRef[fx.refs[4]!]);
  });

  it("rejects an account list whose size fits no settle shape", () => {
    const fx = buildFixture(1);
    expect(() =>
      decodeSvmSettleExecution({
        wireFormat: "legacy-ungated",
        instructionData: fx.ix.data as Uint8Array,
        accounts: [makeAddr(1), makeAddr(2)],
      }),
    ).toThrow(/expected 3N\+3 settlement accounts/);
  });
});

describe("verifySvmSettleExecution: explicit legacy wire", () => {
  it("verifies a genuine execution end to end (bytecode byte-match + pin↔bytecode tie)", () => {
    const fx = buildFixture(2, { minOut: 999n });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
      bytecode: fx.bytecode,
      ...fx.expected,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe("bytecode");
    expect(result.pinMatchesBytecode).toBe(true);
    expect(result.mismatch).toBeUndefined();
  });

  it("★ rejects genuine bytecode whose caller supplies NO pin — the calldata commits to nothing", () => {
    // The bytes ARE the canonical settle, but a pinless calldata does not commit to them, so nothing
    // stops a different program running from the buffer.
    const fx = buildFixture(2);
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM as never,
      code: BUFFER as never,
      accounts: fx.userMetas,
    }); // no expectedSha256 → no pin
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      bytecode: fx.bytecode,
      ...fx.expected,
    });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe("bytecode");
    expect(result.bytecodeMatchesCanonical).toBe(true);
    expect(result.pinMatchesBytecode).toBeNull();
    expect(result.mismatch).toMatch(/supplied no pin/);
  });

  it("verifies the recipes split shape (3N+3 user tail, no buffer account) as genuine", () => {
    const fx = buildFixture(3);
    const accounts = fx.refs.map((ref) => ({
      pubkey: fx.addrByRef[ref],
      isSigner: false,
      isWritable: true,
      ref,
    }));
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts,
      bytecode: fx.bytecode,
      ...fx.expected,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(true);
    expect(result.hadBufferAccount).toBe(false);
    expect(result.verifiedBy).toBe("bytecode");
  });

  it("★ rejects a genuine execution checked against the WRONG expected minOut", () => {
    const fx = buildFixture(2, { minOut: 999n });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
      bytecode: fx.bytecode,
      minOut: 1n,
      splCount: 1n,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(false);
    expect(result.bytecodeMatchesCanonical).toBe(false);
  });

  it("rejects tampered bytecode (byte-match fails)", () => {
    const fx = buildFixture(2);
    const tampered = fx.bytecode.slice();
    tampered[10] ^= 0xff;
    // Re-pin the calldata to the tampered bytecode so the failure is the byte-match, not the pin.
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM as never,
      code: BUFFER as never,
      accounts: fx.userMetas,
    });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      bytecode: tampered,
      ...fx.expected,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it("rejects a pin that does not equal sha256(bytecode)", () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM as never,
      code: BUFFER as never,
      accounts: fx.userMetas,
    });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      bytecode: fx.bytecode,
      ...fx.expected,
      // A pin that is NOT sha256(bytecode) — the subject of this test.
      pin: new Uint8Array(32).fill(0xab),
    });
    expect(result.genuine).toBe(false);
    expect(result.pinMatchesBytecode).toBe(false);
    expect(result.mismatch).toMatch(/pin does not equal sha256/);
  });

  it("accepts a CALLER-ASSERTED pin alone, with NO partner bytecode", () => {
    // fx.pin is sha256(the real settle bytecode) == sha256(canonical), so the SDK's own recompile
    // matches it and a partner needs no bytecode. Note what this does NOT show: nothing on chain
    // checks this pin, so the verdict is only as good as the caller's evidence for it — which is
    // why it is `caller-asserted-pin` rather than proof.
    const fx = buildFixture(2, { minOut: 321n });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
      ...fx.expected,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe("caller-asserted-pin");
    expect(result.pinMatchesCanonical).toBe(true);
    expect(result.bytecodeMatchesCanonical).toBeNull();
  });

  // The inline `execute` path had NO test at all — every fixture used execute_from_account — which is
  // how a pin-only verdict for inline bytecode survived a previous audit round.
  it("verifies an INLINE execute against its own payload, no pin needed", () => {
    const fx = buildFixture(1, { minOut: 555n });
    const ix = buildExecuteInstruction({
      programId: PROGRAM as never,
      bytecode: fx.bytecode,
      accounts: fx.userMetas,
    });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      ...fx.expected,
    });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe("inline-bytecode");
  });

  it("refuses an INLINE execute carrying arbitrary bytecode, even with a canonical pin", () => {
    // The attack: the program is inline, so the engine runs THESE bytes and never looks at a pin.
    // Supplying `pin = sha256(canonical settle)` used to return genuine: true / verifiedBy: "pin",
    // because the verdict never read `decoded.instruction`.
    const fx = buildFixture(1, { minOut: 555n });
    const attacker = new Uint8Array(fx.bytecode.length).fill(0x99);
    const ix = buildExecuteInstruction({
      programId: PROGRAM as never,
      bytecode: attacker,
      accounts: fx.userMetas,
    });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      ...fx.expected,
      pin: fx.pin,
    });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe("inline-bytecode");
    expect(result.mismatch).toMatch(/inline execute bytecode does not byte-match/);
  });

  it("rejects a settle-SHAPED decoy whose pin does not match the canonical settle (no bytecode)", () => {
    // Same account shape as a real settle (3·1+3) but a pin that is NOT the canonical settle hash —
    // exactly the adversarial decoy the shape-only path would have misread.
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM as never,
      code: BUFFER as never,
      accounts: fx.userMetas,
    });
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      ...fx.expected,
      // A pin that is not the canonical settle's hash — the decoy this test is about.
      pin: new Uint8Array(32).fill(0xcd),
    });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe("caller-asserted-pin");
    expect(result.pinMatchesCanonical).toBe(false);
    expect(result.mismatch).toMatch(/pin does not match sha256/);
  });

  it("is NOT genuine when no pin is supplied and no bytecode is supplied", () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({
      programId: PROGRAM as never,
      code: BUFFER as never,
      accounts: fx.userMetas,
    }); // no expectedSha256 → no pin
    const result = verifySvmSettleExecution({
      wireFormat: "legacy-ungated",
      instructionData: ix.data as Uint8Array,
      accounts: bareAccounts(ix),
      ...fx.expected,
    });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe("none");
    expect(result.mismatch).toMatch(/no caller pin and no bytecode/);
  });
});
