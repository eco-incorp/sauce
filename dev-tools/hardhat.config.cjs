/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      hardfork: "cancun",
      allowUnlimitedContractSize: true,
      chains: {
        // Base mainnet - enable Cancun from genesis for fork testing
        8453: {
          hardforkHistory: {
            cancun: 0,
          },
        },
      },
    },
  },
};
