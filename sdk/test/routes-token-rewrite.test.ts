/**
 * ERC20 token member rewrite — `USDC.transfer(to, amount)` -> `IERC20.at(USDC).transfer(to, amount)`.
 */
import { compile } from "@eco-incorp/sauce-compiler";
import { rewriteTokenMembers } from "../src/routes/token-rewrite.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { TOKEN_BASE_DIRS } from "../src/token/source.js";

// Base USDC -- pinned fixture, matching src/verify/vectors.ts's own Base USDC constant.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x6666666666666666666666666666666666666666" as const;

function evmOptions() {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base" as const,
    creator: "0x3333333333333333333333333333333333333333" as const,
    prover: "0x4444444444444444444444444444444444444444" as const,
    rewardDeadline: 1000n,
  };
}

describe("rewriteTokenMembers", () => {
  it("USDC.transfer(to, amount) rewrites to IERC20.at(USDC).transfer(to, amount) and compiles byte-identically", () => {
    const source = `function main() { USDC.transfer(${TO}, 5n); }`;
    const { source: rewritten, rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(true);
    expect(rewritten).toContain(`IERC20.at(USDC).transfer(${TO}, 5n)`);

    const handWritten =
      `import { IERC20 } from "./artifacts/IERC20.json";\n` +
      `function main() { IERC20.at(${USDC}n).transfer(${TO}, 5n); }`;
    const withDefine = `import { IERC20 } from "./artifacts/IERC20.json";\n${rewritten}`;

    const a = compile(withDefine, { target: "v12", baseDirs: [...TOKEN_BASE_DIRS], defines: { USDC: BigInt(USDC) } });
    const b = compile(handWritten, { target: "v12", baseDirs: [...TOKEN_BASE_DIRS] });
    expect(Array.from(a.bytecode[0]!)).toEqual(Array.from(b.bytecode[0]!));
  });

  it("a local `let USDC = 1n;` suppresses the rewrite", () => {
    const source = `function main() { let USDC = 1n; USDC.transfer(${TO}, 5n); }`;
    const { rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(false);
  });

  it("an unknown symbol is left untouched", () => {
    const source = `function main() { NOTATOKEN.transfer(${TO}, 5n); }`;
    const { source: out, rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("balanceOf in expression position rewrites correctly", () => {
    const source = `function main() { return USDC.balanceOf(${TO}); }`;
    const { source: out, rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(true);
    expect(out).toContain(`IERC20.at(USDC).balanceOf(${TO})`);
  });

  it("no rewrite when the token symbol set is empty", () => {
    const source = `function main() { USDC.transfer(${TO}, 5n); }`;
    const { rewrote, source: out } = rewriteTokenMembers(source, new Set());
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("the emitted import line appears exactly once even for multiple token calls", () => {
    const source = `function main() { USDC.transfer(${TO}, 5n); USDC.approve(${TO}, 5n); }`;
    const { source: out } = rewriteTokenMembers(source, new Set(["USDC"]));
    const withImport = `import { IERC20 } from "./artifacts/IERC20.json";\n${out}`;
    const count = (withImport.match(/import \{ IERC20 \} from "\.\/artifacts\/IERC20\.json";/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("openRoute: token member rewrite end to end", () => {
  it("compiles USDC.transfer(...) with options.tokenDefines and produces one cook() call", () => {
    const built = openRoute(
      "ethereum",
      `USDC.transfer(${TO}, 5n);`,
      { ...evmOptions(), tokenDefines: { USDC } },
    ).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
  });

  it("an svm destination throws the named error", () => {
    expect(() =>
      openRoute(
        "solana",
        `USDC.transfer(${TO}, 5n);`,
        {
          execution: { buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
          deadline: 2000n,
          portal: PORTAL,
          source: "base",
          creator: "0x3333333333333333333333333333333333333333",
          prover: "0x4444444444444444444444444444444444444444",
          rewardDeadline: 1000n,
          tokenDefines: { USDC },
        },
      ),
    ).toThrow(/svm/i);
  });
});
