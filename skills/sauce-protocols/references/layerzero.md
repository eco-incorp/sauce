# LayerZero

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

## Category

cross-chain messaging | Direction: any-to-any | Chains and addresses: [registry/layerzero.md](registry/layerzero.md)

## SauceScript Functions

### sendMessage

Send a cross-chain message via LayerZero Endpoint V2.

```typescript
import { LayerZeroEndpointV2ABI as IEndpointV2 } from "./abis";

function main(
  endpointAddress: Address,
  dstEid: Uint256,
  receiver: Uint256,
  message: bytes,
): { guid: Uint256; nonce: Uint256; fee: { nativeFee: Uint256; lzTokenFee: Uint256 } } {
  const endpoint = IEndpointV2.at(endpointAddress);
  return endpoint.send(
    { dstEid: dstEid, receiver: receiver, message: message, options: 0x00, payInLzToken: false },
    ctx.msgSender(),
  );
}
```

- `dstEid`: LayerZero endpoint ID for destination chain (NOT the EVM chain ID)
- `receiver`: Destination contract address as bytes32 (left-padded)
- `message`: Arbitrary message payload
- `options`: Execution options (gas limits, etc.). Use `0x00` for defaults
- `payInLzToken`: false = pay fees in native token, true = pay in ZRO token
- Requires native token (ETH) for messaging fees (sent as msg.value)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/layerzero.md](registry/layerzero.md).

## Notes

- This is a messaging protocol, not a direct token bridge. Token bridging is done via OFT (Omnichain Fungible Token) contracts built on top of LayerZero
- Uses endpoint IDs (dstEid) for chain identification, NOT EVM chain IDs
- Same endpoint address across most chains (except zkSync)
- Use `quote` to estimate fees before sending
- Finality: depends on DVN (Decentralized Verifier Network) configuration, typically 1-5 minutes
- Powers Stargate V2, OFT tokens, and many cross-chain dApps
- TVL: $5B+ (across protocols built on LayerZero). Audited
- On Arc (5042, eid 30417) the messaging fee `msg.value` is native USDC at 18 decimals, from the same balance as the USDC ERC-20 `0x3600…0000`
