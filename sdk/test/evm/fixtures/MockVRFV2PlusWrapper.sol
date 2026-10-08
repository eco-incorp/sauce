// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Chainlink VRF v2.5's VRFV2PlusWrapper for the randomness suites, real where a consumer touches
/// it and MOCKED where the coordinator and its oracle would be:
///
///  - `requestRandomWordsInNative`, `calculateRequestPriceNative` and `estimateRequestPriceNative`
///    have the wrapper's signatures and checks, from its source (smartcontractkit/chainlink-evm
///    contracts/src/v0.8/vrf/VRFV2PlusWrapper.sol): `checkPaymentMode`'s native `extraArgs`, the
///    price at the transaction's gas price, `fee too low`, `numWords too high`, the coordinator's
///    confirmations and gas bounds, and the consumer recorded as the caller. The price is computed
///    with Base's live configuration (no L1 fee). The coordinator's `RandomWordsRequested` is
///    emitted here, the mock standing for both.
///  - `fulfill` is the COORDINATOR AND ITS ORACLE, mocked: whoever calls it fulfils a request with
///    the words it is given, exactly as the wrapper's `fulfillRandomWords` does once the coordinator
///    calls it: the request deleted, then the consumer's `rawFulfillRandomWords(uint256,uint256[])`
///    called from this wrapper with exactly its callback gas (`_callWithExactGas`), a failure caught
///    and logged as `WrapperFulfillmentFailed`.
///  - `deliver` calls a consumer back for no request this wrapper holds, with the same call: what a
///    consumer must refuse (an unknown or replayed id from the genuine wrapper).
///
/// No constructor and no immutable, so a test installs its runtime at the wrapper's own address.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin,bin-runtime` into
/// `MockVRFV2PlusWrapper.json` beside this file.
contract MockVRFV2PlusWrapper {
    error LINKPaymentInRequestRandomWordsInNative();
    error IncorrectExtraArgsLength(uint16 expectedMinimumLength, uint16 actualLength);
    error InvalidExtraArgsTag();
    error InvalidRequestConfirmations(uint16 have, uint16 min, uint16 max);
    error GasLimitTooBig(uint32 have, uint32 want);

    event WrapperFulfillmentFailed(uint256 indexed requestId, address indexed consumer);
    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint256 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        bytes extraArgs,
        address indexed sender
    );

    // Base's configuration, read from the wrapper's `getConfig()` and the coordinator's `s_config()`.
    uint32 internal constant WRAPPER_GAS_OVERHEAD = 13_400;
    uint32 internal constant COORDINATOR_GAS_OVERHEAD_NATIVE = 128_500;
    uint32 internal constant COORDINATOR_GAS_OVERHEAD_PER_WORD = 435;
    uint256 internal constant NATIVE_PREMIUM_PERCENTAGE = 60;
    uint32 internal constant MAX_NUM_WORDS = 10;
    uint16 internal constant MIN_REQUEST_CONFIRMATIONS = 0;
    uint16 internal constant MAX_REQUEST_CONFIRMATIONS = 200;
    uint32 internal constant MAX_GAS_LIMIT = 2_500_000;

    uint16 internal constant EXPECTED_MIN_LENGTH = 36;
    bytes4 internal constant EXTRA_ARGS_V1_TAG = 0x92fd1338; // bytes4(keccak256("VRF ExtraArgsV1"))
    uint256 internal constant GAS_FOR_CALL_EXACT_CHECK = 5_000;

    struct Callback {
        address callbackAddress;
        uint32 callbackGasLimit;
        uint64 requestGasPrice;
    }

    mapping(uint256 => Callback) public s_callbacks;
    uint256 public requests;

    function calculateRequestPriceNative(
        uint32 _callbackGasLimit,
        uint32 _numWords
    ) external view returns (uint256) {
        return _calculateRequestPriceNative(_callbackGasLimit, _numWords, tx.gasprice);
    }

    function estimateRequestPriceNative(
        uint32 _callbackGasLimit,
        uint32 _numWords,
        uint256 _requestGasPriceWei
    ) external view returns (uint256) {
        return _calculateRequestPriceNative(_callbackGasLimit, _numWords, _requestGasPriceWei);
    }

    function requestRandomWordsInNative(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        uint32 _numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId) {
        _checkNativePayment(extraArgs);
        uint32 eip150Overhead = _callbackGasLimit / 63 + 1;
        uint256 price = _calculateRequestPriceNative(_callbackGasLimit, _numWords, tx.gasprice);
        require(msg.value >= price, "fee too low");
        require(_numWords <= MAX_NUM_WORDS, "numWords too high");
        // The coordinator's checks on the request the wrapper makes.
        if (
            _requestConfirmations < MIN_REQUEST_CONFIRMATIONS ||
            _requestConfirmations > MAX_REQUEST_CONFIRMATIONS
        ) {
            revert InvalidRequestConfirmations(
                _requestConfirmations,
                MIN_REQUEST_CONFIRMATIONS,
                MAX_REQUEST_CONFIRMATIONS
            );
        }
        uint32 coordinatorGas = _callbackGasLimit + eip150Overhead + WRAPPER_GAS_OVERHEAD;
        if (coordinatorGas > MAX_GAS_LIMIT) revert GasLimitTooBig(coordinatorGas, MAX_GAS_LIMIT);

        requests += 1;
        requestId = uint256(keccak256(abi.encode(address(this), requests)));
        s_callbacks[requestId] = Callback({
            callbackAddress: msg.sender,
            callbackGasLimit: _callbackGasLimit,
            requestGasPrice: uint64(tx.gasprice)
        });
        emit RandomWordsRequested(
            bytes32(0),
            requestId,
            requests,
            0,
            _requestConfirmations,
            coordinatorGas,
            _numWords,
            extraArgs,
            address(this)
        );
    }

    /// The coordinator and its oracle: fulfil `requestId` with `randomWords`, as the wrapper's
    /// `fulfillRandomWords` does. Returns whether the consumer's callback succeeded.
    function fulfill(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external returns (bool success) {
        Callback memory callback = s_callbacks[requestId];
        delete s_callbacks[requestId];
        require(callback.callbackAddress != address(0), "request not found");
        success = _callBack(
            callback.callbackAddress,
            callback.callbackGasLimit,
            requestId,
            randomWords
        );
    }

    /// Call `consumer` back for `requestId` with no request behind it, from this wrapper.
    function deliver(
        address consumer,
        uint256 requestId,
        uint256[] calldata randomWords,
        uint32 callbackGasLimit
    ) external returns (bool success) {
        success = _callBack(consumer, callbackGasLimit, requestId, randomWords);
    }

    function _callBack(
        address consumer,
        uint32 callbackGasLimit,
        uint256 requestId,
        uint256[] calldata randomWords
    ) private returns (bool success) {
        bytes memory resp = abi.encodeWithSelector(
            bytes4(keccak256("rawFulfillRandomWords(uint256,uint256[])")),
            requestId,
            randomWords
        );
        success = _callWithExactGas(callbackGasLimit, consumer, resp);
        if (!success) emit WrapperFulfillmentFailed(requestId, consumer);
    }

    function _checkNativePayment(bytes calldata extraArgs) private pure {
        if (extraArgs.length == 0) revert LINKPaymentInRequestRandomWordsInNative();
        if (extraArgs.length < EXPECTED_MIN_LENGTH) {
            revert IncorrectExtraArgsLength(EXPECTED_MIN_LENGTH, uint16(extraArgs.length));
        }
        if (extraArgs[35] != hex"01") revert LINKPaymentInRequestRandomWordsInNative();
        // The coordinator's `_fromBytes`: the tag, then the ExtraArgsV1 struct, whose bool must be
        // a clean word.
        if (bytes4(extraArgs[:4]) != EXTRA_ARGS_V1_TAG) revert InvalidExtraArgsTag();
        abi.decode(extraArgs[4:], (bool));
    }

    function _calculateRequestPriceNative(
        uint256 _gas,
        uint32 _numWords,
        uint256 _requestGasPrice
    ) private pure returns (uint256) {
        uint256 wrapperCostWei = _requestGasPrice * WRAPPER_GAS_OVERHEAD;
        uint256 coordinatorCostWei = _requestGasPrice *
            (_gas + COORDINATOR_GAS_OVERHEAD_NATIVE + COORDINATOR_GAS_OVERHEAD_PER_WORD * _numWords);
        return wrapperCostWei + (coordinatorCostWei * (NATIVE_PREMIUM_PERCENTAGE + 100)) / 100;
    }

    /// The wrapper's `_callWithExactGas`: the callee gets exactly `gasAmount`, or this reverts.
    function _callWithExactGas(
        uint256 gasAmount,
        address target,
        bytes memory data
    ) private returns (bool success) {
        assembly {
            let g := gas()
            if lt(g, GAS_FOR_CALL_EXACT_CHECK) {
                revert(0, 0)
            }
            g := sub(g, GAS_FOR_CALL_EXACT_CHECK)
            if iszero(gt(sub(g, div(g, 64)), gasAmount)) {
                revert(0, 0)
            }
            if iszero(extcodesize(target)) {
                revert(0, 0)
            }
            success := call(gasAmount, target, 0, add(data, 0x20), mload(data), 0, 0)
        }
    }
}
