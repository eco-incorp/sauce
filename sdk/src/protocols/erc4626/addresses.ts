import type { ChainDeployment } from "../../core/types.js";

// ERC-4626 is a standard interface, not a single deployment.
// Any vault that conforms to EIP-4626 can be used with these functions.
export const deployments: ChainDeployment[] = [];
