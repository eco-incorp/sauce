/**
 * E4.2 universal deposit/stake/wrap adapter — CONTRACT tests. Pure data assertions, no
 * compiler/forge/network.
 */
import { toFunctionSelector } from "viem";

import { PoolABI } from "../src/protocols/aave-v3/abis.js";
import { SparkPoolABI } from "../src/protocols/spark/abis.js";
import { CometABI } from "../src/protocols/compound-v3/abis.js";
import { EVaultABI } from "../src/protocols/euler-v2/abis.js";
import { VaultABI } from "../src/protocols/erc4626/abis.js";
import { WstETHABI, LidoABI } from "../src/protocols/lido/abis.js";

import {
  DEPOSIT_TEMPLATES,
  depositTemplateFor,
  listDepositTemplates,
  toDeposit,
} from "../src/deposit/index.js";
import { depositCallStatement, depositImportLines, depositSource } from "../src/deposit/source.js";
import type { DepositSpec } from "../src/deposit/index.js";

const TARGET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const BENEFICIARY = "0x3333333333333333333333333333333333333333" as const;

/** Rebuilds the canonical `name(type,type,...)` signature from a vendored as-const ABI array
 *  entry — mirrors `templates.ts`'s own hand-transcribed `signature` field so the two can be
 *  compared string-for-string. */
function signatureFromAbi(
  abi: readonly { name: string; inputs: readonly { type: string }[] }[],
  name: string,
): string {
  const entry = abi.find((e) => e.name === name);
  if (!entry) throw new Error(`signatureFromAbi: no entry named "${name}"`);
  return `${name}(${entry.inputs.map((i) => i.type).join(",")})`;
}

describe("registry drift — every ABI-backed template's signature/selector matches the vendored ABI", () => {
  const cases: {
    key: string;
    abi: readonly { name: string; inputs: readonly { type: string }[] }[];
    method: string;
  }[] = [
    { key: "aave-v3:supply", abi: PoolABI, method: "supply" },
    { key: "aave-v3:withdraw", abi: PoolABI, method: "withdraw" },
    { key: "spark:supply", abi: SparkPoolABI, method: "supply" },
    { key: "spark:withdraw", abi: SparkPoolABI, method: "withdraw" },
    { key: "compound-v3:supply", abi: CometABI, method: "supplyTo" },
    { key: "euler-v2:deposit", abi: EVaultABI, method: "deposit" },
    { key: "erc4626:deposit", abi: VaultABI, method: "deposit" },
    { key: "lido:wrap", abi: WstETHABI, method: "wrap" },
    { key: "lido:stake", abi: LidoABI, method: "submit" },
  ];

  for (const { key, abi, method } of cases) {
    it(`${key}`, () => {
      const template = DEPOSIT_TEMPLATES[key as keyof typeof DEPOSIT_TEMPLATES];
      const expectedSignature = signatureFromAbi(abi, method);
      expect(template.signature).toBe(expectedSignature);
      expect(template.selector).toBe(toFunctionSelector(`function ${expectedSignature}`));
    });
  }
});

describe("WETH selector pins (no vendored SDK ABI exists for WETH — see the module doc)", () => {
  it("weth:wrap uses deposit()'s real selector", () => {
    expect(DEPOSIT_TEMPLATES["weth:wrap"].selector).toBe(toFunctionSelector("function deposit()"));
  });
  it("weth:unwrap uses withdraw(uint256)'s real selector", () => {
    expect(DEPOSIT_TEMPLATES["weth:unwrap"].selector).toBe(
      toFunctionSelector("function withdraw(uint256)"),
    );
  });
});

describe("depositTemplateFor", () => {
  it("resolves a known protocol:action", () => {
    expect(depositTemplateFor("aave-v3", "supply")).toBe(DEPOSIT_TEMPLATES["aave-v3:supply"]);
  });
  it("throws, listing every registered key, for an unknown protocol:action", () => {
    expect(() => depositTemplateFor("nope", "supply")).toThrow(/no deposit template registered/);
    expect(() => depositTemplateFor("nope", "supply")).toThrow(/aave-v3:supply/);
  });
});

describe("listDepositTemplates", () => {
  it("returns all 11 registered templates", () => {
    expect(listDepositTemplates()).toHaveLength(11);
  });
});

function aaveSpec(overrides: Partial<DepositSpec> = {}): DepositSpec {
  return {
    protocol: "aave-v3",
    action: "supply",
    target: TARGET,
    token: TOKEN,
    amount: 1_000n,
    ...overrides,
  };
}

describe("toDeposit guards", () => {
  it("throws for an unknown protocol:action", () => {
    expect(() => toDeposit(aaveSpec({ protocol: "nope" }))).toThrow(
      /no deposit template registered/,
    );
  });

  it("requires token for an erc20-approve/none template", () => {
    expect(() => toDeposit(aaveSpec({ token: undefined }))).toThrow(/requires "token"/);
  });

  it("rejects token on a native-value template", () => {
    expect(() =>
      toDeposit({ protocol: "weth", action: "wrap", target: TARGET, token: TOKEN, amount: 1n }),
    ).toThrow(/native-value template.*token.*must be omitted/s);
  });

  it("rejects beneficiary on a beneficiary-unsupported template (weth:wrap)", () => {
    expect(() =>
      toDeposit({
        protocol: "weth",
        action: "wrap",
        target: TARGET,
        amount: 1n,
        beneficiary: BENEFICIARY,
      }),
    ).toThrow(/does not support a beneficiary/);
  });

  it("rejects beneficiary on weth:unwrap", () => {
    expect(() =>
      toDeposit({
        protocol: "weth",
        action: "unwrap",
        target: TARGET,
        amount: 1n,
        beneficiary: BENEFICIARY,
      }),
    ).toThrow(/does not support a beneficiary/);
  });

  it("rejects beneficiary on lido:stake", () => {
    expect(() =>
      toDeposit({
        protocol: "lido",
        action: "stake",
        target: TARGET,
        amount: 1n,
        beneficiary: BENEFICIARY,
      }),
    ).toThrow(/does not support a beneficiary/);
  });

  it("rejects amount 'max' on a template without allowsMaxAmount", () => {
    expect(() => toDeposit(aaveSpec({ amount: "max" }))).toThrow(
      /does not document a uint256-max sentinel/,
    );
  });

  it("accepts amount 'max' on aave-v3:withdraw (allowsMaxAmount: true)", () => {
    const normalized = toDeposit({
      protocol: "aave-v3",
      action: "withdraw",
      target: TARGET,
      token: TOKEN,
      amount: "max",
    });
    expect(normalized.amount).toBe("max");
  });

  it("rejects an unknown extra field", () => {
    expect(() => toDeposit(aaveSpec({ extra: { bogus: 1n } }))).toThrow(
      /has no extra field "bogus"/,
    );
  });

  it("rejects referralCode >= 65536", () => {
    expect(() => toDeposit(aaveSpec({ extra: { referralCode: 65_536n } }))).toThrow(
      /expected a uint16/,
    );
  });

  it("rejects an unsafe integer referralCode before the range check sees a rounded value", () => {
    // The imprecise literal IS the input under test: it asserts the safe-integer guard
    // rejects it before anything reads a rounded value.
    // eslint-disable-next-line no-loss-of-precision
    expect(() => toDeposit(aaveSpec({ extra: { referralCode: 1234567890123456789 } }))).toThrow(
      /referralCode: expected a safe integer/,
    );
  });

  it("rejects a non-integer referralCode with a labelled message", () => {
    expect(() => toDeposit(aaveSpec({ extra: { referralCode: 1.5 } }))).toThrow(
      /referralCode: expected an integer, got 1\.5/,
    );
  });

  it("rejects a non-integer number amount", () => {
    expect(() => toDeposit(aaveSpec({ amount: 1.5 }))).toThrow(
      /amount: expected an integer, got 1\.5/,
    );
  });

  it("accepts a number amount at Number.MAX_SAFE_INTEGER exactly", () => {
    expect(toDeposit(aaveSpec({ amount: Number.MAX_SAFE_INTEGER })).amount).toBe(9007199254740991n);
  });

  it("rejects an unsafe integer number amount instead of silently rounding it", () => {
    expect(() => toDeposit(aaveSpec({ amount: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(
      /amount: expected a safe integer, got 9007199254740992/,
    );
    expect(() => toDeposit(aaveSpec({ amount: 1e18 }))).toThrow(
      /amount: expected a safe integer, got 1000000000000000000/,
    );
  });

  it("defaults beneficiary to 'self' and referralCode to 0n", () => {
    const normalized = toDeposit(aaveSpec());
    expect(normalized.beneficiary).toBe("self");
    expect(normalized.extra.referralCode).toBe(0n);
  });
});

describe("emission shape — approvals", () => {
  it("emits an approve line by default (approvalPolicy 'exact')", () => {
    const stmt = depositCallStatement(aaveSpec());
    expect(stmt).toMatch(/IERC20\.at\(.*\)\.approve\(.*1000n\)/);
  });

  it("approvalPolicy 'none' emits no approve line", () => {
    const stmt = depositCallStatement(aaveSpec({ approvalPolicy: "none" }));
    expect(stmt).not.toMatch(/\.approve\(/);
  });

  it("approvalPolicy 'max' approves the uint256 max sentinel, not the deposit amount", () => {
    const stmt = depositCallStatement(aaveSpec({ approvalPolicy: "max" }));
    expect(stmt).toMatch(/\.approve\(.*2n \*\* 256n - 1n\)/);
  });

  it("a native-value template (weth:wrap) emits no approve at all", () => {
    const stmt = depositCallStatement({
      protocol: "weth",
      action: "wrap",
      target: TARGET,
      amount: 1_000n,
    });
    expect(stmt).not.toMatch(/\.approve\(/);
    expect(stmt).toMatch(/evm\.call\(/);
  });

  it("a 'none'-funded template (aave-v3:withdraw) emits no approve", () => {
    const stmt = depositCallStatement({
      protocol: "aave-v3",
      action: "withdraw",
      target: TARGET,
      token: TOKEN,
      amount: 1_000n,
    });
    expect(stmt).not.toMatch(/\.approve\(/);
  });

  it("amount 'balance' binds exactly one balanceOf read, reused by both approve and the call", () => {
    const stmt = depositCallStatement(aaveSpec({ amount: "balance" }));
    const balanceOfCount = (stmt.match(/balanceOf\(ctx\.self\(\)\)/g) ?? []).length;
    expect(balanceOfCount).toBe(1);
    expect(stmt).toMatch(/const depositAmt = IERC20\.at/);
    expect(stmt.match(/depositAmt/g)?.length).toBeGreaterThanOrEqual(3); // decl + approve + call
  });

  it("depositCallStatement rejects amount 'delta'", () => {
    expect(() =>
      depositCallStatement(
        aaveSpec({ amount: "delta" } as unknown as Partial<DepositSpec> as DepositSpec),
      ),
    ).toThrow(/only meaningful inside swapThenDepositSource/);
  });
});

describe("depositImportLines", () => {
  it("unions template imports across specs, de-duped", () => {
    const lines = depositImportLines([aaveSpec(), aaveSpec({ target: BENEFICIARY })]);
    const aaveImportCount = lines.filter((l) => l.includes("aave-v3/PoolABI.json")).length;
    expect(aaveImportCount).toBe(1);
  });

  it("includes IERC20 when an approve is needed", () => {
    const lines = depositImportLines([aaveSpec()]);
    expect(lines.some((l) => l.includes("IERC20.json"))).toBe(true);
  });

  it("omits IERC20 for a plain native-value deposit", () => {
    const lines = depositImportLines([
      { protocol: "weth", action: "wrap", target: TARGET, amount: 1n },
    ]);
    expect(lines.some((l) => l.includes("IERC20.json"))).toBe(false);
  });
});

describe("depositSource — a complete program", () => {
  it("produces a compilable-looking function body with import + call", () => {
    const src = depositSource(aaveSpec());
    expect(src).toContain('import { IAavePool } from "./protocols/aave-v3/PoolABI.json";');
    expect(src).toContain("function main() {");
    expect(src).toContain("IAavePool.at(");
  });
});
