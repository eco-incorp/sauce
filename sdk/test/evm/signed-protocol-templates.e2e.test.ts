/**
 * The registry templates that touch a signed ABI value, COMPILED AS SHIPPED and EXECUTED through the
 * released gated stack (`gated-engine.ts`) on a local anvil against ABI-compatible callees
 * (`fixtures/SignedProtocolTemplates.sol`, vendored beside it as `SignedProtocolTemplates.json`).
 *
 * Compiling is not evidence here. A `Uint256` handed to an ABI `intN` parameter is a CHECKED numeric
 * conversion: a two's-complement word above `Int256.max` still compiles and reverts at run time. So
 * every signed argument below is sent as a real negative `int256` and read back from the callee,
 * and every signed return is decoded as `int256`, not as the unsigned word it travels as.
 *
 * Signed in the templates (a negative value is meaningful): `fluid.repay` (`newDebt`),
 * `uniswap-v3.addLiquidity` (`tickLower`, `tickUpper`) and the returns of `chainlink.getLatestPrice`
 * (`answer`), `pyth.getPrice` (`price`, `expo`) and `ambient.swap` (`baseFlow`, `quoteFlow`).
 * Slipstream's `tickSpacing` and Superfluid's `flowrate` are `Int256` too, narrowed to the ABI's
 * `int24`/`int96`: a value that fits lands exactly, one past either end reverts and moves nothing.
 * Kept `Uint256` because the value is never negative (`fluid.borrow`'s amount, Curve's `i`/`j`):
 * there the checked conversion IS the guard, and the boundary rows show the old two's-complement
 * spelling of a negative reverts.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like the other EVM suites: skipped locally without it,
 * a failure under CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  http,
} from "viem";
import type { Abi, AbiParameter, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getPool } from "../../src/protocols/aerodrome-slipstream/functions.js";
import { swap as ambientSwap } from "../../src/protocols/ambient/functions.js";
import { getLatestPrice } from "../../src/protocols/chainlink/functions.js";
import { swap as curveSwap } from "../../src/protocols/curve/functions.js";
import { borrow, repay } from "../../src/protocols/fluid/functions.js";
import { getPrice } from "../../src/protocols/pyth/functions.js";
import { createFlow, updateFlow } from "../../src/protocols/superfluid/functions.js";
import { addLiquidity } from "../../src/protocols/uniswap-v3/functions.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { compileSauceFunctionRust } from "../helpers.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTOCOLS = join(HERE, "../../src/protocols");
const STUB = JSON.parse(
  readFileSync(join(HERE, "fixtures/SignedProtocolTemplates.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });
const GAS_LIMIT = 10_000_000n;

const INT256_MIN = -(2n ** 255n);
const INT256_MAX = 2n ** 255n - 1n;
const INT24_MIN = -(2n ** 23n);
const INT24_MAX = 2n ** 23n - 1n;
const INT96_MIN = -(2n ** 95n);
const INT96_MAX = 2n ** 95n - 1n;
const INT128_MAX = 2n ** 127n - 1n;
/** What an unsigned template used to be handed for a negative: 2^256 - |value|. */
const twos = (negative: bigint): bigint => 2n ** 256n + negative;

const RECIPIENT = getAddress("0x00000000000000000000000000000000000000a1");
const TOKEN_A = getAddress("0x00000000000000000000000000000000000000b1");
const TOKEN_B = getAddress("0x00000000000000000000000000000000000000b2");

const send = async (to: Address | null, data: Hex): Promise<{ status: string; at?: Address }> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { status: receipt.status, at: receipt.contractAddress ?? undefined };
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const { at } = await send(null, creationCode);
  if (!at) throw new Error("a deployment produced no contract address");

  return at;
};

let anvil: ChildProcess;
let sauce: GatedEngine;
/** The callee every program in one test calls; a fresh one per test, so nothing carries over. */
let stub: Address;

/** A value the callee recorded. viem reads an int24 as a `number` and an int96 as a `bigint`. */
const recorded = async (functionName: string): Promise<bigint> =>
  BigInt(
    (await publicClient.readContract({ abi: STUB.abi, address: stub, functionName })) as
      bigint | number,
  );

interface Template {
  /** The template's own bytecode, with the arguments' ABI types the COMPILER reports for `main`. */
  bytecode: Uint8Array;
  entryParams: AbiParameter[];
}
const compiled = new Map<string, Template>();
/** A registry template compiled as the SDK ships it: its own protocol's `abis.ts`, no edits. */
const template = (slug: string, source: string): Template => {
  if (!compiled.has(source)) {
    const { bytecode, entryParams } = compileSauceFunctionRust(source, join(PROTOCOLS, slug));
    compiled.set(source, { bytecode, entryParams });
  }

  return compiled.get(source)!;
};

/** The cook of `program` with `main`'s arguments ABI-encoded from the types the compiler reported. */
const cookData = (program: Template, values: readonly unknown[]): Hex =>
  sauce.cookData(
    concatHex([
      bytesToHex(program.bytecode),
      values.length === 0 ? "0x" : encodeAbiParameters(program.entryParams, values),
    ]),
  );

const types = (program: Template): string[] => program.entryParams.map((param) => param.type);

/** What the cook returns by an eth_call: `main`'s value as it comes back, one word per field. */
const returns = async (program: Template, values: readonly unknown[]): Promise<Hex> =>
  (
    await publicClient.call({
      account: OWNER.address,
      data: cookData(program, values),
      to: sauce.pot,
    })
  ).data!;

/** Sends the cook; `reverted` leaves the callee's state exactly as it was. */
const cook = async (program: Template, values: readonly unknown[]): Promise<string> =>
  (await send(sauce.pot, cookData(program, values))).status;

describeEvm("signed registry templates, compiled as shipped and executed", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
  }, 120_000);

  beforeEach(async () => {
    stub = await deploy(STUB.creationCode);
  });

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("the entry signature a host encodes from", () => {
    it("takes the signed inputs as int256 and every unsigned one as uint256", () => {
      expect(types(template("fluid", repay))).toEqual(["address", "uint256", "int256", "address"]);
      expect(types(template("fluid", borrow))).toEqual([
        "address",
        "uint256",
        "uint256",
        "address",
      ]);
      expect(types(template("uniswap-v3", addLiquidity))).toEqual([
        "address",
        "address",
        "address",
        "uint256",
        "int256",
        "int256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "address",
      ]);
      expect(types(template("aerodrome-slipstream", getPool))).toEqual([
        "address",
        "address",
        "address",
        "int256",
      ]);
      expect(types(template("curve", curveSwap))).toEqual([
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
      ]);
      expect(types(template("superfluid", createFlow))).toEqual([
        "address",
        "address",
        "address",
        "address",
        "int256",
      ]);
    });
  });

  describe("fluid.repay passes the signed debt delta through", () => {
    it("a negative delta reaches operate as that exact negative int256", async () => {
      const program = template("fluid", repay);
      expect(await cook(program, [stub, 99n, -1_234_567n, RECIPIENT])).toBe("success");

      expect(await recorded("lastDebtDelta")).toBe(-1_234_567n);
      // `newCol` is the literal 0: repaying moves no collateral.
      expect(await recorded("lastCollateralDelta")).toBe(0n);
    });

    it("returns 1 for the repayment", async () => {
      const [ok] = decodeAbiParameters(
        [{ type: "uint256" }],
        await returns(template("fluid", repay), [stub, 99n, -1_234_567n, RECIPIENT]),
      );
      expect(ok).toBe(1n);
    });

    it("a caller still encoding the old 2**256 - amount word reaches operate as the same negative", async () => {
      // The wire is unchanged: an int256 is its two's-complement word, so a host that never learned
      // the new type keeps working. Only a Uint256 PARAMETER inside a program changed meaning.
      const program = template("fluid", repay);
      const unsignedWire = program.entryParams.map((param) =>
        param.type === "int256" ? { ...param, type: "uint256" } : param,
      );
      const data = sauce.cookData(
        concatHex([
          bytesToHex(program.bytecode),
          encodeAbiParameters(unsignedWire, [stub, 99n, twos(-1_234_567n), RECIPIENT]),
        ]),
      );
      expect((await send(sauce.pot, data)).status).toBe("success");
      expect(await recorded("lastDebtDelta")).toBe(-1_234_567n);
    });

    it("the most negative int256 arrives intact", async () => {
      expect(await cook(template("fluid", repay), [stub, 99n, INT256_MIN, RECIPIENT])).toBe(
        "success",
      );
      expect(await recorded("lastDebtDelta")).toBe(INT256_MIN);
    });
  });

  describe("fluid.borrow keeps a positive Uint256 amount", () => {
    it("lands as the same positive int256 debt delta, with no collateral moved", async () => {
      expect(await cook(template("fluid", borrow), [stub, 99n, 5_000_000n, RECIPIENT])).toBe(
        "success",
      );
      expect(await recorded("lastDebtDelta")).toBe(5_000_000n);
      expect(await recorded("lastCollateralDelta")).toBe(0n);
    });

    it("the largest amount an int256 holds lands exactly", async () => {
      expect(await cook(template("fluid", borrow), [stub, 99n, INT256_MAX, RECIPIENT])).toBe(
        "success",
      );
      expect(await recorded("lastDebtDelta")).toBe(INT256_MAX);
    });

    it("an amount above it reverts instead of becoming a negative delta", async () => {
      for (const amount of [INT256_MAX + 1n, twos(-1_234_567n)]) {
        expect(await cook(template("fluid", borrow), [stub, 99n, amount, RECIPIENT])).toBe(
          "reverted",
        );
      }
      expect(await recorded("lastDebtDelta")).toBe(0n);
    });
  });

  describe("uniswap-v3.addLiquidity passes signed ticks through", () => {
    const mintWith = (lower: bigint, upper: bigint) => [
      stub,
      TOKEN_A,
      TOKEN_B,
      3000n,
      lower,
      upper,
      1_000n,
      2_000n,
      0n,
      0n,
      RECIPIENT,
    ];

    it("negative ticks reach mint as those exact int24 values", async () => {
      expect(await cook(template("uniswap-v3", addLiquidity), mintWith(-887_220n, -60n))).toBe(
        "success",
      );
      expect(await recorded("lastTickLower")).toBe(-887_220n);
      expect(await recorded("lastTickUpper")).toBe(-60n);
    });

    it("a range straddling zero keeps each sign, and the position comes back", async () => {
      const program = template("uniswap-v3", addLiquidity);
      expect(await cook(program, mintWith(-60n, 60n))).toBe("success");
      expect(await recorded("lastTickLower")).toBe(-60n);
      expect(await recorded("lastTickUpper")).toBe(60n);

      const [tokenId, liquidity, amount0, amount1] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        await returns(program, mintWith(-60n, 60n)),
      );
      expect([tokenId, liquidity, amount0, amount1]).toEqual([7n, 11n, 1_000n, 2_000n]);
    });

    it("the int24 extremes land and one past either reverts, moving nothing", async () => {
      const program = template("uniswap-v3", addLiquidity);
      expect(await cook(program, mintWith(INT24_MIN, INT24_MAX))).toBe("success");
      expect(await recorded("lastTickLower")).toBe(INT24_MIN);
      expect(await recorded("lastTickUpper")).toBe(INT24_MAX);

      expect(await cook(program, mintWith(INT24_MIN - 1n, 60n))).toBe("reverted");
      expect(await cook(program, mintWith(-60n, INT24_MAX + 1n))).toBe("reverted");
      expect(await recorded("lastTickLower")).toBe(INT24_MIN);
      expect(await recorded("lastTickUpper")).toBe(INT24_MAX);
    });
  });

  describe("signed returns decode as int256, not as the unsigned word they travel as", () => {
    it("chainlink.getLatestPrice: a negative answer", async () => {
      const data = await returns(template("chainlink", getLatestPrice), [stub]);
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = decodeAbiParameters(
        [
          { type: "uint256" },
          { type: "int256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        data,
      );
      expect(answer).toBe(-5n);
      expect([roundId, startedAt, updatedAt, answeredInRound]).toEqual([1n, 2n, 3n, 1n]);
      // The same word read unsigned is the two's-complement pattern, which is the point of Int256.
      expect(
        decodeAbiParameters([{ type: "uint256" }], `0x${data.slice(2 + 64, 2 + 128)}`)[0],
      ).toBe(twos(-5n));
    });

    it("pyth.getPrice: a negative price and exponent, the unsigned fields untouched", async () => {
      const [price, conf, expo, publishTime] = decodeAbiParameters(
        [{ type: "int256" }, { type: "uint256" }, { type: "int256" }, { type: "uint256" }],
        await returns(template("pyth", getPrice), [stub, 1n]),
      );
      expect([price, conf, expo, publishTime]).toEqual([-42n, 3n, -8n, 1234n]);
    });

    it("ambient.swap: a negative flow paid out and a positive flow paid in", async () => {
      const [baseFlow, quoteFlow] = decodeAbiParameters(
        [{ type: "int256" }, { type: "int256" }],
        await returns(template("ambient", ambientSwap), [
          stub,
          TOKEN_A,
          TOKEN_B,
          420n,
          true,
          true,
          1_000n,
          0n,
        ]),
      );
      expect([baseFlow, quoteFlow]).toEqual([-1_000n, 999n]);
    });
  });

  describe("Int256 inputs narrowed to the ABI's intN: the width is the guard", () => {
    const poolFor = (spacing: bigint) =>
      returns(template("aerodrome-slipstream", getPool), [stub, TOKEN_A, TOKEN_B, spacing]);

    it("aerodrome-slipstream.getPool: a real spacing, and either int24 end, land exactly", async () => {
      // The callee answers with the int24 it received, as an address: its 24 bits.
      for (const spacing of [1n, 50n, 200n, INT24_MAX, INT24_MIN]) {
        expect(BigInt(await poolFor(spacing))).toBe(BigInt.asUintN(24, spacing));
      }
    });

    it("aerodrome-slipstream.getPool: one past either int24 end reverts", async () => {
      for (const spacing of [INT24_MAX + 1n, INT24_MIN - 1n]) {
        await expect(poolFor(spacing)).rejects.toThrow();
      }
    });

    it("superfluid.createFlow and updateFlow: a flow rate lands as the int96 the forwarder takes", async () => {
      // 1e18 tokens a month, per second.
      const perSecond = 10n ** 18n / (30n * 86_400n);
      for (const [source, read] of [
        [createFlow, "lastCreatedFlowrate"],
        [updateFlow, "lastUpdatedFlowrate"],
      ] as const) {
        const program = template("superfluid", source);
        for (const flowrate of [perSecond, INT96_MAX, INT96_MIN]) {
          expect(await cook(program, [stub, TOKEN_A, OWNER.address, RECIPIENT, flowrate])).toBe(
            "success",
          );
          expect(await recorded(read)).toBe(flowrate);
        }
      }
    });

    it("superfluid.createFlow and updateFlow: one past either int96 end reverts and moves nothing", async () => {
      for (const [source, read] of [
        [createFlow, "lastCreatedFlowrate"],
        [updateFlow, "lastUpdatedFlowrate"],
      ] as const) {
        const program = template("superfluid", source);
        for (const flowrate of [INT96_MAX + 1n, INT96_MIN - 1n]) {
          expect(await cook(program, [stub, TOKEN_A, OWNER.address, RECIPIENT, flowrate])).toBe(
            "reverted",
          );
        }
        expect(await recorded(read)).toBe(0n);
      }
    });
  });

  describe("inputs that are never negative keep Uint256, and the ABI width is the guard", () => {
    it("curve.swap: the coin indices land as the int128 the pool takes", async () => {
      const program = template("curve", curveSwap);
      expect(await cook(program, [stub, 1n, 2n, 777n, 0n])).toBe("success");
      expect(await recorded("lastI")).toBe(1n);
      expect(await recorded("lastJ")).toBe(2n);

      expect(await cook(program, [stub, INT128_MAX, 0n, 777n, 0n])).toBe("success");
      expect(await recorded("lastI")).toBe(INT128_MAX);
      expect(await recorded("lastJ")).toBe(0n);

      const [out] = decodeAbiParameters(
        [{ type: "uint256" }],
        await returns(program, [stub, 1n, 2n, 777n, 0n]),
      );
      expect(out).toBe(777n);
    });

    it("curve.swap: an index past int128 reverts and moves nothing", async () => {
      const program = template("curve", curveSwap);
      expect(await cook(program, [stub, 0n, 1n, 777n, 0n])).toBe("success");
      for (const [i, j] of [
        [INT128_MAX + 1n, 1n],
        [0n, twos(-1n)],
      ] as const) {
        expect(await cook(program, [stub, i, j, 777n, 0n])).toBe("reverted");
      }
      expect(await recorded("lastI")).toBe(0n);
      expect(await recorded("lastJ")).toBe(1n);
    });
  });
});
