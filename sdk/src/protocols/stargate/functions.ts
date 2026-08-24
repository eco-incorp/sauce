export const bridge = `
import { StargatePoolABI as IStargatePool } from "./abis";

function main(poolAddress: Address, dstEid: Uint256, recipient: Uint256, amount: Uint256, minAmount: Uint256): Uint256 {
  const pool = IStargatePool.at(poolAddress);
  return pool.send({dstEid: dstEid, to: recipient, amountLD: amount, minAmountLD: minAmount, extraOptions: 0x00, composeMsg: 0x00, oftCmd: 0x00}, {nativeFee: ctx.msgValue(), lzTokenFee: 0}, ctx.msgSender());
}
`;
