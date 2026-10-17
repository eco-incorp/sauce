/**
 * What a wallet's policy measures of a Solana transaction that loads accounts through a lookup
 * table: the table read from the cluster, and, where it cannot be — the endpoint failing, or the
 * table gone — nothing measured, said so, rather than a guess, so a limit refuses it and nothing is
 * reserved. The measurement through a table that reads is `mcp/test/send.e2e.test.ts`'s wallet
 * plan, on LiteSVM.
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
  getCompiledTransactionMessageDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import { guardWallet, measureSvm, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import type { WalletInfo } from "../src/cli/wallets.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { buildCookInstruction } from "../src/svm/index.js";

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

describe("measuring a Kitchen cook", () => {
  const POT = address("7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2");
  const FEE_CONFIG = address("BPFLoaderUpgradeab1e11111111111111111111111");
  const BEFORE: Readonly<Record<string, bigint>> = { [WALLET]: 5_000_000_000n, [POT]: 1_000_000n };
  const AFTER: Readonly<Record<string, bigint>> = { [WALLET]: 5_000_000_000n, [POT]: 400_000n };
  const account = (lamports: bigint | undefined) =>
    lamports === undefined
      ? null
      : {
          lamports,
          owner: "11111111111111111111111111111111",
          data: ["", "base64"],
          executable: false,
        };

  // The Pot the cook names, as the Kitchen checks it at the bump the cook carries and signs for it:
  // not the one the salt derives at its canonical bump, which a cook passing another bump does not
  // run on.
  it("counts what leaves the Pot the cook names", async () => {
    const cook = buildCookInstruction({
      kitchen: address(v12SvmKitchenProgramId()),
      owner: WALLET,
      engineProgram: address(v12SvmEngineProgramId()),
      potSalt: new Uint8Array(32),
      pot: POT,
      potBump: 250,
      feeConfig: FEE_CONFIG,
      bytecode: new Uint8Array([0]),
      maxExecutionFee: 0n,
      tail: [{ address: POT, role: AccountRole.WRITABLE }],
    });
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
        (message) => appendTransactionMessageInstruction(cook, message),
      ),
    );
    const rpc = {
      getMultipleAccounts: (addresses: readonly string[]) => ({
        send: async () => ({ value: addresses.map((at) => account(BEFORE[at])) }),
      }),
      simulateTransaction: (
        _: string,
        options: { accounts: { addresses: readonly string[] } },
      ) => ({
        send: async () => ({
          value: {
            err: null,
            accounts: options.accounts.addresses.map((at) => account(AFTER[at])),
          },
        }),
      }),
    } as unknown as Parameters<typeof measureSvm>[0];

    const measured = await measureSvm(rpc, requireChain("solana"), WALLET, transaction);

    expect(String(measured.native.amount)).toBe("600000");
  });
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
