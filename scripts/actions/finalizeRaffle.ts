import { ethers } from "hardhat";
const addressList = require("../../addressList/apechain.json");

async function main() {
  console.log("=== RaffleOnApe Finalize Script ===\n");

  // Get contract instances
  const raffleContract = await ethers.getContractAt(
    "RaffleOnape",
    addressList.raffle
  );
  const nativeVRFContract = await ethers.getContractAt(
    "INativeVRF",
    addressList.NativeVRF
  );

  const [signer] = await ethers.getSigners();
  console.log("🔍 Finalizing from address:", signer.address);
  console.log(
    "💰 ETH Balance:",
    ethers.utils.formatEther(await signer.getBalance()),
    "ETH\n"
  );

  // Get raffle ID from command line arguments or use latest
  const args = process.argv.slice(2);
  let raffleId: number;

  if (args.length > 0) {
    raffleId = parseInt(args[0]);
    console.log(`🎯 Finalizing Raffle ID: ${raffleId} (from command line)`);
  } else {
    const raffleCounter = await raffleContract.raffleCounter();
    raffleId = raffleCounter.toNumber();
    console.log(`🎯 Finalizing Latest Raffle ID: ${raffleId}`);
  }

  try {
    // Pre-flight checks
    console.log("\n🔍 Pre-flight Checks:");
    console.log("=".repeat(30));

    const raffle = await raffleContract.getRaffle(raffleId);

    // Check raffle status
    const statusNames = ["ACTIVE", "DRAWN", "CANCELLED", "REFUND_AVAILABLE"];
    const currentStatus = statusNames[raffle.status] || "UNKNOWN";
    console.log(`   Raffle Status: ${currentStatus}`);

    if (raffle.status !== 1) {
      console.log(`❌ Cannot finalize: Raffle is not in DRAWN status`);
      if (raffle.status === 0) {
        console.log(`   💡 Solution: Draw the raffle first`);
      } else if (raffle.status === 2) {
        console.log(`   ℹ️  Raffle is cancelled`);
      } else if (raffle.status === 3) {
        console.log(`   ℹ️  Raffle is in refund mode`);
      }
      return;
    }

    // Check if already finalized
    if (raffle.winner !== ethers.constants.AddressZero) {
      console.log(`❌ Raffle already finalized!`);
      console.log(`   Winner: ${raffle.winner}`);
      return;
    }

    // Check VRF fulfillment
    console.log(`   Checking VRF fulfillment...`);
    const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
    console.log(`   VRF Request ID: ${vrfRequestId}`);

    if (vrfRequestId.eq(0)) {
      console.log(`❌ No VRF request found for this raffle`);
      return;
    }

    const randomResult = await nativeVRFContract.randomResults(vrfRequestId);
    console.log(`   Random Result: ${randomResult}`);

    if (randomResult.eq(0)) {
      console.log(`❌ VRF not yet fulfilled`);
      console.log(`   ⏳ Please wait for VRF oracle to fulfill the request`);
      console.log(`   🔍 You can check periodically using the debug script`);
      return;
    }

    console.log(`✅ VRF fulfilled! Ready to finalize.`);

    // Get participants for winner calculation preview
    console.log(`\n👥 Participants Analysis:`);
    try {
      const participants = await raffleContract.getRaffleParticipants(raffleId);
      console.log(`   Total Participants: ${participants.length}`);
      
      let totalTickets = 0;
      for (let i = 0; i < participants.length; i++) {
        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          participants[i]
        );
        totalTickets += userTickets;
        console.log(`     ${i + 1}. ${participants[i]} - ${userTickets} tickets`);
      }
      
      // Calculate which ticket will win (preview)
      const winningTicket = randomResult.mod(raffle.currentTickets).add(1);
      console.log(`\n🎲 Winning ticket number: ${winningTicket} (out of ${totalTickets})`);
      
    } catch (error: any) {
      console.log(`   ⚠️  Could not fetch participants: ${error.message}`);
    }

    // Estimate gas
    console.log(`\n💰 Gas Estimation:`);
    try {
      const gasEstimate = await raffleContract.estimateGas.finalizeRaffle(
        raffleId
      );
      console.log(`   Estimated Gas: ${gasEstimate.toString()}`);
    } catch (gasError: any) {
      console.log(`   ⚠️  Gas estimation failed: ${gasError.message}`);
    }

    // Execute the finalization
    console.log(`\n🚀 READY TO FINALIZE RAFFLE ${raffleId}`);
    console.log("=".repeat(40));
    console.log(`   Prize: ${ethers.utils.formatEther(raffle.prizeAmount)}`);
    console.log(`   Participants: ${raffle.currentTickets} tickets`);
    console.log(`   Random Number: ${randomResult}`);

    console.log(`\n⏳ Finalizing raffle...`);

    const tx = await raffleContract.finalizeRaffle(raffleId, {
      gasLimit: 300000, // Set a reasonable gas limit
    });

    console.log(`📤 Transaction sent: ${tx.hash}`);
    console.log(`⏳ Waiting for confirmation...`);

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

    // Parse events to find the winner
    const prizeClaimedEvent = receipt.events?.find(
      (event: any) => event.event === "PrizeClaimed"
    );

    if (prizeClaimedEvent && prizeClaimedEvent.args) {
      console.log(`\n🎉 RAFFLE FINALIZED SUCCESSFULLY!`);
      console.log(`🏆 Winner: ${prizeClaimedEvent.args.winner}`);
      
      // Get final raffle state
      const finalRaffle = await raffleContract.getRaffle(raffleId);
      console.log(`🎁 Prize transferred to winner`);
      console.log(`💰 Revenue distributed to creator`);
      
    } else {
      console.log(`\n✅ Finalization completed`);
      console.log(`   Check the transaction events for details`);
    }

    // Gas used
    console.log(`\n💸 Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(
      `💰 Transaction Cost: ${ethers.utils.formatEther(
        receipt.gasUsed.mul(tx.gasPrice || ethers.BigNumber.from("0"))
      )} ETH`
    );

    // Final status
    const finalRaffle = await raffleContract.getRaffle(raffleId);
    if (finalRaffle.winner !== ethers.constants.AddressZero) {
      console.log(`\n🎊 RAFFLE COMPLETE!`);
      console.log(`   Winner: ${finalRaffle.winner}`);
      console.log(`   Status: Finalized`);
    }

  } catch (error: any) {
    console.log(`\n❌ Error finalizing raffle: ${error.message}`);

    // Try to parse revert reason
    if (error.reason) {
      console.log(`   Revert reason: ${error.reason}`);
    }

    // Common error suggestions
    if (error.message.includes("Raffle not drawn")) {
      console.log(`   💡 Solution: Draw the raffle first using drawRaffle script`);
    } else if (error.message.includes("Already finalized")) {
      console.log(`   💡 Solution: This raffle is already completed`);
    } else if (error.message.includes("VRF not fulfilled")) {
      console.log(`   💡 Solution: Wait for VRF oracle to fulfill the random number request`);
    }
  }
}

// Handle command line arguments
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    throw error;
  });
}

export { main as finalizeRaffle };