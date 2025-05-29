import { ethers, network } from "hardhat";
import addressUtils from "../../utils/addressUtils";

async function main() {
  console.log("Deploying PrizeDrawConsumer...");

  // Get the Native VRF contract address
  const addressList = await addressUtils.getAddressList(network.name);
  const nativeVRFAddress = addressList["NativeVRF"];
  if (!nativeVRFAddress) {
    throw new Error(
      "Native VRF contract not found. Please deploy Native VRF first."
    );
  }

  console.log(`Using Native VRF at: ${nativeVRFAddress}`);

  // Deploy PrizeDrawConsumer
  const PrizeDrawConsumer = await ethers.getContractFactory(
    "PrizeDrawConsumer"
  );
  const prizeDrawConsumer = await PrizeDrawConsumer.deploy(nativeVRFAddress);

  await prizeDrawConsumer.deployed();

  console.log(`PrizeDrawConsumer deployed to: ${prizeDrawConsumer.address}`);

  // Save the contract address
  await addressUtils.saveAddresses(network.name, {
    PrizeDrawConsumer: prizeDrawConsumer.address,
  });

  // Display the default draw configuration
  console.log("\n=== Default Draw Configuration ===");
  const drawConfig = await prizeDrawConsumer.getDrawConfiguration(1);
  console.log(`Description: ${drawConfig.description}`);
  console.log(`Prize Count: ${drawConfig.prizeCount}`);
  console.log(`Total Weight: ${drawConfig.totalWeight}`);
  console.log(`Is Active: ${drawConfig.isActive}`);

  console.log("\n=== Prize Details ===");
  for (let i = 0; i < drawConfig.prizeCount.toNumber(); i++) {
    const prize = await prizeDrawConsumer.getPrizeDetails(1, i);
    const probability = (prize.probability.toNumber() / 100).toFixed(2);
    console.log(`Prize ${i + 1}: ${prize.name}`);
    console.log(`  Weight: ${prize.weight}`);
    console.log(`  Value: ${ethers.utils.formatEther(prize.value)} ETH`);
    console.log(`  Probability: ${probability}%`);
  }

  // Calculate and display all probabilities
  console.log("\n=== Probability Distribution ===");
  const probabilities = await prizeDrawConsumer.calculateProbabilities(1);
  for (let i = 0; i < probabilities.length - 1; i++) {
    const prob = (probabilities[i].toNumber() / 100).toFixed(2);
    console.log(`Prize ${i + 1}: ${prob}%`);
  }
  const noPrizeProb = (
    probabilities[probabilities.length - 1].toNumber() / 100
  ).toFixed(2);
  console.log(`No Prize: ${noPrizeProb}%`);

  console.log("\n=== Next Steps ===");
  console.log("1. Whitelist this contract in Native VRF:");
  console.log(`   nativeVRF.whitelistAddress("${prizeDrawConsumer.address}")`);
  console.log("2. Fund the contract with ETH for gas fees");
  console.log("3. Test the prize draw functionality");

  return prizeDrawConsumer.address;
}

main().catch((error) => {
  console.error(error);
  throw error;
});
