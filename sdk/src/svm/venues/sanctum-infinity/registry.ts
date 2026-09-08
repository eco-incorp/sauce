/**
 * Sanctum Infinity (`sanctum-infinity` SvmRoute venue) — vendored per-LST
 * registry: mint -> { family, stakePool }.
 *
 * WHY THIS EXISTS: Infinity's `LstState` (read live from `lst_state_list`,
 * see `./sanctum-infinity.ts`) names each LST's SOL-value CALCULATOR
 * PROGRAM — but the calculator CPI also needs the specific STAKE-POOL
 * ACCOUNT for that LST (the account holding `total_lamports`/
 * `pool_token_supply`), and that address is NOT derivable from `LstState`,
 * the calculator program id, or the mint alone (confirmed against the
 * `SplLstSolValCalc::from_pool` constructor in igneous-labs/S, which takes
 * `stake_pool_addr` as an external input — see the module doc in
 * `./sanctum-infinity.ts` for the full source trail). It has to come from
 * somewhere outside the pool itself.
 *
 * SOURCE: `sanctum-lst-list.toml` (github.com/igneous-labs/sanctum-lst-list,
 * master, fetched 2026-07-31) — Sanctum's own community LST directory,
 * `[[sanctum_lst_list]].mint` + `.pool.{program,pool}`. Every row below was
 * CROSS-VALIDATED against a live read of Infinity's own `lst_state_list`
 * (`Gb7m4daakbVbrFLR33FKMDVMHAprRZ66CSYt4bpFwUgS`) on 2026-07-31: of the 124
 * LSTs live in the pool that epoch, 122 resolve to one of the 4 families
 * this adapter supports (spl 22, sanctumSpl 83, sanctumSplMulti 16, wsol 1;
 * the remaining 2 are marinade/lido, out of scope — see the adapter's module
 * doc), and of those 121 non-wsol legs, 110 matched a `sanctum-lst-list.toml`
 * row whose `pool.program` (`Spl`/`SanctumSpl`/`SanctumSplMulti`) agreed
 * EXACTLY with the on-chain `LstState.sol_value_calculator` — zero
 * mismatches. The other 11 on-chain LSTs are newer than this TOML snapshot
 * (absent from the list entirely, not merely differently classified) and so
 * are not in this table; a mint absent here self-drops (see the adapter's
 * `fetchPoolConfig` — one unmapped LEG never kills the pair, only that
 * pair's candidacy).
 *
 * STALENESS: this table can only ever be a SNAPSHOT — Sanctum whitelists new
 * LSTs continuously, and the vendored registry does not auto-track that (the
 * SAME shape of limitation `scorch-asset-configs.ts`'s header documents for
 * its own vendored directory). A live-getProgramAccounts resolution
 * (memcmp on `pool_mint` at the stake-pool account's offset 162 — verified
 * identical across all three families' account layout) would close this
 * gap and is a natural follow-up; out of scope for this pass. Re-derive by
 * re-fetching the TOML and re-running the cross-check above (see PR
 * description for the exact script).
 *
 * All 110 mints resolve through the classic Tokenkeg token program (no
 * Token-2022 outliers in this set) — confirmed against the same TOML rows.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";

export type SanctumInfinityCalcFamily = "spl" | "sanctumSpl" | "sanctumSplMulti";

export interface SanctumInfinityRegistryEntry {
  family: SanctumInfinityCalcFamily;
  /** The specific stake-pool account this LST's calculator CPI reads (total_lamports/pool_token_supply). */
  stakePool: Address;
}

/** wSOL — the one `wsol`-family leg live in the pool; handled without a registry row (see the adapter). */
export const WSOL_MINT: Address = address("So11111111111111111111111111111111111111112");

/** mint (base58) -> registry entry. Sorted by mint for readability; lookup is by Map, not position. */
const ENTRIES: readonly [string, SanctumInfinityRegistryEntry][] = [
  [
    "3bfv2scCdbvumVBc3Sar5QhYXx7Ecsi8EFF2akjxe329",
    { family: "sanctumSpl", stakePool: address("Fwy2jGmRCDjKpWTacMVvnLp66Fg4L5yhVCfahHsbjMGf") },
  ], // digitalSOL
  [
    "7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn",
    { family: "spl", stakePool: address("CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1") },
  ], // JSOL
  [
    "Agi84n7Hfw9sQMah9sumHU6Jyjsc6Uw2WjehSFG92qMG",
    { family: "sanctumSpl", stakePool: address("3k8cCTWYyH6WoBzbdinbyc59p2LAarSGVrgJiVCtcKhs") },
  ], // DKS
  [
    "BANXyWgPpa519e2MtQF1ecRbKYKKDMXPF1dyBxUq9NQG",
    {
      family: "sanctumSplMulti",
      stakePool: address("4fdMvFuyNboQ5Kr93X16f1tFcTeEkvfNwNAeSrzY3afb"),
    },
  ], // banxSOL
  [
    "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85",
    { family: "spl", stakePool: address("Hr9pzexrBge3vgmBNRR8u42CNQgBXdHm4UkUN2DH4a7r") },
  ], // BNSOL
  [
    "BPSoLzmLQn47EP5aa7jmFngRL8KC3TWAeAwXwZD8ip3P",
    { family: "sanctumSpl", stakePool: address("ETVc1GBAiKzv2gNaA3Hfq4hsS1Mzh1NwQSxRFst7k8vz") },
  ], // bpSOL
  [
    "BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn",
    {
      family: "sanctumSplMulti",
      stakePool: address("3aUmJDNpMHjkxunQEkHTj2chzyryKoH2uQj6YACLD174"),
    },
  ], // BulkSOL
  [
    "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs",
    { family: "sanctumSpl", stakePool: address("ArAQfbzsdotoKB5jJcZa3ajQrrPcWr2YQoDAEAiFxJAC") },
  ], // bonkSOL
  [
    "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B",
    { family: "sanctumSpl", stakePool: address("2aMLkB5p5gVvCwKkdSo5eZAL1WwhZbxezQr1wxiynRhq") },
  ], // bbSOL
  [
    "CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX",
    { family: "sanctumSpl", stakePool: address("8B9yuGU5SbXLE56k4yH2AfqbMXNEah7MJMbZKDPqg23X") },
  ], // CDCSOL
  [
    "CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE",
    { family: "spl", stakePool: address("CgntPoLka5pD5fesJYhGmUCF8KU1QS1ZmZiuAuMZr2az") },
  ], // cgntSOL
  [
    "Comp4ssDzXcLeu2MnLuGNNFC4cmLPMng8qWHPvzAMU1h",
    { family: "sanctumSpl", stakePool: address("AwDeTcW6BovNYR34Df1TPm4bFwswa4CJY4YPye2LXtPS") },
  ], // compassSOL
  [
    "D1gittVxgtszzY4fMwiTfM4Hp7uL5Tdi1S9LYaepAUUm",
    { family: "sanctumSpl", stakePool: address("4qYufFsPQETukkXd5z9fxDsdwm8AEaSqzYpuzmZzCJxR") },
  ], // digitSOL
  [
    "DEF1NXSZ8Th9n28hYBayrFtx9bj1EwwTiy3mhHEB9oyA",
    {
      family: "sanctumSplMulti",
      stakePool: address("Bvbu55B991evqqhLtKcyTZjzQ4EQzRUwtf9T4CcpMmPL"),
    },
  ], // definSOL
  [
    "DUAL6T9pATmQUFPYmrWq2BkkGdRxLtERySGScYmbHMER",
    { family: "sanctumSpl", stakePool: address("BmEgS5XpWJJDqT3FVfB6ZmoELQrWkJxDXo3cNoJVsNFK") },
  ], // dualSOL
  [
    "DYNoyS3x5qgbccZg7RPXagm4xQzfnm5iwd9o8pMyJtdE",
    { family: "spl", stakePool: address("DpooSqZRL3qCmiq82YyB4zWmLfH3iEqx2gy8f2B6zjru") },
  ], // dynoSOL
  [
    "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ",
    { family: "sanctumSpl", stakePool: address("9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn") },
  ], // dSOL
  [
    "EPCz5LK372vmvCkZH3HgSuGNKACJJwwxsofW6fypCPZL",
    { family: "sanctumSpl", stakePool: address("6LXCxeyQZqdAL4yLCtgATFYF6dcayWvsiwjtBFYVfb1N") },
  ], // rkSOL
  [
    "FRAGME9aN7qzxkHPmVP22tDhG87srsR9pr5SY9XdRd9R",
    { family: "sanctumSpl", stakePool: address("LUKAypUYCVCptMKuN7ug3NGyRFz6p3SvKLHEXudS56X") },
  ], // fSOL
  [
    "Fi5GayacZzUrfaCRCJtBz2vSYkGF56xjgCceZx5SbXwq",
    {
      family: "sanctumSplMulti",
      stakePool: address("9Z8yimuc3bQCWLDyMhe6jfWqNk9EggyJZUo8TLnYsqhN"),
    },
  ], // wifSOL
  [
    "GEJpt3Wjmr628FqXxTgxMce1pLntcPV4uFi8ksxMyPQh",
    { family: "spl", stakePool: address("7ge2xKsZXmqPxa3YmXxXmzCp9Hc2ezrTxh6PECaxCwrL") },
  ], // daoSOL
  [
    "GRJQtWwdJmp5LLpy8JWjPgn5FnLyqSJGNhn5ZnCTFUwM",
    { family: "sanctumSpl", stakePool: address("6e2LpgytfG3RqMdYuPr3dnedv6bmHQUk9hH9h2fzVk9o") },
  ], // clockSOL
  [
    "Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn",
    { family: "spl", stakePool: address("3fV1sdGeXaNEZj6EPDTpub82pYxcRXwt2oie6jkSzeWi") },
  ], // dzSOL
  [
    "HALALGvdNJ8u1J3uFFSsba1tyYPRF3vnYfCQ3CpJasfD",
    { family: "sanctumSpl", stakePool: address("C5jSbkdn83TK2ajtsAdK7T1gzH2NugZk4VoNSem2qjzR") },
  ], // iASOL
  [
    "HUBsveNpjo5pWqNkH57QzxjQASdTVXcSK7bVKTSZtcSX",
    { family: "sanctumSpl", stakePool: address("ECRqn7gaNASuvTyC5xfCUjehWZCSowMXstZiM5DNweyB") },
  ], // hubSOL
  [
    "HausGKcq9G9zM3azwNmgZyzUvYeeqR8h8663PmZpxuDj",
    { family: "sanctumSpl", stakePool: address("5bzgfi7nidWWrp3DCwPwLzepw7PGgawRmMH9tqqXMZRj") },
  ], // hausSOL
  [
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    { family: "spl", stakePool: address("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb") },
  ], // JitoSOL
  [
    "KTjWwdHU3PpjxX5XsbdXGr7oNzz9uig1K5uqUXsBAGS",
    { family: "sanctumSpl", stakePool: address("9qBcbY6kXiFfcets3XS8tay36BZQLSLs3eteMZPSYABK") },
  ], // SOLb
  [
    "KUMAgSzADhUmwXwNiUbNHYnMBnd89u4t9obZThJ4dqg",
    { family: "sanctumSpl", stakePool: address("Fvy5L7f3rduuYfRf9GR9fDqEgmJkYagDPh3Ddkp5jcoP") },
  ], // kumaSOL
  [
    "LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X",
    { family: "spl", stakePool: address("2qyEeSAWKfU18AFthrF7JA8z8ZCi1yt76Tqs917vwQTV") },
  ], // laineSOL
  [
    "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp",
    { family: "spl", stakePool: address("DqhH94PjkZsjAqEze2BEkWhFQJ6EyU6MdtMphMgnXqeK") },
  ], // LST
  [
    "Lakej6n5VCagKPS3eEU77m7iRYztNp3eiUH95q7dpsW",
    { family: "sanctumSpl", stakePool: address("95tkNsPVV3gTwG3jrxSbbVowo5WG2VZDY2efze2EQ3pD") },
  ], // lakeSOL
  [
    "LegQQkRCGrp4EqMy8NVrpMTbNi5jaQUDdhKhQSSBSE6",
    { family: "sanctumSpl", stakePool: address("4sSbXZ3UfP72BbqrCk6uxTo195QPgwS6ihpaCN6CFs7f") },
  ], // legendsSOL
  [
    "LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg",
    { family: "sanctumSpl", stakePool: address("LW3qEdGWdVrxNgxSXW8vZri7Jifg4HuKEQ1UABLxs3C") },
  ], // lanternSOL
  [
    "LumiP8p22hsa6jNHDMn85xCM4Hpyzoy15K1rLgFB9eG",
    { family: "sanctumSpl", stakePool: address("7ef7tkPqGehLZA1fGMB4jVsngyNadnxsHfvHRkDDbEU9") },
  ], // lumiSOL
  [
    "MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY",
    { family: "sanctumSpl", stakePool: address("9jWbABPXfc75wseAbLEkBCb1NRaX9EbJZJTDQnbtpzc1") },
  ], // mangoSOL
  [
    "MonkeD3uUj5c1w5tW8tJeTe5fX1jkpkdtD3dTibnidx",
    { family: "sanctumSpl", stakePool: address("HkjvNm1oUC3uySVukuGzEdHXsD19Z4SzGMhdZHhX9D8T") },
  ], // MonkeSOL
  [
    "MpsoLp1YBDqeiuSrVrYH4DoAGJ3myAMmMy6crYNVSTo",
    { family: "sanctumSpl", stakePool: address("4peTGNqmk2epWka7o4RmcgfsjbhZxPZ8ajyZmsNq4naz") },
  ], // mpSOL
  [
    "PawsoLz4VaXjb9jFTp1UF6qvYQ2qmxipZuRJuG16sVq",
    { family: "sanctumSpl", stakePool: address("Gyu7jVRXaBSWy5CPApsXa4Yat85F5AkcpC4JM5Z96shD") },
  ], // pawSOL
  [
    "PenguW6ZcFVuvbkm8wZhvCbv9KLExTJeH2Mff7p6TTY",
    { family: "sanctumSpl", stakePool: address("6GomXTMtSyG4n9owjZyFpRhmSUg8KAwZPcjH24Ls6j1v") },
  ], // penguSOL
  [
    "PoLaRbHgtHnmeSohWQN83LkwA4xnQt91VUqL5hx5VTc",
    { family: "sanctumSpl", stakePool: address("EYwMHf8Ajnpvy3PqMMkq1MPkTyhCsBEesXFgnK9BZfmu") },
  ], // polarSOL
  [
    "RDLGTw8UcSjpPkuu2u8AgEfPJk95DjcnrgPEyRyVFd6",
    {
      family: "sanctumSplMulti",
      stakePool: address("HMwyh2xECDXLNgLX3FzTQUMrswDuvfRpZyY4Hx9A1za1"),
    },
  ], // rdlgtSOL
  [
    "Ra1so1sTkvX3PorAM9ewqrsUMz9sPSbfFZ5oZUjN4oc",
    { family: "spl", stakePool: address("RaiDhwyRoMVxLN9KD7kAXAwHbWKf1TCTe5HFSrPVJaD") },
  ], // raiSOL
  [
    "SouL4UuxKaFutpyZGb2weXUPEQCCsmEHSubMJEs7ttH",
    { family: "sanctumSpl", stakePool: address("EtiHrfkBNJTkHyBrofC98z4yF6fdRYLMrDGZP2CCwDkC") },
  ], // soulSOL
  [
    "StPsoHokZryePePFV8N7iXvfEmgUoJ87rivABX7gaW6",
    { family: "sanctumSpl", stakePool: address("7yQNEvbzH6KffCY7iYFrKCKXv8c9zB9jJREmPK6gBVYz") },
  ], // stepSOL
  [
    "ThUGsoLWtoTCfb24AmQTKDVjTTUBbNrUrozupJeyPsy",
    { family: "sanctumSpl", stakePool: address("G9WdMBxWSo1X3fKxbuyGrv1nGXrVqGg5zBKAkBFkb37g") },
  ], // thugSOL
  [
    "WensoLXxZJnev2YvihHFchn1dVVFnFLYvgomXWvvwRu",
    { family: "sanctumSpl", stakePool: address("CWM1VcNPd2A5WF2x2mmEUCgA1PGSKNZCGAH5GsoQw7h8") },
  ], // wenSOL
  [
    "WinDfAPoDk4P8D7eMkCVzY3Ged5vXtvT32XkWVBYGU8",
    { family: "sanctumSpl", stakePool: address("CBhqBAnnUEByPRwGZ2oCcrda7hV4QmkSYQ9Edy3zkqKi") },
  ], // windSOL
  [
    "Zippybh3S5xYYam2nvL6hVJKz1got6ShgV4DyD1XQYF",
    { family: "spl", stakePool: address("DxRFpqBQBC2nKcvh14gD1eizCj9Xi7ruMR3nCR3Hvw8f") },
  ], // zippySOL
  [
    "aeroXvCT6tjGVNyTvZy86tFDwE4sYsKCh7FbNDcrcxF",
    { family: "spl", stakePool: address("aero2ePURjuEgLKTzcUmF6RypBncBGd7pMUYCoSsVJ6") },
  ], // aeroSOL
  [
    "aiA9Ex1xGej38BP1nycxzR6TqVokoYi2xE3kqoNw2PU",
    { family: "sanctumSpl", stakePool: address("J8FzXAFAzPHAbjywWCEPR7uU45QaEeWkwE2B81G94MfE") },
  ], // ai20xSOL
  [
    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
    { family: "spl", stakePool: address("stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi") },
  ], // bSOL
  [
    "cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm",
    { family: "sanctumSpl", stakePool: address("2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa") },
  ], // dumSOL
  [
    "camaK1kryp4KJ2jS1HDiZuxmK7S6dyEtr9DA7NsuAAB",
    { family: "sanctumSpl", stakePool: address("2RUTyfN8iq7Hsd2s9rLgrRT9VhHLuqkx2mGNgbuzbhTc") },
  ], // camaoSOL
  [
    "chSoLyETGSZpdpAk4TKfRWw5kyuHkzt5WaQ2kiJYJun",
    { family: "sanctumSpl", stakePool: address("GA8X1dnaVmwyJ5R67hzqKvrVE3ZHi3dHHzbwNtAbYg5j") },
  ], // chSOL
  [
    "dbcMcw2pC8EDt5eiYMiMBwe35mCWK4hRpec98bKAjML",
    {
      family: "sanctumSplMulti",
      stakePool: address("2jwPxqMcYy7YRNteXr5yFmZVFopribgpR7mNHEm5sv5Q"),
    },
  ], // dbcSOL
  [
    "edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt",
    { family: "spl", stakePool: address("edgejNWAqkePLpi5sHRxT9vHi7u3kSHP9cocABPKiWZ") },
  ], // edgeSOL
  [
    "eon5tgYNk5FjJUcBUcLno49t2GfpmWZDzJHeYkbh9Zo",
    { family: "sanctumSpl", stakePool: address("G9Jgnqhq5MaDNmLSgTDSmiWRcmq67Q7yVnXjoA8tUsGX") },
  ], // eonSOL
  [
    "esprDDGBNVg3pJM8EQtCsVwcUsEk5TxgYGVjD4Uu7pZ",
    {
      family: "sanctumSplMulti",
      stakePool: address("32hsg4iXSPbbJxsr4oFkM2skBoauv9coqaUSAvXFU2JE"),
    },
  ], // espresSOL
  [
    "fpSoL8EJ7UA5yJxFKWk1MFiWi35w8CbH36G5B9d7DsV",
    {
      family: "sanctumSplMulti",
      stakePool: address("GutG5bcmEZw15WmPHNVMWHU77c6t8CEinUEdPLYz3doa"),
    },
  ], // fpSOL
  [
    "fuseYvhNJbSzdDByyTCrLcogsoNwAviB1WeewhbqgFc",
    { family: "sanctumSpl", stakePool: address("pjwKqvtt4ij6VJW4HxNxSaufSrkWHRc6iCTHoC4gFs4") },
  ], // fuseSOL
  [
    "gSvP9zBJ33pX7W2finzAYJZp6Q9ipNAQ19xU9PrCirz",
    { family: "sanctumSpl", stakePool: address("6KrUyxQR9ia4WCozrRzwkqpFrh9jzsmzrrEypfnz6bqh") },
  ], // gS
  [
    "gangqfNY8fA7eQY3tHyjrevxHCLnhKRrLGRwUMBR4y6",
    { family: "sanctumSpl", stakePool: address("4yQWc4Zss8YqWoVCwuSm3wVXebdHx9z6dPigH5eLqugm") },
  ], // lotusSOL
  [
    "gateMurAxe4YFoUR6J63gXGKtkbTfdkMdLjZrCmThFP",
    { family: "sanctumSpl", stakePool: address("31Mwyr8Qof3LjB7Nn8fuWk6HcGVJCTYFYU3bAmW9fcL1") },
  ], // GTSOL
  [
    "goSoLpeDU49kWPCt6pL4QQSPqns3c787uPTKpxH6LXW",
    { family: "sanctumSpl", stakePool: address("CZmVtFqkSqRAkV6Xq9X95asrW2hdBbc22Y6eLWSraVGC") },
  ], // goSOL
  [
    "haSo1Vz5aTsqEnz8nisfnEsipvbAAWpgzRDh2WhhMEh",
    { family: "sanctumSpl", stakePool: address("9ovWYMZp18Qn7UVbyUvwqLSBBSEPDDA5q9pUgDFy6R23") },
  ], // haSOL
  [
    "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
    { family: "sanctumSpl", stakePool: address("3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws") },
  ], // hSOL
  [
    "hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT",
    {
      family: "sanctumSplMulti",
      stakePool: address("hy1oDeVCVRDGkxS26qLVDvRhDpZGfWJ6w9AMvwMegwL"),
    },
  ], // hyloSOL
  [
    "hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u",
    {
      family: "sanctumSplMulti",
      stakePool: address("hy1o2kiYu9rUDFqHJSqwJH4j5ZkM23tBJsaEmqkP9sT"),
    },
  ], // hyloSOL+
  [
    "iceSdwqztAQFuH6En49HWwMxwthKMnGzLFQcMN3Bqhj",
    {
      family: "sanctumSplMulti",
      stakePool: address("EVXQHaLSJyUNrnBGfXUnvEi4DvVz4UJ3GnoKGVQVxrjr"),
    },
  ], // iceSOL
  [
    "jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV",
    { family: "spl", stakePool: address("jagEdDepWUgexiu4jxojcRWcVKKwFqgZBBuAoGu2BxM") },
  ], // jagSOL
  [
    "jucy5XJ76pHVvtPZb5TKRcGQExkwit2P5s4vY8UzmpC",
    { family: "sanctumSpl", stakePool: address("AZGSr2fUyKkPLMhAW6WUEKEsQiRMAFKf8Fjnt4MFFaGv") },
  ], // proSOL
  [
    "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    {
      family: "sanctumSplMulti",
      stakePool: address("8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr"),
    },
  ], // JupSOL
  [
    "kiLNQXQtoCDSVj6AcRXrSLK2kzBAbjrmdeeeghffrDD",
    { family: "sanctumSpl", stakePool: address("Bo9Z6Rkz6ooJgUfpdUUx7upq4ovReHQ88GJF4pNYdQyf") },
  ], // kilnSOL
  [
    "meme9VKXNNxquqQgvXTAauiHYP6giqrZHA2Tjzf9umy",
    {
      family: "sanctumSplMulti",
      stakePool: address("6uYGNQo1jotWKAcXMUpbtSbVRKuoj1RqMDTb67X3W8Ln"),
    },
  ], // memeSOL
  [
    "nordEhq2BnR6weCyrdezNVk7TwC3Ej94znPZxdBnfLM",
    { family: "sanctumSpl", stakePool: address("GrrASJmjz19gHDsUUGv9y3gtRAwYJcdrtFESCRAosd44") },
  ], // nordSOL
  [
    "orcaSo6gzWvvXvAHVJQVrxWmHepCcGp7swVX1yTBuoJ",
    { family: "sanctumSpl", stakePool: address("8JX2GTYio5T7AJKXCNW2K8XmmZXmKCsgwUZu44qqNbNj") },
  ], // orcaSOL
  [
    "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL",
    { family: "spl", stakePool: address("pSPcvR8GmG9aKDUbn9nbKYjkxt9hxMS7kF1qqKJaPqJ") },
  ], // PSOL
  [
    "pWrSoLAhue6jUxUkbWgmEy5rD9VJzkFmvfTDV5KgNuu",
    { family: "sanctumSpl", stakePool: address("DfiQgSvpW3Dy4gKfhtdHnWGHwFUrE8exvaxqjtMtAVxk") },
  ], // pwrSOL
  [
    "pathdXw4He1Xk3eX84pDdDZnGKEme3GivBamGCVPZ5a",
    {
      family: "sanctumSplMulti",
      stakePool: address("GM7TwD34n8HmDP9XcT6bD3JJuNniKJkrKQinHqmqHarz"),
    },
  ], // pathSOL
  [
    "phaseZSfPxTDBpiVb96H4XFSD8xHeHxZre5HerehBJG",
    {
      family: "sanctumSplMulti",
      stakePool: address("phasejkG1akKgqkLvfWzWY17evnH6mSWznnUspmpyeG"),
    },
  ], // phaseSOL
  [
    "picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX",
    { family: "sanctumSpl", stakePool: address("8Dv3hNYcEWEaa4qVx9BTN1Wfvtha1z8cWDUXb7KVACVe") },
  ], // picoSOL
  [
    "prgnSYr57EiEMUknwPrdaUSMyd4eFpdZDVBaa1xR2jY",
    { family: "sanctumSpl", stakePool: address("2RMsk6vxX1t1ZKpNBXoXtYEkMBdcZEtEUMEXTR5dwQjn") },
  ], // prgnSOL
  [
    "pumpkinsEq8xENVZE6QgTS93EN4r9iKvNxNALS1ooyp",
    { family: "sanctumSpl", stakePool: address("8WHCJsUduwDBhPL9uVADQSdWkUi2LPZNFAMyX1n2HGMD") },
  ], // pumpkinSOL
  [
    "rdLGtfDeqRBJS6h24oMypQApxqNRCmPeLkfhFDNFti6",
    { family: "sanctumSpl", stakePool: address("cv8FyhC1Hizeh4nrXMRFWL6hhtimuALXUrkPLT59vJK") },
  ], // rdlgtSOL (dup symbol, distinct mint from RDLGTw8U above)
  [
    "roxDFxTFHufJBFy3PgzZcgz6kwkQNPZpi9RfpcAv4bu",
    { family: "sanctumSpl", stakePool: address("BuMRVW5uUQqJmguCk4toGh7DB3CcJt6dk64JiUMdYS22") },
  ], // RoXSOL
  [
    "sSo1wxKKr6zW2hqf5hZrp2CawLibcwi1pMBqk5bg2G4",
    { family: "spl", stakePool: address("po1osKDWYF9oiVEGmzKA4eTs8eMveFRMox3bUKazGN2") },
  ], // LP-SOLAYER
  [
    "sctmAy9zFfZznZUWxEMgGtF6PHZ3gwoiCGcfwRua1AZ",
    { family: "sanctumSpl", stakePool: address("E2fVGkhB4No2KJiXCfVqLUPjjiuyJwmPod8BtcHXkcZk") },
  ], // sctmSOL
  [
    "sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx",
    { family: "sanctumSpl", stakePool: address("pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP") },
  ], // dfdvSOL
  [
    "sctmPQsBHbpnxF6CQ2Hzv6Hn1egPb8LwBTWYLLLKAbB",
    { family: "sanctumSpl", stakePool: address("54rCQeq2Xr6T5pMUBhNHJuU6K3saRNNtLXYQSJnYWcCN") },
  ], // chaosSOL
  [
    "sctmTAsDn4tLUcemqoqYijfuRkiEfAMPi84PNq2EueR",
    { family: "sanctumSpl", stakePool: address("FyucURhqXtpSJzymEPmXLpr6tJKct5JuixVU5Tv9bCp7") },
  ], // nxSOL
  [
    "sctmWXGT7L75psrUHV2xxyTQKndE7ZcCQRHy2z6D5ER",
    { family: "sanctumSpl", stakePool: address("FhFP8TRNbHgY7HDfMFEAPNwixipvYQHf7dHscjFqNm9i") },
  ], // honestSOL
  [
    "sctmY8fJucsJatwHz6P48RuWBBkdBMNmSMuBYrWFdrw",
    { family: "sanctumSpl", stakePool: address("2XhsHdwf4ZDpp2JhpTqPovoVy3L2Atfp1XkLqFMwGP4Y") },
  ], // adraSOL
  [
    "sctmZbtfE4dBNBEqBriQQVZLBrTaTjiTfKNRzKUcSLa",
    { family: "sanctumSpl", stakePool: address("4cLLFNT2WAoioAYXfEF8rqgg1gSW4kNN3y8qyTz1kPmh") },
  ], // chimpSOL
  [
    "sctmadV2fcLtrxjzYhTZzwAGjXUXKtYSBrrM36EtdcY",
    { family: "sanctumSpl", stakePool: address("8iax3u8PEcP6VhBtLLG7QAoSrCp7fUbCJtmHPrqHxdas") },
  ], // sfSOL
  [
    "sctmpoe8tJzrB6j2nK1gPiqRyugPSdNcprYPEqKkFAR",
    { family: "sanctumSpl", stakePool: address("2pehyrs1sgWUHpeTQgEWpxPp35dApMvBZjjhjjmzFr7N") },
  ], // masSOL
  [
    "sctmqBfQtZj76PaLmepQ7Xskpu8LNMyWsXqFYAuihML",
    { family: "sanctumSpl", stakePool: address("5pRQddxyQSRTBnES1J1Q1CaqmRTkkm7Msyq65SjZKawJ") },
  ], // STEAKSOL
  [
    "sntn1oVhhKuytG42jyjneMYnGAtzkpJsBxHNEskTfGp",
    { family: "spl", stakePool: address("sntn1Y9gX7MwcPD6Z4GLCkUAy7iKAZika6RUjDu1paS") },
  ], // sentSOL
  [
    "sphSo1j2eTLa6AB5Wjrmap8VbQoZKccCpqJ7gV5pqGM",
    { family: "sanctumSpl", stakePool: address("5j6fSany8ATpKFPwvc7us2AQGPohniA9sSJdwm3BGpCu") },
  ], // sphSOL
  [
    "st8QujHLPsX3d6HG9uQg9kJ91jFxUgruwsb1hyYXSNd",
    { family: "sanctumSpl", stakePool: address("2jjK1MsLgsPgVjnp97HUJeovNj3jp4XgyQ3nuiWMwiS8") },
  ], // stakeSOL
  [
    "stacMUJ1gnBwu5tdKB1xtSmtNu9xNqvBQXoDB8eX92n",
    { family: "sanctumSpl", stakePool: address("7q8nazWeYfwCV1b9vX38FbCRWisiTnDMaEAr12xsXuhg") },
  ], // LSTache
  [
    "strng7mqqc1MBJJV6vMzYbEqnwVGvKKGKedeCvtktWA",
    { family: "sanctumSpl", stakePool: address("GZDX5JYXDzCEDL3kybhjN7PSixL4ams3M2G4CvWmMmm5") },
  ], // strongSOL
  [
    "suPer8CPwxoJPQ7zksGMwFvjBQhjAHwUMmPV4FVatBw",
    { family: "sanctumSpl", stakePool: address("4dZDUL3BFJUFeqS3Y3cwkc84Rs6mgVHRYGt1LJvhooW4") },
  ], // superSOL
  [
    "tiNyNcKeDhsntPmvw4GUz1cvz74ovM2hHyi96bpVJYY",
    { family: "sanctumSpl", stakePool: address("CjjXMAoFq6NufSePbURyyCxwRW9fkLSYUYo9SiwnBULD") },
  ], // tinySOL
  [
    "truthMz1n1fzkRrSK2xdS4FBaPmvkihxa8asAYcDMD8",
    { family: "sanctumSpl", stakePool: address("7ePUk6bLa7Yx9eYMARGNZFPoqJqcjTcE4drLmFkPcFNJ") },
  ], // truthSOL
  [
    "uPtSoL2qszk4SuPHNE2zqk1gDtqCq21ZE1yZCqvFTqq",
    {
      family: "sanctumSplMulti",
      stakePool: address("5UMja2dWNX3XhrBAvsoRteySTngfpQGHrWfHxueCs5s6"),
    },
  ], // uptSOL
  [
    "vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7",
    { family: "spl", stakePool: address("Fu9BYC6tWBo1KMKaP3CFoKfRhqv9akmy3DuYwnCyWiyC") },
  ], // vSOL
  [
    "vybe5DgwzGdvJMi4oH7TiQpubJd4QSDuGmbvWfACeb8",
    { family: "sanctumSpl", stakePool: address("EiUp5pUAHvDy28onm32bk8VecFQnQ1P4E2YrZPkGcAmf") },
  ], // vybeSOL
  [
    "xSoL18r4U1k2ALa4yF857VDZJqCKecLtty92nscre3o",
    { family: "spl", stakePool: address("spp1mo6shdcrRyqDK2zdurJ8H5uttZE6H6oVjHxN1QN") },
  ], // xSHIN
  [
    "yontaGPyo7eLjKfAhW4eXU3L1adKbthqRHx9MsJCzvg",
    { family: "sanctumSpl", stakePool: address("C22gEQX9MkhiVnUWXpu7QaTtsbNyzwneEtfv2AzYNQHr") },
  ], // yontaSOL
];

/** mint (base58) -> registry entry. */
export const SANCTUM_INFINITY_REGISTRY: ReadonlyMap<string, SanctumInfinityRegistryEntry> = new Map(
  ENTRIES,
);

/** Row count — cross-checked in `sanctum-infinity.test.ts` against a live-dumped fixture. */
export const SANCTUM_INFINITY_REGISTRY_SIZE = ENTRIES.length;
