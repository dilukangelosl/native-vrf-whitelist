import hre from "hardhat";

async function main() {
  const contractAddress = "0x78f7fAF4F40A93c12314A44d35F901306Dd5673B";
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
