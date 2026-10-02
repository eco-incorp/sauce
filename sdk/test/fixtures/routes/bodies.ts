/**
 * Route BODIES, compiled the way TypeScript compiles one — `Base(program, options)`, or
 * `compileSauceRoute` — with the values they read handed in as `defines`, since a body built from
 * TypeScript takes no `main` arguments. Kept as strings rather than `.sauce.ts` files: a program
 * file's inputs are its `main` parameters, and these read names they never declare.
 */

/**
 * Three hops, Base, then Ethereum, then Base again, each amount measured on arrival: the
 * nested-intents guide's cascade as the body of an intent to Base, before the guide's file opened
 * that intent itself with `main` arguments. `RECIPIENT` is the define its route is compiled with,
 * and each level's creator.
 */
export const CASCADE_BODY = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum.Portal.send({ token: USDC, amount })
    .creator(RECIPIENT)
    .receive({ token: USDC, amount })
    .then(() => {
      const arrived = USDC.balanceOf(ctx.self());
      Base.Portal.send({ token: USDC, amount: arrived })
        .creator(RECIPIENT)
        .receive()
        .then(() => {
          USDC.transfer(RECIPIENT, arrived);
        });
    });
}`;

/**
 * A body that measures what the calls before it left in the Pot and opens a new intent carrying it
 * to Arbitrum: the README's example until that became a program a Pot runs with
 * `main(recipient, minAmount)`. `RECIPIENT` and `MIN_AMOUNT` are the defines its route is compiled
 * with, `RECIPIENT` the intent's creator too.
 */
export const BODY_TO_ARBITRUM = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum.Portal.send({ token: USDC, amount })
    .creator(RECIPIENT)
    .receive()
    .then(() => {
      USDC.transfer(RECIPIENT, amount);
    });
}`;
