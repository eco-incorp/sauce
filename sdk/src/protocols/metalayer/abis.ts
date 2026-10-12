// The MetalayerRouter (@metalayer/contracts src/MetalayerRouter.sol). `dispatch` sends `writeCallData`
// to `recipient` on the destination domain, with the reads it lists (none here) and the gas the
// destination call is given; the router there calls the recipient's
// `handle(uint32 origin, bytes32 sender, bytes message, ReadOperation[] reads, bytes[] results)`.
// `quoteDispatch` with hook metadata prices that gas, as eco-routes' MetaProver quotes it.
export const MetalayerRouterABI = [
  {
    type: "function",
    name: "dispatch",
    stateMutability: "payable",
    inputs: [
      { name: "_destinationDomain", type: "uint32" },
      { name: "_recipientAddress", type: "bytes32" },
      {
        name: "_reads",
        type: "tuple[]",
        components: [
          { name: "domain", type: "uint32" },
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
      { name: "_writeCallData", type: "bytes" },
      { name: "_finalityState", type: "uint8" },
      { name: "_gasLimit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "quoteDispatch",
    stateMutability: "view",
    inputs: [
      { name: "destinationDomain", type: "uint32" },
      { name: "recipientAddress", type: "bytes32" },
      { name: "messageBody", type: "bytes" },
      { name: "defaultHookMetadata", type: "bytes" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
] as const;
