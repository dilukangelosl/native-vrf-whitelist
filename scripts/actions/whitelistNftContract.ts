import { ContractReceipt } from "ethers";
import hre, { ethers } from "hardhat";
import { RaffleOnape__factory } from "../../typechain";
import addressUtils from "../../utils/addressUtils";

async function main() {
  const [signer] = await ethers.getSigners();
  const addressList = await addressUtils.getAddressList(hre.network.name);

  const contract = await RaffleOnape__factory.connect(
    addressList["raffle"],
    signer
  );

  const tx = await contract.setNFTContractWhitelist(
    "0x490ee1259725928c367f0d8d938b2237cc76e1d6",
    true
  );

  console.log("Submitted a transaction: ", tx.hash);

  await tx.wait();
  console.log("NFT contract has been whitelisted");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
