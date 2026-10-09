// Pays `amount` of the chain's native coin to `recipient` once Boundless proves a RISC Zero guest,
// run on `input`, output at least `minimum`. The guest is `imageId`, published at `imageUrl`; it
// reads the request's id (32 bytes) and then `input` from stdin, and commits the sha256 of its whole
// stdin and then its output, one 32-byte word. The request pays at most `maxPrice` wei, which the
// Pot deposits, and asks the prover that takes it to lock 15 ZKC as collateral. If no prover fulfils it within half
// an hour, anyone may expire it, and its price comes back to the Pot. Base only; the Pot must be a
// Private Pot with @sauce/zk's handlers installed (`sauce run @sauce/zk --chain base`).
//
//   sauce run proven-guest.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <imageId> <imageUrl> <input> <maxPrice> <minimum> <recipient> <amount>
//
//   imageId: Uint256  the guest's image id
//   imageUrl: bytes  where provers download the guest, its UTF-8 bytes
//   input: bytes  what the guest reads after the request's id
//   maxPrice: Uint256  the most the proof is paid, in wei
//   minimum: Uint256  the least the guest's output may be
//   recipient: Address  who is paid
//   amount: Uint256  how much of the native coin, in wei
//
// On Base, 0.01 ETH once the guest's output is at least 100, paying at most 0.001 ETH:
//
//   sauce run proven-guest.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <imageId> <imageUrl> <input> 1000000000000000 100 <recipient> 10000000000000000
import { Zk } from "@sauce/zk";

function main(
  imageId: Uint256,
  imageUrl: bytes,
  input: bytes,
  maxPrice: Uint256,
  minimum: Uint256,
  recipient: Address,
  amount: Uint256,
): void {
  Zk.risc0({
    imageId,
    imageUrl,
    input,
    offer: {
      maxPrice,
      rampUpPeriod: 60,
      lockTimeout: 900,
      timeout: 1800,
      lockCollateral: 15000000000000000000,
    },
  })
    .then((journal) => {
      const [output] = abi.decode(journal, ["Uint256"]);
      require(output >= minimum, "below the minimum");
      evm.call(recipient, amount, hex``);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
