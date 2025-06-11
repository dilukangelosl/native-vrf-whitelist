import hre from "hardhat";

async function main() {
  const contractAddress = "0xb45303569f4751B4b3d17EA1Ad4D61E60140DCcF";
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
