export const dispatch = `
import { HyperlaneMailboxABI as IMailbox } from "./abis";

function main(mailboxAddress: Address, destinationDomain: Uint256, recipientAddress: Uint256, messageBody: bytes): Uint256 {
  const mailbox = IMailbox.at(mailboxAddress);
  return mailbox.dispatch(destinationDomain, recipientAddress, messageBody);
}
`;
//# sourceMappingURL=functions.js.map