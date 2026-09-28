export const GelatoAutomateABI = [
  {
    name: "createTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "execAddress", type: "address" },
      { name: "execDataOrSelector", type: "bytes" },
      {
        name: "moduleData",
        type: "tuple",
        components: [
          { name: "modules", type: "uint8[]" },
          { name: "args", type: "bytes[]" },
        ],
      },
      { name: "feeToken", type: "address" },
    ],
    outputs: [{ name: "taskId", type: "bytes32" }],
  },
  {
    name: "cancelTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [],
  },
] as const;
