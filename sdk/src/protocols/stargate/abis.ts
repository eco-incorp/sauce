export const StargatePoolABI = [
  {
    name: "addTreasuryFee",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "_amountLD", type: "uint256" }],
    outputs: [],
  },
  {
    name: "allowBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_burnAdmin", type: "address" },
      { name: "_burnAllowanceSD", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "approvalRequired",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "burnAdmin",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "burnAllowanceSD",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  { name: "burnLocked", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    name: "burnLockedUSDC",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "deficitOffset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_receiver", type: "address" },
      { name: "_amountLD", type: "uint256" },
    ],
    outputs: [{ name: "amountLD", type: "uint256" }],
  },
  {
    name: "endpoint",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getAddressConfig",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "feeLib", type: "address" },
          { name: "planner", type: "address" },
          { name: "treasurer", type: "address" },
          { name: "tokenMessaging", type: "address" },
          { name: "creditMessaging", type: "address" },
          { name: "lzToken", type: "address" },
        ],
      },
    ],
  },
  {
    name: "getTransferGasLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "localEid",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    name: "lpToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "oftVersion",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [
      { name: "interfaceId", type: "bytes4" },
      { name: "version", type: "uint64" },
    ],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "paths",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "eid", type: "uint32" }],
    outputs: [{ name: "credit", type: "uint64" }],
  },
  {
    name: "plannerFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "available", type: "uint256" }],
  },
  {
    name: "poolBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "quoteOFT",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "oftLimit",
        type: "tuple",
        components: [
          { name: "minAmountLD", type: "uint256" },
          { name: "maxAmountLD", type: "uint256" },
        ],
      },
      {
        name: "oftFeeDetails",
        type: "tuple[]",
        components: [
          { name: "feeAmountLD", type: "int256" },
          { name: "description", type: "string" },
        ],
      },
      {
        name: "oftReceipt",
        type: "tuple",
        components: [
          { name: "amountSentLD", type: "uint256" },
          { name: "amountReceivedLD", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "quoteRedeemSend",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      { name: "_payInLzToken", type: "bool" },
    ],
    outputs: [
      {
        name: "fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "quoteSend",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      { name: "_payInLzToken", type: "bool" },
    ],
    outputs: [
      {
        name: "fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "receiveCredits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_srcEid", type: "uint32" },
      {
        name: "_credits",
        type: "tuple[]",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "amount", type: "uint64" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "receiveTokenBus",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_origin",
        type: "tuple",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "sender", type: "bytes32" },
          { name: "nonce", type: "uint64" },
        ],
      },
      { name: "_guid", type: "bytes32" },
      { name: "_seatNumber", type: "uint8" },
      { name: "_receiver", type: "address" },
      { name: "_amountSD", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "receiveTokenTaxi",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_origin",
        type: "tuple",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "sender", type: "bytes32" },
          { name: "nonce", type: "uint64" },
        ],
      },
      { name: "_guid", type: "bytes32" },
      { name: "_receiver", type: "address" },
      { name: "_amountSD", type: "uint64" },
      { name: "_composeMsg", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "recoverToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_token", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amountLD", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "amountLD", type: "uint256" }],
  },
  {
    name: "redeemable",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_owner", type: "address" }],
    outputs: [{ name: "amountLD", type: "uint256" }],
  },
  {
    name: "redeemSend",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      {
        name: "_fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
      { name: "_refundAddress", type: "address" },
    ],
    outputs: [
      {
        name: "msgReceipt",
        type: "tuple",
        components: [
          { name: "guid", type: "bytes32" },
          { name: "nonce", type: "uint64" },
          {
            name: "fee",
            type: "tuple",
            components: [
              { name: "nativeFee", type: "uint256" },
              { name: "lzTokenFee", type: "uint256" },
            ],
          },
        ],
      },
      {
        name: "oftReceipt",
        type: "tuple",
        components: [
          { name: "amountSentLD", type: "uint256" },
          { name: "amountReceivedLD", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "renounceOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "retryReceiveToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_guid", type: "bytes32" },
      { name: "_index", type: "uint8" },
      { name: "_srcEid", type: "uint32" },
      { name: "_receiver", type: "address" },
      { name: "_amountLD", type: "uint256" },
      { name: "_composeMsg", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "send",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      {
        name: "_fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
      { name: "_refundAddress", type: "address" },
    ],
    outputs: [
      {
        name: "msgReceipt",
        type: "tuple",
        components: [
          { name: "guid", type: "bytes32" },
          { name: "nonce", type: "uint64" },
          {
            name: "fee",
            type: "tuple",
            components: [
              { name: "nativeFee", type: "uint256" },
              { name: "lzTokenFee", type: "uint256" },
            ],
          },
        ],
      },
      {
        name: "oftReceipt",
        type: "tuple",
        components: [
          { name: "amountSentLD", type: "uint256" },
          { name: "amountReceivedLD", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "sendCredits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_dstEid", type: "uint32" },
      {
        name: "_credits",
        type: "tuple[]",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "amount", type: "uint64" },
          { name: "minAmount", type: "uint64" },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "amount", type: "uint64" },
        ],
      },
    ],
  },
  {
    name: "sendToken",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      {
        name: "_fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
      { name: "_refundAddress", type: "address" },
    ],
    outputs: [
      {
        name: "msgReceipt",
        type: "tuple",
        components: [
          { name: "guid", type: "bytes32" },
          { name: "nonce", type: "uint64" },
          {
            name: "fee",
            type: "tuple",
            components: [
              { name: "nativeFee", type: "uint256" },
              { name: "lzTokenFee", type: "uint256" },
            ],
          },
        ],
      },
      {
        name: "oftReceipt",
        type: "tuple",
        components: [
          { name: "amountSentLD", type: "uint256" },
          { name: "amountReceivedLD", type: "uint256" },
        ],
      },
      {
        name: "ticket",
        type: "tuple",
        components: [
          { name: "ticketId", type: "uint72" },
          { name: "passengerBytes", type: "bytes" },
        ],
      },
    ],
  },
  {
    name: "setAddressConfig",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_config",
        type: "tuple",
        components: [
          { name: "feeLib", type: "address" },
          { name: "planner", type: "address" },
          { name: "treasurer", type: "address" },
          { name: "tokenMessaging", type: "address" },
          { name: "creditMessaging", type: "address" },
          { name: "lzToken", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "setDeficitOffset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_deficitOffsetLD", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setOFTPath",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_dstEid", type: "uint32" },
      { name: "_oft", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setPause",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
    outputs: [],
  },
  {
    name: "setTransferGasLimit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_gasLimit", type: "uint256" }],
    outputs: [],
  },
  {
    name: "sharedDecimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "stargateType",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "status",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "token",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "transferOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    name: "treasuryFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "tvl",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "unreceivedTokens",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "guid", type: "bytes32" },
      { name: "index", type: "uint8" },
    ],
    outputs: [{ name: "hash", type: "bytes32" }],
  },
  {
    name: "withdrawPlannerFee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdrawTreasuryFee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_amountSD", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "AddressConfigSet",
    type: "event",
    inputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "feeLib", type: "address" },
          { name: "planner", type: "address" },
          { name: "treasurer", type: "address" },
          { name: "tokenMessaging", type: "address" },
          { name: "creditMessaging", type: "address" },
          { name: "lzToken", type: "address" },
        ],
        indexed: false,
      },
    ],
  },
  {
    name: "CreditsReceived",
    type: "event",
    inputs: [
      { name: "srcEid", type: "uint32", indexed: false },
      {
        name: "credits",
        type: "tuple[]",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "amount", type: "uint64" },
        ],
        indexed: false,
      },
    ],
  },
  {
    name: "CreditsSent",
    type: "event",
    inputs: [
      { name: "dstEid", type: "uint32", indexed: false },
      {
        name: "credits",
        type: "tuple[]",
        components: [
          { name: "srcEid", type: "uint32" },
          { name: "amount", type: "uint64" },
        ],
        indexed: false,
      },
    ],
  },
  {
    name: "Deposited",
    type: "event",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "amountLD", type: "uint256", indexed: false },
    ],
  },
  {
    name: "OFTPathSet",
    type: "event",
    inputs: [
      { name: "dstEid", type: "uint32", indexed: false },
      { name: "oft", type: "bool", indexed: false },
    ],
  },
  {
    name: "OFTReceived",
    type: "event",
    inputs: [
      { name: "guid", type: "bytes32", indexed: true },
      { name: "srcEid", type: "uint32", indexed: false },
      { name: "toAddress", type: "address", indexed: true },
      { name: "amountReceivedLD", type: "uint256", indexed: false },
    ],
  },
  {
    name: "OFTSent",
    type: "event",
    inputs: [
      { name: "guid", type: "bytes32", indexed: true },
      { name: "dstEid", type: "uint32", indexed: false },
      { name: "fromAddress", type: "address", indexed: true },
      { name: "amountSentLD", type: "uint256", indexed: false },
      { name: "amountReceivedLD", type: "uint256", indexed: false },
    ],
  },
  {
    name: "OwnershipTransferred",
    type: "event",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    name: "Path_CreditBurned",
    type: "event",
    inputs: [{ name: "amountSD", type: "uint64", indexed: false }],
  },
  { name: "PauseSet", type: "event", inputs: [{ name: "paused", type: "bool", indexed: false }] },
  {
    name: "PlannerFeeWithdrawn",
    type: "event",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  {
    name: "Redeemed",
    type: "event",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "amountLD", type: "uint256", indexed: false },
    ],
  },
  {
    name: "TreasuryFeeAdded",
    type: "event",
    inputs: [{ name: "amountSD", type: "uint64", indexed: false }],
  },
  {
    name: "TreasuryFeeWithdrawn",
    type: "event",
    inputs: [
      { name: "to", type: "address", indexed: false },
      { name: "amountSD", type: "uint64", indexed: false },
    ],
  },
  { name: "Path_AlreadyHasCredit", type: "error", inputs: [] },
  { name: "Path_InsufficientCredit", type: "error", inputs: [] },
  { name: "Path_UnlimitedCredit", type: "error", inputs: [] },
  { name: "Stargate_InsufficientFare", type: "error", inputs: [] },
  { name: "Stargate_InvalidAmount", type: "error", inputs: [] },
  { name: "Stargate_InvalidPath", type: "error", inputs: [] },
  { name: "Stargate_LzTokenUnavailable", type: "error", inputs: [] },
  { name: "Stargate_OnlyTaxi", type: "error", inputs: [] },
  { name: "Stargate_OutflowFailed", type: "error", inputs: [] },
  { name: "Stargate_Paused", type: "error", inputs: [] },
  { name: "Stargate_RecoverTokenUnsupported", type: "error", inputs: [] },
  { name: "Stargate_ReentrantCall", type: "error", inputs: [] },
  { name: "Stargate_SlippageTooHigh", type: "error", inputs: [] },
  { name: "Stargate_Unauthorized", type: "error", inputs: [] },
  { name: "Stargate_UnreceivedTokenNotFound", type: "error", inputs: [] },
  { name: "StargatePoolMigratable_BurnAmountExceedsBalance", type: "error", inputs: [] },
  { name: "StargatePoolUSDC_BurnAmountExceedsBalance", type: "error", inputs: [] },
  { name: "Transfer_TransferFailed", type: "error", inputs: [] },
] as const;
