/**
 * `@sauce/token` on Token-2022, EXECUTED: the SVM arm compiled by the published compiler, cooked
 * through the released Kitchen and engine in LiteSVM, against the REAL Token-2022 program and the
 * REAL associated-token-account program LiteSVM loads.
 *
 * Nothing here plants a token account by hand where the token program can make one: accounts are the
 * associated token accounts the ATA program creates for each mint, sized and initialized by
 * Token-2022 itself (with the account extensions the mint requires: ImmutableOwner, TransferFeeAmount,
 * TransferHookAccount, PausableAccount), and balances arrive through `MintToChecked`. Mints are
 * planted, because a mint's extensions are set by its issuer: two are real tokenized-stock mints as
 * mainnet held them (`test/svm/fixtures/token-2022/stock-mints.json`), one is PYUSD
 * (`real-mints.json`), and the rest carry one extension each, built to Token-2022's layout. A planted
 * mint names the payer as its mint authority, so the test can mint; nothing else of a real image
 * changes unless a case says so.
 *
 * What each extension does to a program, as these cases show it:
 *   - none, ScaledUiAmount, MetadataPointer/TokenMetadata, PermanentDelegate, ConfidentialTransferMint,
 *     a TransferHook with no program, DefaultAccountState initialized: reads and checked writes work
 *     as on a legacy mint, in raw base units;
 *   - TransferFee: the destination receives the amount less the fee, exactly as the SDK's
 *     `svmTokenReceived` computes it, so a program measures what arrived;
 *   - Pausable (paused) and DefaultAccountState (frozen): the token program refuses the write, with
 *     its own error;
 *   - a TransferHook that names a program: the library refuses the transfer, "transfer hook".
 *
 * GATED like `svm.e2e.test.ts`: it skips locally without the engine and hard-fails in CI.
 */
import { AccountRole, getAddressCodec, lamports } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToCheckedInstruction,
} from "@solana-program/token";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import { SVM_TOKEN_REGISTRY } from "../../../src/routes/token-registry.js";
import {
  resolveSvmToken,
  svmTokenAccount,
  svmTokenReceived,
  svmTokenToSend,
} from "../../../src/svm/token-accounts.js";
import { parseMintExtensions } from "../../../src/svm/token-extensions.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import {
  expectOk,
  randomAddress,
  sendInstructions,
  setTokenAccount,
  startEngine,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  tokenAmount,
  toBigInt,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import { failure, literal, reasonOf, run } from "./svm-cook.js";

const RUST_ENGINE_SO = process.env.SAUCE_RUST_ENGINE_SO;
const describeToken2022 = RUST_ENGINE_SO ? describe : describe.skip;

if (!RUST_ENGINE_SO && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_ENGINE_SO is unset in CI. This suite must never skip here — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const codec = getAddressCodec();
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "svm", "fixtures");

interface MintFixture {
  readonly mint: string;
  readonly dataBase64: string;
}

const STOCK_MINTS = (
  JSON.parse(readFileSync(join(FIXTURES, "token-2022", "stock-mints.json"), "utf8")) as {
    mints: Record<string, MintFixture & { readonly decimals: number }>;
  }
).mints;
const PYUSD = (
  JSON.parse(readFileSync(join(FIXTURES, "token-2022", "real-mints.json"), "utf8")) as {
    pyusd: MintFixture;
  }
).pyusd;

/** Multi-byte, so a wrong decode cannot pass by coincidence. */
const MINTED = 0x0000_0012_3456_789an;
const MOVED = 0x0000_0000_0123_4567n;
const DECIMALS = 6;

// ---------------------------------------------------------------------------------------------
// Token-2022 images
// ---------------------------------------------------------------------------------------------

/** One extension entry: its type, its length, its value (`spl_token_2022::extension`, TLV). */
const extension = (type: number, value: Uint8Array): Uint8Array => {
  const entry = new Uint8Array(4 + value.length);
  const view = new DataView(entry.buffer);
  view.setUint16(0, type, true);
  view.setUint16(2, value.length, true);
  entry.set(value, 4);

  return entry;
};

const key = (address: Address): Uint8Array => new Uint8Array(codec.encode(address));

/** `TransferFeeConfig` (1): both schedules `bps` and `maximumFee`, from epoch 0. */
const transferFee = (bps: number, maximumFee: bigint): Uint8Array => {
  const value = new Uint8Array(108);
  const view = new DataView(value.buffer);
  for (const at of [72, 90]) {
    view.setBigUint64(at + 8, maximumFee, true);
    view.setUint16(at + 16, bps, true);
  }

  return extension(1, value);
};

/** `DefaultAccountState` (6): the state a new account starts in (1 initialized, 2 frozen). */
const defaultAccountState = (state: number): Uint8Array => extension(6, new Uint8Array([state]));

/** `TransferHook` (14): its authority, then its program; no program is all zeros. */
const transferHook = (program?: Address): Uint8Array => {
  const value = new Uint8Array(64);
  if (program !== undefined) value.set(key(program), 32);

  return extension(14, value);
};

/** `PausableConfig` (26): its authority, then whether the mint is paused. */
const pausable = (paused: boolean): Uint8Array => {
  const value = new Uint8Array(33);
  value[32] = paused ? 1 : 0;

  return extension(26, value);
};

/**
 * A Token-2022 mint with `extensions`, the payer its mint and freeze authority: the 82-byte base
 * (`mint_authority` COption@0, supply@36, decimals@44, initialized@45, `freeze_authority` COption@46)
 * and, with any extension, padding to 165, the type byte (1, Mint) and the entries. With none it is
 * the bare 82 bytes, as Token-2022 sizes an extensionless mint.
 */
const mintImage = (authority: Address, extensions: readonly Uint8Array[] = []): Uint8Array => {
  const tail = extensions.reduce((size, entry) => size + entry.length, 0);
  const data = new Uint8Array(extensions.length === 0 ? 82 : 166 + tail);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  data.set(key(authority), 4);
  data[44] = DECIMALS;
  data[45] = 1;
  view.setUint32(46, 1, true);
  data.set(key(authority), 50);
  if (extensions.length > 0) {
    data[165] = 1;
    let at = 166;
    for (const entry of extensions) {
      data.set(entry, at);
      at += entry.length;
    }
  }

  return data;
};

/** A real mint's image with the payer as its mint authority, so the test can mint it. */
const realImage = (fixture: MintFixture, authority: Address): Uint8Array => {
  const data = new Uint8Array(Buffer.from(fixture.dataBase64, "base64"));
  if (new DataView(data.buffer).getUint32(0, true) !== 1) {
    throw new Error(`${fixture.mint} has no mint authority to replace`);
  }
  data.set(key(authority), 4);

  return data;
};

/** Each TLV entry of a mint image, as `[type, value offset, length]`. */
const entriesOf = (data: Uint8Array): Array<[number, number, number]> => {
  const view = new DataView(data.buffer, data.byteOffset);
  const entries: Array<[number, number, number]> = [];
  for (let at = 166; at + 4 <= data.length;) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (type === 0) break;
    entries.push([type, at + 4, length]);
    at += 4 + length;
  }

  return entries;
};

/** The value offset of extension `type` in a mint image, which must carry it. */
const valueOf = (data: Uint8Array, type: number): number => {
  const found = entriesOf(data).find(([entry]) => entry === type);
  if (found === undefined) throw new Error(`the image carries no extension ${type}`);

  return found[1];
};

// ---------------------------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------------------------

const plant = (
  harness: EngineHarness,
  data: Uint8Array,
  owner: Address = TOKEN_2022_PROGRAM,
  address: Address = randomAddress(),
): Address => {
  harness.svm.setAccount({
    address,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: owner,
    space: BigInt(data.length),
  });

  return address;
};

const dataOf = (harness: EngineHarness, address: Address): Uint8Array => {
  const account = harness.svm.getAccount(address);
  if (!account.exists) throw new Error(`${address} does not exist`);

  return new Uint8Array(account.data);
};

/** The bank as an RPC answers for it: an account's data and owner, or null. */
const bankLoader =
  (harness: EngineHarness): OwnedAccountLoader =>
  async (address) => {
    const account = harness.svm.getAccount(address);

    return account.exists
      ? { data: new Uint8Array(account.data), owner: account.programAddress }
      : null;
  };

const send = async (harness: EngineHarness, instructions: Instruction[]): Promise<void> => {
  expectOk(await sendInstructions(harness, instructions));
};

/**
 * `owner`'s associated token account for `mint`, created by the ATA program — which asks the token
 * program for the account's size, so Token-2022 sizes it for the extensions the mint requires — and,
 * with `amount`, funded by `MintToChecked`.
 */
const tokenAccount = async (
  harness: EngineHarness,
  mint: Address,
  owner: Address,
  amount = 0n,
  tokenProgram: Address = TOKEN_2022_PROGRAM,
): Promise<Address> => {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  const decimals = dataOf(harness, mint)[44]!;
  await send(harness, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: harness.payer,
      ata,
      owner,
      mint,
      tokenProgram,
    }),
    ...(amount === 0n
      ? []
      : [
          getMintToCheckedInstruction(
            { mint, token: ata, mintAuthority: harness.payer, amount, decimals },
            { programAddress: tokenProgram },
          ),
        ]),
  ]);

  return ata;
};

const readonly = (address: Address) => ({ address, role: AccountRole.READONLY });
const writable = (address: Address) => ({ address, role: AccountRole.WRITABLE });

// ---------------------------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------------------------

const readEntry = (method: "balanceOf" | "ownerOf", mint: Address): string =>
  `import { ${method} } from "@sauce/token"; function main(account: Account): ${method === "ownerOf" ? "Address" : "Uint256"} { return ${method}(${literal(mint)}, account); }`;

const mintEntry = (method: "totalSupply" | "decimals"): string =>
  `import { ${method} } from "@sauce/token"; function main(token: Account): Uint256 { return ${method}(token); }`;

/** Moves `amount` from `source` to `dest` with `transferChecked`, and nothing else. */
const moveEntry = (mint: Address, amount: bigint): string =>
  `import { transferChecked } from "@sauce/token"; function main(tokenProgram: Account, source: Account<Writable>, mint: Account, dest: Account<Writable>, authority: Account<Signer>): void { transferChecked(${literal(mint)}, tokenProgram, source, mint, dest, authority, ${amount}n, ${DECIMALS}n); }`;

/**
 * Moves `amount` from `source` to `dest` with `transferChecked` and returns what `dest` gained: the
 * balance delta, which is what a program that must know what arrived measures.
 */
const transferEntry = (mint: Address, amount: bigint, decimals = DECIMALS): string =>
  `import { balanceOf, transferChecked } from "@sauce/token"; function main(tokenProgram: Account, source: Account<Writable>, mint: Account, dest: Account<Writable>, authority: Account<Signer>): Uint256 { const before = balanceOf(${literal(mint)}, dest); transferChecked(${literal(mint)}, tokenProgram, source, mint, dest, authority, ${amount}n, ${decimals}n); return balanceOf(${literal(mint)}, dest) - before; }`;

const transferSlots = (
  harness: EngineHarness,
  accounts: { source: Address; mint: Address; dest: Address; tokenProgram?: Address },
) => ({
  tokenProgram: readonly(accounts.tokenProgram ?? TOKEN_2022_PROGRAM),
  source: writable(accounts.source),
  mint: readonly(accounts.mint),
  dest: writable(accounts.dest),
  authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
});

describeToken2022("@sauce/token e2e: Token-2022 on the real token program", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, RUST_ENGINE_SO);
  });

  /** A mint planted with `extensions` and two of the payer's accounts, the source funded. */
  const withAccounts = async (image: Uint8Array) => {
    const mint = plant(harness, image);
    const source = await tokenAccount(harness, mint, harness.payer.address, MINTED);
    const dest = await tokenAccount(harness, mint, randomAddress());

    return { mint, source, dest };
  };

  describe("reads", () => {
    it("balanceOf, ownerOf, totalSupply and decimals read an extensionless Token-2022 mint's accounts", async () => {
      const { mint, source } = await withAccounts(mintImage(harness.payer.address));
      // The ATA program gives every Token-2022 account ImmutableOwner, so this account is past 165
      // bytes with its type byte set: the extended path, not the legacy size.
      expect(dataOf(harness, source).length).toBeGreaterThan(165);
      expect(dataOf(harness, source)[165]).toBe(2);
      expect(dataOf(harness, mint)).toHaveLength(82);

      const account = { account: readonly(source) };
      expect(toBigInt(await run(harness, readEntry("balanceOf", mint), account))).toBe(MINTED);
      expect(toBigInt(await run(harness, readEntry("ownerOf", mint), account))).toBe(
        BigInt(literal(harness.payer.address).slice(0, -1)),
      );
      const token = { token: readonly(mint) };
      expect(toBigInt(await run(harness, mintEntry("totalSupply"), token))).toBe(MINTED);
      expect(toBigInt(await run(harness, mintEntry("decimals"), token))).toBe(BigInt(DECIMALS));
    });

    it("reads a 165-byte Token-2022 account, which has no type byte", async () => {
      const mint = randomAddress();
      const account = setTokenAccount(
        harness,
        randomAddress(),
        mint,
        harness.payer.address,
        MINTED,
        TOKEN_2022_PROGRAM,
      );

      expect(
        toBigInt(await run(harness, readEntry("balanceOf", mint), { account: readonly(account) })),
      ).toBe(MINTED);
    });

    it("totalSupply and decimals read an extended mint", async () => {
      const mint = plant(harness, mintImage(harness.payer.address, [pausable(false)]));
      await tokenAccount(harness, mint, harness.payer.address, MINTED);
      const token = { token: readonly(mint) };

      expect(toBigInt(await run(harness, mintEntry("totalSupply"), token))).toBe(MINTED);
      expect(toBigInt(await run(harness, mintEntry("decimals"), token))).toBe(BigInt(DECIMALS));
    });

    it("refuses a Token-2022 mint, or its multisig, read as a token account", async () => {
      const owner = harness.payer.address;
      const bare = plant(harness, mintImage(owner));
      const extended = plant(harness, mintImage(owner, [pausable(false)]));
      // A 355-byte multisig whose bytes would otherwise pass: the type byte an extended account has,
      // and the mint at 0. Token-2022 never reads that size as an account; neither does the library.
      const mint = randomAddress();
      const lookalike = new Uint8Array(355);
      lookalike.set(key(mint), 0);
      lookalike[165] = 2;
      const multisig = plant(harness, lookalike);

      for (const [account, token] of [
        [bare, owner],
        [extended, owner],
        [multisig, mint],
      ] as const) {
        expect(
          await reasonOf(harness, readEntry("balanceOf", token), { account: readonly(account) }),
        ).toBe("not a token account");
      }
    });

    it("refuses a Token-2022 token account, multisig or uninitialized mint read as a mint", async () => {
      const { source } = await withAccounts(mintImage(harness.payer.address));
      const lookalike = mintImage(harness.payer.address, [pausable(false)]);
      const multisig = plant(
        harness,
        new Uint8Array([...lookalike.subarray(0, 166), ...new Uint8Array(189)]),
      );
      const uninitialized = mintImage(harness.payer.address, [pausable(false)]);
      uninitialized[45] = 0;

      for (const [account, reason] of [
        [source, "not a mint"],
        [multisig, "not a mint"],
        [plant(harness, uninitialized), "uninitialized mint"],
      ] as const) {
        expect(await reasonOf(harness, mintEntry("decimals"), { token: readonly(account) })).toBe(
          reason,
        );
      }
    });
  });

  describe("checked writes", () => {
    it("transferChecked moves an extensionless Token-2022 balance", async () => {
      const { mint, source, dest } = await withAccounts(mintImage(harness.payer.address));

      const received = await run(
        harness,
        transferEntry(mint, MOVED),
        transferSlots(harness, { source, mint, dest }),
      );

      expect(toBigInt(received)).toBe(MOVED);
      expect(tokenAmount(harness, source)).toBe(MINTED - MOVED);
      expect(tokenAmount(harness, dest)).toBe(MOVED);
    });

    it("approveChecked sets the delegate allowance reads back", async () => {
      const { mint, source } = await withAccounts(mintImage(harness.payer.address));
      const delegate = randomAddress();

      await run(
        harness,
        `import { approveChecked } from "@sauce/token"; function main(tokenProgram: Account, source: Account<Writable>, mint: Account, delegate: Account, authority: Account<Signer>): void { approveChecked(${literal(mint)}, tokenProgram, source, mint, delegate, authority, ${MOVED}n, ${DECIMALS}n); }`,
        {
          tokenProgram: readonly(TOKEN_2022_PROGRAM),
          source: writable(source),
          mint: readonly(mint),
          delegate: readonly(delegate),
          authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
        },
      );
      const allowance = await run(
        harness,
        `import { allowance } from "@sauce/token"; function main(account: Account): Uint256 { return allowance(${literal(mint)}, account, ${literal(delegate)}); }`,
        { account: readonly(source) },
      );

      expect(toBigInt(allowance)).toBe(MOVED);
    });

    it("the same functions move legacy SPL Token, through legacy SPL Token", async () => {
      const mint = plant(harness, mintImage(harness.payer.address), TOKEN_PROGRAM);
      const source = await tokenAccount(
        harness,
        mint,
        harness.payer.address,
        MINTED,
        TOKEN_PROGRAM,
      );
      const dest = await tokenAccount(harness, mint, randomAddress(), 0n, TOKEN_PROGRAM);

      const received = await run(
        harness,
        transferEntry(mint, MOVED),
        transferSlots(harness, { source, mint, dest, tokenProgram: TOKEN_PROGRAM }),
      );

      expect(toBigInt(received)).toBe(MOVED);
      expect(tokenAmount(harness, dest)).toBe(MOVED);
    });

    it("refuses, naming, before anything moves", async () => {
      const { mint, source, dest } = await withAccounts(mintImage(harness.payer.address));
      const legacyMint = plant(harness, mintImage(harness.payer.address), TOKEN_PROGRAM);
      const slots = transferSlots(harness, { source, mint, dest });
      const cases: Array<[string, string, Record<string, ReturnType<typeof readonly>>]> = [
        // A callee that is no token program: refused before the call it would have made.
        [
          "not the token program",
          moveEntry(mint, MOVED),
          { ...slots, tokenProgram: readonly(randomAddress()) },
        ],
        // Token-2022's accounts handed to legacy SPL Token: never moved across programs.
        [
          "not a token account",
          moveEntry(mint, MOVED),
          { ...slots, tokenProgram: readonly(TOKEN_PROGRAM) },
        ],
        // A mint the callee does not own.
        ["not a mint", moveEntry(legacyMint, MOVED), { ...slots, mint: readonly(legacyMint) }],
        // The program names one asset and the caller attaches another.
        ["wrong mint", moveEntry(randomAddress(), MOVED), slots],
        ["amount over u64", moveEntry(mint, 0x1_0000_0000_0000_0000n), slots],
      ];

      for (const [reason, entry, attached] of cases) {
        expect(await reasonOf(harness, entry, attached)).toBe(reason);
      }
      expect(tokenAmount(harness, source)).toBe(MINTED);
    });

    it("refuses decimals that are not the mint's, including one past a byte", async () => {
      const { mint, source, dest } = await withAccounts(mintImage(harness.payer.address));
      const slots = transferSlots(harness, { source, mint, dest });

      // The instruction carries the decimals in one byte: 6 + 256 would reach the token program as 6.
      for (const decimals of [DECIMALS + 1, DECIMALS + 256]) {
        expect(await reasonOf(harness, transferEntry(mint, MOVED, decimals), slots)).toBe(
          "wrong decimals",
        );
      }
      expect(tokenAmount(harness, source)).toBe(MINTED);
    });
  });

  describe("extensions", () => {
    it.each(Object.keys(STOCK_MINTS))(
      "%s, a real stock mint: the Pot reads and moves it, every extension as mainnet has it",
      async (symbol) => {
        const fixture = STOCK_MINTS[symbol]!;
        const image = realImage(fixture, harness.payer.address);
        // ScaledUiAmount, Pausable (not paused), DefaultAccountState (initialized), a TransferHook
        // with no program, ConfidentialTransferMint, MetadataPointer and TokenMetadata.
        const types = entriesOf(image).map(([type]) => type);
        expect(types).toEqual(expect.arrayContaining([4, 6, 14, 18, 19, 25, 26]));
        expect(parseMintExtensions(image).transferHook).toBeUndefined();
        const mint = plant(harness, image);
        const pot = await tokenAccount(harness, mint, harness.pot, MINTED);
        const dest = await tokenAccount(harness, mint, randomAddress());
        const mintKey = literal(mint);

        // The Pot's own account, checked to be the Pot's, then spent with the Pot as authority.
        const returned = await run(
          harness,
          `import { balanceOf, ownerOf, transferChecked } from "@sauce/token"; function main(tokenProgram: Account, pot: Account<Signer>, source: Account<Writable>, mint: Account, dest: Account<Writable>): Uint256 { require(ownerOf(${mintKey}, source) == pot.address, "not the Pot's"); transferChecked(${mintKey}, tokenProgram, source, mint, dest, pot, ${MOVED}n, ${fixture.decimals}n); return balanceOf(${mintKey}, source); }`,
          {
            tokenProgram: readonly(TOKEN_2022_PROGRAM),
            pot: readonly(harness.pot),
            source: writable(pot),
            mint: readonly(mint),
            dest: writable(dest),
          },
        );

        expect(toBigInt(returned)).toBe(MINTED - MOVED);
        expect(tokenAmount(harness, dest)).toBe(MOVED);
      },
    );

    it("ScaledUiAmount: the program sees and moves raw base units, whatever the multiplier", async () => {
      const image = realImage(STOCK_MINTS.TSLAx!, harness.payer.address);
      const config = new DataView(image.buffer, valueOf(image, 25));
      config.setFloat64(32, 2.5, true);
      config.setFloat64(48, 2.5, true);
      const mint = plant(harness, image);
      const source = await tokenAccount(harness, mint, harness.payer.address, MINTED);
      const dest = await tokenAccount(harness, mint, randomAddress());

      expect(
        toBigInt(await run(harness, readEntry("balanceOf", mint), { account: readonly(source) })),
      ).toBe(MINTED);
      const received = await run(
        harness,
        transferEntry(mint, MOVED, STOCK_MINTS.TSLAx!.decimals),
        transferSlots(harness, { source, mint, dest }),
      );

      expect(toBigInt(received)).toBe(MOVED);
    });

    it("TransferFee: the destination receives the amount less the fee, which the SDK nets exactly", async () => {
      const { mint, source, dest } = await withAccounts(
        mintImage(harness.payer.address, [transferFee(150, 9_000n)]),
      );
      // The SDK's own resolution of the mint, read from the bank as an RPC would answer.
      const token = await resolveSvmToken(bankLoader(harness), mint);
      expect(token).toMatchObject({ tokenProgram: TOKEN_2022_PROGRAM, decimals: DECIMALS });
      expect(await svmTokenAccount(token, harness.payer.address)).toBe(source);
      // The harness runs at epoch 0, where both schedules start. MOVED meets the fee's maximum.
      const fee = MOVED - svmTokenReceived(token, MOVED, 0n);
      expect(fee).toBe(9_000n);

      const received = await run(
        harness,
        transferEntry(mint, MOVED),
        transferSlots(harness, { source, mint, dest }),
      );

      // The program's own measure, the account, and the SDK's arithmetic agree.
      expect(toBigInt(received)).toBe(MOVED - fee);
      expect(tokenAmount(harness, dest)).toBe(MOVED - fee);
      expect(tokenAmount(harness, source)).toBe(MINTED - MOVED);

      // Below the maximum the fee is a share, rounded up: sending what the SDK says to send delivers
      // exactly the amount asked for.
      const wanted = 100_000n;
      const send = svmTokenToSend(token, wanted, 0n);
      expect(send).toBeGreaterThan(wanted);
      expect(
        toBigInt(
          await run(
            harness,
            transferEntry(mint, send),
            transferSlots(harness, { source, mint, dest }),
          ),
        ),
      ).toBe(wanted);
    });

    it("PYUSD, by its registered symbol: a fee config at zero, a hook with no program", async () => {
      const row = SVM_TOKEN_REGISTRY["mainnet-beta"].find((token) => token.symbol === "PYUSD")!;
      expect(row.tokenProgram).toBe(TOKEN_2022_PROGRAM);
      const mint = plant(
        harness,
        realImage(PYUSD, harness.payer.address),
        TOKEN_2022_PROGRAM,
        row.mint as Address,
      );
      const source = await tokenAccount(harness, mint, harness.payer.address, MINTED);
      const dest = await tokenAccount(harness, mint, randomAddress());

      // Compiled for the `solana` chain, as `sauce compile --chain solana` does: `PYUSD` is the
      // mint's key, and the library is there with no import.
      const program = compileSauceProgram(
        "solana",
        "function main(tokenProgram: Account, source: Account<Writable>, mint: Account, dest: Account<Writable>, authority: Account<Signer>) {\n" +
          `  transferChecked(PYUSD, tokenProgram, source, mint, dest, authority, ${MOVED}n, ${row.decimals}n);\n` +
          "}",
      );
      await run(harness, program, transferSlots(harness, { source, mint, dest }));

      expect(tokenAmount(harness, dest)).toBe(MOVED);
    });

    it("Pausable: a paused mint refuses the transfer, with the token program's own error", async () => {
      const image = realImage(STOCK_MINTS.TSLAon!, harness.payer.address);
      const mint = plant(harness, image);
      const source = await tokenAccount(harness, mint, harness.payer.address, MINTED);
      const dest = await tokenAccount(harness, mint, randomAddress());
      // Paused after the mint: pausing stops minting too.
      const paused = dataOf(harness, mint);
      paused[valueOf(paused, 26) + 32] = 1;
      plant(harness, paused, TOKEN_2022_PROGRAM, mint);

      const { logs } = await failure(
        harness,
        transferEntry(mint, MOVED, STOCK_MINTS.TSLAon!.decimals),
        transferSlots(harness, { source, mint, dest }),
      );

      expect(logs).toContain(
        "Program log: Transferring, minting, and burning is paused on this mint",
      );
      expect(logs).toContain(`Program ${TOKEN_2022_PROGRAM} failed: custom program error: 0x43`);
      expect(tokenAmount(harness, source)).toBe(MINTED);
    });

    it("DefaultAccountState frozen: a new account starts frozen and cannot receive", async () => {
      const { mint, source, dest } = await withAccounts(
        mintImage(harness.payer.address, [defaultAccountState(1)]),
      );
      // Frozen accounts from here on: the next account the ATA program makes starts frozen.
      const image = dataOf(harness, mint);
      image[valueOf(image, 6)] = 2;
      plant(harness, image, TOKEN_2022_PROGRAM, mint);
      const frozen = await tokenAccount(harness, mint, randomAddress());
      expect(dataOf(harness, frozen)[108]).toBe(2);

      const { logs } = await failure(
        harness,
        transferEntry(mint, MOVED),
        transferSlots(harness, { source, mint, dest: frozen }),
      );

      expect(logs).toContain("Program log: Error: Account is frozen");
      expect(tokenAmount(harness, source)).toBe(MINTED);
      // An account made before the switch is not frozen, and still receives.
      await run(
        harness,
        transferEntry(mint, MOVED),
        transferSlots(harness, { source, mint, dest }),
      );
      expect(tokenAmount(harness, dest)).toBe(MOVED);
    });

    it("TransferHook: no program transfers; a program set is refused before the call", async () => {
      const unset = await withAccounts(mintImage(harness.payer.address, [transferHook()]));
      await run(harness, transferEntry(unset.mint, MOVED), transferSlots(harness, unset));
      expect(tokenAmount(harness, unset.dest)).toBe(MOVED);

      // The hook names a program after the accounts exist (each already has its TransferHookAccount),
      // as an issuer setting one later would.
      const set = await withAccounts(mintImage(harness.payer.address, [transferHook()]));
      const image = dataOf(harness, set.mint);
      image.set(key(randomAddress()), valueOf(image, 14) + 32);
      plant(harness, image, TOKEN_2022_PROGRAM, set.mint);

      expect(
        await reasonOf(harness, transferEntry(set.mint, MOVED), transferSlots(harness, set)),
      ).toBe("transfer hook");
      expect(tokenAmount(harness, set.source)).toBe(MINTED);
    });
  });
});
