// Ported from: boundless-xyz/boundless-foundry-template/contracts/src/EvenNumber.sol, with the
// request its app makes, apps/src/main.rs
//
// Boundless's template: asks the market to prove, by the template's guest, that `number` is even,
// and once the market has verified the proof keeps the number, as `EvenNumber.set` does. The guest
// is the template's `is-even` as published: it reads `number` ABI-encoded from stdin, refuses an odd
// one, and commits it ABI-encoded. That journal is known in advance, so the request asks for
// exactly it, as the template's app does.
//
// What the Pot does differently: the market calls it back with the verified journal, so there is no
// `set(x, seal)` to send after the proof and no seal to verify again; the number is kept in the
// Pot's storage at `keccak256("EvenNumber.number")`, where the template keeps it in its contract's
// `number`; and a request no prover fulfils by its deadline gives its price back in `.catch`. The
// request pays at most `maxPrice` wei, which the Pot deposits, and asks the prover that takes it to
// lock 15 ZKC as collateral. Base only.
//
//   sauce run even-number.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <number> <imageId> <imageUrl> <maxPrice>
//
//   number: Uint256  the number to prove even and keep
//   imageId: Uint256  the is-even guest's image id
//   imageUrl: bytes  where provers download the guest, its UTF-8 bytes
//   maxPrice: Uint256  the most the proof is paid, in wei
//
// Keeping 42, paying at most 0.001 ETH:
//
//   sauce run even-number.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args 42 <imageId> <imageUrl> 1000000000000000
import { Zk } from "@sauce/zk";

function main(number: Uint256, imageId: Uint256, imageUrl: bytes, maxPrice: Uint256): void {
  Zk.risc0({
    imageId,
    imageUrl,
    input: abi.encode(number),
    journal: abi.encode(number),
    offer: {
      maxPrice,
      rampUpPeriod: 60,
      lockTimeout: 900,
      timeout: 1800,
      lockCollateral: 15000000000000000000,
    },
  })
    .then((journal) => {
      const [even] = abi.decode(journal, ["Uint256"]);
      evm.sstore(crypto.keccak256("EvenNumber.number"), even);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
