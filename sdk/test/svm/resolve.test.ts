import { AccountRole, address, createNoopSigner } from "@solana/kit";
import type { AccountEntry, AccountManifest, AccountRole as SlotRole } from "sauce-compiler";
import { PAYER_REF, resolveAccounts } from "../../src/svm/index.js";

const PAYER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const POOL = address("So11111111111111111111111111111111111111112");
const ORACLE = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Slots in declaration order, `index` assigned positionally exactly as the compiler emits it. */
const manifestOf = (
  ...slots: readonly (readonly [name: string, requires: SlotRole])[]
): AccountManifest => ({
  accounts: slots.map(([name, requires], index) => ({ kind: "slot", index, name, requires })),
});

describe("resolveAccounts", () => {
  it("preserves manifest order: metas[i] is user-account index i", () => {
    const manifest = manifestOf(
      ["pool", "writable"],
      [PAYER_REF, "readonly"],
      ["oracle", "readonly"],
    );
    const metas = resolveAccounts(manifest, { pool: POOL, oracle: ORACLE }, PAYER);

    expect(metas).toEqual([
      { address: POOL, role: AccountRole.WRITABLE },
      { address: PAYER, role: AccountRole.READONLY_SIGNER },
      { address: ORACLE, role: AccountRole.READONLY },
    ]);
  });

  it("resolves the reserved payer ref to the fee payer as a signer", () => {
    const metas = resolveAccounts(manifestOf([PAYER_REF, "writable"]), {}, PAYER);

    expect(metas).toEqual([{ address: PAYER, role: AccountRole.WRITABLE_SIGNER }]);
  });

  it("rejects a resolution entry under the reserved payer ref instead of silently overriding it", () => {
    const manifest = manifestOf([PAYER_REF, "readonly"]);

    expect(() => resolveAccounts(manifest, { [PAYER_REF]: POOL }, PAYER)).toThrow(
      "account ref 'payer' is reserved for the fee payer (rename the ref or remove it from the resolution map)",
    );
  });

  it("throws the exact message listing every unresolved ref", () => {
    const manifest = manifestOf(["a", "readonly"], ["pool", "readonly"], ["b", "readonly"]);

    expect(() => resolveAccounts(manifest, { pool: POOL }, PAYER)).toThrow(
      "unresolved account refs: a, b (provide addresses in the resolution map)",
    );
  });

  it("upgrades signer from the slot role", () => {
    const metas = resolveAccounts(manifestOf(["auth", "readonly_signer"]), { auth: ORACLE }, PAYER);

    expect(metas).toEqual([{ address: ORACLE, role: AccountRole.READONLY_SIGNER }]);
  });

  it("upgrades signer from the resolution entry flag", () => {
    const metas = resolveAccounts(
      manifestOf(["auth", "writable"]),
      { auth: { address: ORACLE, signer: true } },
      PAYER,
    );

    expect(metas).toEqual([{ address: ORACLE, role: AccountRole.WRITABLE_SIGNER }]);
  });

  it("carries a resolution-attached TransactionSigner on the meta and upgrades the role", () => {
    const signer = createNoopSigner(ORACLE);
    const metas = resolveAccounts(
      manifestOf(["delegate", "readonly_signer"]),
      { delegate: { address: ORACLE, signer } },
      PAYER,
    );

    expect(metas).toEqual([{ address: ORACLE, role: AccountRole.READONLY_SIGNER, signer }]);
    expect(metas[0].signer).toBe(signer);
  });

  it("omits the signer key on metas without an attached signer (kit detects signers via 'signer' in meta)", () => {
    const metas = resolveAccounts(
      manifestOf(["auth", "readonly_signer"]),
      { auth: { address: ORACLE, signer: true } },
      PAYER,
    );

    expect("signer" in metas[0]).toBe(false);
  });

  it("rejects a TransactionSigner whose address differs from the resolved address", () => {
    const manifest = manifestOf(["delegate", "readonly"]);

    expect(() =>
      resolveAccounts(
        manifest,
        { delegate: { address: POOL, signer: createNoopSigner(ORACLE) } },
        PAYER,
      ),
    ).toThrow(
      `account ref 'delegate' address ${POOL} does not match its TransactionSigner address ${ORACLE}`,
    );
  });

  it("takes writable from the slot role, not the resolution", () => {
    const metas = resolveAccounts(
      manifestOf(["ro", "readonly"], ["rw", "writable"]),
      { ro: POOL, rw: ORACLE },
      PAYER,
    );

    expect(metas[0].role).toBe(AccountRole.READONLY);
    expect(metas[1].role).toBe(AccountRole.WRITABLE);
  });

  it("maps all four slot roles onto the matching kit role", () => {
    const metas = resolveAccounts(
      manifestOf(
        ["a", "readonly"],
        ["b", "writable"],
        ["c", "readonly_signer"],
        ["d", "writable_signer"],
      ),
      { a: POOL, b: POOL, c: ORACLE, d: ORACLE },
      PAYER,
    );

    expect(metas.map((m) => m.role)).toEqual([
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.READONLY_SIGNER,
      AccountRole.WRITABLE_SIGNER,
    ]);
  });

  it("stops at a `remaining` marker — the tail is the caller's own, not a resolvable slot", () => {
    const manifest: AccountManifest = {
      accounts: [
        { kind: "slot", index: 0, name: "pool", requires: "writable" },
        { kind: "remaining", from: 1 } satisfies AccountEntry,
      ],
    };
    const metas = resolveAccounts(manifest, { pool: POOL }, PAYER);

    expect(metas).toEqual([{ address: POOL, role: AccountRole.WRITABLE }]);
  });

  it("rejects a `remaining` marker that is not last instead of silently dropping the slots after it", () => {
    // Nothing in the manifest TYPE enforces "always last", and stopping at it would drop 'oracle'
    // from `metas` — shifting the index of every account the caller then appends as its own tail.
    const manifest: AccountManifest = {
      accounts: [
        { kind: "slot", index: 0, name: "pool", requires: "writable" },
        { kind: "remaining", from: 1 } satisfies AccountEntry,
        { kind: "slot", index: 2, name: "oracle", requires: "readonly" },
      ],
    };

    expect(() => resolveAccounts(manifest, { pool: POOL, oracle: ORACLE }, PAYER)).toThrow(
      "account manifest: a 'remaining' entry must be last, but index 1 of 3 is followed by 'oracle'",
    );
  });

  it("allows duplicate addresses across refs", () => {
    const metas = resolveAccounts(
      manifestOf(["a", "readonly"], ["b", "writable"]),
      { a: POOL, b: POOL },
      PAYER,
    );

    expect(metas.map((m) => m.address)).toEqual([POOL, POOL]);
  });

  it("a signerless manifest stays signerless by default (NoSigner is lazy — only MSG_SENDER readers need one)", () => {
    const metas = resolveAccounts(
      manifestOf(["pool", "writable"], ["oracle", "readonly"]),
      { pool: POOL, oracle: ORACLE },
      PAYER,
    );

    expect(metas).toEqual([
      { address: POOL, role: AccountRole.WRITABLE },
      { address: ORACLE, role: AccountRole.READONLY },
    ]);
  });

  it("appendPayerSigner appends the payer AT THE END when no meta signs (slot indices stable)", () => {
    const manifest = manifestOf(["pool", "writable"], ["oracle", "readonly"]);
    const metas = resolveAccounts(manifest, { pool: POOL, oracle: ORACLE }, PAYER, {
      appendPayerSigner: true,
    });

    // For MSG_SENDER-reading programs whose manifest declares no signer slot; the
    // append keeps user-account indices 0..n-1 exactly the manifest's.
    expect(metas).toEqual([
      { address: POOL, role: AccountRole.WRITABLE },
      { address: ORACLE, role: AccountRole.READONLY },
      { address: PAYER, role: AccountRole.READONLY_SIGNER },
    ]);
  });

  it("appendPayerSigner does NOT append when any resolved meta already signs", () => {
    const viaSlotRole = resolveAccounts(
      manifestOf(["auth", "readonly_signer"]),
      { auth: ORACLE },
      PAYER,
      {
        appendPayerSigner: true,
      },
    );
    const viaPayerRef = resolveAccounts(manifestOf([PAYER_REF, "readonly"]), {}, PAYER, {
      appendPayerSigner: true,
    });

    expect(viaSlotRole).toHaveLength(1);
    expect(viaPayerRef).toHaveLength(1);
  });
});
