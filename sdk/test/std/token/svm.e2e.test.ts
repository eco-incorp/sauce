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
import type { Address, Instruction } from "@solana/kit";
import {
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildHeapFramePrepend,
} from "../../../src/svm/index.js";
import type { ResolvedAccountMeta } from "../../../src/svm/index.js";
import { compileStdToken } from "./harness.js";
import type { AccountManifest } from "./harness.js";
import {
  TOKEN_PROGRAM,
  expectOk,
  randomAddress,
  sendInstructions,
  setTokenAccount,
  startEngine,
  tokenAccountData,
  tokenAmount,
  toBigInt,
  HARNESS_POT_SALT,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";

/** Multi-byte so a wrong decode cannot pass by coincidence, and `u64` because an SPL amount is one. */
const TOKEN_BALANCE = 0x0000_00ab_cdef_1234n;
const TOTAL_SUPPLY = 0x0000_00ff_ee00_1111n;
const DECIMALS = 6n;
const DELEGATED = 0x0000_0000_dead_beefn;
const TRANSFERRED = 0x1234n;

/** Generous, so nothing here ever starves on compute rather than on the behavior under test. */
const COMPUTE_UNITS = 1_400_000;

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

/** A pubkey as the SauceScript big-endian bigint literal the library compares `svm.sload(…).toBe()` against. */
const literal = (address: Address): string =>
  `0x${Buffer.from(codec.encode(address)).toString("hex")}n`;

const missing = (what: string): never => {
  throw new Error(`the SVM manifest ${what}`);
};

/**
 * The attach contract, applied: every manifest slot resolves by NAME from `slots`, in manifest order.
 * This is what an SDK consumer of the Rust compiler does with the manifest, so a wrong order or an
 * unresolved slot fails the transaction rather than a matcher.
 *
 * There is no separate program entry to special-case any more: a CPI callee is an account the caller
 * attaches, so it reaches the manifest as an ordinary named slot and is resolved like the rest — which
 * is why these tests now pass the SPL Token program in `slots` under the name the library declares it
 * with. `remaining` marks where a caller's own variable-length accounts begin; no fixture here uses
 * one, so it is an explicit failure rather than a silently dropped entry.
 */
const attach = (
  manifest: AccountManifest | undefined,
  slots: Record<string, ResolvedAccountMeta>,
): ResolvedAccountMeta[] =>
  (manifest ?? missing("is absent — the svm target must emit one")).accounts.map((entry) =>
    entry.kind === "remaining"
      ? missing(
          `asks for a remaining-accounts tail at ${entry.from}, which this suite does not attach`,
        )
      : (slots[entry.name] ?? missing(`names a slot the test did not resolve: ${entry.name}`)),
  );

/** Compile `entry` for the SVM and assemble the transaction that runs it with its manifest-derived accounts. */
const instructionsFor = (
  harness: EngineHarness,
  entry: string,
  slots: Record<string, ResolvedAccountMeta>,
): Instruction[] => {
  const { bytecode, manifest } = compileStdToken(entry, "svm");

  return [
    ...buildComputeBudgetPrepend({ unitLimit: COMPUTE_UNITS }),
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
      tail: attach(manifest, slots),
    }),
  ];
};

/** Run `entry` and return the engine's output, failing the test if the transaction did not succeed. */
const run = (
  harness: EngineHarness,
  entry: string,
  slots: Record<string, ResolvedAccountMeta>,
): Promise<Uint8Array> =>
  sendInstructions(harness, instructionsFor(harness, entry, slots)).then(
    (result) => expectOk(result).returnData,
  );

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

    const { ok } = await sendInstructions(harness, instructionsFor(harness, entry, slots));

    expect(ok).toBe(false);
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
    "%s rejects token accounts and uninitialized mints",
    async (method) => {
      const tokenAccount = setTokenAccount(
        harness,
        randomAddress(),
        randomAddress(),
        harness.payer.address,
        TOKEN_BALANCE,
      );
      const uninitializedMint = randomAddress();
      const data = new Uint8Array(82);
      new DataView(data.buffer).setBigUint64(36, TOTAL_SUPPLY, true);
      data[44] = Number(DECIMALS);
      harness.svm.setAccount({
        address: uninitializedMint,
        data,
        executable: false,
        lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
        programAddress: TOKEN_PROGRAM,
        space: BigInt(data.length),
      });
      const entry = `import { ${method} } from "@sauce/token"; function main(token: Account): Uint256 { return ${method}(token); }`;
      for (const address of [tokenAccount, uninitializedMint]) {
        const slots = { token: { address, role: AccountRole.READONLY } };
        const { ok } = await sendInstructions(harness, instructionsFor(harness, entry, slots));
        expect(ok).toBe(false);
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
});
