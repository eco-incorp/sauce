import type { Abi, Address, Hex } from "viem";
import type { EvmPotBindingInput, EvmPotRuntimeProfile } from "../../src/evm/pot-binding.js";
import type { ReleaseStackArtifacts } from "../../src/evm/release-stack.js";

type ContractArtifact = { abi: Abi; bytecode: Hex };
export interface LocalCandidateArtifacts {
  artifacts: {
    V12Pot: ContractArtifact;
    V12Kitchen: ContractArtifact;
    V12KitchenProxy: ContractArtifact;
    Router: ContractArtifact;
    ISauceRouter: ContractArtifact;
    V12RuntimeBytecode: { runtimeCreationCode: Hex };
    V12PotProfile: EvmPotRuntimeProfile;
    V12EngineGate: {
      scheme: "create3";
      kitchen: Address;
      fixedRouter: Address;
      potProfileHash: Hex;
      profile: EvmPotRuntimeProfile;
      potInitCodeHash?: never;
    };
  };
  binding: Omit<EvmPotBindingInput, "pot" | "owner" | "userSalt" | "kind" | "chainId"> & {
    source: "LOCAL";
    routerCodeHash: Hex;
    profile: EvmPotRuntimeProfile;
    profileHash: Hex;
  };
  deployments: ReleaseStackArtifacts["deployments"];
}
export function loadLocalCandidate(path: string): LocalCandidateArtifacts;
export function syncLocalCandidate(
  path: string,
  destinations: readonly string[],
): LocalCandidateArtifacts;
