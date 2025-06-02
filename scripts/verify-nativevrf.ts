import hre from "hardhat";

async function main() {
  const contractAddress = "0x47B393684E5D72b004b8aDB0645F5377374a4f6a";
  const constructorArgs = [6666]; // The seed value used in deployment

  console.log("Verifying NativeVRF contract...");
  console.log("Contract Address:", contractAddress);
  console.log("Constructor Args:", constructorArgs);

  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArgs,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
