/**
 * `resolveSvmToken` and friends: one mint as a `@sauce/token` write takes it, resolved from its
 * account (no engine, no RPC — a loader over fixtures). Execution against the real Token-2022
 * program, including the fee netting, is in `test/std/token/svm-token-2022.e2e.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  resolveSvmToken,
  svmTokenAccount,
  svmTokenReceived,
  svmTokenToSend,
} from "../../src/svm/token-accounts.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../src/svm/token-program.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (file: string) =>
  JSON.parse(readFileSync(join(HERE, "fixtures/token-2022", file), "utf8"));
const PYUSD = fixture("real-mints.json").pyusd as { mint: string; dataBase64: string };
const TSLAX = fixture("stock-mints.json").mints.TSLAx as { mint: string; dataBase64: string };

const codec = getAddressCodec();
const someKey = (byte: number): Address => codec.decode(new Uint8Array(32).fill(byte));

/** A mint's 82-byte base: 6 decimals, initialized. */
const base = (): Uint8Array => {
  const data = new Uint8Array(82);
  data[44] = 6;
  data[45] = 1;
  return data;
};

/** A Token-2022 mint image carrying a TransferHook that names `program`. */
const hooked = (program: Address): Uint8Array => {
  const data = new Uint8Array(166 + 4 + 64);
  data.set(base(), 0);
  data[165] = 1;
  data.set([14, 0, 64, 0], 166);
  data.set(new Uint8Array(codec.encode(program)), 166 + 4 + 32);
  return data;
};

const loader =
  (accounts: Record<string, { data: Uint8Array; owner: Address }>): OwnedAccountLoader =>
  async (key) =>
    accounts[key] ?? null;

describe("resolveSvmToken", () => {
  const LEGACY = someKey(1);
  const BARE_2022 = someKey(2);
  const HOOKED = someKey(3);
  const ACCOUNT = someKey(4);
  const load = loader({
    [LEGACY]: { data: base(), owner: TOKEN_PROGRAM_ID },
    // 82 bytes either way: only the owner tells an extensionless Token-2022 mint from a legacy one.
    [BARE_2022]: { data: base(), owner: TOKEN_2022_PROGRAM_ID },
    [HOOKED]: { data: hooked(someKey(9)), owner: TOKEN_2022_PROGRAM_ID },
    [ACCOUNT]: { data: new Uint8Array(165).fill(1), owner: TOKEN_2022_PROGRAM_ID },
    [PYUSD.mint]: {
      data: Uint8Array.from(Buffer.from(PYUSD.dataBase64, "base64")),
      owner: TOKEN_2022_PROGRAM_ID,
    },
    [TSLAX.mint]: {
      data: Uint8Array.from(Buffer.from(TSLAX.dataBase64, "base64")),
      owner: TOKEN_2022_PROGRAM_ID,
    },
  });

  it("names each mint's token program by its owner", async () => {
    expect((await resolveSvmToken(load, LEGACY)).tokenProgram).toBe(TOKEN_PROGRAM_ID);
    expect((await resolveSvmToken(load, BARE_2022)).tokenProgram).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("reads PYUSD and a real stock mint: Token-2022, their decimals, nothing that refuses a transfer", async () => {
    const pyusd = await resolveSvmToken(load, address(PYUSD.mint));
    expect(pyusd).toMatchObject({ tokenProgram: TOKEN_2022_PROGRAM_ID, decimals: 6 });
    expect(pyusd.transferRefusals).toEqual([]);
    // A fee schedule at 0 basis points nets nothing either way.
    expect(svmTokenReceived(pyusd, 1_000_000n, 900n)).toBe(1_000_000n);
    expect(svmTokenToSend(pyusd, 1_000_000n, 900n)).toBe(1_000_000n);

    const stock = await resolveSvmToken(load, address(TSLAX.mint));
    expect(stock).toMatchObject({ tokenProgram: TOKEN_2022_PROGRAM_ID, decimals: 8 });
    expect(stock.transferRefusals).toEqual([]);
  });

  it("says why a checked transfer of a mint whose hook names a program is refused", async () => {
    const token = await resolveSvmToken(load, HOOKED);
    expect(token.transferRefusals).toEqual([
      `TransferHook names program ${someKey(9)}, whose extra accounts a checked transfer does not pass`,
    ]);
  });

  it("refuses an account that is not an initialized mint, and a missing one", async () => {
    await expect(resolveSvmToken(load, ACCOUNT)).rejects.toThrow("is not an initialized mint");
    await expect(resolveSvmToken(load, someKey(5))).rejects.toThrow("account not found");
  });

  it("derives a holder's account under the mint's own program", async () => {
    const owner = someKey(7);
    for (const mint of [LEGACY, BARE_2022]) {
      const token = await resolveSvmToken(load, mint);
      const [expected] = await findAssociatedTokenPda({
        owner,
        mint,
        tokenProgram: token.tokenProgram,
      });
      expect(await svmTokenAccount(token, owner)).toBe(expected);
    }
    // The two programs give the same holder different accounts for the same mint key.
    expect(await svmTokenAccount({ mint: LEGACY, tokenProgram: TOKEN_PROGRAM_ID }, owner)).not.toBe(
      await svmTokenAccount({ mint: LEGACY, tokenProgram: TOKEN_2022_PROGRAM_ID }, owner),
    );
  });
});
