// LayerZero's OApp example in Sauce: send a string to another chain, which keeps the last one it
// received. A program cooked on Ethereum sends it; its body runs on Base as this same Pot when
// LayerZero's executor delivers it, and keeps the string in the Pot's storage: its length at
// keccak256("myoapp.lastMessage"), and its bytes a word to a slot from the hash of that slot on.
//
// Ported from: LayerZero-Labs/devtools/examples/oapp/contracts/MyOApp.sol
//   https://github.com/LayerZero-Labs/devtools/blob/508363b50abf8215363a9d3aaddaf2ca5021c9ec/examples/oapp/contracts/MyOApp.sol
// The original is a contract deployed on both chains, each set as the other's peer: 38 lines of
// Solidity (comments left out) over LayerZero's OApp. This program is 15 and deploys nothing. The
// Pot quotes and pays LayerZero's fee from what it holds, giving the executor the gas the body
// needs as its option.
//
//   sauce run my-oapp.sauce.ts --chain <chain> --wallet <name> --args <text>
//
//   text: string   what Base keeps
//
// From Ethereum:
//
//   sauce run my-oapp.sauce.ts --chain ethereum --wallet <name> --args 'Hello from Ethereum'
function main(text: string) {
  Base.remote(
    () => {
      const lastMessage = crypto.keccak256("myoapp.lastMessage");
      const words = crypto.keccak256(lastMessage.toBytesBe(32));
      const zero = 0;
      const padded = text.concat(zero.toBytesBe(32));
      evm.sstore(lastMessage, text.length);
      for (let i = 0; i < text.length; i += 32) {
        evm.sstore(words + i / 32, padded.slice(i, i + 32).toBe());
      }
    },
    { via: "layerzero" },
  );
}
