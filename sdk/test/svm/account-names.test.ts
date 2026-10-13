/**
 * The language an account of a Solana cook is named in (`svm/account-names.ts`): what `--account`
 * takes, and what the SDK writes for the accounts it adds to a program. Each name resolved against a
 * cook, with no cluster: a registered mint's program is the registry's.
 */
import { address, getAddressCodec, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import { svmTokenRows } from "../../src/routes/token-registry.js";
import {
  isSvmAccountName,
  resolveSvmAccountName,
  SvmAccountNameError,
  type SvmAccountNameContext,
} from "../../src/svm/account-names.js";
import { svmTokenAccount } from "../../src/svm/token-accounts.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../src/svm/token-program.js";

const SOLANA = requireChain("solana");
const key = (byte: number): Address => getAddressCodec().decode(new Uint8Array(32).fill(byte));
const OWNER = key(1);
const POT = key(2);
const TO = key(3);
const MINT = key(4);
const row = (symbol: string) => svmTokenRows(SOLANA).find((one) => one.symbol === symbol)!;
const USDC = address(row("USDC").mint);
const PYUSD = address(row("PYUSD").mint);

const ctx = (more: Partial<SvmAccountNameContext> = {}): SvmAccountNameContext => ({
  chain: SOLANA,
  owner: OWNER,
  pot: POT,
  args: { to: TO, mint: MINT },
  ...more,
});

describe("svm account names", () => {
  it("pot, owner and self keep their roles; self is the Pot, or the owner cooked directly", async () => {
    expect(await resolveSvmAccountName("pot", ctx())).toEqual({ value: "pot", kind: "pot" });
    expect(await resolveSvmAccountName("owner", ctx())).toEqual({ value: "owner", kind: "owner" });
    expect(await resolveSvmAccountName("self", ctx())).toEqual({ value: "pot", kind: "pot" });
    expect(await resolveSvmAccountName("self", ctx({ via: "engine" }))).toEqual({
      value: "owner",
      kind: "owner",
    });
  });

  it("an address is itself, and @<param> main's argument", async () => {
    expect(await resolveSvmAccountName(TO, ctx())).toEqual({ value: TO, kind: "address" });
    expect(await resolveSvmAccountName("@to", ctx())).toEqual({
      value: TO,
      label: "main's argument to",
      kind: "address",
    });
  });

  it("a holder's token account, under the program that owns the mint", async () => {
    expect(await resolveSvmAccountName("self:USDC", ctx())).toEqual({
      value: await svmTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM_ID }, POT),
      label: "the Pot's USDC account",
      kind: "account",
      account: { mint: USDC, holder: POT, program: TOKEN_PROGRAM_ID },
    });
    expect(await resolveSvmAccountName("@to:PYUSD", ctx())).toMatchObject({
      value: await svmTokenAccount({ mint: PYUSD, tokenProgram: TOKEN_2022_PROGRAM_ID }, TO),
      label: "main's argument to's PYUSD account",
      account: { holder: TO, program: TOKEN_2022_PROGRAM_ID },
    });
    expect(await resolveSvmAccountName("self:usdc", ctx({ via: "engine" }))).toMatchObject({
      label: "the owner's USDC account",
      account: { holder: OWNER },
    });
    // A mint the chain does not register: its program from `programOf`, the cluster's to read.
    const asked: Address[] = [];
    const programOf = async (mint: Address) => {
      asked.push(mint);

      return TOKEN_2022_PROGRAM_ID;
    };
    expect(await resolveSvmAccountName("@to:@mint", ctx({ programOf }))).toMatchObject({
      label: `main's argument to's mint ${MINT} account`,
      account: { mint: MINT, holder: TO, program: TOKEN_2022_PROGRAM_ID },
    });
    expect(asked).toEqual([MINT]);
  });

  it("a mint, and its token program", async () => {
    expect(await resolveSvmAccountName("mint:PYUSD", ctx())).toEqual({
      value: PYUSD,
      label: "the PYUSD mint",
      kind: "mint",
    });
    expect(await resolveSvmAccountName("program:PYUSD", ctx())).toEqual({
      value: TOKEN_2022_PROGRAM_ID,
      label: "PYUSD's token program, Token-2022",
      kind: "program",
    });
    expect(await resolveSvmAccountName(`program:${TO}`, ctx())).toMatchObject({
      value: TOKEN_PROGRAM_ID,
    });
  });

  it("refuses what it cannot resolve, saying why", async () => {
    await expect(resolveSvmAccountName("pot:USDC", ctx({ via: "engine" }))).rejects.toThrow(
      "--via engine cooks with no Pot, so there is no Pot's token account to pass",
    );
    await expect(resolveSvmAccountName("@from:USDC", ctx())).rejects.toThrow(
      "the account is derived from main's argument `from`, which was not given",
    );
    await expect(resolveSvmAccountName("pot:USDX", ctx())).rejects.toThrow(
      "USDX is not a mint solana registers (PYUSD, USDC, USDT, WSOL, and ",
    );
    await expect(resolveSvmAccountName("pot:", ctx())).rejects.toBeInstanceOf(SvmAccountNameError);
  });

  it("knows its own language", () => {
    for (const name of [
      "pot",
      "self",
      "@to",
      TO,
      "self:USDC",
      "@to:@mint",
      `${TO}:USDC`,
      "mint:@m",
    ]) {
      expect(isSvmAccountName(name)).toBe(true);
    }
    for (const name of ["", "pot:", "me", "@", "@1x", "pot:US-DC", "self:USDC:x"]) {
      expect(isSvmAccountName(name)).toBe(false);
    }
  });
});
