/**
 * `Chain(() => { ... }).reward({ ... })` written inside a Sauce program.
 *
 * The property under test is not "does it compile" — it is **which values end up where**. A capture
 * is a local of the enclosing program, so it cannot be in the encoded intent; it is a sentinel that
 * the program splices over at run time. A define is known when the intent is built and is baked in.
 * Getting those two backwards produces an intent that compiles, publishes, and carries a number
 * nobody chose, which is why every case below asserts on the bytes rather than on acceptance.
 *
 * `routes-intent-sugar.e2e.test.ts` runs the result against a real Portal.
 */
import { decodeFunctionData, erc20Abi, toFunctionSelector, type AbiFunction, type Hex } from "viem";

import { compileProgram as compile } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { rewriteIntentSugar } from "../src/routes/intent-sugar.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { v12Kitchen } from "../src/evm/engine.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const SOLANA = requireChain("solana");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const RECIPIENT_ADDRESS = "0x9999999999999999999999999999999999999999" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    source: BASE,
    chains: new Map([
      ["Arbitrum", ARBITRUM],
      ["Base", BASE],
    ]),
    definesFor: () =>
      new Map([
        ["USDC", 0x7777777777777777777777777777777777777777n],
        ["RECIPIENT", RECIPIENT],
      ]),
    portalOf: (chain: typeof BASE) => ecoRoutesPortal(chain),
    proverFor: (from: typeof BASE, to: typeof BASE) => ecoRoutesProver(from, to),
    defaults: { deadline: 4_000_000_000n, creator: CREATOR },
    // A body that needs a program gets one from here; the unit suite only checks that the lowering
    // reaches it and splices its sentinels. `routes-nest-dynamic.e2e.test.ts` runs a real one.
    compileChild: (_chain: unknown, _source: string, captures: readonly string[]) => ({
      call: {
        target: "0x4444444444444444444444444444444444444444",
        // Each sentinel as the 32-byte left-padded word a real compact-v1 argument tail carries.
        data: `0x${"cd".repeat(4)}${captures
          .map(
            (_, i) =>
              `${"00".repeat(12)}5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`,
          )
          .join("")}`,
        value: 1000n,
      },
      captureSentinels: captures.map((_, i) =>
        BigInt(`0x5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`),
      ),
    }),
    ...overrides,
  }) as never;

const program = (body: string) => `function main() {\n  const amount = 5n;\n${body}\n}`;

const TRANSFER_INTENT = program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);

describe("a token symbol resolves against the chain the calls run on", () => {
  it("uses the DESTINATION's registry, not the enclosing program's", () => {
    const perChain = new Map([
      [BASE.slug, 0x1111111111111111111111111111111111111111n],
      [ARBITRUM.slug, 0x2222222222222222222222222222222222222222n],
    ]);
    const result = rewriteIntentSugar(
      TRANSFER_INTENT,
      context({
        definesFor: (chain: typeof BASE) =>
          new Map([
            ["USDC", perChain.get(chain.slug)!],
            ["RECIPIENT", RECIPIENT],
          ]),
      }),
    );

    // Arbitrum's USDC, because the transfer executes on Arbitrum. Resolving it against Base would
    // put a Base address in an Arbitrum route -- most likely not a token at all.
    expect(denormalizeToEvm(result.intents[0]!.intent.route.calls[0]!.target).toLowerCase()).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });
});

describe("what the lowering produces", () => {
  it("captures the enclosing local once and splices it everywhere it appears", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());

    expect(result.rewrote).toBe(true);
    expect(result.intents).toHaveLength(1);
    // ONE capture, not three: `amount` is the route token amount, the reward amount and the
    // transfer argument, and all three are the same runtime value.
    expect(result.intents[0]!.captures).toEqual(["amount"]);
    // Two splices of that one local: the transfer's amount argument, and the reward. The route's
    // delivery reuses the SAME sentinel rather than a third, since it is the same variable.
    const concat = result.source.split("\n").find((line) => line.includes("_data ="))!;
    expect(concat.match(/amount\.toBytesBe\(32\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("bakes a compile-time define in, rather than capturing it", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());
    const call = result.intents[0]!.intent.route.calls[0]!;
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });

    expect(decoded.functionName).toBe("transfer");
    // The recipient is the define's value; only the amount is a sentinel.
    expect(BigInt(decoded.args![0] as Hex)).toBe(RECIPIENT);
    expect(result.intents[0]!.captures).not.toContain("RECIPIENT");
  });

  // The Executor runs these calls raw, and USDT refuses to move a non-zero allowance to another
  // non-zero value. One Executor runs every intent on a chain, so the approve is reset to zero first.
  // What that does on a chain is `routes-nest-dynamic.e2e.test.ts`'s "token-only intent bodies".
  describe("a token-only approve is reset to zero first", () => {
    const approveIntent = (spender: string, amount: string) =>
      program(`  Arbitrum(() => {
    USDC.approve(${spender}, ${amount});
  }).reward({ tokens: [{ token: USDC, amount }] });`);
    const callsOf = (source: string) =>
      rewriteIntentSugar(source, context()).intents[0]!.intent.route.calls.map((call) => {
        const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
        return [functionName, BigInt(args![0] as Hex), args![1]];
      });

    it("emits approve(spender, 0) before approve(spender, amount)", () => {
      expect(callsOf(approveIntent("RECIPIENT", "7n"))).toEqual([
        ["approve", RECIPIENT, 0n],
        ["approve", RECIPIENT, 7n],
      ]);
    });

    it("needs no reset to approve zero", () => {
      expect(callsOf(approveIntent("RECIPIENT", "0n"))).toEqual([["approve", RECIPIENT, 0n]]);
    });

    it("resets before a captured amount, whose value is unknown when the intent is built", () => {
      const calls = callsOf(approveIntent("RECIPIENT", "amount"));
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(["approve", RECIPIENT, 0n]);
      expect(calls[1]![2]).not.toBe(0n);
    });

    it("splices a captured spender into both calls", () => {
      const result = rewriteIntentSugar(approveIntent("amount", "7n"), context());
      const concat = result.source.split("\n").find((line) => line.includes("_data ="))!;
      // Both approves' spender, plus the reward amount.
      expect(concat.match(/amount\.toBytesBe\(32\)/g)!.length).toBeGreaterThanOrEqual(3);
    });

    it("leaves a transfer one call", () => {
      expect(callsOf(TRANSFER_INTENT).map(([name]) => name)).toEqual(["transfer"]);
    });
  });

  describe("a top-level `const` of a literal is baked in, as a define is", () => {
    // Known when the file is compiled, so nothing is spliced at run time and the intent is fixed:
    // `sauce intent publish` can build it from a wallet.
    const site = `Arbitrum(() => {
    USDC.transfer(RECIPIENT, AMOUNT);
  }).reward({ tokens: [{ token: USDC, amount: AMOUNT }] });`;
    const amountsOf = (source: string, overrides: Record<string, unknown> = {}) => {
      const [lowered] = rewriteIntentSugar(source, context(overrides)).intents;
      const call = decodeFunctionData({
        abi: erc20Abi,
        data: lowered!.intent.route.calls[0]!.data,
      });
      return {
        captures: lowered!.captures,
        transfer: call.args![1],
        delivered: lowered!.intent.route.tokens[0]!.amount,
        reward: lowered!.intent.reward.tokens[0]!.amount,
      };
    };
    const fixed = { captures: [], transfer: 7n, delivered: 7n, reward: 7n };

    it("in a module", () => {
      expect(amountsOf(`const AMOUNT = 7n;\nfunction main() {\n  ${site}\n}`)).toEqual(fixed);
    });

    it("in a script, where the other top-level statements are the entry", () => {
      expect(amountsOf(`const AMOUNT = 7n;\n${site}`)).toEqual(fixed);
    });

    it("but not where a local of the opening function shadows it", () => {
      const source = `const AMOUNT = 7n;\nfunction main() {\n  const AMOUNT = USDC.balanceOf(ctx.self());\n  ${site}\n}`;
      expect(amountsOf(source).captures).toEqual(["AMOUNT"]);
    });

    it("and a define of the same name replaces it, as it does in the compiler", () => {
      const definesFor = () =>
        new Map([
          ["USDC", 0x7777777777777777777777777777777777777777n],
          ["RECIPIENT", RECIPIENT],
          ["AMOUNT", 9n],
        ]);
      expect(
        amountsOf(`const AMOUNT = 7n;\nfunction main() {\n  ${site}\n}`, { definesFor }),
      ).toEqual({ captures: [], transfer: 9n, delivered: 9n, reward: 9n });
    });

    it("while a computed `const` is still a value of the program", () => {
      expect(amountsOf(`const AMOUNT = 7n * 1n;\n${site}`).captures).toEqual(["AMOUNT"]);
    });
  });

  // SauceScript writes an integer plainly, and the parser's `number` for one past 2^53 is a rounded
  // float: a literal is read from its text, as the compiler reads it, and is the integer its `n`
  // spelling is.
  describe("a plain integer is exact past 2^53, as its `n` spelling is", () => {
    const WEI = 1_000_000_000_000_000_000_001n; // 1e21 + 1: no float holds it
    const lowered = (amount: string, recipient: string, top = "") =>
      rewriteIntentSugar(
        `${top}function main() {\n  Arbitrum(() => {\n    USDC.transfer(${recipient}, ${amount});\n` +
          `  }).reward({ tokens: [{ token: USDC, amount: ${amount} }] });\n}`,
        context(),
      ).intents[0]!;

    it("an amount and an address, in the body and the reward", () => {
      const plain = lowered("1000000000000000000001", RECIPIENT_ADDRESS);
      const call = decodeFunctionData({ abi: erc20Abi, data: plain.intent.route.calls[0]!.data });

      expect(call.args).toEqual([RECIPIENT_ADDRESS, WEI]);
      expect(plain.intent.route.tokens[0]!.amount).toBe(WEI);
      expect(plain.intent.reward.tokens[0]!.amount).toBe(WEI);
      expect(plain.intent).toEqual(
        lowered("1000000000000000000001n", `${RECIPIENT_ADDRESS}n`).intent,
      );
    });

    it("with separators, and in hex", () => {
      const expected = lowered("1000000000000000000001n", RECIPIENT_ADDRESS).intent;

      expect(lowered("1_000_000_000_000_000_000_001", RECIPIENT_ADDRESS).intent).toEqual(expected);
      expect(lowered("0x3635c9adc5dea00001", RECIPIENT_ADDRESS).intent).toEqual(expected);
    });

    it("as a top-level `const`, baked in", () => {
      const baked = lowered(
        "AMOUNT",
        RECIPIENT_ADDRESS,
        "const AMOUNT = 1000000000000000000001;\n",
      );

      expect(baked.captures).toEqual([]);
      expect(baked.intent.reward.tokens[0]!.amount).toBe(WEI);
    });
  });

  it("fills the Portal, the prover and the destination from the registry", () => {
    const { intent, destination } = rewriteIntentSugar(TRANSFER_INTENT, context()).intents[0]!;

    expect(destination.slug).toBe("arbitrum");
    expect(intent.destination).toBe(BigInt(ARBITRUM.id));
    expect(intent.sourceChainId).toBe(BigInt(BASE.id));
    expect(denormalizeToEvm(intent.route.portal).toLowerCase()).toBe(
      ecoRoutesPortal("arbitrum").toLowerCase(),
    );
    expect(denormalizeToEvm(intent.reward.prover).toLowerCase()).toBe(
      ecoRoutesProver("base", "arbitrum").toLowerCase(),
    );
  });

  describe("funds the reward by transfer to its vault, then publishes — the default", () => {
    const portal = ecoRoutesPortal("base").slice(2).toLowerCase();
    const selector = (name: string) =>
      toFunctionSelector(
        PortalABI.find((item) => item.type === "function" && item.name === name) as AbiFunction,
      ).slice(2);
    const linesOf = (source: string) => source.split("\n").map((line) => line.trim());

    it("reads the vault from the Portal over the bytes it publishes, and approves nothing", () => {
      const result = rewriteIntentSugar(TRANSFER_INTENT, context());
      const lines = linesOf(result.source);

      expect(result.intents[0]!.fundVia).toBe("transfer");
      // The payload is `publish`'s, and the vault query is that payload under the other selector:
      // one copy of the intent, so the vault read and the published intent cannot differ.
      expect(lines.find((line) => line.startsWith("const i0_s0 ="))).toContain(selector("publish"));
      expect(lines).toContain(`const i0_vsel = hex\`${selector("intentVaultAddress")}\`;`);
      expect(lines).toContain("const i0_vq = i0_vsel.concat(i0_data.slice(4n, i0_data.length));");
      expect(lines).toContain(
        `const [i0_vault] = abi.decode(evm.static(${BigInt(`0x${portal}`)}n, i0_vq), ["Address"]);`,
      );
      // No approval of anything: nothing for USDT to refuse, no allowance left on the shared Pot.
      expect(result.source).not.toContain("095ea7b3");
      expect(result.source).not.toContain(selector("publishAndFund"));
      // The publish is last, after the transfer, and sends no value.
      expect(lines.filter((line) => line.includes("evm.call(")).at(-1)).toBe(
        `evm.call(${BigInt(`0x${portal}`)}n, 0n, i0_data);`,
      );
    });

    it("transfers the captured reward to that vault with SafeERC20 semantics", () => {
      const lines = linesOf(rewriteIntentSugar(TRANSFER_INTENT, context()).source);
      const transfer = lines.find((line) => line.startsWith("const i0_f0_tr0 ="))!;

      expect(transfer).toContain("a9059cbb");
      // The vault and the amount are run-time words, spliced in that order.
      const call = lines.find((line) => line.includes("evm.call(") && line.includes("i0_f0_"))!;
      expect(call).toContain("i0_vault.toBytesBe(32)");
      expect(call).toContain("amount.toBytesBe(32)");
      // A captured zero transfers nothing; the call and its check sit behind the guard.
      expect(call.startsWith("if (amount > 0n) {")).toBe(true);
      expect(call).toContain("ctx.codeSize(");
    });

    it("sends a native reward to the vault, and only a literal one unguarded", () => {
      const literal = rewriteIntentSugar(
        program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ nativeAmount: 9n });`),
        context(),
      );
      expect(linesOf(literal.source)).toContain("evm.call(i0_vault, 9n, i0_fnd);");

      const captured = rewriteIntentSugar(
        program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount: 3n }], nativeAmount: amount });`),
        context(),
      );
      const lines = linesOf(captured.source);
      expect(lines).toContain("if (amount > 0n) { evm.call(i0_vault, amount, i0_fnd); }");
      // A literal token amount needs no guard.
      expect(lines.some((line) => line.startsWith("const i0_f0_tr = evm.call("))).toBe(true);
    });

    it("pays a token listed twice once, for the larger amount", () => {
      const result = rewriteIntentSugar(
        program(`  const more = 9n;
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }, { token: USDC, amount: more }, { token: USDC, amount: 4n }] });`),
        context(),
      );
      const lines = linesOf(result.source);

      // One transfer to the vault (the other `a9059cbb` is the route's own call, inside the intent).
      expect(
        lines.filter((line) => line.startsWith("const i0_f") && line.includes("a9059cbb")),
      ).toHaveLength(1);
      expect(lines).toContain("const i0_f0m0 = amount > more ? amount : more;");
      expect(lines).toContain("const i0_f0m1 = i0_f0m0 > 4n ? i0_f0m0 : 4n;");
    });

    it("refuses allowPartial, which only publishAndFund takes", () => {
      expect(() =>
        rewriteIntentSugar(
          TRANSFER_INTENT,
          context({ defaults: { deadline: 4_000_000_000n, creator: CREATOR, allowPartial: true } }),
        ),
      ).toThrow(/`intents.allowPartial` goes with `fundVia: "publishAndFund"`/);
    });

    it("refuses a fundVia it does not know", () => {
      expect(() =>
        rewriteIntentSugar(
          TRANSFER_INTENT,
          context({ defaults: { deadline: 4_000_000_000n, creator: CREATOR, fundVia: "permit" } }),
        ),
      ).toThrow(/`intents.fundVia` is 'permit'/);
    });
  });

  it("opted into publishAndFund: approves the source Portal for the reward with SafeERC20 semantics", () => {
    const result = rewriteIntentSugar(
      TRANSFER_INTENT,
      context({
        defaults: { deadline: 4_000_000_000n, creator: CREATOR, fundVia: "publishAndFund" },
      }),
    );
    expect(result.intents[0]!.fundVia).toBe("publishAndFund");
    const portal = ecoRoutesPortal("base").slice(2).toLowerCase();
    const lines = result.source.split("\n").map((line) => line.trim());
    const approvals = lines.filter((line) => line.includes("095ea7b3"));

    // A raw call, not `IERC20.at(t).approve(...)`: the vendored ABI's `bool` return is decoded even
    // when discarded, and a token like USDT returns nothing. See `token/safe.ts`.
    expect(result.source).not.toContain(".approve(");
    // `forceApprove`, in two halves -- the reset to zero, then the real amount -- both naming the
    // Portal. One Pot publishes every intent on this chain, so the allowance an earlier intent left
    // behind is exactly the non-zero-to-non-zero change USDT refuses.
    expect(approvals).toHaveLength(2);
    for (const line of approvals) expect(line).toContain(portal);
    expect(approvals[0]).toContain(`${"0".repeat(64)}\``);
    // The reset costs a call only when there is something to reset, and that is decided from an
    // allowance read -- a `uint256`, always safe to decode -- rather than from a caught revert,
    // because a reverting `evm.call` cannot be caught in a Sauce program the way OZ catches it.
    expect(lines.some((line) => line.includes("dd62ed3e"))).toBe(true);
    expect(lines.some((line) => line.startsWith("if (") && line.includes("cur > 0)"))).toBe(true);
    // Both writes are judged: empty returndata only from an address with code, anything else true.
    expect(lines.filter((line) => line.includes("ctx.codeSize("))).toHaveLength(2);
    // No vault read: the Portal pulls the reward into the vault it derives itself.
    expect(result.source).not.toContain("i0_vault");
  });

  it("opted into publishAndFund: approves a token listed twice once, for the larger amount", () => {
    const result = rewriteIntentSugar(
      program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount: 3n }, { token: USDC, amount }] });`),
      context({
        defaults: { deadline: 4_000_000_000n, creator: CREATOR, fundVia: "publishAndFund" },
      }),
    );
    const lines = result.source.split("\n").map((line) => line.trim());

    // The Portal pulls each entry up to the vault's whole balance of the token, so the larger
    // entry is the allowance it needs — the first one listed could be the smaller.
    expect(lines).toContain("const i0_a0m0 = amount > 3n ? amount : 3n;");
    const approves = lines.filter(
      (line) =>
        line.includes("evm.call(") && line.includes(".toBytesBe(32)") && line.includes("_0"),
    );
    expect(approves.some((line) => line.includes("i0_a0m0.toBytesBe(32)"))).toBe(true);
    expect(lines.filter((line) => line.includes("dd62ed3e"))).toHaveLength(1);
  });

  it("opted into publishAndFund: forwards a native reward as the call's value", () => {
    const result = rewriteIntentSugar(
      program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ nativeAmount: amount });`),
      context({
        defaults: { deadline: 4_000_000_000n, creator: CREATOR, fundVia: "publishAndFund" },
      }),
    );
    const portal = BigInt(ecoRoutesPortal("base"));

    const calls = result.source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("evm.call("));
    expect(calls.at(-1)).toBe(`evm.call(${portal}n, amount, i0_data);`);
  });

  it("lowers several intents in one program without colliding", () => {
    const two = program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
  Base(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);
    const result = rewriteIntentSugar(two, context());

    expect(result.intents.map((i) => i.destination.slug)).toEqual(["arbitrum", "base"]);
    const declared = [...result.source.matchAll(/^\s*const (\w+) =/gm)].map((m) => m[1]!);
    expect(new Set(declared).size).toBe(declared.length);
  });
});

describe("a body that is not just token writes becomes a program", () => {
  // The fast path is an optimisation, not the feature: anything a route body can do belongs inside
  // an intent's braces. These used to be refusals.
  it.each([
    ["control flow", "if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }"],
    ["a local and arithmetic", "const half = amount / 2n; USDC.transfer(RECIPIENT, half);"],
    // The spelling the intents guide gives for opting a token-only body into SafeERC20 checks.
    [
      "an unused balance read",
      "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, amount);",
    ],
    [
      "a method the direct-call lowering does not take",
      "USDC.transferFrom(RECIPIENT, RECIPIENT, amount);",
    ],
  ])("compiles a program for %s", (_name, body) => {
    const source = program(
      `  Arbitrum(() => {\n    ${body}\n  }).reward({ tokens: [{ token: USDC, amount }] });`,
    );
    const result = rewriteIntentSugar(source, context());

    // One route call -- the cook -- rather than one per statement.
    expect(result.intents[0]!.intent.route.calls).toHaveLength(1);
    expect(result.intents[0]!.captures).toContain("amount");
  });

  it("a token write on Solana takes the program path, never ERC-20 calldata aimed at the mint", () => {
    // On Solana `USDC` is the mint's 32-byte key, so the direct-call shape would be a `transfer`
    // call whose target is the mint: a route no solver can run, with the reward escrowed behind it.
    const source = program(
      `  Solana(() => {\n    USDC.transfer(RECIPIENT, amount);\n  }).reward({ tokens: [{ token: USDC, amount }] });`,
    );
    const compileChild = () => {
      throw new Error("compiled as a program");
    };

    expect(() =>
      rewriteIntentSugar(
        source,
        context({ chains: new Map([["Solana", SOLANA]]), proverFor: () => CREATOR, compileChild }),
      ),
    ).toThrow("compiled as a program");
  });

  it("lowers an intent opened inside an intent, recursively", () => {
    const source = program(`  Arbitrum(() => {
    const got = USDC.balanceOf(ctx.self());
    Base(() => {
      USDC.transfer(RECIPIENT, got);
    }).reward({ tokens: [{ token: USDC, amount: got }] });
  }).reward({ tokens: [{ token: USDC, amount }] });`);

    // The inner one is lowered by the CHILD's own compile, not by this pass, so this pass sees one
    // site and hands the whole closure body down.
    const result = rewriteIntentSugar(source, context());
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]!.intent.route.calls).toHaveLength(1);
  });
});

describe("the Pot a program body cooks on", () => {
  const PROGRAM_BODY = program(`  Arbitrum(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount }] });`);
  it("delivers into it and cooks on it, and adds no deployment", () => {
    const calls = rewriteIntentSugar(PROGRAM_BODY, context()).intents[0]!.intent.route.calls;

    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).functionName).toBe(
      "transfer",
    );
    expect(denormalizeToEvm(calls[1]!.target)).toBe("0x4444444444444444444444444444444444444444");
  });

  it("hands the child compile the Portal the route records, override included", () => {
    const seen: unknown[] = [];
    const base = context() as unknown as { compileChild: (...args: unknown[]) => object };
    const override = "0x6666666666666666666666666666666666666666";
    const result = rewriteIntentSugar(
      PROGRAM_BODY,
      context({
        defaults: { deadline: 4_000_000_000n, creator: CREATOR, destinationPortal: override },
        compileChild: (...args: unknown[]) => {
          seen.push(args[3]);
          return base.compileChild(...args);
        },
      }),
    );

    expect(seen).toEqual([override]);
    expect(denormalizeToEvm(result.intents[0]!.intent.route.portal)).toBe(override);
  });

  describe("through the real compile path", () => {
    const compileWith = (intents: Record<string, unknown>) =>
      compileSauceRoute(
        "base",
        `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const here = USDC.balanceOf(ctx.self());
    if (here > 0n) { USDC.transfer(RECIPIENT, here); }
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
        {
          pot: "0x1111111111111111111111111111111111111111",
          engine: "0x2222222222222222222222222222222222222222",
        },
        {
          defines: { RECIPIENT },
          intents: { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n, ...intents },
        },
      ).source;
    const cookOn = (pot: string) => pot.slice(2).toLowerCase().padStart(64, "0");
    const deploySelector = v12Kitchen
      .encodeDeployPot(RECIPIENT_ADDRESS, SAUCE_INTENT_POT_SALT)
      .slice(2, 10);

    it("cooks on the registry Portal's shared Pot, and deploys nothing", () => {
      const executor = ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum"));
      const source = compileWith({}).toLowerCase();

      expect(source).toContain(cookOn(v12PredictPot(executor)));
      expect(source).not.toContain(deploySelector);
    });

    it("derives from an OVERRIDING destination Portal's own Executor", () => {
      const portal = "0x6666666666666666666666666666666666666666" as Hex;
      const source = compileWith({ destinationPortal: portal }).toLowerCase();
      const registryExecutor = ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum"));

      // A Pot owned by the registry Portal's Executor would reject this route's cook with
      // `NotOwner()`: the route records `portal`, so `portal`'s Executor is the caller.
      expect(source).toContain(cookOn(v12PredictPot(ecoRoutesExecutorOf(portal))));
      expect(source).not.toContain(cookOn(v12PredictPot(registryExecutor)));
    });

    it("cooks on a Pot the caller names", () => {
      const pot = "0x7777777777777777777777777777777777777777";
      const source = compileWith({ pot }).toLowerCase();

      expect(source).toContain(cookOn(pot));
      expect(source).not.toContain(deploySelector);
    });
  });
});

describe("a program with no sugar is not parsed for it", () => {
  it("returns a program that cannot hold a site unchanged, without parsing it", () => {
    // Not valid JavaScript: parsing it would throw, so returning shows it was never parsed.
    const unparseable = "function main( { USDC.transfer(RECIPIENT, 1n); }";
    expect(rewriteIntentSugar(unparseable, context())).toEqual({
      source: unparseable,
      rewrote: false,
      intents: [],
    });
  });

  it("still parses, and lowers, a site whose `reward` is spelled with a unicode escape", () => {
    const escaped = TRANSFER_INTENT.replace(".reward(", ".\\u0072eward(");
    expect(escaped).not.toContain("reward");
    const result = rewriteIntentSugar(escaped, context());
    expect(result.rewrote).toBe(true);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]!.intent).toEqual(
      rewriteIntentSugar(TRANSFER_INTENT, context()).intents[0]!.intent,
    );
  });

  it("a skipped program's syntax error is still reported by the compile", () => {
    expect(() =>
      compileSauceRoute("base", "function main( { USDC.transfer(RECIPIENT, 1n); }", {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(SyntaxError);
  });

  it("still parses a program that mentions `reward` anywhere, even with no site", () => {
    const unparseable = "function main( { const reward = 1n; }";
    expect(() => rewriteIntentSugar(unparseable, context())).toThrow(SyntaxError);
  });
});

describe("what it refuses, and how clearly", () => {
  it.each([
    [
      "an identifier that is neither a define nor a local",
      "USDC.transfer(mystery, amount);",
      /refers to 'mystery', which is neither a compile-time value nor a variable/,
    ],
  ])("refuses %s", (_name, body, message) => {
    const source = program(
      `  Arbitrum(() => {\n    ${body}\n  }).reward({ tokens: [{ token: USDC, amount }] });`,
    );
    expect(() => rewriteIntentSugar(source, context())).toThrow(message);
  });

  describe("a token it cannot resolve, named as the part it is in", () => {
    // The delivery and the reward share one parser. When that parser called every token a reward
    // token, an agent told "`reward.tokens[].token` refers to 'USDT0'" about the DELIVERY kept
    // editing the reward, which was right all along, and never compiled.
    const messageOf = (source: string): string => {
      try {
        rewriteIntentSugar(source, context());
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("expected the rewrite to refuse the source");
    };
    const intent = (deliveryToken: string, deliveryAmount = "amount", rewardToken = "USDC") =>
      program(`  Arbitrum(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }
  }, { tokens: [{ token: ${deliveryToken}, amount: ${deliveryAmount} }] }).reward({ tokens: [{ token: ${rewardToken}, amount }] });`);
    const DELIVERY =
      "The delivery — the intent's second argument, `{ tokens: [...] }` — is what the solver " +
      "brings to arbitrum, so its symbols are arbitrum's: fix it there, not in `.reward(...)`. " +
      "Use a symbol arbitrum registers, or the token's arbitrum address as a literal, a define or " +
      "a top-level `const` of a literal.";

    it("a delivery token the destination does not register", () => {
      // Arbitrum's Tether token is USDT0, never USDT.
      expect(messageOf(intent("USDT"))).toBe(
        `intent sugar: the delivery token 'USDT' is not a token arbitrum registers, nor a define. ${DELIVERY}`,
      );
    });

    it("a delivery token the program only has while it runs", () => {
      expect(messageOf(intent("amount"))).toBe(
        "intent sugar: the delivery token 'amount' is a variable of the program, known only while " +
          `it runs, and an intent names its tokens when it is built. ${DELIVERY}`,
      );
    });

    it("a delivery amount nothing resolves", () => {
      expect(messageOf(intent("USDC", "mystery"))).toBe(
        "intent sugar: the delivery's `tokens[].amount` refers to 'mystery', which is neither a " +
          "compile-time value nor a variable of the enclosing program. Declare it with " +
          "`const mystery = ...` before the intent, or supply it as a compile-time define.",
      );
    });

    it("a reward token the enclosing chain does not register", () => {
      expect(messageOf(intent("USDC", "amount", "USDT0"))).toBe(
        "intent sugar: the reward token 'USDT0' is not a token base registers, nor a define. The " +
          "reward — `.reward({ tokens: [...] })` — is escrowed on base, where the program opening " +
          "the intent runs, so its symbols are base's. Use a symbol base registers, or the token's " +
          "base address as a literal, a define or a top-level `const` of a literal.",
      );
    });
  });

  it("names the deadline and the creator when they are missing", () => {
    expect(() => rewriteIntentSugar(TRANSFER_INTENT, context({ defaults: {} }))).toThrow(
      /needs a `deadline`/,
    );
    expect(() =>
      rewriteIntentSugar(TRANSFER_INTENT, context({ defaults: { deadline: 1n } })),
    ).toThrow(/needs a `creator`/);
  });

  it("says which chain has no eco-routes deployment", () => {
    const zora = requireChain("zora");
    const source = program(`  Zora(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);

    expect(() =>
      rewriteIntentSugar(source, context({ chains: new Map([["Zora", zora]]) })),
    ).toThrow(/eco-routes v3 is not deployed on zora/);
  });

  it("leaves a program with no intent in it completely alone", () => {
    const plain = "function main() { return 1n; }";
    const result = rewriteIntentSugar(plain, context());

    expect(result.rewrote).toBe(false);
    expect(result.source).toBe(plain);
  });
});

describe("through the real compile path", () => {
  it("builds no Solana intent from a token write", () => {
    // The program path: an SVM child, which this sugar does not build (it derives an EVM Pot), and
    // whose compile would refuse the token syntax by name. Either way, nothing is published.
    expect(() =>
      compileSauceRoute(
        "base",
        `function main() {
  Solana(() => {
    USDC.transfer(RECIPIENT, 5n);
  }).reward({ tokens: [{ token: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913n, amount: 7n }] });
}`,
        {
          pot: "0x1111111111111111111111111111111111111111",
          engine: "0x2222222222222222222222222222222222222222",
        },
        { defines: { RECIPIENT }, intents: { deadline: 4_000_000_000n, creator: CREATOR } },
      ),
    ).toThrow();
  });

  it("compiles, with no Portal or selector written by the caller", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`,
      {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      },
      {
        defines: { RECIPIENT },
        intents: { deadline: 4_000_000_000n, creator: CREATOR },
      },
    );

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // The token symbol resolved to Base's real USDC, and the Portal to Base's real one.
    expect(out.source.toLowerCase()).toContain(ecoRoutesPortal("base").slice(2).toLowerCase());
  });

  it("compiles an intent that captures nothing: every value a define or a literal", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, 5n);
  }).reward({ tokens: [{ token: USDC, amount: 7n }] });
}`,
      {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      },
      { defines: { RECIPIENT }, intents: { deadline: 4_000_000_000n, creator: CREATOR } },
    );

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // No slot to fill, so the whole publish calldata is one literal.
    expect(out.source).toMatch(/const i0_data = hex`[0-9a-f]+`;/);
    expect(out.source).not.toContain("5acecab7");
  });

  it.each(["transfer", "publishAndFund"] as const)(
    "compiles a captured native reward and a token listed twice, funded via %s",
    (fundVia) => {
      const out = compileSauceRoute(
        "base",
        `function main() {
  const amount = USDC.balanceOf(ctx.self());
  const native = ctx.selfBalance();
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, 5n);
  }).reward({ tokens: [{ token: USDC, amount }, { token: USDC, amount: 7n }], nativeAmount: native });
}`,
        {
          pot: "0x1111111111111111111111111111111111111111",
          engine: "0x2222222222222222222222222222222222222222",
        },
        {
          defines: { RECIPIENT },
          intents: { deadline: 4_000_000_000n, creator: CREATOR, fundVia },
        },
      );

      expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    },
  );

  it("the enclosing program's own token sugar still works alongside it", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  const amount = Token(USDC).balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`,
      {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      },
      { defines: { RECIPIENT }, intents: { deadline: 4_000_000_000n, creator: CREATOR } },
    );

    expect(out.source).toContain("IERC20.at(");
    expect(() => compile(out.source, { baseDirs: [] })).toBeDefined();
  });
});
