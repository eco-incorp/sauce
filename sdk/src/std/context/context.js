// The account the program runs as: the Pot on the EVM, the program's own account on the SVM. The
// extensions manifest binds a bare `self` to this function, so `self` reads as `ctx.self()`.
export function self(): Address {
  return ctx.self();
}
