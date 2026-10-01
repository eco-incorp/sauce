// Opens an intent funded by transfer: the reward goes straight into the intent's vault, the
// address the source Portal derives from the intent itself, and then the intent is published. One
// cook on the Pot, so the vault can't be wrong and nothing is published unfunded. No approval is
// involved, so a token like USDT needs nothing special.
//
// `destination`, `route` and `reward` are the arguments of the Portal's `publish`, the same
// `publish` that `sauce publish … --from <address> --format json` prints for an intent file (which
// already funds that way); `portal` is the source chain's Portal (its file in sauce-chains).
//
//   sauce run fund-by-transfer.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --args <portal> <destination> <route> <reward>
function main(
  portal: Address,
  destination: Uint256,
  route: bytes,
  reward: {
    deadline: Uint256;
    creator: Address;
    prover: Address;
    nativeAmount: Uint256;
    tokens: { token: Address; amount: Uint256 }[];
  },
): bytes {
  // A native reward is sent to the vault with the cook's value; this program funds tokens only.
  require(reward.nativeAmount == 0n, "a native reward is not funded here");
  const intent = abi.encode(destination, route, reward);

  // intentVaultAddress(uint64,bytes,(uint64,address,address,uint256,(address,uint256)[]))
  const vaultOf = hex`0742ebe4`;
  const vault = abi.decode(evm.static(portal, vaultOf.concat(intent)), ["Address"])[0];
  for (const t of reward.tokens) {
    Token(t.token).transfer(vault, t.amount);
  }

  // publish(uint64,bytes,(uint64,address,address,uint256,(address,uint256)[])): returns
  // (intentHash, vault).
  const publish = hex`645c890c`;
  return evm.call(portal, 0n, publish.concat(intent));
}
