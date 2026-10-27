/**
 * What a simulated Solana cook moved, from account states alone (`cli/svm-effects.ts`): token
 * account layouts read and refused, a registered mint named by its symbol, created and closed
 * accounts, accounts handed to another key, and lamports. Executing a cook and reading its accounts
 * back is `cli-solana.e2e.test.ts`.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { address, createSolanaRpc, getAddressEncoder, type Address } from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import {
  accountsNow,
  BEFORE_READ_MS,
  movedBy,
  svmLeftInPot,
  svmLeftInPotJson,
  svmLeftInPotLines,
  svmMovedJson,
  svmMovedLines,
  tokenAccount as readTokenAccount,
} from "../src/cli/svm-effects.js";
import type { SimulatedAccount } from "../src/svm/index.js";

const SOLANA = requireChain("solana");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/** A mint the registry does not record, whose account the stub does not serve either. */
const OTHER_MINT = address("SysvarC1ock11111111111111111111111111111111");
const WSOL = address("So11111111111111111111111111111111111111112");
const SOURCE = address("Vote111111111111111111111111111111111111111");
const DEST = address("Config1111111111111111111111111111111111111");
const MINTED = address("Stake11111111111111111111111111111111111111");
const MINT_ACCOUNT = address("SysvarRent111111111111111111111111111111111");
const OWNER = address("11111111111111111111111111111111");
/** The owner's Pot: the authority of its own token accounts. */
const POT = address("SysvarS1otHashes111111111111111111111111111");
const POT_USDC = address("Sysvar1nstructions1111111111111111111111111");
const POT_OTHER = address("SysvarRecentB1ockHashes11111111111111111111");

/** An SPL token account: mint, owner, amount, then the rest of the 165 bytes. */
function tokenAccount(mint: Address, owner: Address, amount: bigint, size = 165): Uint8Array {
  const data = new Uint8Array(size);
  data.set(getAddressEncoder().encode(mint), 0);
  data.set(getAddressEncoder().encode(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);

  return data;
}

const account = (data: Uint8Array, owner: Address = TOKEN_PROGRAM, lamports = 2_039_280n) =>
  ({ lamports, owner, data, executable: false }) satisfies SimulatedAccount;

/** An RPC that answers `getMultipleAccounts` for the mints: decimals at byte 44. */
function mintRpc(decimals: Record<string, number>) {
  return {
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => ({
        value: addresses.map((key) => {
          if (decimals[key] === undefined) return null;
          const data = new Uint8Array(82);
          data[44] = decimals[key]!;

          return {
            lamports: 1n,
            owner: TOKEN_PROGRAM,
            data: [Buffer.from(data).toString("base64"), "base64"],
            executable: false,
          };
        }),
      }),
    }),
  } as unknown as Parameters<typeof movedBy>[0];
}

describe("what a Solana cook moved", () => {
  const labels = new Map<string, string>([
    [SOURCE, "source"],
    [OWNER, "the owner"],
  ]);

  it("reads token balances, names a registered mint, and counts created and closed accounts", async () => {
    const tracked = [SOURCE, DEST, MINTED, OWNER];
    const before = [
      account(tokenAccount(USDC, OWNER, 1_500_000n)),
      account(tokenAccount(OTHER_MINT, OWNER, 9n)),
      null,
      account(new Uint8Array(0), OWNER, 10_000_000n),
    ];
    const after = [
      account(tokenAccount(USDC, OWNER, 500_000n)),
      null,
      account(tokenAccount(USDC, OWNER, 1_000_000n, 170), TOKEN_2022),
      account(new Uint8Array(0), OWNER, 9_995_000n),
    ];
    // A Token-2022 account past 165 bytes is one only when byte 165 says so (2).
    after[2]!.data[165] = 2;
    const moved = await movedBy(
      mintRpc({ [USDC]: 6 }),
      SOLANA,
      tracked,
      before,
      after,
      labels,
      OWNER,
    );

    expect(svmMovedJson(moved).tokenChanges).toEqual([
      expect.objectContaining({
        account: SOURCE,
        label: "source",
        symbol: "USDC",
        delta: "-1000000",
        formatted: "-1",
      }),
      // Closed: its balance ends at zero. Its mint is not registered and has no decimals here.
      expect.objectContaining({ account: DEST, before: "9", after: "0", delta: "-9" }),
      expect.objectContaining({ account: MINTED, before: "0", after: "1000000", symbol: "USDC" }),
    ]);
    const lines = svmMovedLines(moved);
    expect(lines).toContain(`  ${SOURCE} (source), owned by ${OWNER} (the owner): -1 USDC`);
    expect(lines).toContain(
      `  ${DEST}, owned by ${OWNER} (the owner): -9 of mint ${OTHER_MINT} (base units)`,
    );
    expect(lines).toContain(
      `  ${OWNER} (the owner): -5000 lamports, the transaction's fee included`,
    );
  });

  it("takes a registered mint's decimals from the registry when the cluster does not answer", async () => {
    const moved = await movedBy(
      mintRpc({}),
      SOLANA,
      [SOURCE],
      [account(tokenAccount(WSOL, OWNER, 2_000_000_000n))],
      [account(tokenAccount(WSOL, OWNER, 500_000_000n))],
      labels,
      OWNER,
    );

    expect(svmMovedLines(moved)).toContain(
      `  ${SOURCE} (source), owned by ${OWNER} (the owner): -1.5 WSOL`,
    );
  });

  it("says first what the cook leaves in the Pot's token accounts, and nothing when it leaves nothing", async () => {
    // The Pot's USDC grows, its other token is emptied, and the owner's own account is paid.
    const tracked = [POT_USDC, POT_OTHER, SOURCE];
    const moved = await movedBy(
      mintRpc({ [USDC]: 6 }),
      SOLANA,
      tracked,
      [
        account(tokenAccount(USDC, POT, 2_000_000n)),
        account(tokenAccount(OTHER_MINT, POT, 9n)),
        account(tokenAccount(USDC, OWNER, 0n)),
      ],
      [
        account(tokenAccount(USDC, POT, 2_500_000n)),
        account(tokenAccount(OTHER_MINT, POT, 0n)),
        account(tokenAccount(USDC, OWNER, 1_000_000n)),
      ],
      labels,
      OWNER,
    );
    const left = svmLeftInPot(moved, POT);

    expect(svmLeftInPotJson(left)).toEqual([
      {
        account: POT_USDC,
        mint: USDC,
        symbol: "USDC",
        amount: "2500000",
        decimals: 6,
        formatted: "2.5",
        before: "2000000",
      },
    ]);
    expect(svmLeftInPotLines(left, "the owner's wallet")).toEqual([
      "Left in the Pot, not in the owner's wallet:",
      `  2.5 USDC, in ${POT_USDC} (it held 2 USDC before)`,
      "  Only another cook moves it out. To end in a wallet, the program must send it there, or " +
        "name the wallet as the recipient of the call that produces it.",
    ]);
    // Only the named holder's accounts count: the owner's own for the owner, none for another.
    expect(svmLeftInPot(moved, OWNER)).toEqual([
      expect.objectContaining({ account: SOURCE, after: 1_000_000n }),
    ]);
    expect(svmLeftInPotLines(svmLeftInPot(moved, MINTED), "the owner's wallet")).toEqual([]);
  });

  it.each([
    ["another mint", OTHER_MINT, TOKEN_PROGRAM],
    ["the same mint under the other token program", USDC, TOKEN_2022],
  ] as const)(
    "counts a token account replaced at its address with %s as the old one emptied and a new one filled",
    async (_, mint, program) => {
      const moved = await movedBy(
        mintRpc({ [USDC]: 6 }),
        SOLANA,
        [SOURCE],
        [account(tokenAccount(USDC, OWNER, 1_500_000n))],
        [account(tokenAccount(mint, OWNER, 1_500_000n), program)],
        labels,
        OWNER,
      );

      // As strings: a failing BigInt comparison cannot cross Jest's worker boundary.
      expect(
        moved.tokens.map((change) => ({
          mint: change.mint,
          delta: String(change.after - change.before),
        })),
      ).toEqual([
        { mint: USDC, delta: "-1500000" },
        { mint, delta: "1500000" },
      ]);
    },
  );

  it("counts a balance change for whose the account was, and says whom the transaction handed it to", async () => {
    // The owner's account pays 1 USDC and is handed to MINTED; an empty one of the owner's is
    // filled and handed to the Pot.
    const tracked = [SOURCE, POT_USDC];
    const moved = await movedBy(
      mintRpc({ [USDC]: 6 }),
      SOLANA,
      tracked,
      [account(tokenAccount(USDC, OWNER, 1_500_000n)), account(tokenAccount(USDC, OWNER, 0n))],
      [account(tokenAccount(USDC, MINTED, 500_000n)), account(tokenAccount(USDC, POT, 1_000_000n))],
      labels,
      OWNER,
    );

    expect(svmMovedJson(moved).tokenChanges).toEqual([
      expect.objectContaining({
        account: SOURCE,
        owner: OWNER,
        ownerAfter: MINTED,
        delta: "-1000000",
      }),
      expect.objectContaining({
        account: POT_USDC,
        owner: OWNER,
        ownerAfter: POT,
        delta: "1000000",
      }),
    ]);
    expect(svmMovedLines(moved).slice(0, 2)).toEqual([
      "Token balance changes:",
      `  ${SOURCE} (source), owned by ${OWNER} (the owner), handed to ${MINTED} by the transaction: -1 USDC`,
    ]);
    // What is left in the Pot is what the Pot holds after it.
    expect(svmLeftInPot(moved, POT).map((change) => change.account)).toEqual([POT_USDC]);
    expect(svmLeftInPot(moved, OWNER)).toEqual([]);
  });

  it("reads a token account's delegate, close authority and wrapped SOL, in either program", () => {
    const encode = (key: Address) => getAddressEncoder().encode(key);
    const data = tokenAccount(WSOL, OWNER, 5n, 170);
    data[165] = 2;
    const view = new DataView(data.buffer);
    view.setUint32(72, 1, true);
    data.set(encode(DEST), 76);
    view.setUint32(109, 1, true);
    view.setBigUint64(113, 2_039_280n, true);
    view.setBigUint64(121, 3n, true);
    view.setUint32(129, 1, true);
    data.set(encode(MINTED), 133);
    // As strings: a failing BigInt comparison cannot cross Jest's worker boundary.
    const plain = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (_, each: unknown) => (typeof each === "bigint" ? `${each}` : each)),
      );

    // 5 lamports of wrapped SOL synced into its amount, and 7 more sent in that are not yet.
    expect(plain(readTokenAccount(account(data, TOKEN_2022, 2_039_280n + 12n)))).toEqual({
      program: TOKEN_2022,
      mint: WSOL,
      owner: OWNER,
      amount: "5",
      delegate: DEST,
      delegatedAmount: "3",
      closeAuthority: MINTED,
      isNative: true,
      wrapped: "12",
    });
    expect(plain(readTokenAccount(account(tokenAccount(USDC, OWNER, 1n))))).toEqual({
      program: TOKEN_PROGRAM,
      mint: USDC,
      owner: OWNER,
      amount: "1",
      delegatedAmount: "0",
      isNative: false,
    });
  });

  it("reads no balance out of a mint, or an extended Token-2022 mint", async () => {
    const mint = new Uint8Array(82);
    const extendedMint = tokenAccount(USDC, OWNER, 5n, 200);
    extendedMint[165] = 1;
    const tracked = [MINT_ACCOUNT, SOURCE];
    const moved = await movedBy(
      mintRpc({}),
      SOLANA,
      tracked,
      [account(mint), account(extendedMint, TOKEN_2022)],
      [account(mint), account(tokenAccount(USDC, OWNER, 7n, 200), TOKEN_2022)],
      labels,
      OWNER,
    );

    expect(moved.tokens).toEqual([]);
    expect(svmMovedLines(moved)).toEqual([
      "It changed no token balance and no account's lamports.",
    ]);
  });
});

// The accounts a send reads before it signs are read after its blockhash is fetched: a read the
// endpoint takes the slow testnet budget (120 s) over would let the blockhash, which lives about a
// minute, run out before the send. The send gives that read `BEFORE_READ_MS` and goes on without it.
describe("the accounts read before a send", () => {
  let silent: Server;
  let url: string;

  beforeAll(async () => {
    // An endpoint that takes the request and never answers.
    silent = createServer(() => undefined);
    await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    silent.closeAllConnections();
    await new Promise((done) => silent.close(done));
  });

  it("are given well under a blockhash's life", () => {
    expect(BEFORE_READ_MS).toBe(8_000);
  });

  it("stop at the signal they are given, from an endpoint that never answers", async () => {
    const started = Date.now();
    await expect(
      accountsNow(createSolanaRpc(url), [SOURCE], AbortSignal.timeout(200)),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
