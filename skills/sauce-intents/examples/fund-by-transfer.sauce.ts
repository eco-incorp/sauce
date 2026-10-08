// Publishes an intent built elsewhere, funded from this Pot by a transfer into its vault: the route
// and the reward are inputs, as another tool encodes them. An intent written in SauceScript, with
// the chain syntax, does not need this file: the program that opens it already funds it by
// transfer and publishes it.
//
// One cook: the Pot reads the intent's vault from the source chain's Portal (`EcoRoutes.Portal`, the
// registry's), transfers each reward token there, and publishes, so the vault can't be wrong and
// nothing is published unfunded. No approval is involved, so a token like USDT needs nothing
// special. `destination`, `route` and `reward` are the arguments of the Portal's `publish`, the
// same `publish` that `sauce intent publish … --from <address> --format json` prints for an intent
// file (which already funds that way).
//
//   sauce run fund-by-transfer.sauce.ts --chain <chain> \
//     --keystore <keystore> --args <destination> <route> <reward>
//
//   destination: Uint256  the destination's chain id: 1 is Ethereum
//   route: bytes          the encoded route, 0x hex, as the publish transaction carries it
//   reward: { deadline: Uint256; creator: Address; prover: Address; nativeAmount: Uint256;
//             tokens: { token: Address; amount: Uint256 }[] }
//                         the reward, a JSON object: each token's amount in its smallest units,
//                         {"deadline": <unix seconds>, "creator": "<address>", "prover": "<address>",
//                         "nativeAmount": 0, "tokens": [{"token": "<token>", "amount": 1010000}]}
//                         is 1.01 of a 6-decimal token such as USDC
//
// Returns the intent's hash and its vault, as `publish` does. On Base, for an intent to Ethereum:
//
//   sauce run fund-by-transfer.sauce.ts --chain base \
//     --keystore <keystore> --args 1 <route> <reward>
function main(
  destination: Uint256,
  route: bytes,
  reward: {
    deadline: Uint256;
    creator: Address;
    prover: Address;
    nativeAmount: Uint256;
    tokens: { token: Address; amount: Uint256 }[];
  },
): { intentHash: Uint256; vault: Address } {
  // A native reward is sent to the vault with the cook's value; this program funds tokens only.
  require(reward.nativeAmount == 0, "a native reward is not funded here");
  const vault = EcoRoutes.Portal.intentVaultAddress(destination, route, reward);
  for (const t of reward.tokens) {
    Token(t.token).transfer(vault, t.amount);
  }
  const [intentHash, published] = EcoRoutes.Portal.publish(destination, route, reward);
  require(published == vault, "the Portal published to another vault");
  return { intentHash, vault };
}
