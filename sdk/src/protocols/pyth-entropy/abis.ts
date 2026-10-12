/**
 * Pyth Entropy v2 (IEntropyV2, pyth-crosschain target_chains/ethereum/entropy_sdk/solidity). Every
 * `requestV2` is payable, takes at least the matching `getFeeV2`, keeps any excess, and returns the
 * request's sequence number, which counts per provider: a request is the pair (provider,
 * sequenceNumber). The overloads without a provider use `getDefaultProvider()`, and those without a
 * gas limit the provider's default. A gas limit is rounded up to 10,000 and raised to the
 * provider's default. The requester is called back by this contract with
 * `_entropyCallback(uint64 sequence, address provider, bytes32 randomNumber)` (IEntropyConsumer),
 * with at most the request's gas limit. A callback that reverts leaves the request open, and anyone
 * may reveal it again.
 */
export const EntropyABI = [
  {
    name: "requestV2",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "assignedSequenceNumber", type: "uint64" }],
  },
  {
    name: "requestV2",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "gasLimit", type: "uint32" }],
    outputs: [{ name: "assignedSequenceNumber", type: "uint64" }],
  },
  {
    name: "requestV2",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "gasLimit", type: "uint32" },
    ],
    outputs: [{ name: "assignedSequenceNumber", type: "uint64" }],
  },
  {
    name: "requestV2",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "gasLimit", type: "uint32" },
    ],
    outputs: [{ name: "assignedSequenceNumber", type: "uint64" }],
  },
  {
    name: "getDefaultProvider",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "provider", type: "address" }],
  },
  {
    name: "getFeeV2",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "feeAmount", type: "uint128" }],
  },
  {
    name: "getFeeV2",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "gasLimit", type: "uint32" }],
    outputs: [{ name: "feeAmount", type: "uint128" }],
  },
  {
    name: "getFeeV2",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
      { name: "gasLimit", type: "uint32" },
    ],
    outputs: [{ name: "feeAmount", type: "uint128" }],
  },
  {
    type: "event",
    name: "Requested",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "sequenceNumber", type: "uint64", indexed: true },
      { name: "userContribution", type: "bytes32", indexed: false },
      { name: "gasLimit", type: "uint32", indexed: false },
      { name: "extraArgs", type: "bytes", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Revealed",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "sequenceNumber", type: "uint64", indexed: true },
      { name: "randomNumber", type: "bytes32", indexed: false },
      { name: "userContribution", type: "bytes32", indexed: false },
      { name: "providerContribution", type: "bytes32", indexed: false },
      { name: "callbackFailed", type: "bool", indexed: false },
      { name: "callbackReturnValue", type: "bytes", indexed: false },
      { name: "callbackGasUsed", type: "uint32", indexed: false },
      { name: "extraArgs", type: "bytes", indexed: false },
    ],
    anonymous: false,
  },
] as const;
