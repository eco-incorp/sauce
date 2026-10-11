// SP1VerifierGateway, as verified on Sourcify (an exact match on Ethereum and Base, solc 0.8.20):
// it routes a proof to the SP1 verifier its first four bytes name, refusing a route that is missing
// or frozen. succinctlabs/sp1-contracts, `contracts/src/SP1VerifierGateway.sol`. Left out:
// `RouteNotFound(bytes4)`, which the code pushes shifted right one bit (PUSH4 0x79043bbf, then
// SHL 225), a form the registry's evidence capture does not read.
export const SP1VerifierGatewayABI = [
  {
    name: "addRoute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "verifier", type: "address" }],
    outputs: [],
  },
  {
    name: "freezeRoute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "selector", type: "bytes4" }],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "renounceOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "routes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes4" }],
    outputs: [
      { name: "verifier", type: "address" },
      { name: "frozen", type: "bool" },
    ],
  },
  {
    name: "transferOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    name: "verifyProof",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "programVKey", type: "bytes32" },
      { name: "publicValues", type: "bytes" },
      { name: "proofBytes", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "OwnershipTransferred",
    type: "event",
    anonymous: false,
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    name: "RouteAdded",
    type: "event",
    anonymous: false,
    inputs: [
      { name: "selector", type: "bytes4", indexed: false },
      { name: "verifier", type: "address", indexed: false },
    ],
  },
  {
    name: "RouteFrozen",
    type: "event",
    anonymous: false,
    inputs: [
      { name: "selector", type: "bytes4", indexed: false },
      { name: "verifier", type: "address", indexed: false },
    ],
  },
  { name: "OwnableInvalidOwner", type: "error", inputs: [{ name: "owner", type: "address" }] },
  {
    name: "OwnableUnauthorizedAccount",
    type: "error",
    inputs: [{ name: "account", type: "address" }],
  },
  { name: "RouteAlreadyExists", type: "error", inputs: [{ name: "verifier", type: "address" }] },
  { name: "RouteIsFrozen", type: "error", inputs: [{ name: "selector", type: "bytes4" }] },
  { name: "SelectorCannotBeZero", type: "error", inputs: [] },
] as const;
