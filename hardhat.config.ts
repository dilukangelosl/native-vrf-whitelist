import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import accountUtils from "./utils/accountUtils";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: "0.8.30",
  networks: {
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts: accountUtils.getAccounts(),
    },
    rinkeby: {
      url: process.env.RINKEBY_URL || "",
      accounts: accountUtils.getAccounts(),
    },
    kubchain_test: {
      url: `https://rpc-testnet.bitkubchain.io`,
      accounts: accountUtils.getAccounts(),
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts: accountUtils.getAccounts(),
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
