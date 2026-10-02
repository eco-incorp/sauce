/**
 * `sauce simulate`'s parts that need no chain: where a token keeps a balance (against a stand-in
 * client that answers `balanceOf` from the storage a state override writes, for every layout the
 * search knows and the ones it must refuse), merging overrides, and reading a cook's logs back.
 * Running them against a chain is `cli-simulate.e2e.test.ts`.
 */
import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  getAddress,
  keccak256,
  pad,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { assumeTokenBalance, findBalanceSlot, mergeOverrides } from "../src/cli/assume.js";
import { revertReason } from "../src/cli/chain.js";
import { effectLines, effectsJson, effectsOf, type RawLog } from "../src/cli/effects.js";
import { POT_ROUTER_SLOT } from "../src/cli/rehearse.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const TOKEN = getAddress("0x1000000000000000000000000000000000000001");
const HOLDER = getAddress("0x5a0ce0000000000000000000000000000000beef");
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const word = (value: bigint | Hex): Hex => pad(toHex(BigInt(value)), { size: 32 });
const solidity = (slot: bigint | Hex) =>
  keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [HOLDER, BigInt(slot)]),
  );

/**
 * A client whose one token answers `balanceOf(holder)` from the word at `slotOf(holder)` — 0 unless
 * a state override writes it. `refuses` makes it revert when any of those words is written too.
 */
function tokenClient(options: {
  readonly slotOf?: (holder: Address) => Hex;
  readonly refuses?: readonly Hex[];
  readonly overrides?: boolean;
}): PublicClient {
  const call = async ({
    to,
    data,
    stateOverride,
  }: {
    to?: Address;
    data?: Hex;
    stateOverride?: StateOverride;
  }): Promise<{ data?: Hex }> => {
    const applied = options.overrides === false ? undefined : stateOverride;
    const own = applied?.find((entry) => getAddress(entry.address) === getAddress(to!));
    if (own?.code !== undefined)
      return { data: own.code === "0x602a60005260206000f3" ? word(42n) : "0x" };
    const storage = new Map(
      (own?.stateDiff ?? []).map((entry) => [entry.slot.toLowerCase(), entry.value]),
    );
    if ((options.refuses ?? []).some((slot) => storage.has(slot.toLowerCase()))) {
      throw new Error("execution reverted");
    }
    const { args } = decodeFunctionData({ abi: ERC20, data: data! });
    const slot = options.slotOf?.(args![0] as Address);
    if (slot === undefined) return { data: word(7n) };

    return { data: storage.get(slot.toLowerCase()) ?? word(0n) };
  };

  return { call } as unknown as PublicClient;
}

describe("--assume-balance: where a token keeps a holder's balance", () => {
  it.each<[string, (holder: Address) => Hex]>([
    ["Solidity mapping at slot 0", () => solidity(0n)],
    // USDC's FiatToken: the balance mapping is at slot 9, behind the proxy.
    ["Solidity mapping at slot 9", () => solidity(9n)],
    // An OpenZeppelin v4 upgradeable token, after its storage gaps.
    ["Solidity mapping at slot 51", () => solidity(51n)],
    [
      "Vyper HashMap at slot 3",
      (holder) =>
        keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [3n, holder])),
    ],
    [
      "OpenZeppelin ERC20Upgradeable (ERC-7201 namespace)",
      () => solidity("0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00"),
    ],
    ["Solady ERC20", (holder) => keccak256(concat([holder, pad("0x", { size: 8 }), "0x87a211a2"]))],
  ])("finds the %s layout", async (layout, slotOf) => {
    const found = await findBalanceSlot(tokenClient({ slotOf }), TOKEN, HOLDER, "TKN");
    expect(found).toEqual({ slot: slotOf(HOLDER), layout });
  });

  it("tries each slot alone when writing them all at once trips the token", async () => {
    const found = await findBalanceSlot(
      tokenClient({ slotOf: () => solidity(9n), refuses: [solidity(2n)] }),
      TOKEN,
      HOLDER,
      "TKN",
    );
    expect(found.layout).toBe("Solidity mapping at slot 9");
  });

  it("confirms the slot with balanceOf, and returns the override that writes the amount", async () => {
    const assumed = await assumeTokenBalance(
      tokenClient({ slotOf: () => solidity(9n) }),
      TOKEN,
      HOLDER,
      2_000_000n,
      "USDC",
    );
    expect(assumed.override).toEqual({
      address: TOKEN,
      stateDiff: [{ slot: solidity(9n), value: word(2_000_000n) }],
    });
  });

  it("refuses a token whose balance is not stored, and an endpoint that ignores overrides", async () => {
    await expect(findBalanceSlot(tokenClient({}), TOKEN, HOLDER, "TKN")).rejects.toThrow(
      `--assume-balance TKN: no storage slot of ${TOKEN} holds the balance its balanceOf reports`,
    );
    await expect(
      findBalanceSlot(
        tokenClient({ slotOf: () => solidity(0n), overrides: false }),
        TOKEN,
        HOLDER,
        "TKN",
      ),
    ).rejects.toThrow("the endpoint does not apply state overrides to eth_call");
  });
});

describe("--assume-balance on a B20 token", () => {
  it("refuses it by what it is, before searching its storage", async () => {
    let calls = 0;
    const client = {
      call: async () => {
        calls++;
        return { data: word(7n) };
      },
      getCode: async () => "0xef",
    } as unknown as PublicClient;
    await expect(findBalanceSlot(client, TOKEN, HOLDER, "SPCXc")).rejects.toThrow(
      `--assume-balance SPCXc: ${TOKEN} is a B20 token, a precompile of the Base node`,
    );
    expect(calls).toBe(0);
  });
});

describe("state overrides", () => {
  it("merges every override for one account into one entry, the later word winning", () => {
    const merged = mergeOverrides([
      { address: TOKEN, stateDiff: [{ slot: solidity(0n), value: word(1n) }] },
      { address: HOLDER, balance: 5n },
      {
        address: TOKEN.toLowerCase() as Address,
        stateDiff: [
          { slot: solidity(0n), value: word(2n) },
          { slot: solidity(1n), value: word(3n) },
        ],
      },
      { address: HOLDER, code: "0x00", nonce: 1 },
    ]);
    expect(merged).toEqual([
      {
        address: TOKEN,
        stateDiff: [
          { slot: solidity(0n).toLowerCase(), value: word(2n) },
          { slot: solidity(1n).toLowerCase(), value: word(3n) },
        ],
      },
      { address: HOLDER, balance: 5n, code: "0x00", nonce: 1 },
    ]);
  });

  it("puts the Pot's Router where Pot.sol's ERC-7201 namespace says", () => {
    expect(POT_ROUTER_SLOT).toBe(
      "0x5dcf1afeb37fe4804d4db2aa42e07f76a76c328b0f50beb6b52ea4daec1f5f00",
    );
  });
});

describe("a revert, by name", () => {
  it("decodes ERC-20's standard errors (EIP-6093), which a token's balance shortfall reverts with", () => {
    const data = encodeErrorResult({
      abi: parseAbi([
        "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
      ]),
      errorName: "ERC20InsufficientBalance",
      args: [HOLDER, 0n, 2_000_000n],
    });
    expect(revertReason({ data })).toBe(`ERC20InsufficientBalance(${HOLDER}, 0, 2000000)`);
  });

  const message = (text: string) =>
    revertReason({
      data: encodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        errorName: "Error",
        args: [text],
      }),
    });

  it("says what a pool's short revert string means", () => {
    expect(message("SPL")).toMatch(
      /^"SPL" \(a V3-style pool's price-limit check: the limit is on the wrong side of the pool's current price, or at or past a bound/,
    );
    expect(message("LOK")).toMatch(/^"LOK" \(a V3-style pool's lock: the pool is not initialized/);
    expect(message("STF")).toMatch(/^"STF" \(a token's transferFrom failed/);
    // A pair's own check, under any fork's name — and not a router's string of the same reason.
    expect(message("UniswapV2: K")).toMatch(/^"UniswapV2: K" \(the pair's constant-product check/);
    expect(message("Pancake: K")).toMatch(/^"Pancake: K" \(the pair's constant-product check/);
    expect(message("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT")).toBe(
      '"UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"',
    );
    // A program's own message stays as it is.
    expect(message("fill below minOut")).toBe('"fill below minOut"');
  });

  it("has a meaning for every string it knows, and none for one it does not", async () => {
    const { poolRevertMeaning } = await import("../src/cli/chain.js");
    const known: Array<[string, RegExp]> = [
      ["SPL", /price-limit check/],
      ["AS", /amount is not zero/],
      ["LOK", /lock/],
      ["IIA", /callback paid all the input/],
      ["TF", /could not transfer the output token/],
      ["STF", /transferFrom failed/],
      ["ST", /transfer failed/],
      ["SA", /approve failed/],
      ["STE", /native transfer failed/],
      ["Too little received", /below its minimum/],
      ["Too much requested", /more input than its maximum/],
      ["Transaction too old", /deadline has passed/],
      ["UniswapV2: K", /constant-product check/],
      ["UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT", /asked for no output/],
      ["UniswapV2: INSUFFICIENT_INPUT_AMOUNT", /received no input/],
      ["UniswapV2: INSUFFICIENT_LIQUIDITY", /reserves cannot pay/],
      ["UniswapV2: LOCKED", /re-entered/],
      ["UniswapV2: TRANSFER_FAILED", /could not transfer the output token/],
    ];
    for (const [text, meaning] of known)
      expect([text, poolRevertMeaning(text)]).toEqual([text, expect.stringMatching(meaning)]);
    for (const text of ["XYZ", "UniswapV2: SOMETHING", "UniswapV2Router: EXPIRED", ""]) {
      expect(poolRevertMeaning(text)).toBeUndefined();
    }
  });

  it("names the Router's errors, and says what the pair check means", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error InvalidPool()"]),
      errorName: "InvalidPool",
    });
    expect(revertReason({ data })).toBe(
      "InvalidPool() (the Router's check that the pool's token0 and token1 are the pair passed)",
    );
  });
});

describe("a rehearsal pinned to one block", () => {
  it("puts the block in every state read that names a moving one, or none", async () => {
    const { pinnedParams } = await import("../src/cli/chain.js");
    const block = "0x10";
    const tx = { to: HOLDER, data: "0x" };
    // eth_call's block is its second parameter: given, moving, or left out.
    expect(pinnedParams("eth_call", [tx, "latest", { [HOLDER]: {} }], block)).toEqual([
      tx,
      block,
      { [HOLDER]: {} },
    ]);
    expect(pinnedParams("eth_call", [tx, "pending"], block)).toEqual([tx, block]);
    expect(pinnedParams("eth_estimateGas", [tx], block)).toEqual([tx, block]);
    // A block the request names already is kept.
    expect(pinnedParams("eth_call", [tx, "0x5"], block)).toEqual([tx, "0x5"]);
    // eth_getStorageAt's is its third: a request short of it is padded to it.
    expect(pinnedParams("eth_getStorageAt", [HOLDER, "0x0"], block)).toEqual([
      HOLDER,
      "0x0",
      block,
    ]);
    expect(pinnedParams("eth_getStorageAt", [HOLDER], block)).toEqual([HOLDER, null, block]);
    expect(pinnedParams("eth_simulateV1", [{ blockStateCalls: [] }, "latest"], block)).toEqual([
      { blockStateCalls: [] },
      block,
    ]);
    // Anything that is not a state read is left alone.
    expect(pinnedParams("eth_blockNumber", [], block)).toEqual([]);
    expect(pinnedParams("eth_chainId", undefined, block)).toBeUndefined();
  });
});

describe("what the cook did, from its logs", () => {
  const base = requireChain("base");
  const usdc = getAddress(pad(toHex(registryTokenAddress(base, "USDC")!), { size: 20 }));
  const weth = getAddress(pad(toHex(registryTokenAddress(base, "WETH")!), { size: 20 }));
  const POT = getAddress("0x00000000000000000000000000000000000000a1");
  const POOL = getAddress("0x00000000000000000000000000000000000000b2");
  const OTHER = getAddress("0x00000000000000000000000000000000000000c3");
  const topic = (signature: string): Hex => keccak256(stringToHex(signature));
  const at = (address: Address): Hex => pad(address, { size: 32 });
  const TRANSFER = topic("Transfer(address,address,uint256)");
  const log = (address: Address, topics: Hex[], amount?: bigint): RawLog => ({
    address,
    topics,
    data: amount === undefined ? "0x" : word(amount),
  });
  // A token the registry does not know, answering its own symbol and decimals.
  const metadata = {
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (address !== OTHER) throw new Error("no such contract");
      return functionName === "symbol" ? "OTH" : 18;
    },
  } as unknown as PublicClient;

  it("decodes transfers, approvals, wraps and native transfers, and nets each address", async () => {
    const effects = await effectsOf(
      metadata,
      base,
      [
        log(usdc, [TRANSFER, at(POT), at(POOL)], 2_000_000n),
        log(weth, [TRANSFER, at(POOL), at(POT)], 10n ** 15n),
        log(weth, [topic("Withdrawal(address,uint256)"), at(POT)], 4n * 10n ** 14n),
        log(
          OTHER,
          [topic("Approval(address,address,uint256)"), at(POT), at(POOL)],
          5n * 10n ** 18n,
        ),
        // An ERC-721 Transfer, with the token id indexed: not an amount.
        log(OTHER, [TRANSFER, at(POT), at(POOL), word(1n)]),
        // A Deposit from a contract that is not the wrapped native token: some other event.
        log(OTHER, [topic("Deposit(address,uint256)"), at(POT)], 1n),
        log(
          "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          [TRANSFER, at(weth), at(POT)],
          4n * 10n ** 14n,
        ),
      ],
      true,
      new Map([[POT, "the Pot"]]),
    );
    expect(effects.transfers.map((move) => [move.kind, move.token, move.from, move.to])).toEqual([
      ["transfer", usdc, POT, POOL],
      ["transfer", weth, POOL, POT],
      ["unwrap", weth, POT, zeroAddress],
    ]);
    expect(effects.other).toHaveLength(2);
    expect(effects.changes).toEqual([
      {
        address: POT,
        deltas: [
          { token: usdc, amount: -2_000_000n },
          { token: weth, amount: 6n * 10n ** 14n },
          { token: "native", amount: 4n * 10n ** 14n },
        ],
      },
      {
        address: POOL,
        deltas: [
          { token: usdc, amount: 2_000_000n },
          { token: weth, amount: -(10n ** 15n) },
        ],
      },
      { address: weth, deltas: [{ token: "native", amount: -4n * 10n ** 14n }] },
    ]);
    const lines = effectLines(effects);
    expect(lines).toEqual(
      expect.arrayContaining([
        `  2 USDC: ${POT} (the Pot) -> ${POOL}`,
        `  0.0004 WETH unwrapped by ${POT} (the Pot)`,
        `  ${POT} (the Pot) lets ${POOL} spend 5 OTH`,
        `  0.0004 ETH: ${weth} -> ${POT} (the Pot)`,
        `  ${POT} (the Pot): -2 USDC, +0.0006 WETH, +0.0004 ETH`,
        `Other events: 2, from ${OTHER} x2 (--json lists them)`,
      ]),
    );
    const json = effectsJson(effects);
    expect(json.approvals).toEqual([
      {
        token: OTHER,
        symbol: "OTH",
        decimals: 18,
        owner: POT,
        spender: POOL,
        amount: "5000000000000000000",
        formatted: "5",
      },
    ]);
    expect((json.otherLogs as unknown[]).length).toBe(2);
  });

  it("says when the endpoint did not trace native transfers, and when nothing moved", async () => {
    const untraced = await effectsOf(metadata, base, [], false, new Map());
    expect(effectLines(untraced)).toEqual([
      "Native transfers: not reported (the endpoint did not trace them)",
    ]);
    expect(effectsJson(untraced).nativeTransfers).toBeNull();
    expect(effectLines(await effectsOf(metadata, base, [], true, new Map()))).toEqual([
      "It moved no tokens and logged nothing.",
    ]);
  });
});

describe("sauce simulate --assume-balance, offline", () => {
  async function sauce(...argv: string[]): Promise<{ code: number; stderr: string }> {
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: () => undefined,
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stderr };
  }
  const PAY = new URL("../../skills/sauce-cli/examples/pay.sauce.ts", import.meta.url).pathname;

  it.each([
    [["--assume-balance", "USDC"], "--assume-balance: expected <TOKEN|address>:<amount>"],
    [["--assume-balance", "DOGE:1"], "--assume-balance DOGE:1: DOGE is not a token base registers"],
    [
      ["--assume-balance", "USDC:1", "--assume-balance", "USDC:2"],
      "--assume-balance names USDC twice",
    ],
  ])("refuses %j before reaching a network", async (flags, message) => {
    const run = await sauce(
      "simulate",
      PAY,
      "--chain",
      "base",
      "--owner",
      HOLDER,
      "--rpc-url",
      "http://127.0.0.1:9",
      ...flags,
      "--args",
      HOLDER,
      "1",
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
  });

  it("is refused on Solana, whose simulateTransaction takes no overrides", async () => {
    const run = await sauce(
      "simulate",
      PAY,
      "--chain",
      "solana",
      "--owner",
      "11111111111111111111111111111111",
      "--rpc-url",
      "http://127.0.0.1:9",
      "--assume-balance",
      "ETH:1",
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--assume-balance is for EVM chains");
  });

  it("lists the flags one kind of chain takes under their own heading in --help", async () => {
    let help = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (help += text),
      stderr: () => undefined,
    };
    expect(await runCli(["simulate", "--help"], io)).toBe(0);
    const section = (heading: string): string =>
      help.slice(help.indexOf(heading)).split("\n\n")[0]!;
    expect(help).toContain(
      "Usage: sauce simulate <file | -> --chain <slug|id> (--owner <address> | --pot <address>)",
    );
    expect(help).toContain("       sauce simulate <file | -> --chain solana --owner <pubkey>");
    for (const flag of ["--pot", "--value", "--assume-balance", "--fund-mode", "--keystore"]) {
      expect(section("EVM chains only:")).toContain(`${flag} `);
      expect(section("Options:")).not.toContain(`${flag} `);
    }
    expect(section("Solana only:")).toContain("--account NAME=<address>");
    expect(section("Solana only:")).toContain("--keypair <path>");
    expect(section("Options:")).not.toContain("--keypair ");
    expect(section("Options:")).toContain("--owner <address>");
  });
});
