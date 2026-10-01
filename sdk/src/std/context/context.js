/**
 * The contract running the program — a route body's `self`, which the SDK declares as a getter of
 * this function.
 */
export function self(): Address {
  return ctx.self();
}
