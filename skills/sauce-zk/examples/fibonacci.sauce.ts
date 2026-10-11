// Ported from: succinctlabs/sp1-project-template/contracts/src/Fibonacci.sol
//
// Succinct's SP1 template: checks a proof that the template's Fibonacci program computed
// fib(n), through Succinct's SP1 verifier gateway, and answers the proven n, fib(n - 1) and fib(n),
// as `verifyFibonacciProof` does. Unlike a coprocessor's answer, the proof arrives with the call:
// the gateway checks it in the same transaction and reverts if it does not verify, so there is no
// promise and no callback, and the program acts on the public values straight after.
//
// The proof is a Groth16 one, as `cargo run --bin evm -- --system groth16` makes it; its first four
// bytes name the SP1 version whose verifier the gateway routes it to. A version Succinct has frozen
// is refused (`RouteIsFrozen`), as is one the gateway lacks (`RouteNotFound`). What the Pot does
// differently: nothing to deploy, so the verification key is a constant here, where the template's
// contract takes it in its constructor; and the gateway is the registry's, where the template's
// takes an address.
//
//   sauce simulate fibonacci.sauce.ts --chain <chain> --args <publicValues> <proof>
//
//   publicValues: bytes  what the program committed: n, fib(n - 1) and fib(n), ABI-encoded
//   proof: bytes  the Groth16 proof, its verifier's selector first
//
// On Base, a proof the template's script made:
//
//   sauce simulate fibonacci.sauce.ts --chain base --args <publicValues> <proof>

// The template's Fibonacci program, as `cargo run --bin vkey` prints its verification key.
const FIBONACCI_PROGRAM_VKEY = 0x004a55ed3c7a07d0233a027278a8b7ff8681ffbd5d1ec4795c18966f6e693090;

function main(publicValues: bytes, proof: bytes): { n: Uint256; a: Uint256; b: Uint256 } {
  require(Succinct.VerifierGatewayGroth16);
  Succinct.VerifierGatewayGroth16.verifyProof(FIBONACCI_PROGRAM_VKEY, publicValues, proof);
  const [n, a, b] = abi.decode(publicValues, ["Uint256", "Uint256", "Uint256"]);
  return { n, a, b };
}
