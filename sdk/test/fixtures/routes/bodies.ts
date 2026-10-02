/**
 * Route BODIES, compiled the way TypeScript compiles one — `Base(program, options)`, or
 * `compileSauceRoute` — with the values they read handed in as `defines`, since a body built from
 * TypeScript takes no `main` arguments. Kept as strings rather than `.sauce.ts` files: a program
 * file's inputs are its `main` parameters, and these read names they never declare.
 */

/**
 * Three hops, Base, then Ethereum, then Base again, each amount measured on arrival: the
 * nested-intents guide's cascade as the body of an intent to Base, before the guide's file opened
 * that intent itself with `main` arguments. `RECIPIENT` is the define its route is compiled with.
 */
export const CASCADE_BODY = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum(
    () => {
      const arrived = USDC.balanceOf(ctx.self());
      Base(() => {
        USDC.transfer(RECIPIENT, arrived);
      }).reward({ tokens: [{ token: USDC, amount: arrived }] });
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}`;
