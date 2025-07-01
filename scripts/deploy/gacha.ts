import hre, { ethers } from "hardhat";
import addressUtils from "../../utils/addressUtils";

async function main() {
  const addressList = await addressUtils.getAddressList(hre.network.name);

  const NativeVRFConsumer = await ethers.getContractFactory("Gacha");
  const nativeVRFConsumer = await NativeVRFConsumer.deploy(
    addressList["NativeVRF"],
    "0x55dfe03618b6f83301c6cd85b9f9abd3bf382b79",
    "0x4637b9E2a17Ec34fc6f819db3b5941F0aEDcAc26"
  );

  console.log({ Gascha: nativeVRFConsumer.address });

  await addressUtils.saveAddresses(hre.network.name, {
    Gacha: nativeVRFConsumer.address,
  });

  await hre.run("verify:verify", {
    address: nativeVRFConsumer.address,
    constructorArguments: [
      addressList["NativeVRF"],
      "0x55dfe03618b6f83301c6cd85b9f9abd3bf382b79",
      "0x4637b9E2a17Ec34fc6f819db3b5941F0aEDcAc26",
    ],
    network: "apechain",
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
