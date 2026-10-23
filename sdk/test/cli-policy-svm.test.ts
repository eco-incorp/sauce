/**
 * Solana policy measurement: unreadable lookup tables fail closed, and real released Kitchen cooks
 * in LiteSVM measure the Pot they actually name, including a valid noncanonical bump. Both inline
 * and staged cooks move SOL and SPL tokens, with and without lookup-table-loaded Pot accounts;
 * those outflows must trigger limits without reserving anything.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  createSolanaRpc,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  pipe,
  lamports,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import { guardWallet, measureSvm, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import type { WalletInfo } from "../src/cli/wallets.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import {
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  derivePotPda,
} from "../src/svm/index.js";
import { memoizedCreateProgramAddress } from "../src/svm/venues/pda-memo.js";
import {
  describeSvm,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  setMint,
  setTokenAccount,
  stageProgram,
  startEngine,
  TOKEN_PROGRAM,
  type EngineHarness,
  type StagedProgram,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const WALLET = address("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");
const TABLE = address("8Vaso6eE1pWktDHwy2qQBB1fhjmBgwzhoXQKe1sxtFjn");
const LOADED = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const UNREAD = "a lookup table it loads accounts from could not be read";

/** A v0 transaction from the wallet naming LOADED, which it takes through TABLE. */
const throughTable = () =>
  compileTransaction(
    compressTransactionMessageUsingAddressLookupTables(
      pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayer(WALLET, message),
        (message) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: "11111111111111111111111111111111" as Blockhash,
              lastValidBlockHeight: 1n,
            },
            message,
          ),
        (message) =>
          appendTransactionMessageInstruction(
            {
              programAddress: address("11111111111111111111111111111111"),
              accounts: [{ address: LOADED, role: AccountRole.READONLY }],
              data: new Uint8Array([2, 0, 0, 0]),
            },
            message,
          ),
      ),
      { [TABLE]: [LOADED] },
    ),
  );

/** An endpoint whose every account read answers `read`, and that simulates nothing. */
const endpoint = (read: () => Promise<unknown>) =>
  ({
    getAccountInfo: () => ({ send: read }),
    getMultipleAccounts: () => ({ send: read }),
    simulateTransaction: () => ({
      send: () => Promise.reject(new Error("an unmeasured transaction is never simulated")),
    }),
  }) as unknown as Parameters<typeof measureSvm>[0];

const UNREADABLE: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ["the endpoint fails reading the table", () => Promise.reject(new Error("endpoint down"))],
  [
    "the table is not on the cluster",
    () => Promise.resolve({ context: { slot: 1n }, value: null }),
  ],
];

describe("measuring a Solana transaction that loads accounts through a lookup table", () => {
  it("loads the account through the table, so the table must be read to measure it", () => {
    const message = getCompiledTransactionMessageDecoder().decode(
      throughTable().messageBytes,
    ) as unknown as {
      staticAccounts: readonly string[];
      addressTableLookups: readonly { lookupTableAddress: string }[];
    };
    expect(message.addressTableLookups.map((lookup) => lookup.lookupTableAddress)).toEqual([TABLE]);
    expect(message.staticAccounts).not.toContain(LOADED);
  });

  it.each(UNREADABLE)("measures nothing, and says why, when %s", async (_, read) => {
    const measured = await measureSvm(
      endpoint(read),
      requireChain("solana"),
      WALLET,
      throughTable(),
    );
    expect(measured.unmeasured).toEqual({ native: UNREAD, tokens: UNREAD });
    expect(measured.tokens).toEqual([]);
    expect(measured.native.amount).toBe(0n);
  });
});

describeSvm("measuring the actual Pot a Kitchen cook signs for", () => {
  const RPC_URL = "http://127.0.0.1:65529/";
  const SYSTEM = address("11111111111111111111111111111111");
  let harness: EngineHarness;
  let shim: SolanaShim;
  let pot: Address;
  let bump: number;
  let mint: Address;
  let destination: Address;
  let source: Address;
  let tokenDestination: Address;
  let bytecode: Uint8Array;
  let staged: StagedProgram;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
    const canonical = await derivePotPda(harness.kitchen, harness.payer.address, HARNESS_POT_SALT);
    const seeds = [
      new TextEncoder().encode("pot"),
      getAddressEncoder().encode(harness.payer.address),
      HARNESS_POT_SALT,
    ];
    const alternate = Array.from({ length: canonical.bump }, (_, i) => canonical.bump - i - 1)
      .map((bump) => ({
        bump,
        ...memoizedCreateProgramAddress(harness.kitchen, [...seeds, Uint8Array.of(bump)]),
      }))
      .find(({ offCurve }) => offCurve);
    if (alternate === undefined) throw new Error("no noncanonical off-curve Pot bump");
    pot = alternate.address;
    bump = alternate.bump;
    expect(pot).not.toBe(canonical.address);

    // A PDA can hold SOL and authorize SPL transfers without being allocated as engine storage.
    // The cook checks its seeds and supplied bump, not whether create_pot minted it.
    harness.svm.airdrop(pot, lamports(1_000_000_000n));
    destination = randomAddress();
    harness.svm.airdrop(destination, lamports(1_000_000n));
    mint = setMint(harness, randomAddress(), 6);
    source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
    tokenDestination = setTokenAccount(harness, randomAddress(), mint, destination, 0n);
    bytecode = compileSauceProgram(
      "solana",
      "function main(system: Account, pot: Account<Writable, Signer>, destination: Account<Writable>, " +
        "tokenProgram: Account, source: Account<Writable>, tokenDestination: Account<Writable>) {\n" +
        "  let native = hex`02000000`;\n" +
        "  svm.call(system, [pot, destination], native.concat(123456789n.toBytesLe(8)));\n" +
        "  let token = hex`03`;\n" +
        "  svm.call(tokenProgram, [source, tokenDestination, pot], token.concat(400n.toBytesLe(8)));\n" +
        "}",
    ).bytecode;
    staged = await stageProgram(harness, bytecode, 208n);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  });
  afterAll(() => shim?.restore());

  it.each([
    ["inline", false],
    ["inline", true],
    ["staged", false],
    ["staged", true],
  ] as const)(
    "%s, lookup table %s: counts SOL and tokens leaving a noncanonical Pot",
    async (via, alt) => {
      const tail = [
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: pot, role: AccountRole.WRITABLE },
        { address: destination, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        { address: source, role: AccountRole.WRITABLE },
        { address: tokenDestination, role: AccountRole.WRITABLE },
      ];
      const input = {
        kitchen: harness.kitchen,
        owner: harness.payer.address,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot,
        feeConfig: harness.feeConfig,
        maxExecutionFee: 0n,
        tail,
      };
      const canonicalCook =
        via === "inline"
          ? buildCookInstruction({ ...input, bytecode })
          : buildCookFromAccountInstruction({ ...input, ...staged, pin: staged.sha256 });
      // A wallet may sign instructions not built by this SDK. Keep the released cook layout, but
      // supply the valid lower bump that selects the funded Pot instead of the canonical one.
      const data = Uint8Array.from(canonicalCook.data!);
      data[40] = bump;
      const cook: Instruction = { ...canonicalCook, data };
      const transaction = await buildExecuteTransaction({
        payer: harness.payer,
        instructions: [buildHeapFramePrepend(), cook],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
        ...(alt ? { lookupTables: fabricateAlt(harness, [pot, source, tokenDestination]) } : {}),
      });
      if (alt) {
        const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
        expect(message.staticAccounts).not.toContain(pot);
      }
      const rpc = createSolanaRpc(RPC_URL);
      const measured = await measureSvm(
        rpc,
        requireChain("solana"),
        harness.payer.address,
        transaction,
      );

      expect(measured.unmeasured).toEqual({});
      expect(measured.native.amount).toBe(123_461_789n); // Outflow plus the signature fee.
      expect(measured.tokens).toEqual([{ token: mint, amount: 400n, decimals: 6 }]);
      // Someone else's cook does not make that Pot this wallet's spending.
      const foreign = await measureSvm(rpc, requireChain("solana"), destination, transaction);
      expect(foreign.native.amount).toBe(0n);
      expect(foreign.tokens).toEqual([]);

      const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-pot-"));
      const wallet: WalletInfo = {
        name: "agent",
        kind: "solana",
        address: harness.payer.address,
        path: join(dir, "agent.json"),
        policyPath: join(dir, "agent.policy.json"),
      };
      try {
        for (const policy of [
          { native: { perTransaction: "123456788n" } },
          { tokens: { [mint]: { perTransaction: "399n" } } },
        ]) {
          writeFileSync(wallet.policyPath, JSON.stringify(policy), { mode: 0o600 });
          await expect(
            guardWallet(wallet, readPolicy(wallet)).svm(rpc, transaction),
          ).rejects.toBeInstanceOf(PolicyRefusal);
        }
        expect(readdirSync(dir).filter((file) => file.endsWith(".ledger.jsonl"))).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("a wallet's policy, on a transaction it cannot measure", () => {
  let dir: string;
  let wallet: WalletInfo;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-"));
    wallet = {
      name: "agent",
      kind: "solana",
      address: WALLET,
      path: join(dir, "agent.json"),
      policyPath: join(dir, "agent.policy.json"),
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const guarded = (fields: Record<string, unknown>) => {
    writeFileSync(wallet.policyPath, JSON.stringify(fields), { mode: 0o600 });

    return guardWallet(wallet, readPolicy(wallet));
  };

  it.each([
    ["native", { native: { perTransaction: "1" } }, `native is limited, and ${UNREAD}`],
    [
      "tokens.USDC",
      { tokens: { USDC: { perDay: "100" } } },
      `tokens.USDC is limited, and ${UNREAD}`,
    ],
  ])("refuses it where %s is limited, and reserves nothing", async (limit, policy, why) => {
    for (const [, read] of UNREADABLE) {
      const refusal = await guarded(policy)
        .svm(endpoint(read), throughTable())
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(refusal).toBeInstanceOf(PolicyRefusal);
      expect((refusal as PolicyRefusal).limit).toBe(limit);
      expect((refusal as PolicyRefusal).message).toContain(why);
      expect(readdirSync(dir).filter((file) => file.endsWith(".ledger.jsonl"))).toEqual([]);
    }
  });

  it("lets it through where nothing it cannot measure is limited", async () => {
    for (const [, read] of UNREADABLE) {
      await expect(
        guarded({ chains: ["solana"] }).svm(endpoint(read), throughTable()),
      ).resolves.toBeDefined();
    }
  });
});
