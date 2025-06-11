import hre, { ethers } from "hardhat";
import addressUtils from "../../utils/addressUtils";

async function main() {
  const contract = await ethers.getContractFactory("RaffleOnape");
  const deployedContract = await contract.deploy(
    "0xb45303569f4751B4b3d17EA1Ad4D61E60140DCcF"
  );

  console.log({ contract: deployedContract.address });
  console.log("\n🎉 New features added:");
  console.log(
    "- minTicketsNeededToDraw: Minimum tickets required to proceed with draw"
  );
  console.log(
    "- Refund functionality: Users can claim refunds if minimum tickets not met"
  );
  console.log(
    "- New status: REFUND_AVAILABLE when minimum tickets threshold not reached"
  );

  await addressUtils.saveAddresses(hre.network.name, {
    raffle: deployedContract.address,
  });

  try {
    await hre.run("verify:verify", {
      address: deployedContract.address,
      constructorArguments: ["0xb45303569f4751B4b3d17EA1Ad4D61E60140DCcF"],
      network: "apechain",
    });

    console.log("✅ Contract verified successfully!");
  } catch (error: any) {
    console.error("❌ Verification failed:", error);

    // If already verified, this is expected
    if (error.message && error.message.includes("already verified")) {
      console.log("✅ Contract is already verified!");
    }
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
