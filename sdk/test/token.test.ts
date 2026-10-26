/**
 * The universal token interface — pure unit tests (no compiler import). See
 * `token.compile.test.ts` for the real-compile / both-targets proof.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toFunctionSelector } from "viem";

import { Token } from "../src/token/api.js";
import { evmBalanceExpression } from "../src/token/evm.js";
import {
  MINT_DECIMALS_OFFSET,
  SPL_AMOUNT_OFFSET,
  SPL_APPROVE_CHECKED,
  SPL_TRANSFER_CHECKED,
} from "../src/token/types.js";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";
import { encodeFunctionData, erc20Abi } from "viem";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const TO = "0x2222222222222222222222222222222222222222" as const;
const SPENDER = "0x3333333333333333333333333333333333333333" as const;

describe("Token: SPL discriminants and offsets are pinned", () => {
  it("matches the shipped constants", () => {
    expect(SPL_TRANSFER_CHECKED).toBe(12);
    expect(SPL_APPROVE_CHECKED).toBe(13);
    expect(SPL_AMOUNT_OFFSET).toBe(64);
    expect(MINT_DECIMALS_OFFSET).toBe(44);
    expect(Token.SPL_TRANSFER_CHECKED).toBe(12);
    expect(Token.SPL_APPROVE_CHECKED).toBe(13);
  });
});

describe("Token: EVM source emission", () => {
  // The write goes out as raw calldata with a SafeERC20 check over the result, not as a typed
  // `IERC20` call -- see `token/safe.ts`. A literal argument is therefore encoded INTO the hex
  // rather than spelled as a SauceScript argument.
  it("transfer emits a checked raw call", () => {
    const src = Token.transfer({ token: TOKEN, to: TO, amount: 5n }).source("evm");
    const expected = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [TO, 5n],
    });

    expect(src).toContain(`hex\`${expected.slice(2)}\``);
    expect(src).toContain(`evm.call(${BigInt(TOKEN).toString()}n, 0,`);
    expect(src).toContain(`require(ctx.codeSize(${BigInt(TOKEN).toString()}n) > 0)`);
    expect(src).not.toContain(".transfer(");
  });

  it("approve emits a checked raw call, preceded by the forceApprove reset", () => {
    const src = Token.approve({ token: TOKEN, spender: SPENDER, amount: 7n }).source("v12");
    const expected = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [SPENDER, 7n],
    });

    expect(src).toContain(`hex\`${expected.slice(2)}\``);
    // The allowance read and the conditional reset that make this `forceApprove` rather than
    // `approve` -- the rule USDT enforces.
    expect(src).toContain("ctx.self()");
    expect(src).toContain("evm.static(");
    expect(src).toMatch(/if \(\w+cur > 0\) \{/);
    expect(src).not.toContain(".approve(");
  });

  it("balanceOf emits an expression, and Token.balanceOf({ owner: 'pot' }) reads the Pot's", () => {
    const expr = Token.balanceOf({ token: TOKEN, owner: "pot" }).expression("v1");
    expect(expr).toBe(`IERC20.at(${BigInt(TOKEN).toString()}n).balanceOf(ctx.self())`);
  });

  it("refuses owner 'self', naming 'pot', on every path", () => {
    const old = { token: TOKEN, owner: "self" } as unknown as Parameters<typeof Token.balanceOf>[0];
    const pot = /the Pot is "pot", not "self": write owner: "pot"/;
    expect(() => Token.balanceOf(old).expression("v1")).toThrow(pot);
    expect(() => Token.balanceOf(old).toCall()).toThrow(pot);
    expect(() => Token.balanceOf(old).toSauceScript("evm")).toThrow(pot);
    // The EVM arm's exported builder too, which skips the spec validation the TokenCall paths run.
    expect(() => evmBalanceExpression(old)).toThrow(pot);
  });

  it("amount: 'balance' binds a runtime balanceOf read for transfer/approve", () => {
    const src = Token.transfer({ token: TOKEN, to: TO, amount: "balance" }).statement("evm");
    expect(src).toContain(`IERC20.at(${BigInt(TOKEN).toString()}n).balanceOf(ctx.self())`);
  });

  it("statement() throws for balanceOf; expression() throws for transfer/approve", () => {
    expect(() => Token.balanceOf({ token: TOKEN, owner: "pot" }).statement("evm")).toThrow(
      /statement form/,
    );
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: 1n }).expression("evm")).toThrow(
      /expression form/,
    );
  });

  it("missing required EVM fields throw a named error", () => {
    expect(() => Token.transfer({ to: TO, amount: 1n }).source("evm")).toThrow(/token is required/);
    expect(() => Token.transfer({ token: TOKEN, amount: 1n }).source("evm")).toThrow(
      /to is required/,
    );
  });

  it("importLines de-dupes across a multi-op program (exactly one IERC20 line)", () => {
    const src = Token.program(
      [
        { op: "transfer", token: TOKEN, to: TO, amount: 1n },
        { op: "approve", token: TOKEN, spender: SPENDER, amount: 2n },
      ],
      { target: "evm" },
    );
    expect(src.match(/IERC20\.json/g)?.length).toBe(1);
  });
});

describe("Token: an unsafe number amount never reaches emitted source or calldata", () => {
  // 1234567890123456789 is past 2^53-1, so it arrives already rounded and the two ways of reading
  // it disagree: BigInt() gives 1234567890123456768n, .toString() gives "1234567890123456800".
  // The imprecise literal IS the input under test: it asserts the safe-integer guard
  // rejects it before anything reads a rounded value.
  // eslint-disable-next-line no-loss-of-precision
  const UNSAFE = 1234567890123456789;
  const LABEL = /Token\.(transfer|approve) amount: expected a safe integer/;

  it("transfer rejects it on every EVM surface", () => {
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: UNSAFE }).toCall()).toThrow(LABEL);
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: UNSAFE }).source("evm")).toThrow(
      LABEL,
    );
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: UNSAFE }).statement("v12")).toThrow(
      LABEL,
    );
  });

  it("approve rejects it on every EVM surface", () => {
    expect(() =>
      Token.approve({ token: TOKEN, spender: SPENDER, amount: UNSAFE }).toCall(),
    ).toThrow(LABEL);
    expect(() =>
      Token.approve({ token: TOKEN, spender: SPENDER, amount: UNSAFE }).source("evm"),
    ).toThrow(LABEL);
  });

  it("transfer rejects it on the SVM surface, where it is well under the u64 ceiling", () => {
    expect(() =>
      Token.transfer({
        amount: UNSAFE,
        svm: { source: "src0", mint: "mint0", dest: "dst0" },
      }).source("svm"),
    ).toThrow(LABEL);
  });

  it("a number amount at MAX_SAFE_INTEGER is still emitted and encoded exactly", () => {
    const spec = { token: TOKEN, to: TO, amount: Number.MAX_SAFE_INTEGER } as const;
    // The EVM arm encodes a literal into the calldata, so the check is that the bytes match the
    // bigint form's exactly -- which is the precision question, asked of the thing that ships.
    expect(Token.transfer(spec).source("evm")).toContain(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [TO, 9007199254740991n],
      }).slice(2),
    );
    expect(Token.transfer(spec).toCall().data).toBe(
      Token.transfer({ ...spec, amount: 9007199254740991n }).toCall().data,
    );
    expect(
      Token.transfer({
        amount: Number.MAX_SAFE_INTEGER,
        svm: { source: "src0", mint: "mint0", dest: "dst0" },
      }).source("svm"),
    ).toContain("9007199254740991n");
  });

  it("a non-integer number amount throws the integer message under the same label", () => {
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: 1.5 }).toCall()).toThrow(
      "Token.transfer amount: expected an integer, got 1.5",
    );
  });
});

describe("Token: EVM toCall() selectors are pinned against viem + drift-checked against IERC20.json", () => {
  const IERC20_ABI = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/artifacts/IERC20.json"), "utf-8"),
  ).abi as readonly { name: string; type: string }[];

  it("transfer/approve/balanceOf selectors match viem's own computation", () => {
    const t = Token.transfer({ token: TOKEN, to: TO, amount: 5n }).toCall();
    expect(t.target).toBe(TOKEN);
    expect(t.data.slice(0, 10)).toBe(toFunctionSelector("transfer(address,uint256)"));

    const a = Token.approve({ token: TOKEN, spender: SPENDER, amount: 5n }).toCall();
    expect(a.data.slice(0, 10)).toBe(toFunctionSelector("approve(address,uint256)"));
  });

  it("ERC20ABI (protocols/erc20) and the vendored IERC20.json agree on transfer/approve/balanceOf", () => {
    for (const name of ["transfer", "approve", "balanceOf"]) {
      const fromRegistry = ERC20ABI.find((f) => f.name === name);
      const fromArtifact = IERC20_ABI.find((f) => f.name === name);
      expect(fromRegistry).toBeDefined();
      expect(fromArtifact).toBeDefined();
    }
  });

  it("toCall() throws for amount: 'balance' and for balanceOf('pot') (no fixed calldata)", () => {
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: "balance" }).toCall()).toThrow(
      /no fixed calldata/,
    );
    expect(() => Token.balanceOf({ token: TOKEN, owner: "pot" }).toCall()).toThrow(
      /Token\.balanceOf\(\{ owner: "pot" \}\) has no fixed calldata/,
    );
  });

  it("balanceOf(explicit owner) has fixed calldata", () => {
    const b = Token.balanceOf({ token: TOKEN, owner: TO }).toCall();
    expect(b.data.slice(0, 10)).toBe(toFunctionSelector("balanceOf(address)"));
  });
});

describe("Token: SVM source emission", () => {
  const svmTransfer = {
    op: "transfer" as const,
    amount: 5n,
    svm: { source: "src0", mint: "mint0", dest: "dst0" },
  };
  const svmApprove = {
    op: "approve" as const,
    amount: 5n,
    svm: { source: "src0", mint: "mint0", delegate: "dlg0" },
  };
  const svmBalance = { op: "balanceOf" as const, svm: { source: "src0" } };

  it("transfer emits svm.sload/svm.call with TransferChecked (0x0c) over annotated Account params", () => {
    const src = Token.transfer(svmTransfer).source("svm");
    expect(src).toContain(
      "function main(tokenProgram: Account, mint0: Account, src0: Account<Writable>, dst0: Account<Writable>, owner: Account<Signer>): void {",
    );
    expect(src).toContain("svm.sload(mint0, 44, 1).toLe()");
    expect(src).toContain("const disc0 = hex`0c`;");
    expect(src).toContain("svm.call(tokenProgram, [src0, mint0, dst0, owner], data0);");
    // The CPI target is an attach slot now, so which program arrives is pinned explicitly.
    expect(src).toContain("require(tokenProgram == ");
    expect(src).not.toContain("function le8(x)");
    expect(src).not.toContain("accountData");
    expect(src).not.toContain("accountUint");
    expect(src).not.toContain("IERC20");
  });

  it("approve emits ApproveChecked (0x0d) and declares the delegate NON-writable", () => {
    const src = Token.approve(svmApprove).source("svm");
    expect(src).toContain("const disc0 = hex`0d`;");
    expect(src).toContain("dlg0: Account,");
    expect(src).not.toContain("dlg0: Account<Writable>");
  });

  it("balanceOf emits a pure svm.sload read, no CPI and no program pin", () => {
    const src = Token.balanceOf(svmBalance).source("svm");
    expect(src).toBe(
      [
        "",
        "function main(src0: Account) {",
        "  return svm.sload(src0, 64, 8).toLe();",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("accountRefs() returns the manifest attach order for transfer/approve", () => {
    expect(Token.transfer(svmTransfer).accountRefs()).toEqual([
      "tokenProgram",
      "mint0",
      "src0",
      "dst0",
      "owner",
    ]);
    expect(Token.approve(svmApprove).accountRefs()).toEqual([
      "tokenProgram",
      "mint0",
      "src0",
      "dlg0",
      "owner",
    ]);
  });

  it("missing svm refs throw a named error", () => {
    expect(() => Token.transfer({ amount: 1n }).source("svm")).toThrow(/svm refs are required/);
    expect(() =>
      Token.transfer({ amount: 1n, svm: { source: "s", dest: "d" } }).source("svm"),
    ).toThrow(/svm.mint is required/);
  });

  it("amount >= 2^64 is rejected on svm", () => {
    expect(() => Token.transfer({ amount: 2n ** 64n, svm: svmTransfer.svm }).source("svm")).toThrow(
      /u64/,
    );
  });

  it("the tokenProgram pin and its param appear exactly once across a multi-op program (dedup)", () => {
    const src = Token.program(
      [
        { op: "transfer", amount: 1n, svm: { source: "a", mint: "am", dest: "ad" } },
        { op: "transfer", amount: 2n, svm: { source: "b", mint: "bm", dest: "bd" } },
      ],
      { target: "svm" },
    );
    expect(src.match(/require\(tokenProgram == /g)?.length).toBe(1);
    expect(src.match(/tokenProgram: Account/g)?.length).toBe(1);
    // Both ops CPI through the one shared program slot.
    expect(src.match(/svm\.call\(tokenProgram, /g)?.length).toBe(2);
  });

  it("two specs pinning one tokenProgram ref to different programs are rejected", () => {
    expect(() =>
      Token.program(
        [
          {
            op: "transfer",
            amount: 1n,
            svm: { source: "a", mint: "am", dest: "ad" },
            tokenProgram: "spl",
          },
          {
            op: "transfer",
            amount: 2n,
            svm: { source: "b", mint: "bm", dest: "bd" },
            tokenProgram: "token-2022",
          },
        ],
        { target: "svm" },
      ),
    ).toThrow(/one ref is one attached account/);
  });

  it("two specs on the SAME program still share one pin and one param", () => {
    const src = Token.program(
      [
        {
          op: "transfer",
          amount: 1n,
          svm: { source: "a", mint: "am", dest: "ad" },
          tokenProgram: "token-2022",
        },
        {
          op: "transfer",
          amount: 2n,
          svm: { source: "b", mint: "bm", dest: "bd" },
          tokenProgram: "token-2022",
        },
      ],
      { target: "svm" },
    );
    expect(src.match(/require\(tokenProgram == /g)?.length).toBe(1);
    expect(src).toContain(`require(tokenProgram == ${Token.TOKEN_2022_PROGRAM.toString()}n);`);
  });

  it("duplicate instance refs across specs in one program are rejected", () => {
    expect(() =>
      Token.program(
        [
          { op: "transfer", amount: 1n, svm: { source: "same", mint: "m1", dest: "d1" } },
          { op: "transfer", amount: 2n, svm: { source: "same", mint: "m2", dest: "d2" } },
        ],
        { target: "svm" },
      ),
    ).toThrow(/reused across specs/);
  });

  it("tokenProgramValueExpr picks the pinned pubkey: 'token-2022' / a raw bigint", () => {
    const literalSpec = {
      op: "transfer" as const,
      amount: 1n,
      svm: svmTransfer.svm,
      tokenProgram: "token-2022" as const,
    };
    expect(Token.transfer(literalSpec).source("svm")).toContain(
      `require(tokenProgram == ${Token.TOKEN_2022_PROGRAM.toString()}n);`,
    );

    const rawSpec = {
      op: "transfer" as const,
      amount: 1n,
      svm: svmTransfer.svm,
      tokenProgram: 0x1234n,
    };
    expect(Token.transfer(rawSpec).source("svm")).toContain("require(tokenProgram == 4660n);");
  });

  it("toCall() rejects an svm-shaped spec with a named error", () => {
    expect(() => Token.transfer(svmTransfer).toCall()).toThrow(/SVM spec/);
  });

  it("accountRefs()/toSauceScript throw for an EVM-target spec (no AccountPlan there)", () => {
    const call = Token.transfer({ token: TOKEN, to: TO, amount: 1n });
    expect(() => call.accountRefs()).toThrow();
  });
});
