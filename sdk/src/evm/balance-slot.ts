/**
 * Where a token keeps a holder's balance, found by asking the token — plain `eth_call` with state
 * overrides, no trace or debug API — so a balance can be overridden for one call (the `sauce
 * simulate --assume-balance` rehearsal) or written on a local node (`@eco-incorp/sauce/testing`).
 *
 *   1. every candidate slot is written at once, each with its own marker, and the marker
 *      `balanceOf(holder)` answers names the slot. Should that one call not settle it (a token
 *      whose `balanceOf` trips over one of the other writes), each candidate is tried alone;
 *   2. the slot found is written with the amount, alone, and `balanceOf(holder)` must answer exactly
 *      that, or nothing is written.
 *
 * The candidates are the layouts a balance mapping takes: Solidity's `mapping(address => uint256)`
 * at slots 0–255 (`keccak256(holder . slot)`), Vyper's `HashMap` at slots 0–31
 * (`keccak256(slot . holder)`), OpenZeppelin's namespaced (ERC-7201) upgradeable ERC-20, and
 * Solady's ERC-20. A token behind a proxy keeps it in the proxy's storage. A token whose balance is
 * computed rather than stored (a rebasing token, shares) has no such slot, and is refused with that
 * said. So is a B20 token, a precompile of the Base node (Coinbase's tokenized stocks), whose
 * account holds the one byte `0xef` and whose balances the node keeps where no override reaches.
 *
 * Failures are {@link BalanceSlotError}s naming which of those it was, so each caller words them for
 * its own flags.
 */
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
  getAddress,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

const BALANCE_OF = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Where a holder's balance lives in a token's storage, and which layout put it there. */
export interface BalanceSlot {
  readonly slot: Hex;
  readonly layout: string;
}

type Candidate = BalanceSlot;

/** Why no balance slot could be used: the token is a B20 precompile, does not answer `balanceOf`,
 *  the endpoint ignores state overrides, no candidate slot holds the balance, or writing the slot
 *  found does not make `balanceOf` answer the amount. */
export type BalanceSlotFailure = "b20" | "not-erc20" | "no-overrides" | "not-stored" | "write";

export class BalanceSlotError extends Error {
  constructor(
    readonly failure: BalanceSlotFailure,
    readonly token: Address,
    message: string,
  ) {
    super(message);
    this.name = "BalanceSlotError";
  }
}

/** A B20 token's code: no bytecode, the one byte that marks the node's own token. */
const B20_CODE = "0xef";
const SOLIDITY_SLOTS = 256;
const VYPER_SLOTS = 32;
/** OpenZeppelin's `ERC20Upgradeable` (v5) storage namespace, `openzeppelin.storage.ERC20`, whose
 *  first field is the balances mapping. */
const OZ_ERC20_NAMESPACE = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";
/** Solady `ERC20`'s balance slot seed: the slot is `keccak256(holder . uint64(0) . uint32(seed))`. */
const SOLADY_BALANCE_SEED = "0x87a211a2";

/** Every slot a holder's balance might be at, in the order a hit is most likely. */
export function balanceSlotCandidates(holder: Address): Candidate[] {
  const solidity = (slot: bigint | Hex): Hex =>
    keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(slot)]),
    );
  const vyper = (slot: bigint): Hex =>
    keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [slot, holder]));

  return [
    ...Array.from({ length: SOLIDITY_SLOTS }, (_, at) => ({
      slot: solidity(BigInt(at)),
      layout: `Solidity mapping at slot ${at}`,
    })),
    {
      slot: solidity(OZ_ERC20_NAMESPACE),
      layout: "OpenZeppelin ERC20Upgradeable (ERC-7201 namespace)",
    },
    {
      slot: keccak256(concat([holder, pad("0x", { size: 8 }), SOLADY_BALANCE_SEED])),
      layout: "Solady ERC20",
    },
    ...Array.from({ length: VYPER_SLOTS }, (_, at) => ({
      slot: vyper(BigInt(at)),
      layout: `Vyper HashMap at slot ${at}`,
    })),
  ];
}

/** Markers below 2^64, so a balance packed into fewer bits than a word still reads one back. */
const MARKER_BASE = 0x5a0ce5a0ce000000n;
const word = (value: bigint): Hex => numberToHex(value, { size: 32 });

/** `balanceOf(holder)` on `token` with `slots` overridden; `undefined` when the call fails. */
async function balanceWith(
  client: PublicClient,
  token: Address,
  holder: Address,
  slots: ReadonlyArray<{ readonly slot: Hex; readonly value: bigint }>,
): Promise<bigint | undefined> {
  try {
    const { data } = await client.call({
      to: token,
      data: encodeFunctionData({ abi: BALANCE_OF, functionName: "balanceOf", args: [holder] }),
      ...(slots.length === 0
        ? {}
        : {
            stateOverride: [
              {
                address: token,
                stateDiff: slots.map(({ slot, value }) => ({ slot, value: word(value) })),
              },
            ],
          }),
    });
    if (data === undefined || data.length !== 66) return undefined;

    return decodeFunctionResult({ abi: BALANCE_OF, functionName: "balanceOf", data });
  } catch {
    return undefined;
  }
}

/** The candidate whose marker `balanceOf` answered with, if any. */
const answered = (candidates: readonly Candidate[], balance: bigint | undefined) => {
  if (balance === undefined || balance < MARKER_BASE) return undefined;

  return candidates[Number(balance - MARKER_BASE)];
};

/** Whether the endpoint applies an `eth_call` state override at all: code put at an empty address
 *  must answer. */
async function overridesApplied(client: PublicClient): Promise<boolean> {
  const probe: Address = "0x5a0CE00000000000000000000000000000005a0C";
  try {
    const { data } = await client.call({
      to: probe,
      // PUSH1 0x2a PUSH1 0 MSTORE PUSH1 0x20 PUSH1 0 RETURN: answers the word 42.
      stateOverride: [{ address: probe, code: "0x602a60005260206000f3" }],
    });

    return data !== undefined && BigInt(data) === 42n;
  } catch {
    return false;
  }
}

/**
 * The slot of `token`'s storage holding `holder`'s balance, found with `eth_call` and state
 * overrides and confirmed by `balanceOf`.
 */
export async function findBalanceSlot(
  client: PublicClient,
  token: Address,
  holder: Address,
): Promise<BalanceSlot> {
  let code: Hex | undefined;
  try {
    code = await client.getCode({ address: token });
  } catch {
    // Unread code says nothing: the search below decides.
  }
  if (code === B20_CODE) {
    throw new BalanceSlotError(
      "b20",
      token,
      `${token} is a B20 token, a precompile of the Base node, which keeps its balances where no ` +
        "state override reaches",
    );
  }
  const candidates = balanceSlotCandidates(holder);
  const current = await balanceWith(client, token, holder, []);
  if (current === undefined) {
    throw new BalanceSlotError(
      "not-erc20",
      token,
      `${token} does not answer balanceOf(address), so it is not an ERC-20 a balance can be set of`,
    );
  }
  // One call with every candidate written: the marker that comes back names the slot.
  let found = answered(
    candidates,
    await balanceWith(
      client,
      token,
      holder,
      candidates.map(({ slot }, index) => ({ slot, value: MARKER_BASE + BigInt(index) })),
    ),
  );
  // Each alone, a few at a time, when writing them all at once did not settle it.
  for (let at = 0; found === undefined && at < candidates.length; at += 16) {
    const batch = candidates.slice(at, at + 16);
    const answers = await Promise.all(
      batch.map((candidate, index) =>
        balanceWith(client, token, holder, [
          { slot: candidate.slot, value: MARKER_BASE + BigInt(at + index) },
        ]),
      ),
    );
    found = answers.map((answer) => answered(candidates, answer)).find((hit) => hit !== undefined);
  }
  if (found === undefined) {
    if (!(await overridesApplied(client))) {
      throw new BalanceSlotError(
        "no-overrides",
        token,
        "the endpoint does not apply state overrides to eth_call, which finding a balance slot needs",
      );
    }
    throw new BalanceSlotError(
      "not-stored",
      token,
      `no storage slot of ${token} holds the balance its balanceOf reports (tried Solidity ` +
        `mappings at slots 0-${SOLIDITY_SLOTS - 1}, Vyper's at 0-${VYPER_SLOTS - 1}, ` +
        "OpenZeppelin's namespaced ERC-20 and Solady's): its balance is computed rather than " +
        "stored (rebasing, shares)",
    );
  }

  return found;
}

/**
 * `holder`'s balance of `token` set to `amount`: the slot found and the override that writes it,
 * confirmed by `balanceOf` answering exactly `amount` through it. Apply it to one call as a state
 * override, or write `override.stateDiff` to a local node's storage.
 */
export async function balanceOverride(
  client: PublicClient,
  token: Address,
  holder: Address,
  amount: bigint,
): Promise<BalanceSlot & { readonly override: StateOverride[number] }> {
  const found = await findBalanceSlot(client, token, holder);
  const write = [{ slot: found.slot, value: amount }];
  if ((await balanceWith(client, token, holder, write)) !== amount) {
    throw new BalanceSlotError(
      "write",
      token,
      `writing ${amount} at ${found.slot} (${found.layout}) of ${token} does not make ` +
        `balanceOf(${holder}) answer ${amount}`,
    );
  }

  return {
    ...found,
    override: {
      address: getAddress(token),
      stateDiff: [{ slot: found.slot, value: word(amount) }],
    },
  };
}

/**
 * Overrides for the same account, merged into one entry each: a node takes one override per
 * address, and viem refuses two.
 */
export function mergeOverrides(overrides: readonly StateOverride[number][]): StateOverride {
  const byAddress = new Map<string, StateOverride[number]>();
  for (const override of overrides) {
    const key = getAddress(override.address);
    const before = byAddress.get(key);
    if (before === undefined) {
      byAddress.set(key, { ...override, address: key });
      continue;
    }
    const slots = new Map<string, Hex>();
    for (const entry of [...(before.stateDiff ?? []), ...(override.stateDiff ?? [])]) {
      slots.set(entry.slot.toLowerCase(), entry.value);
    }
    const balance = override.balance ?? before.balance;
    const nonce = override.nonce ?? before.nonce;
    const code = override.code ?? before.code;
    byAddress.set(key, {
      address: key,
      ...(balance === undefined ? {} : { balance }),
      ...(nonce === undefined ? {} : { nonce }),
      ...(code === undefined ? {} : { code }),
      ...(slots.size === 0
        ? {}
        : { stateDiff: [...slots].map(([slot, value]) => ({ slot: slot as Hex, value })) }),
    });
  }

  return [...byAddress.values()];
}
