import hre, { ethers } from "hardhat";

const OTHER_RELICS = "0xCd5Df9Cd05C28B8bE5eB5889dF97043E231c1939";

const OTHER_RELICS_ABI = [
  "function addMinter(address minter)",
  "function isMinter(address account) view returns (bool)",
  "function owner() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()), "APE");

  const Factory = await ethers.getContractFactory("OtherRelicReforging");
  const contract = await Factory.deploy(OTHER_RELICS);
  await contract.deployed();

  console.log("OtherRelicReforging deployed to:", contract.address);

  console.log("\nWaiting 10s before verification...");
  await new Promise((r) => setTimeout(r, 10000));

  try {
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: [OTHER_RELICS],
    });
    console.log("Contract verified.");
  } catch (err: any) {
    if (err?.message?.toLowerCase().includes("already verified")) {
      console.log("Already verified.");
    } else {
      console.error("Verification error:", err.message);
    }
  }

  // Add new reforging contract as minter on OtherRelics
  console.log("\nAdding reforging contract as minter on OtherRelics...");
  const relics = new ethers.Contract(OTHER_RELICS, OTHER_RELICS_ABI, deployer);

  const alreadyMinter: boolean = await relics.isMinter(contract.address);
  if (alreadyMinter) {
    console.log("Already a minter — nothing to do.");
  } else {
    const tx = await relics.addMinter(contract.address);
    console.log("addMinter tx sent:", tx.hash);
    await tx.wait();
    console.log("✅ Minter added successfully.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
