import type { ChainDeployment } from "../../core/types.js";

// ERC20 is a standard interface, not a specific deployment.
// Any token contract that implements the standard can be used.
export const deployments: ChainDeployment[] = [];
