// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Pyth Entropy v2 for the randomness suites, real where a requester touches it and MOCKED
/// where the provider's off-chain half would be:
///
///  - every `requestV2` and `getFeeV2` overload, and `getDefaultProvider`, have IEntropyV2's
///    signatures (pyth-crosschain target_chains/ethereum/entropy_sdk/solidity) and Entropy.sol's
///    rules: at least the fee or `InsufficientFee()`, the excess kept; a sequence number counted per
///    provider; the gas limit rounded up to 10,000 and raised to the provider's default; the
///    requester recorded as the caller; `Requested` emitted as EntropyEventsV2 declares it. The fee
///    and default gas limit are Base's default provider's, read on chain.
///  - `reveal` is the PROVIDER'S KEEPER, mocked: whoever calls it reveals a request with the number
///    it is given, as `revealWithCallback` does for a request with a gas limit: the requester's
///    `_entropyCallback(uint64,address,bytes32)` called from this contract with at most the
///    request's gas, a failure caught, logged in `Revealed` with `callbackFailed`, and the request
///    left open to be revealed again (then with no gas limit, as Entropy.sol's recovery path does).
///  - `deliver` calls a requester back for no request this contract holds, with the same call: what
///    a requester must refuse.
///
/// No constructor and no immutable, so a test installs its runtime at Entropy's own address.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin,bin-runtime` into `MockEntropy.json`
/// beside this file.
contract MockEntropy {
    error InsufficientFee();
    error NoSuchRequest();
    error MaxGasLimitExceeded();

    event Requested(
        address indexed provider,
        address indexed caller,
        uint64 indexed sequenceNumber,
        bytes32 userContribution,
        uint32 gasLimit,
        bytes extraArgs
    );
    event Revealed(
        address indexed provider,
        address indexed caller,
        uint64 indexed sequenceNumber,
        bytes32 randomNumber,
        bytes32 userContribution,
        bytes32 providerContribution,
        bool callbackFailed,
        bytes callbackReturnValue,
        uint32 callbackGasUsed,
        bytes extraArgs
    );

    // Base's default provider, its fee and default gas limit, and Pyth's fee, read on chain.
    address internal constant DEFAULT_PROVIDER = 0x52DeaA1c84233F7bb8C8A45baeDE41091c616506;
    uint128 internal constant PROVIDER_FEE = 5_000_000_000_000;
    uint32 internal constant DEFAULT_GAS_LIMIT = 500_000;
    uint128 internal constant PYTH_FEE = 10_000_000_000_000;
    uint32 internal constant TEN_THOUSAND = 10_000;
    uint32 internal constant MAX_GAS_LIMIT = 655_350_000;

    struct Request {
        address requester;
        uint32 gasLimit;
        bool failed;
    }

    mapping(address => uint64) public sequenceNumbers;
    mapping(bytes32 => Request) internal requests;

    function getDefaultProvider() public pure returns (address provider) {
        return DEFAULT_PROVIDER;
    }

    function getFeeV2() external view returns (uint128 feeAmount) {
        return getFeeV2(DEFAULT_PROVIDER, 0);
    }

    function getFeeV2(uint32 gasLimit) external view returns (uint128 feeAmount) {
        return getFeeV2(DEFAULT_PROVIDER, gasLimit);
    }

    function getFeeV2(address, uint32 gasLimit) public pure returns (uint128 feeAmount) {
        uint32 rounded = _roundTo10kGas(gasLimit);
        uint128 providerFee = PROVIDER_FEE;
        if (rounded > DEFAULT_GAS_LIMIT) {
            providerFee += ((rounded - DEFAULT_GAS_LIMIT) * PROVIDER_FEE) / DEFAULT_GAS_LIMIT;
        }
        return providerFee + PYTH_FEE;
    }

    function requestV2() external payable returns (uint64 assignedSequenceNumber) {
        return _request(DEFAULT_PROVIDER, bytes32(0), 0);
    }

    function requestV2(uint32 gasLimit) external payable returns (uint64 assignedSequenceNumber) {
        return _request(DEFAULT_PROVIDER, bytes32(0), gasLimit);
    }

    function requestV2(
        address provider,
        uint32 gasLimit
    ) external payable returns (uint64 assignedSequenceNumber) {
        return _request(provider, bytes32(0), gasLimit);
    }

    function requestV2(
        address provider,
        bytes32 userRandomNumber,
        uint32 gasLimit
    ) external payable returns (uint64 assignedSequenceNumber) {
        return _request(provider, userRandomNumber, gasLimit);
    }

    /// The provider's keeper: reveal `provider`'s request `sequenceNumber` as `randomNumber`. Returns
    /// whether the requester's callback succeeded.
    function reveal(
        address provider,
        uint64 sequenceNumber,
        bytes32 randomNumber
    ) external returns (bool success) {
        bytes32 key = keccak256(abi.encode(provider, sequenceNumber));
        Request memory req = requests[key];
        if (req.requester == address(0)) revert NoSuchRequest();
        bytes memory data = _callbackData(sequenceNumber, provider, randomNumber);
        if (req.failed) {
            // Entropy.sol's recovery path: no gas limit, no catch.
            delete requests[key];
            (success, ) = req.requester.call(data);
            if (!success) {
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
            emit Revealed(provider, req.requester, sequenceNumber, randomNumber, 0, 0, false, "", 0, "");
            return true;
        }
        uint256 startingGas = gasleft();
        bytes memory ret;
        (success, ret) = req.requester.call{ gas: req.gasLimit }(data);
        uint32 gasUsed = uint32(startingGas - gasleft());
        if (success) {
            delete requests[key];
        } else {
            requests[key].failed = true;
        }
        emit Revealed(
            provider,
            req.requester,
            sequenceNumber,
            randomNumber,
            0,
            0,
            !success,
            ret,
            gasUsed,
            ""
        );
    }

    /// Call `requester` back with no request behind it, from this contract.
    function deliver(
        address requester,
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) external returns (bool success) {
        (success, ) = requester.call(_callbackData(sequenceNumber, provider, randomNumber));
    }

    function _request(
        address provider,
        bytes32 userContribution,
        uint32 gasLimit
    ) private returns (uint64 assignedSequenceNumber) {
        if (msg.value < getFeeV2(provider, gasLimit)) revert InsufficientFee();
        assignedSequenceNumber = sequenceNumbers[provider] + 1;
        sequenceNumbers[provider] = assignedSequenceNumber;
        uint32 limit = _roundTo10kGas(gasLimit < DEFAULT_GAS_LIMIT ? DEFAULT_GAS_LIMIT : gasLimit);
        requests[keccak256(abi.encode(provider, assignedSequenceNumber))] = Request({
            requester: msg.sender,
            gasLimit: limit,
            failed: false
        });
        emit Requested(provider, msg.sender, assignedSequenceNumber, userContribution, limit, "");
    }

    function _callbackData(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) private pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                bytes4(keccak256("_entropyCallback(uint64,address,bytes32)")),
                sequenceNumber,
                provider,
                randomNumber
            );
    }

    function _roundTo10kGas(uint32 gas) private pure returns (uint32) {
        if (gas > MAX_GAS_LIMIT) revert MaxGasLimitExceeded();
        uint32 gas10k = gas / TEN_THOUSAND;
        if (gas10k * TEN_THOUSAND < gas) gas10k += 1;
        return gas10k * TEN_THOUSAND;
    }
}
