// Metalayer's block-height reader in Sauce: learn another chain's block height, and log it where
// the program runs with the original's event. A program cooked on Ethereum asks Base: its body
// runs there as this same Pot when Metalayer delivers it, and returns Base's block number; the
// `.then` runs back on Ethereum when the answer arrives, and logs it.
//
// Ported from: @metalayer/contracts (npm), src/sample/BlockHeightReader.sol and
// src/sample/BlockHeightProvider.sol
// The original is a contract on each chain it reads and one on the chain that asks: 67 lines of
// Solidity (comments left out). It reads through Metalayer's read operations, which Metalayer's
// relayer performs; Sauce sends none, so the body reads the height on Base itself, and the answer
// comes back as a second message. This program is 9 and deploys nothing.
//
//   sauce run block-height.sauce.ts --chain <chain> --wallet <name>
//
// From Ethereum:
//
//   sauce run block-height.sauce.ts --chain ethereum --wallet <name>
function main() {
  Base.remote(() => ctx.blockNumber(), { via: "metalayer" }).then((result) => {
    const [blockHeight] = abi.decode(result, ["Uint256"]);
    log(
      abi.encode(Base, ctx.self(), blockHeight),
      crypto.keccak256("BlockHeightReceived(uint32,address,uint256)"),
    );
  });
}
