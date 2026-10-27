/** Refuses `"self"` as a balance's owner: the Pot is `"pot"`. Internal; not in the `token` barrel. */
export function refuseSelfOwner(owner: unknown): void {
  if (owner === "self") {
    throw new Error('Token.balanceOf: the Pot is "pot", not "self": write owner: "pot"');
  }
}
