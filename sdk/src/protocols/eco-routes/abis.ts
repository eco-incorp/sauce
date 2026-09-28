/**
 * The eco-routes Portal and prover ABIs, as the SDK registers them.
 *
 * The SDK's ONLY declaration of the Portal. `routes/portal.ts` encodes its submission calldata
 * against `PortalABI` rather than keeping a subset of its own, so there is no second copy to drift.
 * What that module does need -- each reward parameter here matching the `EVM_REWARD_PARAM` the
 * intent hash is taken over -- `eco-routes-abi-drift.test.ts` pins.
 *
 * Every entry is written out in full, with no shared sub-objects. Protocol ABIs are read
 * statically -- by the per-protocol compile suite, among others -- so a reference to a
 * module-level const here is a reference that reader cannot follow.
 *
 * `route` crosses as `bytes` on every entry point, never as a tuple. That is not a style choice:
 * for a Solana destination the route is Borsh rather than ABI, so handing the Portal a pre-encoded
 * blob is the only way its `routeHash` matches the one the SDK computed. See `routes/portal.ts`.
 */

export const PortalABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "route",
        type: "bytes",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
      {
        name: "vault",
        type: "address",
      },
    ],
  },
  {
    type: "function",
    name: "publishAndFund",
    stateMutability: "payable",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "route",
        type: "bytes",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
      {
        name: "allowPartial",
        type: "bool",
      },
    ],
    outputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
      {
        name: "vault",
        type: "address",
      },
    ],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "payable",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "routeHash",
        type: "bytes32",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
      {
        name: "allowPartial",
        type: "bool",
      },
    ],
    outputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
    ],
  },
  {
    type: "function",
    name: "fulfill",
    stateMutability: "payable",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
      {
        name: "route",
        type: "tuple",
        components: [
          {
            name: "salt",
            type: "bytes32",
          },
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "portal",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
          {
            name: "calls",
            type: "tuple[]",
            components: [
              {
                name: "target",
                type: "address",
              },
              {
                name: "data",
                type: "bytes",
              },
              {
                name: "value",
                type: "uint256",
              },
            ],
          },
        ],
      },
      {
        name: "rewardHash",
        type: "bytes32",
      },
      {
        name: "claimant",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes[]",
      },
    ],
  },
  {
    type: "function",
    name: "getIntentHash",
    stateMutability: "pure",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "route",
        type: "bytes",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
      {
        name: "routeHash",
        type: "bytes32",
      },
      {
        name: "rewardHash",
        type: "bytes32",
      },
    ],
  },
  {
    type: "function",
    name: "intentVaultAddress",
    stateMutability: "view",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "route",
        type: "bytes",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },
  {
    type: "function",
    name: "isIntentFunded",
    stateMutability: "view",
    inputs: [
      {
        name: "destination",
        type: "uint64",
      },
      {
        name: "route",
        type: "bytes",
      },
      {
        name: "reward",
        type: "tuple",
        components: [
          {
            name: "deadline",
            type: "uint64",
          },
          {
            name: "creator",
            type: "address",
          },
          {
            name: "prover",
            type: "address",
          },
          {
            name: "nativeAmount",
            type: "uint256",
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              {
                name: "token",
                type: "address",
              },
              {
                name: "amount",
                type: "uint256",
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
  },
  {
    type: "function",
    name: "getRewardStatus",
    stateMutability: "view",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
      },
    ],
  },
  {
    type: "function",
    name: "executor",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },
  {
    type: "function",
    name: "claimants",
    stateMutability: "view",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
      },
    ],
  },
  {
    type: "event",
    name: "IntentPublished",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
        indexed: true,
      },
      {
        name: "destination",
        type: "uint64",
        indexed: false,
      },
      {
        name: "route",
        type: "bytes",
        indexed: false,
      },
      {
        name: "creator",
        type: "address",
        indexed: true,
      },
      {
        name: "prover",
        type: "address",
        indexed: true,
      },
      {
        name: "rewardDeadline",
        type: "uint64",
        indexed: false,
      },
      {
        name: "rewardNativeAmount",
        type: "uint256",
        indexed: false,
      },
      {
        name: "rewardTokens",
        indexed: false,
        type: "tuple[]",
        components: [
          {
            name: "token",
            type: "address",
          },
          {
            name: "amount",
            type: "uint256",
          },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "IntentFunded",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
        indexed: true,
      },
      {
        name: "funder",
        type: "address",
        indexed: true,
      },
      {
        name: "complete",
        type: "bool",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "IntentFulfilled",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
        indexed: true,
      },
      {
        name: "claimant",
        type: "bytes32",
        indexed: false,
      },
    ],
  },
] as const;

export const ProverABI = [
  {
    type: "function",
    name: "provenIntents",
    stateMutability: "view",
    inputs: [
      {
        name: "intentHash",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "destination",
            type: "uint64",
          },
          {
            name: "claimant",
            type: "address",
          },
        ],
      },
    ],
  },
] as const;
