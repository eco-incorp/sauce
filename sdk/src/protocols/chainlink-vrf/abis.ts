/**
 * The VRFV2PlusWrapper: direct funding, a request paid per call. `requestRandomWordsInNative` takes
 * the native coin, at least `calculateRequestPriceNative(callbackGasLimit, numWords)`, priced at the
 * transaction's gas price, and keeps any excess. Its `extraArgs` must say native payment:
 * `VRFV2PlusClient._argsToBytes(ExtraArgsV1({ nativePayment: true }))`, the tag
 * `bytes4(keccak256("VRF ExtraArgsV1"))` and a `true` word. The wrapper records the caller as the
 * request's consumer and calls it back with `rawFulfillRandomWords(requestId, randomWords)`, giving
 * it exactly `callbackGasLimit`; a callback that reverts is logged as `WrapperFulfillmentFailed` and
 * the request is spent. Verified source: Blockscout (Ethereum), Sourcify (Base,
 * VRFV2PlusWrapper_Optimism), from smartcontractkit/chainlink-evm contracts/src/v0.8/vrf.
 */
export const VRFV2PlusWrapperABI = [
  {
    name: "requestRandomWordsInNative",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_callbackGasLimit", type: "uint32" },
      { name: "_requestConfirmations", type: "uint16" },
      { name: "_numWords", type: "uint32" },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "calculateRequestPriceNative",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_callbackGasLimit", type: "uint32" },
      { name: "_numWords", type: "uint32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "estimateRequestPriceNative",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_callbackGasLimit", type: "uint32" },
      { name: "_numWords", type: "uint32" },
      { name: "_requestGasPriceWei", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getConfig",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fallbackWeiPerUnitLink", type: "int256" },
      { name: "stalenessSeconds", type: "uint32" },
      { name: "fulfillmentFlatFeeNativePPM", type: "uint32" },
      { name: "fulfillmentFlatFeeLinkDiscountPPM", type: "uint32" },
      { name: "wrapperGasOverhead", type: "uint32" },
      { name: "coordinatorGasOverheadNative", type: "uint32" },
      { name: "coordinatorGasOverheadLink", type: "uint32" },
      { name: "coordinatorGasOverheadPerWord", type: "uint16" },
      { name: "wrapperNativePremiumPercentage", type: "uint8" },
      { name: "wrapperLinkPremiumPercentage", type: "uint8" },
      { name: "keyHash", type: "bytes32" },
      { name: "maxNumWords", type: "uint8" },
    ],
  },
  {
    name: "s_vrfCoordinator",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "WrapperFulfillmentFailed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "consumer", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

/**
 * The VRFCoordinatorV2_5 a wrapper requests from: its limits, which bound every wrapper request
 * (`minimumRequestConfirmations`, and `maxGasLimit` over the callback's gas plus the wrapper's
 * overhead), and the events an off-chain reader follows a request by. Verified source: Blockscout
 * (Ethereum), Sourcify (Base, VRFCoordinatorV2_5_Optimism).
 */
export const VRFCoordinatorV2_5ABI = [
  {
    name: "s_config",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "minimumRequestConfirmations", type: "uint16" },
      { name: "maxGasLimit", type: "uint32" },
      { name: "reentrancyLock", type: "bool" },
      { name: "stalenessSeconds", type: "uint32" },
      { name: "gasAfterPaymentCalculation", type: "uint32" },
      { name: "fulfillmentFlatFeeNativePPM", type: "uint32" },
      { name: "fulfillmentFlatFeeLinkDiscountPPM", type: "uint32" },
      { name: "nativePremiumPercentage", type: "uint8" },
      { name: "linkPremiumPercentage", type: "uint8" },
    ],
  },
  {
    name: "MAX_NUM_WORDS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    name: "MAX_REQUEST_CONFIRMATIONS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "event",
    name: "RandomWordsRequested",
    inputs: [
      { name: "keyHash", type: "bytes32", indexed: true },
      { name: "requestId", type: "uint256", indexed: false },
      { name: "preSeed", type: "uint256", indexed: false },
      { name: "subId", type: "uint256", indexed: true },
      { name: "minimumRequestConfirmations", type: "uint16", indexed: false },
      { name: "callbackGasLimit", type: "uint32", indexed: false },
      { name: "numWords", type: "uint32", indexed: false },
      { name: "extraArgs", type: "bytes", indexed: false },
      { name: "sender", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RandomWordsFulfilled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "outputSeed", type: "uint256", indexed: false },
      { name: "subId", type: "uint256", indexed: true },
      { name: "payment", type: "uint96", indexed: false },
      { name: "nativePayment", type: "bool", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "onlyPremium", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
] as const;
