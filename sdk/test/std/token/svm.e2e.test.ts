/**
 * `@sauce/token` EXECUTION on the real SVM engine (LiteSVM), compiled by the published
 * `@eco-incorp/sauce-compiler`.
 *
 * A library that compiles proves nothing about what it reads: every case here plants a REAL SPL
 * image — a 165-byte `spl_token::state::Account` (mint@0, owner@32, amount@64 LE, delegate COption
 * @72/@76, state@108 Initialized, delegated_amount@121) or an 82-byte `Mint` (supply@36, decimals@44)
 * — owned by the REAL SPL Token program, and asserts the value the library reads back. `transfer`
 * goes further and CPIs into the genuine SPL Token processor, so the assertion is that the source
 * account's `amount` actually moved.
 *
 * The accounts are attached from the compiler's own SVM MANIFEST rather than a hand-written list, so
 * the attach contract the SDK would follow in production is the one under test: every entry is a slot
 * resolved by name, in manifest order. A CPI callee is no exception — it is an account the caller
 * passes, so the SPL Token program arrives as a named slot like any other.
 *
 * GATED on SAUCE_RUST_ENGINE_SO, which is now a CONVENIENCE: there is one engine, and the gate only
 * says whether its binary has been fetched. It skips locally without it and hard-fails in CI.
 *
 * It used to be a real finding, and the history is worth keeping because it explains the shape of
 * everything around it. A vendored `artifacts/svm/engine.so` was the repo-wide default: the
 * `release/beta` lineage, while the published compiler emits for `main`. Their wire formats had
 * diverged — `JUMP`/`JUMP_I` (0xB0/0xB1) existed only on main, and `NEW_ARRAY` (0x92) encoded its
 * scalar elements inline there and off the stack on the pin — so every `@sauce/token` method, each
 * carrying a `require` or an `if`, was rejected with `InvalidInstructionData` before executing, while
 * a control-flow-free program (`return 42n`, a bare `svm.sload`) ran on both. That is why this suite
 * needed its own variable, and why the header used to say repinning was the real fix and out of
 * scope.
 *
 * That repin happened. The vendored binary and the pre-release staging surface only it could run are
 * deleted, `svm-settle.e2e` moved to this same engine, and `staged.e2e` went with the surface it
 * tested — so the divergence no longer runs both ways and there is no second lineage to protect.
 * `engine-harness.ts` states the current rule: one engine, from the pinned release, with
 * SAUCE_ENGINE_SO demoted to an override for an unreleased build.
 *
 * CI fetches it with `sync-engine-artifacts --fetch-v12-engines`, digest-verified against the pin.
 * Locally, do the same, or build one —
 *   cd <v12>/v12-svm && make build
 *   SAUCE_RUST_ENGINE_SO=<v12>/v12-svm/target/deploy/engine.so pnpm --filter './sdk' test
 */
import { AccountRole, getAddressCodec, lamports } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  randomAddress,
  setTokenAccount,
  startEngine,
  tokenAccountData,
  tokenAmount,
  toBigInt,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import { literal, reasonOf, run } from "./svm-cook.js";

/** Multi-byte so a wrong decode cannot pass by coincidence, and `u64` because an SPL amount is one. */
const TOKEN_BALANCE = 0x0000_00ab_cdef_1234n;
const TOTAL_SUPPLY = 0x0000_00ff_ee00_1111n;
const DECIMALS = 6n;
const DELEGATED = 0x0000_0000_dead_beefn;
const TRANSFERRED = 0x1234n;

/** The `main`-lineage engine these programs target — see the header for why the vendored one won't do. */
const RUST_ENGINE_SO = process.env.SAUCE_RUST_ENGINE_SO;

const describeStdToken = RUST_ENGINE_SO ? describe : describe.skip;

// The gate above is a local-developer convenience, never a CI outcome: a skipped suite and a passing
// one are the same line in jest's summary, which is how these two went unrun for their whole life.
// CI supplies the engine (see .github/workflows/ci.yml) — so in CI, an absent one is a failure.
if (!RUST_ENGINE_SO && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_ENGINE_SO is unset in CI. This suite must never skip here — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const codec = getAddressCodec();

/**
 * A real 82-byte SPL `Mint`: `mint_authority` COption::None @0, `supply` u64 LE @36, `decimals` @44,
 * `is_initialized` @45, `freeze_authority` COption::None @46 — the layout `totalSupply`/`decimals`
 * read by byte range. (The harness's own `setMint` leaves `supply` at zero, which cannot distinguish
 * a correct read from a read of nothing.)
 */
const setSplMint = (
  harness: EngineHarness,
  address: Address,
  supply: bigint,
  decimals: bigint,
): Address => {
  const data = new Uint8Array(82);
  const view = new DataView(data.buffer);
  view.setBigUint64(36, supply, true);
  data[44] = Number(decimals);
  data[45] = 1; // is_initialized

  harness.svm.setAccount({
    address,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: TOKEN_PROGRAM,
    space: BigInt(data.length),
  });

  return address;
};

/** A token account carrying an ACTIVE delegate: COption tag `Some` @72, delegate @76, amount @121. */
const setDelegatedTokenAccount = (
  harness: EngineHarness,
  address: Address,
  mint: Address,
  owner: Address,
  delegate: Address,
  delegatedAmount: bigint,
): Address => {
  const data = tokenAccountData(mint, owner, TOKEN_BALANCE);
  const view = new DataView(data.buffer);
  view.setUint32(72, 1, true); // COption::Some
  data.set(new Uint8Array(codec.encode(delegate)), 76);
  view.setBigUint64(121, delegatedAmount, true);

  harness.svm.setAccount({
    address,
    data,
    executable: false,
    lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: TOKEN_PROGRAM,
    space: BigInt(data.length),
  });

  return address;
};

describeStdToken("@sauce/token e2e: the SVM arm against real SPL accounts", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, RUST_ENGINE_SO);
  });

  it("balanceOf reads the amount off a real SPL token account", async () => {
    const mint = randomAddress();
    const account = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
    );

    const entry = `import { balanceOf } from "@sauce/token"; function main(account: Account): Uint256 { return balanceOf(${literal(mint)}, account); }`;
    const returnData = await run(harness, entry, {
      account: { address: account, role: AccountRole.READONLY },
    });

    // The library types `balanceOf` `Uint256`, so compare the FULL word — a low-8-byte decode would
    // hide an upper-192-bit divergence.
    expect(toBigInt(returnData)).toBe(TOKEN_BALANCE);
  });

  it("balanceOf reverts when the attached account is of another mint", async () => {
    // The `require(svm.sload(account, 0n, 32n).toBe() == token)` guard: a caller cannot pass an
    // account of the wrong mint and have it read as the named asset.
    const account = setTokenAccount(
      harness,
      randomAddress(),
      randomAddress(),
      harness.payer.address,
      TOKEN_BALANCE,
    );

    const entry = `import { balanceOf } from "@sauce/token"; function main(account: Account): Uint256 { return balanceOf(${literal(randomAddress())}, account); }`;
    const slots = { account: { address: account, role: AccountRole.READONLY } };

    expect(await reasonOf(harness, entry, slots)).toBe("wrong mint");
  });

  it("balanceOf refuses an account no token program owns", async () => {
    // The genuine 165-byte layout, of the right mint, written into an account another program owns.
    // (A Token-2022 account is read, as `svm-token-2022.e2e.test.ts` shows.)
    const mint = randomAddress();
    const account = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
      randomAddress(),
    );
    const entry = `import { balanceOf } from "@sauce/token"; function main(account: Account): Uint256 { return balanceOf(${literal(mint)}, account); }`;

    expect(
      await reasonOf(harness, entry, {
        account: { address: account, role: AccountRole.READONLY },
      }),
    ).toBe("not a token account");
  });

  it("totalSupply and decimals read a real SPL mint", async () => {
    const mint = setSplMint(harness, randomAddress(), TOTAL_SUPPLY, DECIMALS);
    const slots = { token: { address: mint, role: AccountRole.READONLY } };

    const supply = await run(
      harness,
      'import { totalSupply } from "@sauce/token"; function main(token: Account): Uint256 { return totalSupply(token); }',
      slots,
    );
    const decimals = await run(
      harness,
      'import { decimals } from "@sauce/token"; function main(token: Account): Uint256 { return decimals(token); }',
      slots,
    );

    expect(toBigInt(supply)).toBe(TOTAL_SUPPLY);
    expect(toBigInt(decimals)).toBe(DECIMALS);
  });

  it.each(["totalSupply", "decimals"])(
    "%s rejects token accounts, mints SPL Token does not own, and uninitialized mints",
    async (method) => {
      const tokenAccount = setTokenAccount(
        harness,
        randomAddress(),
        randomAddress(),
        harness.payer.address,
        TOKEN_BALANCE,
      );
      const mintImage = (initialized: boolean) => {
        const data = new Uint8Array(82);
        new DataView(data.buffer).setBigUint64(36, TOTAL_SUPPLY, true);
        data[44] = Number(DECIMALS);
        data[45] = initialized ? 1 : 0;
        return data;
      };
      const planted = (data: Uint8Array, programAddress: Address): Address => {
        const address = randomAddress();
        harness.svm.setAccount({
          address,
          data,
          executable: false,
          lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
          programAddress,
          space: BigInt(data.length),
        });
        return address;
      };
      const entry = `import { ${method} } from "@sauce/token"; function main(token: Account): Uint256 { return ${method}(token); }`;
      const cases: Array<[Address, string]> = [
        // Owned by SPL Token, but 165 bytes: the size check.
        [tokenAccount, "not a mint"],
        // A genuine mint's bytes, written into an account another program owns: the owner check.
        [planted(mintImage(true), randomAddress()), "not a mint"],
        [planted(mintImage(false), TOKEN_PROGRAM), "uninitialized mint"],
      ];
      for (const [address, reason] of cases) {
        const slots = { token: { address, role: AccountRole.READONLY } };
        expect(await reasonOf(harness, entry, slots)).toBe(reason);
      }
    },
  );

  it("allowance returns the delegated amount only for the matching delegate", async () => {
    const mint = randomAddress();
    const delegate = randomAddress();
    const account = setDelegatedTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      delegate,
      DELEGATED,
    );
    const slots = { account: { address: account, role: AccountRole.READONLY } };

    const matching = await run(
      harness,
      `import { allowance } from "@sauce/token"; function main(account: Account): Uint256 { return allowance(${literal(mint)}, account, ${literal(delegate)}); }`,
      slots,
    );
    const other = await run(
      harness,
      `import { allowance } from "@sauce/token"; function main(account: Account): Uint256 { return allowance(${literal(mint)}, account, ${literal(randomAddress())}); }`,
      slots,
    );

    expect(toBigInt(matching)).toBe(DELEGATED);
    expect(toBigInt(other)).toBe(0n);
  });

  it("allowance refuses an account of another mint, or one no token program owns", async () => {
    const mint = randomAddress();
    const entry = `import { allowance } from "@sauce/token"; function main(account: Account): Uint256 { return allowance(${literal(mint)}, account, ${literal(randomAddress())}); }`;
    const otherMint = setTokenAccount(
      harness,
      randomAddress(),
      randomAddress(),
      harness.payer.address,
      TOKEN_BALANCE,
    );
    const forged = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
      randomAddress(),
    );

    for (const [address, reason] of [
      [otherMint, "wrong mint"],
      [forged, "not a token account"],
    ] as const) {
      const slots = { account: { address, role: AccountRole.READONLY } };
      expect(await reasonOf(harness, entry, slots)).toBe(reason);
    }
  });

  it("transfer moves the balance through a real SPL Token CPI", async () => {
    const mint = randomAddress();
    const source = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
    );
    const dest = setTokenAccount(harness, randomAddress(), mint, harness.payer.address, 0n);

    // The authority is the payer, which already signs the transaction. `tokenProgram` is the CPI
    // callee: a declared account now, so the entry takes it and this test attaches the real SPL Token
    // program at that slot — the library `require`s it is exactly that program before it calls.
    const entry = `import { transfer } from "@sauce/token"; function main(tokenProgram: Account, source: Account, dest: Account, authority: Account): void { transfer(${literal(mint)}, tokenProgram, source, dest, authority, ${TRANSFERRED}n); }`;
    await run(harness, entry, {
      tokenProgram: { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      source: { address: source, role: AccountRole.WRITABLE },
      dest: { address: dest, role: AccountRole.WRITABLE },
      authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
    });

    expect(tokenAmount(harness, source)).toBe(TOKEN_BALANCE - TRANSFERRED);
    expect(tokenAmount(harness, dest)).toBe(TRANSFERRED);
  });

  it("ownerOf reads owner@32 off a real SPL token account", async () => {
    const mint = randomAddress();
    const owner = randomAddress();
    const account = setTokenAccount(harness, randomAddress(), mint, owner, TOKEN_BALANCE);

    const returnData = await run(
      harness,
      `import { ownerOf } from "@sauce/token"; function main(account: Account): Address { return ownerOf(${literal(mint)}, account); }`,
      { account: { address: account, role: AccountRole.READONLY } },
    );

    // The full word: the owner is a 32-byte key, and its bytes come back big-endian, as written.
    expect(toBigInt(returnData)).toBe(BigInt(literal(owner).slice(0, -1)));
  });

  it("ownerOf refuses an account of another mint, or one no token program owns", async () => {
    const mint = randomAddress();
    const entry = `import { ownerOf } from "@sauce/token"; function main(account: Account): Address { return ownerOf(${literal(mint)}, account); }`;
    const otherMint = setTokenAccount(
      harness,
      randomAddress(),
      randomAddress(),
      harness.payer.address,
      TOKEN_BALANCE,
    );
    // The genuine layout, of the right mint, written into an account another program owns.
    const forged = randomAddress();
    const data = tokenAccountData(mint, harness.payer.address, TOKEN_BALANCE);
    harness.svm.setAccount({
      address: forged,
      data,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: randomAddress(),
      space: BigInt(data.length),
    });

    for (const [address, reason] of [
      [otherMint, "wrong mint"],
      [forged, "not a token account"],
    ] as const) {
      const slots = { account: { address, role: AccountRole.READONLY } };
      expect(await reasonOf(harness, entry, slots)).toBe(reason);
    }
  });

  it("a delegate's transfer spends someone else's balance, and ownerOf tells the two apart", async () => {
    // The gap ownerOf closes: SPL accepts the delegate as the transfer's authority, so a transfer
    // that succeeds with `authority` attached says nothing about whose `source` is.
    const mint = randomAddress();
    const holder = randomAddress();
    const delegated = setDelegatedTokenAccount(
      harness,
      randomAddress(),
      mint,
      holder,
      harness.payer.address,
      DELEGATED,
    );
    const own = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
    );
    const dest = setTokenAccount(harness, randomAddress(), mint, harness.payer.address, 0n);
    const slots = (source: Address) => ({
      tokenProgram: { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      source: { address: source, role: AccountRole.WRITABLE },
      dest: { address: dest, role: AccountRole.WRITABLE },
      authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
    });
    const params = "tokenProgram: Account, source: Account, dest: Account, authority: Account";
    const move = `transfer(${literal(mint)}, tokenProgram, source, dest, authority, ${TRANSFERRED}n);`;
    const unchecked = `import { transfer } from "@sauce/token"; function main(${params}): void { ${move} }`;
    const checked = `import { ownerOf, transfer } from "@sauce/token"; function main(${params}): void { require(ownerOf(${literal(mint)}, source) == authority, "source is not the authority's"); ${move} }`;

    await run(harness, unchecked, slots(delegated));
    expect(tokenAmount(harness, delegated)).toBe(TOKEN_BALANCE - TRANSFERRED);

    expect(await reasonOf(harness, checked, slots(delegated))).toBe(
      "source is not the authority's",
    );
    expect(tokenAmount(harness, delegated)).toBe(TOKEN_BALANCE - TRANSFERRED);

    await run(harness, checked, slots(own));
    expect(tokenAmount(harness, own)).toBe(TOKEN_BALANCE - TRANSFERRED);
  });

  it("approve sets a delegate the library then reads back through allowance", async () => {
    const mint = randomAddress();
    const delegate = randomAddress();
    const source = setTokenAccount(
      harness,
      randomAddress(),
      mint,
      harness.payer.address,
      TOKEN_BALANCE,
    );
    // The delegate account must exist for the SPL `Approve` processor to accept it as an account.
    setTokenAccount(harness, delegate, mint, harness.payer.address, 0n);

    const approve = `import { approve } from "@sauce/token"; function main(tokenProgram: Account, source: Account, delegate: Account, authority: Account): void { approve(${literal(mint)}, tokenProgram, source, delegate, authority, ${DELEGATED}n); }`;
    await run(harness, approve, {
      tokenProgram: { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      source: { address: source, role: AccountRole.WRITABLE },
      delegate: { address: delegate, role: AccountRole.READONLY },
      authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
    });

    // Read it back with the library's own `allowance`: the write and the read agree on the SPL
    // delegate layout, which a one-sided test could not show.
    const returnData = await run(
      harness,
      `import { allowance } from "@sauce/token"; function main(account: Account): Uint256 { return allowance(${literal(mint)}, account, ${literal(delegate)}); }`,
      { account: { address: source, role: AccountRole.READONLY } },
    );

    expect(toBigInt(returnData)).toBe(DELEGATED);
  });

  // Every write checks its callee, its source's owner and mint, and the amount, before it calls,
  // and each refusal is named; the source's balance is untouched by any of them.
  describe.each(["transfer", "transferFrom", "approve"])("%s refuses, naming", (method) => {
    const second = method === "approve" ? "delegate" : "dest";
    const write = (mint: Address, amount: bigint) =>
      `import { ${method} } from "@sauce/token"; function main(tokenProgram: Account, source: Account, ${second}: Account, authority: Account): void { ${method}(${literal(mint)}, tokenProgram, source, ${second}, authority, ${amount}n); }`;
    const refusal = async (
      reason: string,
      overrides: {
        tokenProgram?: Address;
        mint?: Address;
        amount?: bigint;
        sourceProgram?: Address;
      },
    ) => {
      const mint = randomAddress();
      const source = setTokenAccount(
        harness,
        randomAddress(),
        mint,
        harness.payer.address,
        TOKEN_BALANCE,
        overrides.sourceProgram,
      );
      const other = setTokenAccount(harness, randomAddress(), mint, harness.payer.address, 0n);
      const entry = write(overrides.mint ?? mint, overrides.amount ?? TRANSFERRED);

      expect(
        await reasonOf(harness, entry, {
          tokenProgram: {
            address: overrides.tokenProgram ?? TOKEN_PROGRAM,
            role: AccountRole.READONLY,
          },
          source: { address: source, role: AccountRole.WRITABLE },
          [second]: { address: other, role: AccountRole.WRITABLE },
          authority: { address: harness.payer.address, role: AccountRole.READONLY_SIGNER },
        }),
      ).toBe(reason);
      expect(tokenAmount(harness, source)).toBe(TOKEN_BALANCE);
    };

    it("a callee that is not the SPL Token program", () =>
      refusal("not the token program", { tokenProgram: TOKEN_2022_PROGRAM }));
    it("a source SPL Token does not own", () =>
      refusal("not a token account", { sourceProgram: TOKEN_2022_PROGRAM }));
    it("a source of another mint", () => refusal("wrong mint", { mint: randomAddress() }));
    it("an amount no SPL account can hold", () =>
      refusal("amount over u64", { amount: 0x1_0000_0000_0000_0000n }));
  });
});
