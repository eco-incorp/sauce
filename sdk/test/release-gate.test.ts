/**
 * The operator release gate (`scripts/release-gate.mjs`) holds each cook to what it did, not only to
 * having run.
 *
 * The outcome checks are pure functions of what the command and the chain reported
 * (`scripts/lib/release-gate-checks.mjs`), tested here against the outcomes they must refuse: each
 * negative control is a cook that ran and succeeded and is still not the cook the gate is for.
 */
import { encodeAbiParameters, pad, toHex, type Hex } from "viem";

import { evmCookProblem, solanaCookProblem } from "../scripts/lib/release-gate-checks.mjs";

// ---- Solana ---------------------------------------------------------------------------------

const ENGINE = "8ukALvkKyJcyf5aEAUwTbLwSr9iMYktnRZL5if8vYBhg";
const EARLIER = "53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW";
const KITCHEN = "SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const POT = "Go5ec9H3NJG6aedQwAx4cekfjcbf5okLa2hG6v2wUxCt";
const RECIPIENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const STRANGER = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn";
const AMOUNT = 1_000_000n;

const EXPECTED = {
  engine: ENGINE,
  earlier: [EARLIER],
  recipient: RECIPIENT,
  mint: USDC,
  symbol: "USDC",
  amount: AMOUNT,
};

interface Change {
  account: string;
  mint: string;
  symbol: string;
  owner: string;
  before: string;
  after: string;
  delta: string;
  decimals: number;
}
const change = (owner: string, delta: bigint, mint = USDC, before = 5_000_000n): Change => ({
  account: `${owner.slice(0, 8)}-${mint.slice(0, 4)}`,
  mint,
  symbol: mint === USDC ? "USDC" : "WSOL",
  owner,
  before: before.toString(),
  after: (before + delta).toString(),
  delta: delta.toString(),
  decimals: mint === USDC ? 6 : 9,
});

/** `sauce simulate --json` of the payment, as the gate expects it: the Pot pays, the recipient is paid. */
function simulation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    chain: "solana",
    pot: POT,
    logs: [
      `Program ${KITCHEN} invoke [1]`,
      `Program ${ENGINE} invoke [2]`,
      `Program ${ENGINE} success`,
      `Program ${KITCHEN} success`,
    ],
    tokenChanges: [change(POT, -AMOUNT), change(RECIPIENT, AMOUNT, USDC, 0n)],
    ...overrides,
  };
}

describe("the release gate's check of a simulated Solana payment", () => {
  it("accepts the payment: the Pot debited and the recipient credited, in USDC, by the amount", () => {
    expect(solanaCookProblem(simulation(), EXPECTED)).toBeUndefined();
    // The credit may arrive over several token accounts of the recipient: their net is the payment.
    expect(
      solanaCookProblem(
        simulation({
          tokenChanges: [
            change(POT, -AMOUNT),
            change(RECIPIENT, 400_000n, USDC, 0n),
            change(RECIPIENT, 600_000n, USDC, 0n),
          ],
        }),
        EXPECTED,
      ),
    ).toBeUndefined();
  });

  // Each control is a simulation that succeeded and invoked the engine: all the old gate asked.
  it.each([
    ["empty effects", { tokenChanges: [] }, /no USDC change.*recipient/i],
    ["no effects reported", { tokenChanges: undefined }, /no USDC change.*recipient/i],
    [
      "another recipient is paid",
      { tokenChanges: [change(POT, -AMOUNT), change(STRANGER, AMOUNT, USDC, 0n)] },
      /no USDC change.*recipient/i,
    ],
    [
      "the recipient is paid less",
      { tokenChanges: [change(POT, -AMOUNT), change(RECIPIENT, AMOUNT - 1n, USDC, 0n)] },
      /recipient.*receives 999999.*not 1000000/i,
    ],
    [
      "the recipient is paid more",
      { tokenChanges: [change(POT, -AMOUNT), change(RECIPIENT, AMOUNT + 1n, USDC, 0n)] },
      /recipient.*receives 1000001.*not 1000000/i,
    ],
    [
      "the Pot is not debited",
      { tokenChanges: [change(RECIPIENT, AMOUNT, USDC, 0n)] },
      /no USDC change.*Pot/i,
    ],
    [
      "the Pot pays another amount",
      { tokenChanges: [change(POT, -(AMOUNT + 1n)), change(RECIPIENT, AMOUNT, USDC, 0n)] },
      /Pot.*-1000001.*not -1000000/i,
    ],
    [
      "someone other than the Pot pays",
      { tokenChanges: [change(STRANGER, -AMOUNT), change(RECIPIENT, AMOUNT, USDC, 0n)] },
      /no USDC change.*Pot/i,
    ],
    [
      "another token moves the right amounts between the right holders",
      { tokenChanges: [change(POT, -AMOUNT, WSOL), change(RECIPIENT, AMOUNT, WSOL, 0n)] },
      /no USDC change.*recipient/i,
    ],
    ["the simulation names no Pot", { pot: undefined }, /names no Pot/i],
    [
      "the simulation did not succeed",
      { ok: false, reason: "reverted" },
      /does not simulate: reverted/,
    ],
    [
      "the engine never runs",
      { logs: [`Program ${KITCHEN} invoke [1]`, `Program ${KITCHEN} success`] },
      new RegExp(`never invokes the package's engine ${ENGINE}`),
    ],
    [
      "the earlier engine runs",
      { logs: [`Program ${ENGINE} invoke [2]`, `Program ${EARLIER} invoke [2]`] },
      new RegExp(`invokes the earlier engine ${EARLIER}`),
    ],
  ] as const)("refuses a simulation that succeeds but: %s", (_what, overrides, problem) => {
    expect(solanaCookProblem(simulation(overrides), EXPECTED)).toMatch(problem);
  });

  it("refuses a delta it cannot read, of the recipient's or the Pot's, rather than skip it", () => {
    const unreadable = (holder: string, delta: bigint) => ({
      ...change(holder, delta),
      delta: "one million",
    });
    for (const tokenChanges of [
      [change(POT, -AMOUNT), unreadable(RECIPIENT, AMOUNT)],
      [unreadable(POT, -AMOUNT), change(RECIPIENT, AMOUNT, USDC, 0n)],
    ]) {
      expect(solanaCookProblem(simulation({ tokenChanges }), EXPECTED)).toMatch(
        /no readable delta \(one million\)/,
      );
    }
  });
});

// ---- EVM ------------------------------------------------------------------------------------

const POT_EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_EVM = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ENGINE_EVM = "0x983C102aa6321187877530723dDF6921AB4861a6";
const EARLIER_EVM = "0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67";

/**
 * What a cook returns for a program that returns `n`, as the call tracer shows the top call's
 * output: the one 32-byte word, with no ABI framing (the way `sdk/src/routes/returned.ts` reads it).
 */
const returned = (n: bigint): Hex => pad(toHex(n), { size: 32 });

const EVM_EXPECTED = { pot: POT_EVM, engine: ENGINE_EVM, value: 7n };
const cook = (observed: Partial<Parameters<typeof evmCookProblem>[0]> = {}) => ({
  to: POT_EVM,
  engine: ENGINE_EVM,
  output: returned(7n),
  ...observed,
});

describe("the release gate's check of a mined EVM cook", () => {
  it("accepts a cook to the Pot, on the package's engine, that returned the value", () => {
    expect(evmCookProblem(cook(), EVM_EXPECTED)).toBeUndefined();
    // Addresses compare by value, not by their checksum's case.
    expect(evmCookProblem(cook({ to: POT_EVM.toLowerCase() }), EVM_EXPECTED)).toBeUndefined();
  });

  // Each control is a cook that was mined with status success and names the package's engine.
  it.each([
    ["the cook went to another account", { to: OTHER_EVM }, /went to .*not to the Pot/],
    ["the cook created a contract", { to: null }, /went to .*not to the Pot/],
    ["the program returned another value", { output: returned(999n) }, /returned 999, not 7/],
    ["the cook returned nothing", { output: "0x" }, /returned 0 bytes, not the one word of 7/],
    ["the trace has no output", { output: undefined }, /trace has no output/i],
    ["the output is not hex", { output: "0xzz" }, /output 0xzz is not hex/],
    [
      "the output is the word inside ABI framing, which a program's return does not have",
      { output: encodeAbiParameters([{ type: "bytes" }], [returned(7n)]) },
      /returned 96 bytes, not the one word of 7/,
    ],
    [
      "the program returned two words",
      { output: `0x${"00".repeat(31)}07${"00".repeat(32)}` },
      /returned 64 bytes, not the one word of 7/,
    ],
    [
      "the cook names another engine",
      { engine: EARLIER_EVM },
      new RegExp(`names engine ${EARLIER_EVM}, not the package's ${ENGINE_EVM}`),
    ],
  ] as const)("refuses a cook that succeeded but: %s", (_what, observed, problem) => {
    expect(evmCookProblem(cook(observed), EVM_EXPECTED)).toMatch(problem);
  });
});
