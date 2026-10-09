// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The two contracts AxiomV2Query asks whether a fulfilment's proof holds, standing in for the
// deployed ones in `@sauce/zk`'s suite, which runs AxiomV2Query's own implementation as deployed.
// A local suite cannot make a real proof: AxiomV2HeaderVerifier checks the proof's block-hash MMR
// against AxiomV2Core's, and the query verifier is a halo2 verifier of the proof itself. These
// accept any proof, so the suite's prover builds one carrying the public instances AxiomV2Query
// reads (`_verifyResult`: source chain, results hash, query hash, schema, MMR keccak, aggregate
// vkey hash, payee) and everything AxiomV2Query checks against them, the callback included, runs as
// deployed.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `AxiomProofMocks.json` beside
// this file.

struct MmrWitness {
    uint32 snapshotPmmrSize;
    bytes32[] proofMmrPeaks;
    bytes32[] mmrComplementOrPeaks;
}

// IAxiomV2HeaderVerifier: the chain whose history the deployment proves, and a header check that
// passes.
contract AxiomHeaderVerifierMock {
    uint64 public immutable sourceChainId;

    constructor(uint64 sourceChainId_) {
        sourceChainId = sourceChainId_;
    }

    function getSourceChainId() external view returns (uint64) {
        return sourceChainId;
    }

    function verifyQueryHeaders(bytes32, MmrWitness calldata) external pure {}
}

// The query verifier AxiomV2Query calls with the proof as calldata: any call succeeds.
contract AxiomVerifierMock {
    fallback() external {}
}
