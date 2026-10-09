/**
 * Sync a Uniswap V3 pool's price and token balances on a fork to match mainnet.
 *
 * Uses anvil_setStorageAt to copy:
 * - slot0 (sqrtPriceX96, tick, etc.)
 * - Token balances held by the pool
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type Hex,
  keccak256,
  encodePacked,
  pad,
  numberToHex,
} from "viem";

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const SLOT0_POSITION: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function formatSqrtPrice(sqrtPriceX96: bigint): string {
  const Q96 = 2n ** 96n;
  const priceNum = Number(sqrtPriceX96) / Number(Q96);
  return (priceNum * priceNum).toExponential(6);
}

async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function balanceKey(holder: Hex, slot: number): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32"],
      [pad(holder, { size: 32 }), pad(numberToHex(slot), { size: 32 })],
    ),
  );
}

/**
 * Find the storage slot used for an ERC20 balance mapping.
 * Tries Solidity-style (keccak256(addr . slot)) for slots 0-20.
 */
export async function findBalanceSlot(
  token: Hex,
  holder: Hex,
  forkRpc: string,
): Promise<number | null> {
  const forkClient = createPublicClient({ transport: http(forkRpc) });
  const balance = (await forkClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  } as any)) as bigint;

  if (balance === 0n) return null;

  const balanceHex = pad(numberToHex(balance), { size: 32 });

  for (let slot = 0; slot <= 20; slot++) {
    const key = balanceKey(holder, slot);
    const reading = (await rpc(forkRpc, "eth_getStorageAt", [token, key, "latest"])) as Hex;
    if (reading === balanceHex) return slot;
  }
  return null;
}

/**
 * Set an ERC20 token balance for an address on a Hardhat fork.
 */
export async function setBalance(
  token: Hex,
  holder: Hex,
  amount: bigint,
  balanceSlot: number,
  forkRpc: string,
) {
  const key = balanceKey(holder, balanceSlot);
  await rpc(forkRpc, "anvil_setStorageAt", [token, key, pad(numberToHex(amount), { size: 32 })]);
}

export interface SyncPriceOptions {
  poolAddress: Hex;
  forkRpc: string;
  mainnetRpc: string;
}

export interface SyncPriceResult {
  token0: Hex;
  token1: Hex;
  fee: number;
  before: { sqrtPriceX96: bigint; balance0: bigint; balance1: bigint };
  after: { sqrtPriceX96: bigint; balance0: bigint; balance1: bigint };
}

/**
 * Sync a Uniswap V3 pool's slot0 and token balances from mainnet to a fork.
 */
export async function syncPrice(options: SyncPriceOptions): Promise<SyncPriceResult> {
  const { poolAddress, forkRpc, mainnetRpc } = options;

  const mainnetClient = createPublicClient({ transport: http(mainnetRpc) });
  const forkClient = createPublicClient({ transport: http(forkRpc) });

  // Read pool info
  const [token0, token1, fee] = (await Promise.all([
    forkClient.readContract({ address: poolAddress, abi: poolAbi, functionName: "token0" } as any),
    forkClient.readContract({ address: poolAddress, abi: poolAbi, functionName: "token1" } as any),
    forkClient.readContract({ address: poolAddress, abi: poolAbi, functionName: "fee" } as any),
  ])) as [Hex, Hex, number];

  // Read slot0 and balances from both
  const [_mainnetSlot0, forkSlot0] = (await Promise.all([
    mainnetClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "slot0",
    } as any),
    forkClient.readContract({ address: poolAddress, abi: poolAbi, functionName: "slot0" } as any),
  ])) as [any, any];

  const [mainnetBal0, mainnetBal1, forkBal0, forkBal1] = (await Promise.all([
    mainnetClient.readContract({
      address: token0,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
    mainnetClient.readContract({
      address: token1,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
    forkClient.readContract({
      address: token0,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
    forkClient.readContract({
      address: token1,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
  ])) as [bigint, bigint, bigint, bigint];

  const before = { sqrtPriceX96: forkSlot0[0] as bigint, balance0: forkBal0, balance1: forkBal1 };

  // Sync slot0
  const mainnetRawSlot0 = (await rpc(mainnetRpc, "eth_getStorageAt", [
    poolAddress,
    SLOT0_POSITION,
    "latest",
  ])) as Hex;
  await rpc(forkRpc, "anvil_setStorageAt", [poolAddress, SLOT0_POSITION, mainnetRawSlot0]);

  // Sync token balances
  for (const [token, target] of [
    [token0, mainnetBal0],
    [token1, mainnetBal1],
  ] as [Hex, bigint][]) {
    const slot = await findBalanceSlot(token, poolAddress, forkRpc);
    if (slot !== null) {
      await setBalance(token, poolAddress, target, slot, forkRpc);
    }
  }

  // Read final state
  const newSlot0 = (await forkClient.readContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "slot0",
  } as any)) as any;

  const [newBal0, newBal1] = (await Promise.all([
    forkClient.readContract({
      address: token0,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
    forkClient.readContract({
      address: token1,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
    } as any),
  ])) as [bigint, bigint];

  return {
    token0,
    token1,
    fee,
    before,
    after: { sqrtPriceX96: newSlot0[0] as bigint, balance0: newBal0, balance1: newBal1 },
  };
}
