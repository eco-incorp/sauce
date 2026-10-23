/**
 * Solana policy measurement: unreadable lookup tables fail closed, and real released Kitchen cooks
 * in LiteSVM measure the Pot they actually name, including a valid noncanonical bump. Both inline
 * and staged cooks move SOL and SPL tokens, with and without lookup-table-loaded Pot accounts;
 * those outflows must trigger limits without reserving anything. What a token account of the
 * wallet's or a Pot's lets another key do — spend it as a delegate, own it, close it — is held as
 * an approval or a send, whether the wallet signs it or a cook does.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  createSolanaRpc,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  pipe,
  lamports,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountSignerMeta,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import { v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { guardWallet, measureSvm, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import type { WalletInfo } from "../src/cli/wallets.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  derivePotPda,
  KITCHEN_DISCRIMINATORS,
} from "../src/svm/index.js";
import { memoizedCreateProgramAddress } from "../src/svm/venues/pda-memo.js";
import {
  describeSvm,
  expectOk,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  sendSigned,
  setMint,
  setTokenAccount,
  stageProgram,
  startEngine,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  tokenAccountData,
  tokenAmount,
  transferCheckedData,
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

describe("measuring a Solana transaction whose programs' calls the endpoint does not show", () => {
  const PROGRAM = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  const KITCHEN = address(v12SvmKitchenProgramId());
  const NOT_REPORTED =
    "the endpoint did not report the programs its programs call, so a cook among them is not seen";
  const UNREADABLE_CALL =
    "one of its programs calls the Kitchen, and the endpoint's report of that call cannot be read";
  const UNNAMED = "the endpoint reported a program its programs call that cannot be named";
  /** A cook's instruction data as a node reports it: base58, the discriminator then a salt and bump. */
  const cookData = (head: Uint8Array) =>
    getBase58Decoder().decode(new Uint8Array([...head, ...new Uint8Array(33)]));
  /** The wallet calling PROGRAM with the Kitchen among its accounts (as a CPI to it needs), which
   *  the simulation says made `inner`, given each account's index in the message. */
  const calling = (inner: (at: (key: Address) => number) => unknown) => {
    const transaction = compileTransaction(
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
              programAddress: PROGRAM,
              accounts: [{ address: KITCHEN, role: AccountRole.READONLY }],
              data: new Uint8Array([1]),
            },
            message,
          ),
      ),
    );
    const { staticAccounts } = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    ) as unknown as { staticAccounts: readonly Address[] };
    const reported = inner((key) => staticAccounts.indexOf(key));
    const rpc = {
      getMultipleAccounts: (keys: readonly string[]) => ({
        send: () => Promise.resolve({ context: { slot: 1n }, value: keys.map(() => null) }),
      }),
      simulateTransaction: (_: string, config: { accounts: { addresses: readonly string[] } }) => ({
        send: () =>
          Promise.resolve({
            context: { slot: 1n },
            value: {
              err: null,
              logs: [],
              accounts: config.accounts.addresses.map(() => null),
              innerInstructions: reported,
            },
          }),
      }),
    } as unknown as Parameters<typeof measureSvm>[0];

    return { rpc, transaction };
  };

  it.each([
    ["the endpoint reports none", () => null, NOT_REPORTED],
    ["the endpoint leaves them out", () => undefined, NOT_REPORTED],
    [
      "a call to the Kitchen comes parsed, without its data",
      () => [
        { index: 0, instructions: [{ programId: KITCHEN, accounts: [WALLET], stackHeight: 2 }] },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a call to the Kitchen is reported with empty data",
      () => [{ index: 0, instructions: [{ programId: KITCHEN, accounts: [WALLET], data: "" }] }],
      UNREADABLE_CALL,
    ],
    [
      "a call to the Kitchen is reported with data shorter than a discriminator",
      () => [
        {
          index: 0,
          instructions: [
            {
              programId: KITCHEN,
              accounts: [WALLET],
              data: getBase58Decoder().decode(KITCHEN_DISCRIMINATORS.cook.subarray(0, 7)),
            },
          ],
        },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a cook from the Kitchen is reported with its accounts cut short before the Pot",
      () => [
        {
          index: 0,
          instructions: [
            { programId: KITCHEN, accounts: [WALLET], data: cookData(KITCHEN_DISCRIMINATORS.cook) },
          ],
        },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a staged cook from the Kitchen is reported with its accounts cut short before the Pot",
      () => [
        {
          index: 0,
          instructions: [
            {
              programId: KITCHEN,
              accounts: [WALLET, PROGRAM, PROGRAM, PROGRAM],
              data: cookData(KITCHEN_DISCRIMINATORS.cookFromAccount),
            },
          ],
        },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a cook from the Kitchen is reported with no accounts at all",
      () => [
        {
          index: 0,
          instructions: [
            { programId: KITCHEN, accounts: [], data: cookData(KITCHEN_DISCRIMINATORS.cook) },
          ],
        },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a call to the Kitchen names an account past the message's",
      (at: (key: Address) => number) => [
        { index: 0, instructions: [{ programIdIndex: at(KITCHEN), accounts: [0, 9], data: "1" }] },
      ],
      UNREADABLE_CALL,
    ],
    [
      "a call names its program by an index past the message's",
      () => [{ index: 0, instructions: [{ programIdIndex: 9, accounts: [], data: "1" }] }],
      UNNAMED,
    ],
  ])("measures nothing it can stand behind when %s", async (_, inner, why) => {
    const { rpc, transaction } = calling(inner);
    const measured = await measureSvm(rpc, requireChain("solana"), WALLET, transaction);
    expect(measured.unmeasured).toEqual({ native: why, tokens: why });

    const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-inner-"));
    const wallet: WalletInfo = {
      name: "agent",
      kind: "solana",
      address: WALLET,
      path: join(dir, "agent.json"),
      policyPath: join(dir, "agent.policy.json"),
    };
    try {
      writeFileSync(wallet.policyPath, JSON.stringify({ native: { perTransaction: "1" } }), {
        mode: 0o600,
      });
      const refusal = await guardWallet(wallet, readPolicy(wallet))
        .svm(rpc, transaction)
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(refusal).toBeInstanceOf(PolicyRefusal);
      expect((refusal as PolicyRefusal).message).toContain(`native is limited, and ${why}`);
      expect(readdirSync(dir).filter((file) => file.endsWith(".ledger.jsonl"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("measures as usual when every call it reports is read", async () => {
    // A System transfer as a mainnet node reports it (parsed: no accounts, no data), a call
    // PROGRAM makes to itself, and one to the Kitchen that is not a cook.
    const { rpc, transaction } = calling((at) => [
      {
        index: 0,
        instructions: [
          {
            parsed: {
              info: { destination: PROGRAM, lamports: 85672, source: WALLET },
              type: "transfer",
            },
            program: "system",
            programId: "11111111111111111111111111111111",
            stackHeight: 2,
          },
          { programIdIndex: at(PROGRAM), accounts: [0], data: "1", stackHeight: 2 },
          {
            programId: KITCHEN,
            accounts: [WALLET],
            data: getBase58Decoder().decode(KITCHEN_DISCRIMINATORS.createPot),
            stackHeight: 3,
          },
        ],
      },
    ]);
    const measured = await measureSvm(rpc, requireChain("solana"), WALLET, transaction);
    expect(measured.unmeasured).toEqual({});
    expect(measured.to).toEqual([PROGRAM]);
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

// A program the wallet calls at the top level that CPIs the Kitchen's cook with the wallet's own
// signature: the Kitchen allows a cook at any depth (it checks the owner's signature, not where the
// instruction sits), and a signer's privilege passes through a CPI. Source and build line beside it.
const FORWARDER_SO = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/cpi-forwarder/cpi_forwarder.so",
);

describeSvm("measuring a Kitchen cook another program makes for the wallet", () => {
  const RPC_URL = "http://127.0.0.1:65528/";
  const SYSTEM = address("11111111111111111111111111111111");
  let harness: EngineHarness;
  let shim: SolanaShim;
  let forwarder: Address;
  // A Pot under a salt of its own that create_pot never allocated: a System transfer needs a
  // `from` with no data, and the cook signs a Pot that need not exist.
  const salt = new Uint8Array(32).fill(12);
  let pot: Address;
  let mint: Address;
  let destination: Address;
  let source: Address;
  let tokenDestination: Address;
  let bytecode: Uint8Array;
  let staged: StagedProgram;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
    forwarder = randomAddress();
    harness.svm.addProgram(forwarder, new Uint8Array(readFileSync(FORWARDER_SO)));
    pot = (await derivePotPda(harness.kitchen, harness.payer.address, salt)).address;
    harness.svm.airdrop(pot, lamports(1_000_000_000n));
    destination = randomAddress();
    harness.svm.airdrop(destination, lamports(1_000_000n));
    mint = setMint(harness, randomAddress(), 6);
    source = setTokenAccount(harness, randomAddress(), mint, pot, 10_000n);
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
    staged = await stageProgram(harness, bytecode, 209n);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  });
  afterAll(() => shim?.restore());

  /** The wallet's cook on its Pot, as the forwarder's CPI: the Kitchen first, then its accounts. */
  const forwarded = (via: "inline" | "staged"): Instruction => {
    const input = {
      kitchen: harness.kitchen,
      owner: harness.payer.address,
      engineProgram: harness.programId,
      potSalt: salt,
      pot,
      feeConfig: harness.feeConfig,
      maxExecutionFee: 0n,
      tail: [
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: pot, role: AccountRole.WRITABLE },
        { address: destination, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        { address: source, role: AccountRole.WRITABLE },
        { address: tokenDestination, role: AccountRole.WRITABLE },
      ],
    };
    const cook =
      via === "inline"
        ? buildCookInstruction({ ...input, bytecode })
        : buildCookFromAccountInstruction({ ...input, ...staged, pin: staged.sha256 });

    return {
      programAddress: forwarder,
      accounts: [{ address: harness.kitchen, role: AccountRole.READONLY }, ...cook.accounts!],
      data: cook.data!,
    };
  };

  it.each([
    ["inline", false],
    ["inline", true],
    ["staged", false],
    ["staged", true],
  ] as const)(
    "%s, lookup table %s: counts what leaves the Pot a CPI cook signs for",
    async (via, alt) => {
      harness.svm.expireBlockhash();
      const transaction = await buildExecuteTransaction({
        payer: harness.payer,
        instructions: [buildHeapFramePrepend(), forwarded(via)],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
        ...(alt ? { lookupTables: fabricateAlt(harness, [pot, source, tokenDestination]) } : {}),
      });
      // The Kitchen is nowhere among the transaction's own instructions.
      const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
        staticAccounts: readonly Address[];
        instructions: readonly { programAddressIndex: number }[];
      };
      expect(
        message.instructions.map((each) => message.staticAccounts[each.programAddressIndex]),
      ).not.toContain(harness.kitchen);
      const rpc = createSolanaRpc(RPC_URL);
      const measured = await measureSvm(
        rpc,
        requireChain("solana"),
        harness.payer.address,
        transaction,
      );

      expect(measured.unmeasured).toEqual({});
      // As strings: a failing BigInt comparison cannot cross Jest's worker boundary, and this is the
      // assertion that shows the bypass when the Kitchen's CPI cook is not measured.
      expect(String(measured.native.amount)).toBe("123461789"); // Outflow plus the signature fee.
      expect(
        measured.tokens.map(({ amount, ...rest }) => ({ ...rest, amount: String(amount) })),
      ).toEqual([{ token: mint, amount: "400", decimals: 6 }]);

      const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-cpi-"));
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

      // And the cook does run: what the measurement counts is what moves.
      expect(sendSigned(harness, transaction).ok).toBe(true);
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

/**
 * What `wallet`'s guard does with `transaction` under `policy`, as one value a failure shows
 * whole: its refusal (the limit and the message), or that it let the transaction through, and the
 * ledger it leaves (a reservation, when it let it through).
 */
const verdictOf = async (
  rpc: Parameters<typeof measureSvm>[0],
  wallet: Address,
  policy: Record<string, unknown>,
  transaction: Transaction,
) => {
  const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-approval-"));
  const info: WalletInfo = {
    name: "agent",
    kind: "solana",
    address: wallet,
    path: join(dir, "agent.json"),
    policyPath: join(dir, "agent.policy.json"),
  };
  try {
    writeFileSync(info.policyPath, JSON.stringify(policy), { mode: 0o600 });
    const refusal = await guardWallet(info, readPolicy(info))
      .svm(rpc, transaction)
      .then(
        () => "none: the guard let it through",
        (error: unknown) =>
          error instanceof PolicyRefusal
            ? { limit: error.limit, message: error.message }
            : String(error),
      );
    const ledger = join(dir, "agent.ledger.jsonl");

    return {
      refusal,
      ledger: readdirSync(dir).includes("agent.ledger.jsonl") ? readFileSync(ledger, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** What {@link verdictOf} gives for a refusal by `limit` that says `why` and reserves nothing. */
const refused = (limit: string, why: string) => ({
  refusal: { limit, message: expect.stringContaining(why) as unknown },
  ledger: "",
});

describe("measuring token accounts from a simulation's account images", () => {
  const PROGRAM = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  const ACCOUNT = address("Vote111111111111111111111111111111111111111");
  const MINT_A = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const MINT_B = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  const SPL = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  type Image = { lamports: bigint; owner: Address; data: Uint8Array } | null;
  const asRpc = (image: Image) =>
    image === null
      ? null
      : {
          lamports: image.lamports,
          owner: image.owner,
          data: [Buffer.from(image.data).toString("base64"), "base64"],
          executable: false,
        };
  /** A token account image of `program`'s: `mint`, held by `holder`, holding `amount`. */
  const held = (program: Address, mint: Address, holder: Address, amount: bigint): Image => ({
    lamports: 2_039_280n,
    owner: program,
    data: tokenAccountData(mint, holder, amount),
  });
  /** A mint of `program`'s with `decimals`. */
  const minted = (program: Address, decimals: number): Image => {
    const data = new Uint8Array(82);
    data[44] = decimals;
    data[45] = 1;

    return { lamports: 1_461_600n, owner: program, data };
  };
  /**
   * The wallet calling PROGRAM with ACCOUNT writable, against an endpoint that holds `now` and
   * whose simulation leaves `after`.
   */
  const simulated = (now: Record<string, Image>, after: Record<string, Image>) => {
    const transaction = compileTransaction(
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
              programAddress: PROGRAM,
              accounts: [{ address: ACCOUNT, role: AccountRole.WRITABLE }],
              data: new Uint8Array([1]),
            },
            message,
          ),
      ),
    );
    const rpc = {
      getMultipleAccounts: (keys: readonly string[]) => ({
        send: () =>
          Promise.resolve({
            context: { slot: 1n },
            value: keys.map((key) => asRpc(now[key] ?? null)),
          }),
      }),
      simulateTransaction: (_: string, config: { accounts: { addresses: readonly string[] } }) => ({
        send: () =>
          Promise.resolve({
            context: { slot: 1n },
            value: {
              err: null,
              logs: [],
              innerInstructions: [],
              accounts: config.accounts.addresses.map((key) => asRpc(after[key] ?? null)),
            },
          }),
      }),
    } as unknown as Parameters<typeof measureSvm>[0];

    return { rpc, transaction };
  };
  const plain = <T extends { amount: bigint }>(list: readonly T[]) =>
    list.map(({ amount, ...rest }) => ({ ...rest, amount: String(amount) }));

  // (A mint belongs to one token program, so a limit, which names a mint, cannot see the same mint
  // under the other program: `movedBy` reports that as two changes, `cli-svm-effects.test.ts`.)
  it.each([
    ["another mint, held by the wallet", held(SPL, MINT_B, WALLET, 1_000_000n)],
    ["another mint, held by another key", held(SPL, MINT_B, PROGRAM, 1_000_000n)],
  ] as const)(
    "counts the whole balance of a token account the transaction replaces at its address with %s",
    async (_, replacement) => {
      // Closed and made again at the same address, holding as many base units of another mint.
      const { rpc, transaction } = simulated(
        {
          [ACCOUNT]: held(SPL, MINT_A, WALLET, 1_000_000n),
          [MINT_A]: minted(SPL, 3),
          [MINT_B]: minted(SPL, 3),
        },
        { [ACCOUNT]: replacement },
      );
      const measured = await measureSvm(rpc, requireChain("solana"), WALLET, transaction);

      expect({
        tokens: plain(measured.tokens).filter((each) => each.token === MINT_A),
        ...(await verdictOf(
          rpc,
          WALLET,
          { tokens: { [MINT_A]: { perTransaction: "1" } } },
          transaction,
        )),
      }).toEqual({
        tokens: [{ token: MINT_A, symbol: "USDC", amount: "1000000", decimals: 3 }],
        ...refused(`tokens.${MINT_A}.perTransaction`, "this transaction sends 1000 USDC"),
      });
    },
  );

  /** An account of PROGRAM's, a layout this command does not read, that names the wallet. */
  const vault = (lamports: bigint): Image => {
    const data = new Uint8Array(72);
    data.set(getAddressEncoder().encode(WALLET), 8);

    return { lamports, owner: PROGRAM, data };
  };
  const wallet = (lamports: bigint): Image => ({
    lamports,
    owner: address("11111111111111111111111111111111"),
    data: new Uint8Array(),
  });

  it.each([
    ["to another key", 1_000_000_000n, "1000000000"],
    ["to the wallet", 2_000_000_000n, "0"],
  ] as const)(
    "counts lamports leaving an account that names the wallet, under a layout it does not read, %s",
    async (_, walletAfter, sent) => {
      const { rpc, transaction } = simulated(
        { [WALLET]: wallet(1_000_000_000n), [ACCOUNT]: vault(1_002_000_000n) },
        { [WALLET]: wallet(walletAfter), [ACCOUNT]: vault(2_000_000n) },
      );
      const measured = await measureSvm(rpc, requireChain("solana"), WALLET, transaction);

      expect(String(measured.native.amount)).toBe(sent);
    },
  );
});

// What a token account lets another key do once a transaction lands: spend from it as its delegate,
// own it, or close it. Each gives away what the wallet (or a Pot it cooks on) holds, so a policy that
// limits the token holds each of them: an approval as an ERC-20 approval is held, an account handed
// to another key as a send of its whole balance, and wrapped SOL another key may close as a send of
// its lamports.
describeSvm(
  "a wallet's policy, on a Solana approval or a token account handed to another key",
  () => {
    const RPC_URL = "http://127.0.0.1:65527/";
    /** 1,000,000 base units at 3 decimals: 1,000 tokens, against a limit of 1. */
    const DECIMALS = 3;
    const AMOUNT = 1_000_000n;
    const NATIVE_MINT = address("So11111111111111111111111111111111111111112");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    const u32 = (value: number) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value, true);

      return bytes;
    };
    const PROGRAMS = { spl: TOKEN_PROGRAM, token2022: TOKEN_2022_PROGRAM } as const;
    type Kind = keyof typeof PROGRAMS;
    /** The Pot programs that approve a delegate: `@sauce/token`'s checked write on both token
     *  programs, and its legacy `approve`, which only SPL Token takes. */
    const POT_APPROVALS = [
      ["approveChecked", "spl"],
      ["approveChecked", "token2022"],
      ["approve", "spl"],
    ] as const;
    type Approving = (typeof POT_APPROVALS)[number][0];
    let harness: EngineHarness;
    let shim: SolanaShim;
    let rpc: ReturnType<typeof createSolanaRpc>;
    let wallet: Address;
    let forwarder: Address;
    const mints = {} as Record<Kind, Address>;
    /** Each of POT_APPROVALS, compiled and staged once. */
    const cooking = new Map<string, { bytecode: Uint8Array; staged: StagedProgram }>();

    const keyBytes = (key: Address) => new Uint8Array(getAddressEncoder().encode(key));
    const keyHex = (key: Address) => Buffer.from(keyBytes(key)).toString("hex");
    const u64 = (value: bigint) => {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setBigUint64(0, value, true);

      return bytes;
    };
    const readonly = (key: Address) => ({ address: key, role: AccountRole.READONLY });
    const writable = (key: Address) => ({ address: key, role: AccountRole.WRITABLE });
    const signer = (key: Address) => ({ address: key, role: AccountRole.READONLY_SIGNER });

    /** SPL Token's `Approve` (4), which names the source, the delegate and the owner. */
    const approve = (source: Address, delegate: Address, amount: bigint): Instruction => ({
      programAddress: TOKEN_PROGRAM,
      accounts: [writable(source), readonly(delegate), signer(wallet)],
      data: Uint8Array.of(4, ...u64(amount)),
    });
    /** `ApproveChecked` (13), on either program: the mint and its decimals too. */
    const approveChecked = (
      kind: Kind,
      source: Address,
      delegate: Address,
      amount: bigint,
    ): Instruction => ({
      programAddress: PROGRAMS[kind],
      accounts: [writable(source), readonly(mints[kind]), readonly(delegate), signer(wallet)],
      data: Uint8Array.of(13, ...u64(amount), DECIMALS),
    });
    /** The wallet's own approval of `delegate` on `source`, as each program takes it. */
    const approval = (kind: Kind, source: Address, delegate: Address): Instruction =>
      kind === "spl"
        ? approve(source, delegate, AMOUNT)
        : approveChecked(kind, source, delegate, AMOUNT);
    /** `SetAuthority` (6) over the wallet's `account`: its owner (2) or its close authority (3). */
    const setAuthority = (
      program: Address,
      account: Address,
      what: "owner" | "close",
      to: Address,
    ): Instruction => ({
      programAddress: program,
      accounts: [writable(account), signer(wallet)],
      data: Uint8Array.of(6, what === "owner" ? 2 : 3, 1, ...keyBytes(to)),
    });
    const transferChecked = (
      kind: Kind,
      source: Address,
      dest: Address,
      amount: bigint,
      authority: Address,
    ): Instruction => ({
      programAddress: PROGRAMS[kind],
      accounts: [writable(source), readonly(mints[kind]), writable(dest), signer(authority)],
      data: transferCheckedData(amount, DECIMALS),
    });
    const prepends = () => [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
    ];

    /** `instructions` signed by `payer` (the wallet unless said), `tabled` loaded through a table. */
    const signed = (
      instructions: readonly Instruction[],
      tabled?: readonly Address[],
      payer: KeyPairSigner = harness.payer,
    ) => {
      harness.svm.expireBlockhash();

      return buildExecuteTransaction({
        payer,
        instructions,
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
        ...(tabled === undefined ? {} : { lookupTables: fabricateAlt(harness, tabled) }),
      });
    };
    const staticAccounts = (transaction: Transaction) =>
      (
        getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
          staticAccounts: readonly Address[];
        }
      ).staticAccounts;
    const measure = (transaction: Transaction) =>
      measureSvm(rpc, requireChain("solana"), wallet, transaction);
    /** Amounts as strings: a failing BigInt comparison cannot cross Jest's worker boundary. */
    const plain = <T extends { amount: bigint }>(list: readonly T[]) =>
      list.map(({ amount, ...rest }) => ({ ...rest, amount: String(amount) }));
    const limited = (mint: Address) => ({ tokens: { [mint]: { perTransaction: "1" } } });

    const guarded = (policy: Record<string, unknown>, transaction: Transaction) =>
      verdictOf(rpc, wallet, policy, transaction);
    const keyAt = (key: Address, at: number): Address => {
      const account = harness.svm.getAccount(key);
      if (!account.exists) throw new Error(`${key} does not exist`);

      return getAddressDecoder().decode(new Uint8Array(account.data).subarray(at, at + 32));
    };
    /** A wrapped SOL account of `owner`'s holding `amount`, beside the rent it keeps. */
    const wrappedSol = (owner: Address, amount: bigint): { account: Address; held: bigint } => {
      const data = tokenAccountData(NATIVE_MINT, owner, amount);
      const rent = harness.svm.minimumBalanceForRentExemption(BigInt(data.length));
      const view = new DataView(data.buffer);
      view.setUint32(109, 1, true); // is_native: Some(the rent it keeps)
      view.setBigUint64(113, rent, true);
      const account = randomAddress();
      harness.svm.setAccount({
        address: account,
        data,
        executable: false,
        lamports: lamports(rent + amount),
        programAddress: TOKEN_PROGRAM,
        space: BigInt(data.length),
      });

      return { account, held: rent + amount };
    };

    /** The wallet's cook on its Pot approving `delegate` on `source`, at the top level or through
     *  the forwarder. */
    const potApproval = (
      fn: Approving,
      kind: Kind,
      source: Address,
      delegate: Address,
      depth: "the top level" | "a CPI",
      via: "inline" | "staged",
    ): Instruction => {
      const { bytecode, staged } = cooking.get(`${fn}/${kind}`)!;
      const input = {
        kitchen: harness.kitchen,
        owner: wallet,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        feeConfig: harness.feeConfig,
        maxExecutionFee: 0n,
        tail: [
          readonly(PROGRAMS[kind]),
          writable(source),
          readonly(mints[kind]),
          readonly(delegate),
          writable(harness.pot),
        ],
      };
      const cook =
        via === "inline"
          ? buildCookInstruction({ ...input, bytecode })
          : buildCookFromAccountInstruction({ ...input, ...staged, pin: staged.sha256 });

      return depth === "the top level"
        ? cook
        : {
            programAddress: forwarder,
            accounts: [readonly(harness.kitchen), ...cook.accounts!],
            data: cook.data!,
          };
    };

    beforeAll(async () => {
      harness = await startEngine(1_700_000_000n);
      wallet = harness.payer.address;
      forwarder = randomAddress();
      harness.svm.addProgram(forwarder, new Uint8Array(readFileSync(FORWARDER_SO)));
      for (const kind of Object.keys(PROGRAMS) as Kind[]) {
        mints[kind] = setMint(harness, randomAddress(), DECIMALS, PROGRAMS[kind]);
      }
      let nonce = 301n;
      for (const [fn, kind] of POT_APPROVALS) {
        const mint = `0x${keyHex(mints[kind])}n`;
        const bytecode = compileSauceProgram(
          "solana",
          `import { ${fn} } from "@sauce/token";\n` +
            "function main(tokenProgram: Account, source: Account<Writable>, mint: Account, " +
            "delegate: Account, pot: Account<Writable, Signer>) {\n" +
            (fn === "approve"
              ? `  approve(${mint}, tokenProgram, source, delegate, pot, ${AMOUNT});\n`
              : `  approveChecked(${mint}, tokenProgram, source, mint, delegate, pot, ${AMOUNT}, ${DECIMALS});\n`) +
            "}",
        ).bytecode;
        cooking.set(`${fn}/${kind}`, {
          bytecode,
          staged: await stageProgram(harness, bytecode, nonce++),
        });
      }
      shim = solanaShim(harness.svm, RPC_URL);
      shim.install();
      rpc = createSolanaRpc(RPC_URL);
    });
    afterAll(() => shim?.restore());

    it.each([
      ["SPL Token Approve", "spl", false],
      ["SPL Token Approve", "spl", true],
      ["Token-2022 ApproveChecked", "token2022", false],
      ["Token-2022 ApproveChecked", "token2022", true],
    ] as const)(
      "the wallet's own %s (%s), lookup table %s, is an approval its token's limit holds",
      async (_, kind, alt) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          wallet,
          AMOUNT,
          PROGRAMS[kind],
        );
        const delegate = randomAddress();
        const transaction = await signed(
          [approval(kind, source, delegate)],
          alt ? [source] : undefined,
        );
        expect(staticAccounts(transaction).includes(source)).toBe(!alt);

        const measured = await measure(transaction);
        expect({
          unmeasured: measured.unmeasured,
          approvals: plain(measured.approvals),
          ...(await guarded(limited(mint), transaction)),
        }).toEqual({
          unmeasured: {},
          approvals: [{ token: mint, spender: delegate, amount: "1000000", decimals: DECIMALS }],
          ...refused(`tokens.${mint}`, `this transaction approves ${delegate} for 1000 ${mint}`),
        });
      },
    );

    it.each(["spl", "token2022"] as const)(
      "once the wallet's %s approval lands, the delegate alone moves the tokens out",
      async (kind) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          wallet,
          AMOUNT,
          PROGRAMS[kind],
        );
        const delegate = await generateKeyPairSigner();
        harness.svm.airdrop(delegate.address, lamports(1_000_000_000n));
        const dest = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          delegate.address,
          0n,
          PROGRAMS[kind],
        );
        expectOk(sendSigned(harness, await signed([approval(kind, source, delegate.address)])));

        const drain = await signed(
          [transferChecked(kind, source, dest, AMOUNT, delegate.address)],
          undefined,
          delegate,
        );
        expect(Object.keys(drain.signatures)).toEqual([delegate.address]);
        expectOk(sendSigned(harness, drain));
        expect(String(tokenAmount(harness, dest))).toBe("1000000");
        expect(String(tokenAmount(harness, source))).toBe("0");
      },
    );

    it.each(
      POT_APPROVALS.flatMap(([fn, kind]) =>
        (["the top level", "a CPI"] as const).flatMap((depth) =>
          (["inline", "staged"] as const).flatMap((via) =>
            [false, true].map((alt) => [fn, kind, depth, via, alt] as const),
          ),
        ),
      ),
    )(
      "the Pot's %s (%s) in a cook at %s, %s, lookup table %s, is an approval its token's limit holds",
      async (fn, kind, depth, via, alt) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          harness.pot,
          AMOUNT,
          PROGRAMS[kind],
        );
        const delegate = randomAddress();
        const transaction = await signed(
          [...prepends(), potApproval(fn, kind, source, delegate, depth, via)],
          alt ? [harness.pot, source] : undefined,
        );
        expect(staticAccounts(transaction).includes(source)).toBe(!alt);

        const measured = await measure(transaction);
        expect({
          unmeasured: measured.unmeasured,
          approvals: plain(measured.approvals),
          ...(await guarded(limited(mint), transaction)),
        }).toEqual({
          unmeasured: {},
          approvals: [{ token: mint, spender: delegate, amount: "1000000", decimals: DECIMALS }],
          ...refused(`tokens.${mint}`, `this transaction approves ${delegate} for 1000 ${mint}`),
        });

        // And the cook does approve it: the delegate is set on the Pot's account.
        expectOk(sendSigned(harness, transaction));
        expect(keyAt(source, 76)).toBe(delegate);
      },
    );

    it.each(["spl", "token2022"] as const)(
      "the wallet's %s token account handed to another key: its whole balance leaves the wallet",
      async (kind) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          wallet,
          AMOUNT,
          PROGRAMS[kind],
        );
        const other = randomAddress();
        const transaction = await signed([setAuthority(PROGRAMS[kind], source, "owner", other)]);

        const measured = await measure(transaction);
        expect({
          unmeasured: measured.unmeasured,
          tokens: plain(measured.tokens),
          ...(await guarded(limited(mint), transaction)),
        }).toEqual({
          unmeasured: {},
          tokens: [{ token: mint, amount: "1000000", decimals: DECIMALS }],
          ...refused(`tokens.${mint}.perTransaction`, `this transaction sends 1000 ${mint}`),
        });

        // Once it lands, the account and everything in it are the other key's.
        expectOk(sendSigned(harness, transaction));
        expect(keyAt(source, 32)).toBe(other);
      },
    );

    it("counts a transfer out of the wallet's account for the wallet, when the same transaction hands the account away", async () => {
      const mint = mints.spl;
      const source = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const elsewhere = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      const send = transferChecked("spl", source, elsewhere, 5_000n, wallet);

      // The transfer alone: 5 tokens, over the limit of 1.
      const alone = await signed([send]);
      expect({
        tokens: plain((await measure(alone)).tokens),
        ...(await guarded(limited(mint), alone)),
      }).toEqual({
        tokens: [{ token: mint, amount: "5000", decimals: DECIMALS }],
        ...refused(`tokens.${mint}.perTransaction`, `this transaction sends 5 ${mint}`),
      });

      // The same transfer, then the account handed to another key: the transfer and what is left.
      const handedOff = await signed([
        send,
        setAuthority(TOKEN_PROGRAM, source, "owner", randomAddress()),
      ]);
      const measured = await measure(handedOff);
      expect({
        unmeasured: measured.unmeasured,
        tokens: plain(measured.tokens),
        ...(await guarded(limited(mint), handedOff)),
      }).toEqual({
        unmeasured: {},
        tokens: [{ token: mint, amount: "1000000", decimals: DECIMALS }],
        ...refused(`tokens.${mint}.perTransaction`, `this transaction sends 1000 ${mint}`),
      });
    });

    it("refuses the wallet's token account with its close authority handed to another key, where the token is limited", async () => {
      const mint = mints.spl;
      const source = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const closer = randomAddress();
      const transaction = await signed([setAuthority(TOKEN_PROGRAM, source, "close", closer)]);

      expect(await guarded(limited(mint), transaction)).toEqual(
        refused(`tokens.${mint}`, `this transaction lets ${closer} close ${source}`),
      );
    });

    /** What the guard and the measurement say of `transaction` under a native limit of `limit`. */
    const nativeVerdict = async (limit: string, transaction: Transaction) => {
      const measured = await measure(transaction);
      const { refusal, ledger } = await guarded({ native: { perTransaction: limit } }, transaction);

      return {
        unmeasured: measured.unmeasured,
        native: String(measured.native.amount),
        refusal,
        spend: ledger === "" ? undefined : (JSON.parse(ledger) as { spend: unknown }).spend,
      };
    };
    const ALLOWED = "none: the guard let it through";
    const FEE = 5_000n;
    const nativeRefusal = {
      limit: "native.perTransaction",
      message: expect.stringContaining("native.perTransaction is ") as unknown,
    };
    const closeAccount = (account: Address, destination: Address): Instruction => ({
      programAddress: TOKEN_PROGRAM,
      accounts: [writable(account), writable(destination), signer(wallet)],
      data: Uint8Array.of(9),
    });
    /** A durable nonce account whose authority is `authority`, holding `amount` above its rent. */
    const nonceAccount = (authority: Address, amount: bigint): Address => {
      const data = new Uint8Array(80);
      const view = new DataView(data.buffer);
      view.setUint32(0, 1, true); // Versions::Current
      view.setUint32(4, 1, true); // State::Initialized
      data.set(keyBytes(authority), 8);
      data.set(keyBytes(randomAddress()), 40); // the durable nonce
      view.setBigUint64(72, 5_000n, true); // lamports per signature
      const account = randomAddress();
      harness.svm.setAccount({
        address: account,
        data,
        executable: false,
        lamports: lamports(harness.svm.minimumBalanceForRentExemption(80n) + amount),
        programAddress: SYSTEM_PROGRAM,
        space: 80n,
      });

      return account;
    };

    it("counts the wallet's wrapped SOL closed to another key against native", async () => {
      const { account, held } = wrappedSol(wallet, 2_000_000_000n);
      const transaction = await signed([closeAccount(account, randomAddress())]);

      expect(await nativeVerdict("1", transaction)).toEqual({
        unmeasured: {},
        native: String(held + FEE),
        refusal: nativeRefusal,
        spend: undefined,
      });
    });

    it.each(["withdraws from it", "hands it to another key"] as const)(
      "counts what the wallet's durable nonce account loses against native, when the transaction %s",
      async (what) => {
        const nonce = nonceAccount(wallet, 2_000_000_000n);
        const held = harness.svm.getBalance(nonce)!;
        const transaction = await signed([
          what === "withdraws from it"
            ? {
                programAddress: SYSTEM_PROGRAM,
                accounts: [
                  writable(nonce),
                  writable(randomAddress()),
                  readonly(address("SysvarRecentB1ockHashes11111111111111111111")),
                  readonly(address("SysvarRent111111111111111111111111111111111")),
                  signer(wallet),
                ],
                data: Uint8Array.of(...u32(5), ...u64(1_500_000_000n)),
              }
            : {
                programAddress: SYSTEM_PROGRAM,
                accounts: [writable(nonce), signer(wallet)],
                data: Uint8Array.of(...u32(7), ...keyBytes(randomAddress())),
              },
        ]);

        expect(await nativeVerdict("1", transaction)).toEqual({
          unmeasured: {},
          native: String((what === "withdraws from it" ? 1_500_000_000n : held) + FEE),
          refusal: nativeRefusal,
          spend: undefined,
        });
      },
    );

    it("counts wrapped SOL the wallet approves another key to move against native", async () => {
      const { account } = wrappedSol(wallet, 2_000_000_000n);
      const transaction = await signed([approve(account, randomAddress(), 2_000_000_000n)]);

      expect(await nativeVerdict("1", transaction)).toEqual({
        unmeasured: {},
        native: String(2_000_000_000n + FEE),
        refusal: nativeRefusal,
        spend: undefined,
      });
    });

    it("counts the wallet's whole balance against native when the transaction gives the wallet to another program", async () => {
      // System's Assign: from then on the program, not the wallet's key, moves its lamports.
      const transaction = await signed([
        {
          programAddress: SYSTEM_PROGRAM,
          accounts: [{ address: wallet, role: AccountRole.WRITABLE_SIGNER }],
          data: Uint8Array.of(...u32(1), ...keyBytes(randomAddress())),
        },
      ]);
      const balance = harness.svm.getBalance(wallet)!;

      expect(await nativeVerdict("1", transaction)).toEqual({
        unmeasured: {},
        native: String(balance),
        refusal: nativeRefusal,
        spend: undefined,
      });
    });

    it("counts only the fee when the wallet wraps SOL into its own account and unwraps it again", async () => {
      const { account } = wrappedSol(wallet, 0n);
      const wrap = await signed([
        {
          programAddress: SYSTEM_PROGRAM,
          accounts: [{ address: wallet, role: AccountRole.WRITABLE_SIGNER }, writable(account)],
          data: Uint8Array.of(...u32(2), ...u64(1_000_000_000n)),
        },
        // SyncNative: the account's amount catches up with its lamports.
        { programAddress: TOKEN_PROGRAM, accounts: [writable(account)], data: Uint8Array.of(17) },
      ]);
      const wrapped = await nativeVerdict("0.5", wrap);
      expectOk(sendSigned(harness, wrap));
      const unwrap = await signed([closeAccount(account, wallet)]);
      const unwrapped = await nativeVerdict("0.5", unwrap);

      const fee = {
        unmeasured: {},
        native: String(FEE),
        refusal: ALLOWED,
        spend: { native: { amount: String(FEE), decimals: 9 } },
      };
      expect({ wrapped, unwrapped }).toEqual({ wrapped: fee, unwrapped: fee });
    });

    it("counts the lamports of the wallet's wrapped SOL against native, when another key may close it", async () => {
      const { account, held } = wrappedSol(wallet, 2_000_000_000n);
      const closer = await generateKeyPairSigner();
      harness.svm.airdrop(closer.address, lamports(1_000_000_000n));
      const transaction = await signed([
        setAuthority(TOKEN_PROGRAM, account, "close", closer.address),
      ]);

      const measured = await measure(transaction);
      expect({
        unmeasured: measured.unmeasured,
        native: String(measured.native.amount),
        ...(await guarded({ native: { perTransaction: "1" } }, transaction)),
      }).toEqual({
        unmeasured: {},
        native: String(held + 5_000n), // And the signature fee.
        ...refused("native.perTransaction", "native.perTransaction is 1 SOL"),
      });

      // Once it lands, the closer alone takes them: the wrapped SOL and the rent.
      expectOk(sendSigned(harness, transaction));
      const before = harness.svm.getBalance(closer.address) ?? 0n;
      const close = await signed(
        [
          {
            programAddress: TOKEN_PROGRAM,
            accounts: [writable(account), writable(closer.address), signer(closer.address)],
            data: Uint8Array.of(9),
          },
        ],
        undefined,
        closer,
      );
      expectOk(sendSigned(harness, close));
      expect(String((harness.svm.getBalance(closer.address) ?? 0n) - before)).toBe(
        String(held - 5_000n),
      );
    });

    /** A cook in which the Pot hands `account`'s close authority to `closer`. */
    const potCloser = (account: Address, closer: Address): Instruction =>
      buildCookInstruction({
        kitchen: harness.kitchen,
        owner: wallet,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        feeConfig: harness.feeConfig,
        maxExecutionFee: 0n,
        bytecode: compileSauceProgram(
          "solana",
          "function main(tokenProgram: Account, account: Account<Writable>, pot: Account<Writable, Signer>) {\n" +
            `  svm.call(tokenProgram, [account, pot], hex\`060301${keyHex(closer)}\`);\n` +
            "}",
        ).bytecode,
        tail: [readonly(TOKEN_PROGRAM), writable(account), writable(harness.pot)],
      });

    it("refuses a cook that hands the close authority of the Pot's token account to another key, where the token is limited", async () => {
      const mint = mints.spl;
      const account = setTokenAccount(harness, randomAddress(), mint, harness.pot, AMOUNT);
      const closer = randomAddress();
      const transaction = await signed([...prepends(), potCloser(account, closer)]);

      expect(await guarded(limited(mint), transaction)).toEqual(
        refused(`tokens.${mint}`, `this transaction lets ${closer} close ${account}`),
      );
      expectOk(sendSigned(harness, transaction));
      expect(keyAt(account, 133)).toBe(closer);
    });

    it("counts the lamports of the Pot's wrapped SOL against native, when a cook lets another key close it", async () => {
      const { account, held } = wrappedSol(harness.pot, 2_000_000_000n);
      const closer = randomAddress();
      const transaction = await signed([...prepends(), potCloser(account, closer)]);

      const measured = await measure(transaction);
      expect({
        unmeasured: measured.unmeasured,
        native: String(measured.native.amount),
        ...(await guarded({ native: { perTransaction: "1" } }, transaction)),
      }).toEqual({
        unmeasured: {},
        native: String(held + 5_000n), // And the signature fee.
        ...refused("native.perTransaction", "native.perTransaction is 1 SOL"),
      });
      expectOk(sendSigned(harness, transaction));
      expect(keyAt(account, 133)).toBe(closer);
    });

    it("refuses wrapped SOL another key may close, where wrapped SOL is limited as a token", async () => {
      const { account } = wrappedSol(wallet, 2_000_000_000n);
      const closer = randomAddress();
      const transaction = await signed([setAuthority(TOKEN_PROGRAM, account, "close", closer)]);

      expect(await guarded(limited(NATIVE_MINT), transaction)).toEqual(
        refused(`tokens.${NATIVE_MINT}`, `this transaction lets ${closer} close ${account}`),
      );
    });

    /** `signer` as the authority an instruction names, signing beside the wallet. */
    const signing = (signer: KeyPairSigner): AccountSignerMeta => ({
      address: signer.address,
      role: AccountRole.READONLY_SIGNER,
      signer,
    });

    it.each(["spl", "token2022"] as const)(
      "lets a %s approval within the limit through, and reserves it in the day's total",
      async (kind) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          wallet,
          AMOUNT,
          PROGRAMS[kind],
        );
        const delegate = randomAddress();
        // 1,000 base units: 1 token, the limit itself.
        const transaction = await signed([
          kind === "spl"
            ? approve(source, delegate, 1_000n)
            : approveChecked(kind, source, delegate, 1_000n),
        ]);

        const measured = await measure(transaction);
        const { refusal, ledger } = await guarded(limited(mint), transaction);
        expect({
          approvals: plain(measured.approvals),
          refusal,
          spend: (JSON.parse(ledger) as { spend: unknown }).spend,
        }).toEqual({
          approvals: [{ token: mint, spender: delegate, amount: "1000", decimals: DECIMALS }],
          refusal: "none: the guard let it through",
          spend: { [`tokens.${mint}`]: { amount: "1000", decimals: DECIMALS } },
        });
      },
    );

    it.each([
      ["two approvals", "approve"],
      ["a transfer and an approval", "transfer"],
    ] as const)("holds %s each within the limit to the limit together", async (_, first) => {
      const mint = mints.spl;
      const one = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const two = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const elsewhere = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      // 600 base units each: 0.6 tokens, under the limit of 1; 1.2 together.
      const transaction = await signed([
        first === "approve"
          ? approve(one, randomAddress(), 600n)
          : transferChecked("spl", one, elsewhere, 600n, wallet),
        approve(two, randomAddress(), 600n),
      ]);

      expect(await guarded(limited(mint), transaction)).toEqual(
        refused(`tokens.${mint}.perTransaction`, `this transaction sends 1.2 ${mint}`),
      );
    });

    it("counts each approval in the day's total, so approving again and again cannot pass it", async () => {
      const mint = mints.spl;
      const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-allowance-"));
      const info: WalletInfo = {
        name: "agent",
        kind: "solana",
        address: wallet,
        path: join(dir, "agent.json"),
        policyPath: join(dir, "agent.policy.json"),
      };
      // One token to a new delegate each time, which may spend it before the next.
      const approveOne = async () =>
        signed([
          approve(
            setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT),
            randomAddress(),
            1_000n,
          ),
        ]);
      try {
        writeFileSync(info.policyPath, JSON.stringify({ tokens: { [mint]: { perDay: "1.5" } } }), {
          mode: 0o600,
        });
        const guard = guardWallet(info, readPolicy(info));
        (await guard.svm(rpc, await approveOne())).sent("the first approval");
        const refusal = await guard.svm(rpc, await approveOne()).then(
          () => "none: the guard let it through",
          (error: unknown) =>
            error instanceof PolicyRefusal
              ? { limit: error.limit, message: error.message }
              : String(error),
        );

        expect(refusal).toEqual({
          limit: `tokens.${mint}`,
          message: expect.stringContaining(`this transaction approves`) as unknown,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("counts a raised allowance at its new total, and not a lowered one, a revoke, or one spent down", async () => {
      const mint = mints.spl;
      const source = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const delegate = await generateKeyPairSigner();
      expectOk(sendSigned(harness, await signed([approve(source, delegate.address, 5_000n)])));

      // Raised from 5 tokens to 6, for the same delegate: an approval of 6, over the limit of 1.
      const raised = await signed([approve(source, delegate.address, 6_000n)]);
      expect({
        approvals: plain((await measure(raised)).approvals),
        ...(await guarded(limited(mint), raised)),
      }).toEqual({
        approvals: [{ token: mint, spender: delegate.address, amount: "6000", decimals: DECIMALS }],
        ...refused(`tokens.${mint}`, `this transaction approves ${delegate.address} for 6 ${mint}`),
      });

      // Lowered, revoked, or spent down by the delegate (400 of it, in a transaction the wallet
      // pays for): nothing new for anyone to take, and the 400 count as what the wallet sends.
      const elsewhere = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      const instructions: Instruction[] = [
        approve(source, delegate.address, 2_000n),
        {
          programAddress: TOKEN_PROGRAM,
          accounts: [writable(source), signer(wallet)],
          data: Uint8Array.of(5),
        },
        {
          programAddress: TOKEN_PROGRAM,
          accounts: [writable(source), readonly(mint), writable(elsewhere), signing(delegate)],
          data: transferCheckedData(400n, DECIMALS),
        },
      ];
      const outcomes = [];
      // Each measured as soon as it is signed, while its blockhash is the bank's latest.
      for (const instruction of instructions) {
        const transaction = await signed([instruction]);
        const measured = await measure(transaction);
        outcomes.push({
          approvals: plain(measured.approvals),
          tokens: plain(measured.tokens),
          refusal: (await guarded(limited(mint), transaction)).refusal,
        });
      }
      const allowed = "none: the guard let it through";
      expect(outcomes).toEqual([
        { approvals: [], tokens: [], refusal: allowed },
        { approvals: [], tokens: [], refusal: allowed },
        {
          approvals: [],
          tokens: [{ token: mint, amount: "400", decimals: DECIMALS }],
          refusal: allowed,
        },
      ]);
    });

    it("ignores an approval on a token account that is neither the wallet's nor a Pot's it cooks on", async () => {
      const mint = mints.token2022;
      const stranger = await generateKeyPairSigner();
      const source = setTokenAccount(
        harness,
        randomAddress(),
        mint,
        stranger.address,
        AMOUNT,
        TOKEN_2022_PROGRAM,
      );
      const transaction = await signed([
        {
          programAddress: TOKEN_2022_PROGRAM,
          accounts: [
            writable(source),
            readonly(mint),
            readonly(randomAddress()),
            signing(stranger),
          ],
          data: Uint8Array.of(13, ...u64(AMOUNT), DECIMALS),
        },
      ]);

      const measured = await measure(transaction);
      expect({
        approvals: plain(measured.approvals),
        refusal: (await guarded(limited(mint), transaction)).refusal,
      }).toEqual({ approvals: [], refusal: "none: the guard let it through" });
      expectOk(sendSigned(harness, transaction));
    });

    it.each(["spl", "token2022"] as const)(
      "gives nothing away by a %s delegate that is the wallet itself, on the wallet's account",
      async (kind) => {
        const mint = mints[kind];
        const source = setTokenAccount(
          harness,
          randomAddress(),
          mint,
          wallet,
          AMOUNT,
          PROGRAMS[kind],
        );
        const transaction = await signed([approval(kind, source, wallet)]);

        const measured = await measure(transaction);
        expect({
          approvals: plain(measured.approvals),
          refusal: (await guarded(limited(mint), transaction)).refusal,
        }).toEqual({ approvals: [], refusal: "none: the guard let it through" });
      },
    );

    it.each([
      ["the wallet", "the top level"],
      ["the wallet", "a CPI"],
      ["the Pot", "the top level"],
    ] as const)(
      "gives nothing away by a delegate that is %s, on the Pot's account in a cook at %s",
      async (who, depth) => {
        const mint = mints.spl;
        const source = setTokenAccount(harness, randomAddress(), mint, harness.pot, AMOUNT);
        const delegate = who === "the wallet" ? wallet : harness.pot;
        const transaction = await signed([
          ...prepends(),
          potApproval("approveChecked", "spl", source, delegate, depth, "inline"),
        ]);

        const measured = await measure(transaction);
        expect({
          approvals: plain(measured.approvals),
          refusal: (await guarded(limited(mint), transaction)).refusal,
        }).toEqual({ approvals: [], refusal: "none: the guard let it through" });
        expectOk(sendSigned(harness, transaction));
        expect(keyAt(source, 76)).toBe(delegate);
      },
    );

    it("gives nothing away by a close authority handed to the wallet itself", async () => {
      const mint = mints.spl;
      const source = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);
      const transaction = await signed([setAuthority(TOKEN_PROGRAM, source, "close", wallet)]);

      const measured = await measure(transaction);
      expect({
        closers: measured.closers,
        refusal: (await guarded(limited(mint), transaction)).refusal,
      }).toEqual({ closers: [], refusal: "none: the guard let it through" });
    });

    it("counts a handoff in the day's total, as the ledger records it", async () => {
      const mint = mints.spl;
      const dir = mkdtempSync(join(tmpdir(), "sauce-policy-svm-handoff-"));
      const info: WalletInfo = {
        name: "agent",
        kind: "solana",
        address: wallet,
        path: join(dir, "agent.json"),
        policyPath: join(dir, "agent.policy.json"),
      };
      const handOff = async () =>
        signed([
          setAuthority(
            TOKEN_PROGRAM,
            setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT),
            "owner",
            randomAddress(),
          ),
        ]);
      try {
        writeFileSync(info.policyPath, JSON.stringify({ tokens: { [mint]: { perDay: "1500" } } }), {
          mode: 0o600,
        });
        const guard = guardWallet(info, readPolicy(info));
        (await guard.svm(rpc, await handOff())).sent("the first handoff");
        const refusal = await guard.svm(rpc, await handOff()).then(
          () => "none: the guard let it through",
          (error: unknown) =>
            error instanceof PolicyRefusal
              ? { limit: error.limit, message: error.message }
              : String(error),
        );
        const ledger = readFileSync(join(dir, "agent.ledger.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);

        expect({ ledger, refusal }).toEqual({
          ledger: [
            expect.objectContaining({
              state: "reserved",
              spend: { [`tokens.${mint}`]: { amount: "1000000", decimals: DECIMALS } },
            }),
            expect.objectContaining({ state: "sent", tx: "the first handoff" }),
          ],
          refusal: {
            limit: `tokens.${mint}.perDay`,
            message: expect.stringContaining(
              `1000 ${mint} went in the last 24 hours, and this transaction sends 1000 ${mint}`,
            ) as unknown,
          },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    /** A token whose mint has no account and which the registry does not record, with an
     *  account of the wallet's: neither Approve nor SetAuthority reads the mint. */
    const unreadable = (what: "an approval" | "a handoff") => {
      const mint = randomAddress();
      const source = setTokenAccount(harness, randomAddress(), mint, wallet, AMOUNT);

      return {
        mint,
        instruction:
          what === "an approval"
            ? approve(source, randomAddress(), AMOUNT)
            : setAuthority(TOKEN_PROGRAM, source, "owner", randomAddress()),
      };
    };

    it.each(["an approval", "a handoff"] as const)(
      "refuses %s of a token whose decimals cannot be read, where that token is limited",
      async (what) => {
        const { mint, instruction } = unreadable(what);
        const transaction = await signed([instruction]);
        const why = `the decimals of mint ${mint} could not be read`;

        const measured = await measure(transaction);
        expect({
          unmeasured: measured.unmeasured,
          undecided: measured.undecided,
          ...(await guarded(limited(mint), transaction)),
        }).toEqual({
          unmeasured: {},
          undecided: [mint],
          ...refused(`tokens.${mint}`, `tokens.${mint} is limited, and ${why}`),
        });
      },
    );

    it.each(["an approval", "a handoff"] as const)(
      "lets %s of a token whose decimals cannot be read through, where only another token is limited",
      async (what) => {
        const { instruction } = unreadable(what);
        const transaction = await signed([instruction]);

        expect((await guarded(limited(mints.spl), transaction)).refusal).toBe(
          "none: the guard let it through",
        );
      },
    );

    it("reads the decimals of a mint the transaction creates from what the simulation leaves", async () => {
      const mint = await generateKeyPairSigner();
      const account = await generateKeyPairSigner();
      const delegate = randomAddress();
      const create = (made: KeyPairSigner, space: bigint): Instruction => ({
        programAddress: address("11111111111111111111111111111111"),
        accounts: [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: made.address, role: AccountRole.WRITABLE_SIGNER, signer: made },
        ] as AccountSignerMeta[],
        data: Uint8Array.of(
          0,
          0,
          0,
          0,
          ...u64(harness.svm.minimumBalanceForRentExemption(space)),
          ...u64(space),
          ...keyBytes(TOKEN_PROGRAM),
        ),
      });
      const transaction = await signed([
        create(mint, 82n),
        // InitializeMint2: 3 decimals, the wallet minting, no freeze authority.
        {
          programAddress: TOKEN_PROGRAM,
          accounts: [writable(mint.address)],
          data: Uint8Array.of(20, DECIMALS, ...keyBytes(wallet), 0),
        },
        create(account, 165n),
        // InitializeAccount3, held by the wallet; then MintTo the whole amount into it.
        {
          programAddress: TOKEN_PROGRAM,
          accounts: [writable(account.address), readonly(mint.address)],
          data: Uint8Array.of(18, ...keyBytes(wallet)),
        },
        {
          programAddress: TOKEN_PROGRAM,
          accounts: [writable(mint.address), writable(account.address), signer(wallet)],
          data: Uint8Array.of(7, ...u64(AMOUNT)),
        },
        approve(account.address, delegate, AMOUNT),
      ]);

      const measured = await measure(transaction);
      expect({
        undecided: measured.undecided,
        approvals: plain(measured.approvals),
        ...(await guarded(limited(mint.address), transaction)),
      }).toEqual({
        undecided: [],
        approvals: [
          { token: mint.address, spender: delegate, amount: "1000000", decimals: DECIMALS },
        ],
        ...refused(
          `tokens.${mint.address}`,
          `this transaction approves ${delegate} for 1000 ${mint.address}`,
        ),
      });
      expectOk(sendSigned(harness, transaction));
    });
  },
);
