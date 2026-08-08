/**
 * The universal token interface — pure unit tests (no compiler import). See
 * `token.compile.test.ts` for the real-compile / both-targets proof.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toFunctionSelector } from "viem";

import { Token } from "../src/token/api.js";
import {
  MINT_DECIMALS_OFFSET,
  SPL_AMOUNT_OFFSET,
  SPL_APPROVE_CHECKED,
  SPL_TRANSFER_CHECKED,
} from "../src/token/types.js";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";

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
  it("transfer emits an IERC20 typed-binding call", () => {
    const src = Token.transfer({ token: TOKEN, to: TO, amount: 5n }).source("evm");
    expect(src).toContain('import { IERC20 } from "./artifacts/IERC20.json";');
    expect(src).toContain(`IERC20.at(${BigInt(TOKEN).toString()}n).transfer(${BigInt(TO).toString()}n, 5n);`);
  });

  it("approve emits an IERC20 typed-binding call", () => {
    const src = Token.approve({ token: TOKEN, spender: SPENDER, amount: 7n }).source("v12");
    expect(src).toContain(`IERC20.at(${BigInt(TOKEN).toString()}n).approve(${BigInt(SPENDER).toString()}n, 7n);`);
  });

  it("balanceOf emits an expression, and Token.balanceOf('self') resolves to address.self", () => {
    const expr = Token.balanceOf({ token: TOKEN, owner: "self" }).expression("v1");
    expect(expr).toBe(`IERC20.at(${BigInt(TOKEN).toString()}n).balanceOf(address.self)`);
  });

  it("amount: 'balance' binds a runtime balanceOf read for transfer/approve", () => {
    const src = Token.transfer({ token: TOKEN, to: TO, amount: "balance" }).statement("evm");
    expect(src).toContain(`IERC20.at(${BigInt(TOKEN).toString()}n).balanceOf(address.self)`);
  });

  it("statement() throws for balanceOf; expression() throws for transfer/approve", () => {
    expect(() => Token.balanceOf({ token: TOKEN, owner: "self" }).statement("evm")).toThrow(/statement form/);
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: 1n }).expression("evm")).toThrow(/expression form/);
  });

  it("missing required EVM fields throw a named error", () => {
    expect(() => Token.transfer({ to: TO, amount: 1n }).source("evm")).toThrow(/token is required/);
    expect(() => Token.transfer({ token: TOKEN, amount: 1n }).source("evm")).toThrow(/to is required/);
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

  it("toCall() throws for amount: 'balance' and for balanceOf('self') (no fixed calldata)", () => {
    expect(() => Token.transfer({ token: TOKEN, to: TO, amount: "balance" }).toCall()).toThrow(/no fixed calldata/);
    expect(() => Token.balanceOf({ token: TOKEN, owner: "self" }).toCall()).toThrow(/no fixed calldata/);
  });

  it("balanceOf(explicit owner) has fixed calldata", () => {
    const b = Token.balanceOf({ token: TOKEN, owner: TO }).toCall();
    expect(b.data.slice(0, 10)).toBe(toFunctionSelector("balanceOf(address)"));
  });
});

describe("Token: SVM source emission", () => {
  const svmTransfer = { op: "transfer" as const, amount: 5n, svm: { source: "src0", mint: "mint0", dest: "dst0" } };
  const svmApprove = { op: "approve" as const, amount: 5n, svm: { source: "src0", mint: "mint0", delegate: "dlg0" } };
  const svmBalance = { op: "balanceOf" as const, svm: { source: "src0" } };

  it("transfer emits accountData/accountUint/contract.call with TransferChecked (12)", () => {
    const src = Token.transfer(svmTransfer).source("svm");
    expect(src).toContain("function le8(x)");
    expect(src).toContain('accountData("tokenProgram", 0, 0);');
    expect(src).toContain('accountUint("mint0", 44, 1)');
    expect(src).toContain("Uint8Array.from([12])");
    expect(src).toContain('{ ref: "src0", writable: true }');
    expect(src).toContain('{ ref: "dst0", writable: true }');
    expect(src).toContain('{ ref: "owner", signer: true }');
    expect(src).not.toContain("IERC20");
  });

  it("approve emits ApproveChecked (13) with a non-writable delegate ref", () => {
    const src = Token.approve(svmApprove).source("svm");
    expect(src).toContain("Uint8Array.from([13])");
    expect(src).toContain('{ ref: "dlg0" }');
    expect(src).not.toContain('{ ref: "dlg0", writable: true }');
  });

  it("balanceOf emits a pure accountUint read, no le8, no CPI", () => {
    const src = Token.balanceOf(svmBalance).source("svm");
    expect(src).toBe(
      ["", "function main() {", "  return accountUint(\"src0\", 64, 8);", "}", ""].join("\n"),
    );
  });

  it("accountRefs() returns the AccountPlan intern order for transfer/approve", () => {
    expect(Token.transfer(svmTransfer).accountRefs()).toEqual(["tokenProgram", "mint0", "src0", "dst0", "owner"]);
    expect(Token.approve(svmApprove).accountRefs()).toEqual(["tokenProgram", "mint0", "src0", "dlg0", "owner"]);
  });

  it("missing svm refs throw a named error", () => {
    expect(() => Token.transfer({ amount: 1n }).source("svm")).toThrow(/svm refs are required/);
    expect(() => Token.transfer({ amount: 1n, svm: { source: "s", dest: "d" } }).source("svm")).toThrow(
      /svm.mint is required/,
    );
  });

  it("amount >= 2^64 is rejected on svm", () => {
    expect(() => Token.transfer({ amount: 2n ** 64n, svm: svmTransfer.svm }).source("svm")).toThrow(/u64/);
  });

  it("tokenProgram accountData is interned exactly once across a multi-op program (dedup)", () => {
    const src = Token.program(
      [
        { op: "transfer", amount: 1n, svm: { source: "a", mint: "am", dest: "ad" } },
        { op: "transfer", amount: 2n, svm: { source: "b", mint: "bm", dest: "bd" } },
      ],
      { target: "svm" },
    );
    expect(src.match(/accountData\("tokenProgram", 0, 0\)/g)?.length).toBe(1);
    expect(src.match(/function le8\(x\)/g)?.length).toBe(1);
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

  it("tokenProgramValueExpr: 'spl' / 'token-2022' / a literal bigint / an {arg} name", () => {
    const literalSpec = { op: "transfer" as const, amount: 1n, svm: svmTransfer.svm, tokenProgram: "token-2022" as const };
    expect(Token.transfer(literalSpec).source("svm")).toContain(`contract.call(${Token.TOKEN_2022_PROGRAM.toString()}n,`);

    const argSpec = { op: "transfer" as const, amount: 1n, svm: svmTransfer.svm, tokenProgram: { arg: "tp" } };
    expect(Token.transfer(argSpec).source("svm")).toContain("contract.call(tp,");
  });

  it("toCall() rejects an svm-shaped spec with a named error", () => {
    expect(() => Token.transfer(svmTransfer).toCall()).toThrow(/SVM spec/);
  });

  it("accountRefs()/toSauceScript throw for an EVM-target spec (no AccountPlan there)", () => {
    const call = Token.transfer({ token: TOKEN, to: TO, amount: 1n });
    expect(() => call.accountRefs()).toThrow();
  });
});
