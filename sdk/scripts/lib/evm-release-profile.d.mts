import type { Abi, Hex } from "viem";
import type { EvmPotRuntimeProfile } from "../../src/evm/pot-binding.js";
export function releasePinPending(entry: unknown): boolean;
export function validateCompiledPotProfile(profile: unknown, pot: unknown): Hex;
export function validateCreate3Release(input: unknown): {
  gate: { potProfileHash: Hex; potInitCodeHash?: never; readonly [key: string]: unknown };
  profile: EvmPotRuntimeProfile;
  contracts: Record<string, { abi: Abi; bytecode: Hex }>;
  profileHash: Hex;
};
