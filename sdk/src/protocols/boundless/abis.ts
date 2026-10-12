export const BoundlessMarketABI = [
  {
    name: "submitRequest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          {
            name: "requirements",
            type: "tuple",
            components: [
              {
                name: "callback",
                type: "tuple",
                components: [
                  { name: "addr", type: "address" },
                  { name: "gasLimit", type: "uint96" },
                ],
              },
              {
                name: "predicate",
                type: "tuple",
                components: [
                  { name: "predicateType", type: "uint8" },
                  { name: "data", type: "bytes" },
                ],
              },
              { name: "selector", type: "bytes4" },
            ],
          },
          { name: "imageUrl", type: "string" },
          {
            name: "input",
            type: "tuple",
            components: [
              { name: "inputType", type: "uint8" },
              { name: "data", type: "bytes" },
            ],
          },
          {
            name: "offer",
            type: "tuple",
            components: [
              { name: "minPrice", type: "uint256" },
              { name: "maxPrice", type: "uint256" },
              { name: "rampUpStart", type: "uint64" },
              { name: "rampUpPeriod", type: "uint32" },
              { name: "lockTimeout", type: "uint32" },
              { name: "timeout", type: "uint32" },
              { name: "lockCollateral", type: "uint256" },
            ],
          },
        ],
      },
      { name: "clientSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "lockRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          {
            name: "requirements",
            type: "tuple",
            components: [
              {
                name: "callback",
                type: "tuple",
                components: [
                  { name: "addr", type: "address" },
                  { name: "gasLimit", type: "uint96" },
                ],
              },
              {
                name: "predicate",
                type: "tuple",
                components: [
                  { name: "predicateType", type: "uint8" },
                  { name: "data", type: "bytes" },
                ],
              },
              { name: "selector", type: "bytes4" },
            ],
          },
          { name: "imageUrl", type: "string" },
          {
            name: "input",
            type: "tuple",
            components: [
              { name: "inputType", type: "uint8" },
              { name: "data", type: "bytes" },
            ],
          },
          {
            name: "offer",
            type: "tuple",
            components: [
              { name: "minPrice", type: "uint256" },
              { name: "maxPrice", type: "uint256" },
              { name: "rampUpStart", type: "uint64" },
              { name: "rampUpPeriod", type: "uint32" },
              { name: "lockTimeout", type: "uint32" },
              { name: "timeout", type: "uint32" },
              { name: "lockCollateral", type: "uint256" },
            ],
          },
        ],
      },
      { name: "clientSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "fulfill",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "fulfillmentBatches",
        type: "tuple[]",
        components: [
          {
            name: "requests",
            type: "tuple[]",
            components: [
              { name: "id", type: "uint256" },
              {
                name: "predicate",
                type: "tuple",
                components: [
                  { name: "predicateType", type: "uint8" },
                  { name: "data", type: "bytes" },
                ],
              },
              {
                name: "callback",
                type: "tuple",
                components: [
                  { name: "addr", type: "address" },
                  { name: "gasLimit", type: "uint96" },
                ],
              },
              { name: "selector", type: "bytes4" },
              { name: "imageUrlHash", type: "bytes32" },
              { name: "inputDigest", type: "bytes32" },
              { name: "offerDigest", type: "bytes32" },
            ],
          },
          {
            name: "fills",
            type: "tuple[]",
            components: [
              { name: "claimDigest", type: "bytes32" },
              { name: "fulfillmentDataType", type: "uint8" },
              { name: "fulfillmentData", type: "bytes" },
              { name: "seal", type: "bytes" },
            ],
          },
          { name: "assessorSeal", type: "bytes" },
          { name: "prover", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "paymentError", type: "bytes[]" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "depositTo",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "value", type: "uint256" }],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "slash",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "requestIsLocked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "requestIsFulfilled",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "requestDeadline",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "eip712DomainSeparator",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "COLLATERAL_TOKEN_CONTRACT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "RequestSubmitted",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          {
            name: "requirements",
            type: "tuple",
            components: [
              {
                name: "callback",
                type: "tuple",
                components: [
                  { name: "addr", type: "address" },
                  { name: "gasLimit", type: "uint96" },
                ],
              },
              {
                name: "predicate",
                type: "tuple",
                components: [
                  { name: "predicateType", type: "uint8" },
                  { name: "data", type: "bytes" },
                ],
              },
              { name: "selector", type: "bytes4" },
            ],
          },
          { name: "imageUrl", type: "string" },
          {
            name: "input",
            type: "tuple",
            components: [
              { name: "inputType", type: "uint8" },
              { name: "data", type: "bytes" },
            ],
          },
          {
            name: "offer",
            type: "tuple",
            components: [
              { name: "minPrice", type: "uint256" },
              { name: "maxPrice", type: "uint256" },
              { name: "rampUpStart", type: "uint64" },
              { name: "rampUpPeriod", type: "uint32" },
              { name: "lockTimeout", type: "uint32" },
              { name: "timeout", type: "uint32" },
              { name: "lockCollateral", type: "uint256" },
            ],
          },
        ],
        indexed: false,
      },
      { name: "clientSignature", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RequestLocked",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "prover", type: "address", indexed: false },
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          {
            name: "requirements",
            type: "tuple",
            components: [
              {
                name: "callback",
                type: "tuple",
                components: [
                  { name: "addr", type: "address" },
                  { name: "gasLimit", type: "uint96" },
                ],
              },
              {
                name: "predicate",
                type: "tuple",
                components: [
                  { name: "predicateType", type: "uint8" },
                  { name: "data", type: "bytes" },
                ],
              },
              { name: "selector", type: "bytes4" },
            ],
          },
          { name: "imageUrl", type: "string" },
          {
            name: "input",
            type: "tuple",
            components: [
              { name: "inputType", type: "uint8" },
              { name: "data", type: "bytes" },
            ],
          },
          {
            name: "offer",
            type: "tuple",
            components: [
              { name: "minPrice", type: "uint256" },
              { name: "maxPrice", type: "uint256" },
              { name: "rampUpStart", type: "uint64" },
              { name: "rampUpPeriod", type: "uint32" },
              { name: "lockTimeout", type: "uint32" },
              { name: "timeout", type: "uint32" },
              { name: "lockCollateral", type: "uint256" },
            ],
          },
        ],
        indexed: false,
      },
      { name: "clientSignature", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProofDelivered",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "prover", type: "address", indexed: true },
      {
        name: "fulfillment",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "requestDigest", type: "bytes32" },
          { name: "claimDigest", type: "bytes32" },
          { name: "fulfillmentDataType", type: "uint8" },
          { name: "fulfillmentData", type: "bytes" },
          { name: "seal", type: "bytes" },
        ],
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "CallbackFailed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "callback", type: "address", indexed: false },
      { name: "error", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProverSlashed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "collateralBurned", type: "uint256", indexed: false },
      { name: "collateralTransferred", type: "uint256", indexed: false },
      { name: "collateralRecipient", type: "address", indexed: false },
    ],
  },
  {
    type: "error",
    name: "RequestIsLocked",
    inputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "error",
    name: "RequestIsFulfilled",
    inputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "error",
    name: "RequestLockIsExpired",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "lockDeadline", type: "uint64" },
    ],
  },
  { type: "error", name: "InvalidRequest", inputs: [] },
  { type: "error", name: "UnfulfillableCallback", inputs: [] },
] as const;
