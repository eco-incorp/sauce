export const Permit2ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "token", type: "address" },
    ],
    outputs: [],
  },
  {
    // SignatureTransfer: moves `requestedAmount` of `permitted.token` from `owner` to `to` on a
    // one-time EIP-712 signature by `owner`, which names the caller (`msg.sender`) as its spender.
    name: "permitTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "transferDetails",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "requestedAmount", type: "uint256" },
        ],
      },
      { name: "owner", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    // The unordered nonces SignatureTransfer spends: bit `nonce & 255` of word `nonce >> 8`.
    name: "nonceBitmap",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "wordPosition", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "lockdown",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "approvals",
        type: "tuple[]",
        components: [
          { name: "token", type: "address" },
          { name: "spender", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  // Its custom errors, so a revert inside Permit2 reads as its name rather than as raw data.
  {
    name: "SignatureExpired",
    type: "error",
    inputs: [{ name: "signatureDeadline", type: "uint256" }],
  },
  { name: "InvalidNonce", type: "error", inputs: [] },
  { name: "InvalidSignature", type: "error", inputs: [] },
  { name: "InvalidSignatureLength", type: "error", inputs: [] },
  { name: "InvalidSigner", type: "error", inputs: [] },
  { name: "InvalidContractSignature", type: "error", inputs: [] },
  { name: "InvalidAmount", type: "error", inputs: [{ name: "maxAmount", type: "uint256" }] },
  { name: "LengthMismatch", type: "error", inputs: [] },
  { name: "AllowanceExpired", type: "error", inputs: [{ name: "deadline", type: "uint256" }] },
  { name: "InsufficientAllowance", type: "error", inputs: [{ name: "amount", type: "uint256" }] },
  { name: "ExcessiveInvalidation", type: "error", inputs: [] },
] as const;
