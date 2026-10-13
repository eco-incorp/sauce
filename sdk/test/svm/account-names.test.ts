/**
 * The language an account of a Solana cook is named in (`svm/account-names.ts`): what `--account`
 * takes, and what the SDK writes for the accounts it adds to a program. Each name resolved against a
 * cook, with no cluster: a registered mint's program is the registry's.
 */
import { address, getAddressCodec, getProgramDerivedAddress, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import { v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { derivePotPda } from "../../src/svm/kitchen.js";
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

  it("an address is itself, @<param> main's argument, and system the System Program", async () => {
    expect(await resolveSvmAccountName(TO, ctx())).toEqual({ value: TO, kind: "address" });
    expect(await resolveSvmAccountName("system", ctx())).toEqual({
      value: "11111111111111111111111111111111",
      kind: "address",
    });
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
    // A mint the chain does not register: its program read through `programOf`, and only that.
    const asked: Address[] = [];
    const programOf = async (mint: Address) => {
      asked.push(mint);

      return TOKEN_2022_PROGRAM_ID;
    };
    expect(await resolveSvmAccountName("program:@mint", ctx({ programOf }))).toEqual({
      value: TOKEN_2022_PROGRAM_ID,
      label: `mint ${MINT}'s token program, Token-2022`,
      kind: "program",
    });
    expect(asked).toEqual([MINT]);
  });

  it("fails closed on an unregistered mint's program: never assumes SPL Token", async () => {
    for (const name of [`program:${TO}`, "pot:@mint"]) {
      await expect(resolveSvmAccountName(name, ctx())).rejects.toThrow(
        "its token program can only be read from the cluster",
      );
    }
    await expect(
      resolveSvmAccountName(
        "program:@mint",
        ctx({
          programOf: async () => {
            throw new Error("the endpoint did not answer");
          },
        }),
      ),
    ).rejects.toThrow(
      `the token program of mint ${MINT} could not be read: the endpoint did not answer`,
    );
    await expect(
      resolveSvmAccountName("@to:@mint", ctx({ programOf: async () => key(7) })),
    ).rejects.toThrow(`mint ${MINT} is owned by ${key(7)}, neither SPL Token nor Token-2022`);
  });

  it("a program-derived address from its program and seeds", async () => {
    const kitchen = address(v12SvmKitchenProgramId());
    // The Pot itself is the Kitchen's address for "pot", its owner and the salt.
    const salt = `0x${"00".repeat(32)}`;
    const pot = (await derivePotPda(kitchen, OWNER, new Uint8Array(32))).address;
    expect(await resolveSvmAccountName(`pda:${kitchen}:"pot",owner,${salt}`, ctx())).toEqual({
      value: pot,
      label: `the address ${kitchen} derives for "pot",owner,${salt}`,
      kind: "address",
    });
    // Every kind of seed, against the derivation by hand.
    const program = key(9);
    const encode = (k: Address) => getAddressCodec().encode(k);
    const u64 = new Uint8Array(8);
    new DataView(u64.buffer).setBigUint64(0, 300n, true);
    const [byHand] = await getProgramDerivedAddress({
      programAddress: program,
      seeds: [
        new TextEncoder().encode("vault"),
        new TextEncoder().encode("pot"),
        encode(POT),
        encode(TO),
        encode(USDC),
        new Uint8Array([7]),
        u64,
        new Uint8Array([0xde, 0xad]),
      ],
    });
    expect(
      (
        await resolveSvmAccountName(
          `pda:${program}:vault,"pot",self,@to,mint:USDC,u8:7,u64:@index,0xdead`,
          ctx({ integers: { index: 300n } }),
        )
      ).value,
    ).toBe(byHand);
    // The program may be main's argument too.
    expect((await resolveSvmAccountName("pda:@to:vault", ctx())).value).toBe(
      (await getProgramDerivedAddress({ programAddress: TO, seeds: ["vault"] }))[0],
    );
  });

  it("refuses a seed it cannot make", async () => {
    await expect(resolveSvmAccountName(`pda:${TO}:u8:300`, ctx())).rejects.toThrow(
      "seed u8:300 does not fit 1 byte",
    );
    await expect(resolveSvmAccountName(`pda:${TO}:u64:@n`, ctx())).rejects.toThrow(
      "main's argument `n`, which was not given",
    );
    await expect(resolveSvmAccountName(`pda:${TO}:${"a".repeat(33)}`, ctx())).rejects.toThrow(
      "is 33 bytes; a seed is at most 32",
    );
  });

  it("refuses the System Program as a token's holder, by name", async () => {
    await expect(resolveSvmAccountName("system:USDC", ctx())).rejects.toThrow(
      "system:USDC: system is the System Program, which holds no token account: name the " +
        "holder, pot, owner, self, @<argument> or a base58 key",
    );
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
      "system",
      "@to",
      TO,
      "self:USDC",
      "@to:@mint",
      `${TO}:USDC`,
      "mint:@m",
      `pda:${TO}:vault,@to,u64:7`,
    ]) {
      expect(isSvmAccountName(name)).toBe(true);
    }
    for (const name of [
      "",
      "pot:",
      "me",
      "@",
      "@1x",
      "pot:US-DC",
      "self:USDC:x",
      "system:USDC",
      "pda:",
      `pda:${TO}`,
      "pda:x:y",
    ]) {
      expect(isSvmAccountName(name)).toBe(false);
    }
  });
});
