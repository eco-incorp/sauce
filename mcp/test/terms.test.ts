/**
 * The `sauce` command's words in the tools' terms: a message or note that names a flag or a
 * command line reaches an agent naming the tool input or the tool instead.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toolTerms } from "../src/terms.js";

describe("toolTerms", () => {
  it("names each flag as its input", () => {
    assert.equal(
      toolTerms("missing --pot <address> or --owner <address>: the Pot to cook on"),
      "missing pot <address> or owner <address>: the Pot to cook on",
    );
    assert.equal(
      toolTerms("give --salt or --salt-hex, not both"),
      "give salt or saltHex, not both",
    );
    assert.equal(
      toolTerms(
        "main(a: Uint256) takes 1 argument: pass them after --args, in order, or as --args-json",
      ),
      "main(a: Uint256) takes 1 argument: pass them as args, in order",
    );
    assert.equal(
      toolTerms("the Pot holds 2 USDC: --assume-balance, plus what --fund would pull"),
      "the Pot holds 2 USDC: assumeBalance, plus what fund would pull",
    );
    // The operator's flag stays: it is not an input.
    assert.equal(toolTerms("add it to the --config file"), "add it to the --config file");
  });

  it("names a command line as the tool, and a signing one as what the caller does", () => {
    assert.equal(
      toolTerms(
        "It is NOT deployed. Deploy it first (sauce pot --deploy --owner 0xabc --chain base --keystore <its keystore>), then fund it.",
      ),
      "It is NOT deployed. Deploy it first (sauce_pot (its unsigned deployment, which any account may send)), then fund it.",
    );
    assert.equal(
      toolTerms(
        "USDC is not a token base registers (sauce globals --chain base --tokens lists them)",
      ),
      "USDC is not a token base registers (sauce_globals lists them)",
    );
    assert.equal(toolTerms("sauce run would refuse it"), "a signed run would refuse it");
    assert.equal(
      toolTerms(
        "swap.sauce.ts's intents go to base and optimism: --rpc-url names one endpoint, so give --config, which names each destination's",
      ),
      "swap.sauce.ts's intents go to base and optimism: rpcUrl names one endpoint, so give rpcUrls, which names each one",
    );
    assert.equal(
      toolTerms(
        "This rehearses publishing on arbitrum only. `sauce fill` with the same file and flags, and the destination's endpoint, rehearses that.",
      ),
      "This rehearses publishing on arbitrum only. sauce_fill with the same inputs, and the destination's endpoint, rehearses that.",
    );
    assert.equal(toolTerms("no flags, no commands"), "no flags, no commands");
  });
});
