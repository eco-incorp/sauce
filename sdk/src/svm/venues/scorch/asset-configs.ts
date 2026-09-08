/**
 * Scorch mint -> AssetConfig account address directory.
 *
 * WHY THIS FILE EXISTS: the swap CPI (SCoRcH8c2d.../ROUTER) needs the two
 * per-mint AssetConfig accounts (owned by the core program ojh19oj...) as
 * fixed account-list entries, but their address is NEITHER embedded in the
 * PairConfig account NOR a PDA of any seed scheme this repo could recover
 * (tried ["asset_config", mint], ["asset_configv0", mint] and combined-string
 * variants against @solana/kit's getProgramDerivedAddress — none matched the
 * 19 real on-chain addresses; the program is closed-source with no IDL). The
 * addresses ARE stable, small in count, and independently ground-truthable via
 * a memcmp getProgramAccounts scan (owner=ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch,
 * dataSize=592, mint stored at byte offset 16), so this repo vendors the
 * directory as a checked-in snapshot — the same pattern this repo already uses
 * for anvil-state blobs and prod-mirror pool dumps (CLAUDE.md's "recapture"
 * convention) — rather than resolving it live on every fetch.
 *
 * SELF-DROP ON MISS: fetchPoolConfig throws a named error for a pair whose
 * mint is absent here (a newly listed Scorch asset) — that ONE pool drops out
 * of discovery/compile until the snapshot is refreshed; every other venue and
 * every other Scorch pair is unaffected (venue-robustness: one missing entry
 * never kills a cook).
 *
 * RECAPTURE (whenever a new asset is listed on Scorch):
 *   1. getProgramAccounts ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch filtered to
 *      dataSize=592 (base64 encoding);
 *   2. for each match, mint = the 32 bytes at data offset 16 (base58-encode);
 *   3. regenerate this file's SCORCH_ASSET_CONFIGS map (mint -> account pubkey).
 * Captured 2026-07-31 against mainnet-beta (19 entries).
 */
export const SCORCH_ASSET_CONFIGS: Record<string, string> = {
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": "C4Ur6NGSfXhG3E9oEHtHwvirkrmFLcXUL9aAciERnDmH",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": "3WDa4Ktb9D4aoXkBSKgSzHnCMEhkLWQA5aqZhNYbJNnh",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "48oj1kDu5Ue2P8hKzc9EnQpj4RGb79opxdzA5RxJmNtM",
  "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g": "HkxRmnfVURPAfQwpqdupDiLEixzsrFvMGrJoMByRYbLh",
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump": "BoQM6x6ywXi7mCTUJ1hhteV6aBkU5gb6HSkpEkmigM7F",
  A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS: "54ojLc4bz3XiuJbQ2AcoFZWztNPieeSzSMGraZZJ8XRc",
  Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump: "AxomzsLTBovkxFkG5eKrueMaTTQNvnexKppXCcsMrZDE",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "DmocjvFXp75asezCDKVNH2qaXbjrV7VeQk4aLZaPF88E",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "9UmAmvtBZrS1Er85MC2DzTyHR522XJqA1EpHQNPLhX5F",
  J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd: "8qJv2UimodDXpVNfQmywcVLDqfYUaH92tVKcFbPUrmgH",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "HKHdrDZUpD4wwyYcRJmEJ2zuUsaLG8MJVmb3wQptUQQh",
  METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL: "8q6b5SVchguPwzZ8QNANqE6KUpnuyHkC92qJztm85fBa",
  SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3: "HFQXJJcHrvTPTLLvanj4hSEQ4ZMhAaQMCYWWV863Ucr9",
  SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb: "D7hf81gzDL9b6p64q1W5GGBqr6aHKPdiekdKfc8tVAu",
  So11111111111111111111111111111111111111112: "85Etk23kFtyt265MQjyUgzJYZ7u5o2EVNdjDmuNySbGi",
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: "Dmzyxo3okyDBZxmn6Sb6dgAMmS8BUEbEGYfAn1vcszgv",
  Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8: "CUmkAhoMJKKkKzb9cELye6fBsLMhLM2B85W8qYxhk6Nd",
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: "3yxUv32cBvxeVD426HnhzSxGAwBi4FawC2ppr4D43bmZ",
  pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "6YBK7CsGp2UjNm9hkYeFgCwbXcEBEnXoZUm5k7LQCU1F",
};
