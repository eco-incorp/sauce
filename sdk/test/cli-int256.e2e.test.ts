/**
 * A program that takes and returns an `Int256`, through the `sauce` command, EXECUTED: a negative
 * value given with `--args` (a word of its own, `-5`, which is no flag) or `--args-json`, encoded as
 * the ABI's `int256`, read by the program as the signed number it is, passed on to a callee that
 * declares `int256` and `int24` parameters (a stub that returns the word it was called with, so
 * what the callee received is what main returns), and returned: `sauce simulate` prints `-6`, not
 * 2^256 - 6, as text and as JSON. `sauce tx` and `sauce run` send the same word, and a program that
 * pays out of a negative balance moves exactly that much.
 *
 * On a local anvil running the released gated stack (`cli-anvil.ts`), Ethereum.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md).
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
/** int24's range: a value outside it must not reach a callee that declares `int24`. */
const INT24_MIN = -(1n << 23n);

/** A word as the engine returns it: 32 bytes, two's complement for a negative. */
const word = (value: bigint): Hex => numberToHex(BigInt.asUintN(256, value), { size: 32 });

/**
 * A stub that returns the 32-byte word it was called with, whatever the selector: runtime
 * `PUSH1 4 CALLDATALOAD PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN`, behind a constructor that copies it
 * out. What a callee declaring `int256` or `int24` received is then what its caller gets back.
 */
const ECHO_CREATION: Hex = "0x600b80600b6000396000f360043560005260206000f3";

const ECHO_ABI = JSON.stringify([
  {
    type: "function",
    name: "echo",
    stateMutability: "view",
    inputs: [{ name: "x", type: "int256" }],
    outputs: [{ name: "", type: "int256" }],
  },
  {
    type: "function",
    name: "echo24",
    stateMutability: "view",
    inputs: [{ name: "x", type: "int24" }],
    outputs: [{ name: "", type: "int24" }],
  },
]);

const DELTA = "function main(x: Int256): Int256 {\n  return x - 1;\n}\n";
const ECHO = [
  'import IEcho from "./IEcho.json";',
  "",
  "function main(stub: Address, wide: Int256, narrow: Int256): { wide: Int256, narrow: Int256 } {",
  "  const callee = IEcho.at(stub);",
  "  return { wide: callee.echo(wide), narrow: callee.echo24(narrow) };",
  "}",
  "",
].join("\n");
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
  let echo: string;
  let settle: string;
  let stub: Address;
  let usdc: Address;
  let pot: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-int256-e2e-"));
    delta = join(work, "delta.sauce.ts");
    echo = join(work, "echo.sauce.ts");
    settle = join(work, "settle.sauce.ts");
    writeFileSync(delta, DELTA);
    writeFileSync(echo, ECHO);
    writeFileSync(join(work, "IEcho.json"), ECHO_ABI);
    writeFileSync(settle, SETTLE);
    ethereum = await startChain("ethereum");
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    stub = await ethereum.plant(ECHO_CREATION);
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
        /argument 1 \(x: Int256\): .* is not a signed integer from -2\^255 to 2\^255 - 1/,
      );
    }
    // -2^255 is a value; one below it is arithmetic past the type, which the engine refuses.
    const under = await simulate(delta, "--args", MIN.toString());
    expect(under.code).toBe(1);
    expect(under.stdout).toMatch(/^The cook reverts: /);
  }, 120_000);

  it("a negative value reaches a callee's int256 and int24 parameters exactly", async () => {
    const run = await simulate(echo, "--json", "--args", stub, "-5", "-8388608");
    expect(jsonOf(run)).toMatchObject({
      ok: true,
      returnType: "{ wide: Int256, narrow: Int256 }",
      returned: { wide: "-5", narrow: INT24_MIN.toString() },
      returns: `${word(-5n)}${word(INT24_MIN).slice(2)}`,
    });
    // The callee's own words, as the stub returned them: the sign-extended int256 and int24.
    const edge = await simulate(echo, "--json", "--args", stub, MIN.toString(), "8388607");
    expect(jsonOf(edge)).toMatchObject({ returned: { wide: MIN.toString(), narrow: "8388607" } });
  }, 120_000);

  it("a value past int24 is not sent to a callee that declares int24", async () => {
    const run = await simulate(echo, "--args", stub, "-5", (INT24_MIN - 1n).toString());
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/^The cook reverts: /);
    const wide = await simulate(echo, "--args", stub, "-5", "8388608");
    expect(wide.code).toBe(1);
    expect(wide.stdout).toMatch(/^The cook reverts: /);
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
