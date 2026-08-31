// ERC20-like transfer operation
// Demonstrates: storage, crypto, abi encode/decode, events, ctx.msgSender()

function balanceSlot(account: any) {
  return crypto.keccak256(abi.encode(account, 1));
}

function main(to: any, amount: any) {
  const from = ctx.msgSender();
  const fromSlot = balanceSlot(from);
  const fromBalance = storage.read(fromSlot);
  if (fromBalance < amount) throw "insufficient balance";
  storage.write(fromSlot, fromBalance - amount);
  const toSlot = balanceSlot(to);
  storage.write(toSlot, storage.read(toSlot) + amount);
  emit("Transfer(address,address,uint256)", { from, to, amount }, "from", "to");
  return 1;
}
