/**
 * A program that takes and returns an `Int256`, through the `sauce` command, EXECUTED: a negative
 * value given with `--args` (a word of its own, `-5`, which is no flag) or `--args-json`, encoded as
 * the ABI's `int256`, read by the program as the signed number it is, and returned: `sauce simulate`
 * prints `-6`, not 2^256 - 6, as text and as JSON, a record's signed fields too. `sauce tx` and
 * `sauce run` send the same word, a program that pays out of a negative balance moves exactly that
 * much, and `sauce inspect` reads the sent argument back as the signed value.
 *
 * On a local anvil running the released gated stack (`cli-anvil.ts`), Ethereum. GATED on
 * SAUCE_V12_RUNTIME_CREATION_HEX.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numberToHex, type Address, type Hex } from "viem";

import { v12PredictPot } from "../src/deployments/pot.js";
import {
  deployPot,
  describeEvm,
  fixture,
  jsonOf,
  OWNER,
  OWNER_KEY,
  registered,
  sauce,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";

const MIN = -(1n << 255n);
const MAX = (1n << 255n) - 1n;
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";

/** A word as the engine returns it: 32 bytes, two's complement for a negative. */
const word = (value: bigint): Hex => numberToHex(BigInt.asUintN(256, value), { size: 32 });

const DELTA = "function main(x: Int256): Int256 {\n  return x - 1;\n}\n";
const PAIR =
  "function main(x: Int256): { wide: Int256, less: Int256 } {\n  return { wide: x, less: x - 1 };\n}\n";
/** Pays out of a negative balance: `owed` is what the Pot owes, below zero, and `-owed` is paid. */
const SETTLE = [
  "function main(to: Address, owed: Int256) {",
  '  require(owed < 0, "owed is not negative");',
  "  USDC.transfer(to, Uint256(-owed));",
  "}",
  "",
].join("\n");

describeEvm("sauce, a program that takes and returns an Int256", () => {
  let ethereum: LocalChain;
  let work: string;
  let delta: string;
  let pair: string;
  let settle: string;
  let usdc: Address;
  let pot: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-int256-e2e-"));
    delta = join(work, "delta.sauce.ts");
    pair = join(work, "pair.sauce.ts");
    settle = join(work, "settle.sauce.ts");
    writeFileSync(delta, DELTA);
    writeFileSync(pair, PAIR);
    writeFileSync(settle, SETTLE);
    ethereum = await startChain("ethereum");
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    pot = await deployPot(ethereum);
    expect(pot).toBe(v12PredictPot(OWNER.address, `0x${"00".repeat(32)}`));
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await ethereum?.stop();
  });

  /** `sauce simulate <file> --args …` from the Pot's owner, on the local chain. */
  const simulate = (file: string, ...rest: string[]) =>
    sauce(
      "simulate",
      file,
      "--chain",
      "ethereum",
      "--owner",
      OWNER.address,
      "--rpc-url",
      ethereum.rpcUrl,
      ...rest,
    );

  it("`sauce simulate --args -5` returns -6, printed as -6 and not as 2^256 - 6", async () => {
    const run = await simulate(delta, "--args", "-5");
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("main returns Int256: -6");
    expect(run.stdout).not.toContain(BigInt.asUintN(256, -6n).toString());
    expect(run.stdout).toContain(`returns ${word(-6n)}`);

    const out = jsonOf(await simulate(delta, "--json", "--args", "-5"));
    expect(out).toMatchObject({
      ok: true,
      returnType: "Int256",
      returned: "-6",
      returns: word(-6n),
    });
  }, 120_000);

  it("takes the value as --args-json too, and a positive value, zero and the bounds", async () => {
    const returned = async (...args: string[]): Promise<unknown> =>
      jsonOf(await simulate(delta, "--json", ...args)).returned;
    expect(await returned("--args-json", "[-5]")).toBe("-6");
    expect(await returned("--args-json", '["-5"]')).toBe("-6");
    expect(await returned("--args", "7")).toBe("6");
    expect(await returned("--args", "0")).toBe("-1");
    expect(await returned("--args", MAX.toString())).toBe((MAX - 1n).toString());
    expect(await returned("--args", (MIN + 1n).toString())).toBe(MIN.toString());
  }, 120_000);

  it("refuses a value outside -2^255..2^255 - 1 before anything is read, and reverts past it", async () => {
    for (const past of [MIN - 1n, MAX + 1n]) {
      const run = await simulate(delta, "--args", past.toString());
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(
        /argument 1 \(x: Int256\): .* is not a signed integer from -2\^255 through 2\^255 - 1/,
      );
    }
    // -2^255 is a value; one below it is arithmetic past the type, which the engine refuses.
    const under = await simulate(delta, "--args", MIN.toString());
    expect(under.code).toBe(1);
    expect(under.stdout).toMatch(/^The cook reverts: /);
  }, 120_000);

  it("prints a record's Int256 fields as signed numbers", async () => {
    const run = await simulate(pair, "--json", "--args", "-5");
    expect(jsonOf(run)).toMatchObject({
      ok: true,
      returnType: "{ wide: Int256, less: Int256 }",
      returned: { wide: "-5", less: "-6" },
      returns: `${word(-5n)}${word(-6n).slice(2)}`,
    });
  }, 120_000);

  it("`sauce tx` carries the two's-complement word, and the cook sent as printed pays -owed", async () => {
    await ethereum.mint(usdc, pot, 5_000_000n);
    const printed = jsonOf(
      await sauce(
        "tx",
        settle,
        "--chain",
        "ethereum",
        "--owner",
        OWNER.address,
        "--rpc-url",
        ethereum.rpcUrl,
        "--args",
        RECIPIENT,
        "-1500000",
      ),
    ) as { to: Address; data: Hex; value: Hex };
    // main's arguments close the program inside the cook's `bytes`: the recipient, then
    // -1500000 as its two's-complement word (the ABI pads what follows with zeros).
    expect(printed.data).toContain(
      `${word(BigInt(RECIPIENT)).slice(2)}${word(-1500000n).slice(2)}`,
    );
    await ethereum.send(ethereum.owner, printed.to, printed.data, BigInt(printed.value));
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(1_500_000n);
    expect(await ethereum.balanceOf(usdc, pot)).toBe(3_500_000n);
  }, 120_000);

  it("`sauce run --args -1500000` signs and sends it, and a positive balance is refused", async () => {
    const before = await ethereum.balanceOf(usdc, RECIPIENT);
    const run = await sauce(
      "run",
      settle,
      "--chain",
      "ethereum",
      "--rpc-url",
      ethereum.rpcUrl,
      "--private-key",
      OWNER_KEY,
      "--args",
      RECIPIENT,
      "-1000000",
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(before + 1_000_000n);

    // `sauce inspect` reads the cook back off the chain against the source, and its argument is
    // the signed value that was sent, not the unsigned word that carried it.
    const hash = /^cook (0x[0-9a-f]{64}): success/m.exec(run.stdout)![1]!;
    const inspected = jsonOf(
      await sauce(
        "inspect",
        hash,
        "--chain",
        "ethereum",
        "--rpc-url",
        ethereum.rpcUrl,
        "--source",
        settle,
        "--json",
      ),
    ) as { program: { source: { arguments: unknown } } };
    expect(inspected.program.source.arguments).toEqual([
      { name: "to", type: "Address", value: RECIPIENT },
      { name: "owed", type: "Int256", value: "-1000000" },
    ]);

    // The sign decides: a positive 1000000 is not owed, so the program refuses and nothing moves.
    const refused = await sauce(
      "run",
      settle,
      "--chain",
      "ethereum",
      "--rpc-url",
      ethereum.rpcUrl,
      "--private-key",
      OWNER_KEY,
      "--args",
      RECIPIENT,
      "1000000",
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr + refused.stdout).toContain("owed is not negative");
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(before + 1_000_000n);
  }, 120_000);
});
