/**
 * The steps a command sends first, approved once for all of them (`cli/approvals.ts`): one question
 * however many there are, `--yes` approving each and saying so, and a refusal that sends nothing —
 * no one to ask (no terminal, or `--json`), or an answer other than yes — naming every step, and how
 * to approve them or do them by hand. The Pot's deployment is one such step; a command adds others
 * to the same list rather than asking a question of its own.
 */
import {
  approvalQuestion,
  approveAll,
  type Approver,
  type PendingApproval,
} from "../src/cli/approvals.js";

const POT: PendingApproval = {
  action: "deploy Pot 0xPot",
  reason: "Your Pot 0xPot on base isn't deployed yet",
  offer: "Deploy it now",
  estimate: "about 274,512 gas, ~0.00008 ETH",
  byHand: "deploy it yourself with sauce pot --deploy --chain base",
};
const RECEIVER: PendingApproval = {
  action: "install the receiver on optimism",
  reason: "The message's receiver is not on optimism yet",
  offer: "Install it now",
  estimate: "about 90,000 gas, ~0.00001 ETH",
};

/** An approver at a terminal answering `answer`, recording what it was asked and approved. */
function approver(options: Partial<Approver> & { readonly answer?: boolean | undefined }) {
  const asked: string[] = [];
  const approved: string[] = [];
  const value: Approver = {
    auto: options.auto ?? false,
    canAsk: options.canAsk ?? true,
    ...(options.why === undefined ? {} : { why: options.why }),
    approve: async (action, question) => {
      if (options.auto === true) {
        approved.push(action);

        return true;
      }
      asked.push(question);

      return options.answer;
    },
  };

  return { value, asked, approved };
}

describe("the steps a command sends first", () => {
  it("are one question: the step's own when it is alone, a list when there are several", () => {
    expect(approvalQuestion([POT], "run")).toBe(
      "Your Pot 0xPot on base isn't deployed yet. Deploy it now (one transaction, about 274,512 " +
        "gas, ~0.00008 ETH), then run? [deploy/cancel] ",
    );
    expect(approvalQuestion([POT, RECEIVER], "run").split("\n")).toEqual([
      "Before it can run, it sends 2 transactions:",
      "  1. Your Pot 0xPot on base isn't deployed yet: deploy Pot 0xPot (about 274,512 gas, ~0.00008 ETH)",
      "  2. The message's receiver is not on optimism yet: install the receiver on optimism (about 90,000 gas, ~0.00001 ETH)",
      "Send them, then run? [deploy/cancel] ",
    ]);
  });

  it("are asked about once, and approved together", async () => {
    const yes = approver({ answer: true });
    await expect(approveAll(yes.value, [POT, RECEIVER])).resolves.toBeUndefined();
    expect(yes.asked).toHaveLength(1);
    expect(await approveAll(yes.value, [])).toBeUndefined();
    expect(yes.asked).toHaveLength(1);
  });

  it("are each approved, and said, with --yes, with nothing asked", async () => {
    const auto = approver({ auto: true });
    await approveAll(auto.value, [POT, RECEIVER]);
    expect(auto.approved).toEqual([POT.action, RECEIVER.action]);
  });

  it("are refused, naming each, when no one can be asked", async () => {
    await expect(approveAll(approver({ canAsk: false }).value, [POT, RECEIVER])).rejects.toThrow(
      "nothing was sent: this run needs approvals, and there is no terminal to ask on:\n" +
        `  ${POT.action}\n  ${RECEIVER.action}\nPass --yes (-y) to approve them`,
    );
    await expect(
      approveAll(approver({ canAsk: false, why: "--json asks nothing" }).value, [POT]),
    ).rejects.toThrow(`this run needs an approval, and --json asks nothing:\n  ${POT.action}\n`);
  });

  it("are refused when the answer is not yes, saying how to approve them or do them by hand", async () => {
    await expect(approveAll(approver({ answer: false }).value, [POT])).rejects.toThrow(
      "Your Pot 0xPot on base isn't deployed yet, so nothing was sent: run again and answer " +
        "deploy, or pass --yes (-y), or deploy it yourself with sauce pot --deploy --chain base",
    );
    await expect(
      approveAll(approver({ answer: undefined }).value, [POT, RECEIVER]),
    ).rejects.toThrow(
      `${POT.reason}; ${RECEIVER.reason}, so nothing was sent: pass --yes (-y) to approve them ` +
        `first, or ${POT.byHand}`,
    );
  });
});
