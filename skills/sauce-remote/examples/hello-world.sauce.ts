// Hyperlane's Hello World app in Sauce: count each message sent and received, per chain, and log
// both ends with the original's events. A program cooked on Ethereum counts and logs the send
// there; its body runs on Base as this same Pot when Hyperlane delivers it, and counts and logs
// the receipt. The counters are the Pot's storage, each a slot named for the original's variable.
//
// Ported from: hyperlane-xyz/hyperlane-monorepo/typescript/helloworld/contracts/HelloWorld.sol
//   https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/18c32ed2b608bfb02183b5028e2406c5153a3754/typescript/helloworld/contracts/HelloWorld.sol
// The original is a contract deployed on both chains, each enrolled as the other's router: 62
// lines of Solidity (comments left out) over Hyperlane's Router. This program is 26 and deploys
// nothing. The Pot pays Hyperlane's fee from what it holds, and a chain's id stands for its
// Hyperlane domain, which is the same number.
//
//   sauce run hello-world.sauce.ts --chain <chain> --wallet <name> --args <message>
//
//   message: string   what both ends log
//
// From Ethereum:
//
//   sauce run hello-world.sauce.ts --chain ethereum --wallet <name> --args 'Hello, Base'
function main(message: string) {
  const origin = chainId;
  const sent = crypto.keccak256("helloworld.sent");
  const sentTo = crypto.keccak256(abi.encode(Base, crypto.keccak256("helloworld.sentTo")));
  evm.sstore(sent, evm.sload(sent) + 1);
  evm.sstore(sentTo, evm.sload(sentTo) + 1);
  Base.remote(
    () => {
      const received = crypto.keccak256("helloworld.received");
      const receivedFrom = crypto.keccak256(
        abi.encode(origin, crypto.keccak256("helloworld.receivedFrom")),
      );
      evm.sstore(received, evm.sload(received) + 1);
      evm.sstore(receivedFrom, evm.sload(receivedFrom) + 1);
      log(
        abi.encode(ctx.self(), message),
        crypto.keccak256("ReceivedHelloWorld(uint32,uint32,bytes32,string)"),
        origin,
        chainId,
      );
    },
    { via: "hyperlane" },
  );
  log(abi.encode(message), crypto.keccak256("SentHelloWorld(uint32,uint32,string)"), origin, Base);
}
