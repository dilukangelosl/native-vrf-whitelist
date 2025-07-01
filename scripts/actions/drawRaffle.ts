import { ethers } from "hardhat";
const addressList = require("../../addressList/apechain.json");

async function main() {
  console.log("=== RaffleOnApe Draw Script ===\n");

  // Get contract instances
  const raffleContract = await ethers.getContractAt(
    "RaffleOnape",
    addressList.raffle
  );
  const nativeVRFContract = await ethers.getContractAt(
    "NativeVRF",
    addressList.NativeVRF
  );

  const [signer] = await ethers.getSigners();
  console.log("🔍 Drawing from address:", signer.address);
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
    console.log(`🎯 Drawing Raffle ID: ${raffleId} (from command line)`);
  } else {
    const raffleCounter = await raffleContract.raffleCounter();
    raffleId = raffleCounter.toNumber();
    console.log(`🎯 Drawing Latest Raffle ID: ${raffleId}`);
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

    if (raffle.status !== 0) {
      console.log(`❌ Cannot draw: Raffle is not ACTIVE`);
      return;
    }

    // Check tickets
    console.log(`   Current Tickets: ${raffle.currentTickets}`);
    if (raffle.currentTickets === 0) {
      console.log(`❌ Cannot draw: No tickets sold`);
      return;
    }

    // Check time and conditions
    const currentTime = Math.floor(Date.now() / 1000);
    const timeExpired = currentTime >= raffle.endTime;
    const maxTicketsReached =
      raffle.totalMaxTickets > 0 &&
      raffle.currentTickets >= raffle.totalMaxTickets;

    console.log(`   Time Expired: ${timeExpired ? "✅ YES" : "❌ NO"}`);
    console.log(
      `   Max Tickets Reached: ${maxTicketsReached ? "✅ YES" : "❌ NO"}`
    );

    if (!timeExpired && !maxTicketsReached) {
      const timeRemaining = raffle.endTime - currentTime;
      console.log(
        `❌ Cannot draw yet: Wait ${timeRemaining} seconds until ${new Date(
          raffle.endTime * 1000
        ).toLocaleString()}`
      );
      return;
    }

    // Check minimum threshold
    const meetsMinThreshold =
      raffle.currentTickets >= raffle.minTicketsNeededToDraw;
    console.log(
      `   Meets Min Threshold: ${meetsMinThreshold ? "✅ YES" : "❌ NO"}`
    );

    if (!meetsMinThreshold) {
      console.log(
        `⚠️  Warning: Minimum tickets not met (${raffle.currentTickets}/${raffle.minTicketsNeededToDraw})`
      );
      console.log(
        `   This will trigger REFUND mode instead of drawing a winner`
      );
    }

    // Check VRF whitelist
    const isWhitelisted = await nativeVRFContract.isWhitelisted(
      addressList.raffle
    );
    console.log(
      `   Contract Whitelisted: ${isWhitelisted ? "✅ YES" : "❌ NO"}`
    );

    if (!isWhitelisted) {
      console.log(`❌ Cannot draw: Contract not whitelisted with VRF`);
      console.log(
        `   Solution: Whitelist ${addressList.raffle} with NativeVRF`
      );
      return;
    }

    console.log(`\n✅ All checks passed! Ready to draw.\n`);

    // Estimate gas and VRF fee
    console.log("💰 Cost Estimation:");
    console.log("=".repeat(20));

    try {
      // Try different VRF fee amounts
      const vrfFees = ["0.001", "0.005", "0.01"];
      let optimalFee = "0.001";

      for (const fee of vrfFees) {
        try {
          const gasEstimate = await raffleContract.estimateGas.drawRaffle(
            raffleId,
            {
              value: ethers.utils.parseEther(fee),
            }
          );
          console.log(
            `   Gas Estimate with ${fee} ETH VRF fee: ${gasEstimate.toString()}`
          );
          optimalFee = fee;
          break;
        } catch (error: any) {
          console.log(`   ${fee} ETH VRF fee: ❌ Too low`);
        }
      }

      console.log(`\n🎯 Recommended VRF fee: ${optimalFee} ETH`);

      // Ask for confirmation
      console.log(`\n🚀 READY TO DRAW RAFFLE ${raffleId}`);
      console.log("=".repeat(40));
      console.log(`   Prize: ${ethers.utils.formatEther(raffle.prizeAmount)}`);
      console.log(`   Participants: ${raffle.currentTickets} tickets`);
      console.log(`   VRF Fee: ${optimalFee} ETH`);
      console.log(
        `   Expected Outcome: ${
          meetsMinThreshold ? "Winner Selection" : "Refund Mode"
        }`
      );

      // Execute the draw
      console.log(`\n⏳ Drawing raffle...`);

      const tx = await raffleContract.drawRaffle(raffleId, {
        value: ethers.utils.parseEther(optimalFee),
        gasLimit: 500000, // Set a reasonable gas limit
      });

      console.log(`📤 Transaction sent: ${tx.hash}`);
      console.log(`⏳ Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

      // Parse events
      const drawEvent = receipt.events?.find(
        (event: any) => event.event === "RaffleDrawn"
      );
      const refundEvent = receipt.events?.find(
        (event: any) => event.event === "RefundAvailable"
      );

      if (drawEvent && drawEvent.args) {
        console.log(`\n🎉 RAFFLE DRAWN SUCCESSFULLY!`);
        console.log(`   VRF Request ID: ${drawEvent.args.vrfRequestId}`);
        console.log(
          `\n⏳ Next Step: Wait for VRF fulfillment, then call finalizeRaffle(${raffleId})`
        );
        console.log(
          `   You can check VRF fulfillment status with the debug script.`
        );
      } else if (refundEvent) {
        console.log(`\n🔄 REFUND MODE ACTIVATED`);
        console.log(`   Minimum tickets threshold was not met.`);
        console.log(
          `   Participants can now claim refunds using claimRefund(${raffleId})`
        );
      } else {
        console.log(`\n❓ Draw completed but no expected events found.`);
        console.log(`   Check the transaction receipt for details.`);
      }

      // Gas used
      console.log(`\n💸 Gas Used: ${receipt.gasUsed.toString()}`);
      console.log(
        `💰 Transaction Cost: ${ethers.utils.formatEther(
          receipt.gasUsed.mul(tx.gasPrice || ethers.BigNumber.from("0"))
        )} ETH`
      );
    } catch (gasError: any) {
      console.log(`❌ Gas estimation failed: ${gasError.message}`);
      console.log(`\n🎲 Attempting draw with default parameters...`);

      const tx = await raffleContract.drawRaffle(raffleId, {
        value: ethers.utils.parseEther("0.001"),
        gasLimit: 500000,
      });

      console.log(`📤 Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    }
  } catch (error: any) {
    console.log(`\n❌ Error drawing raffle: ${error.message}`);

    // Try to parse revert reason
    if (error.reason) {
      console.log(`   Revert reason: ${error.reason}`);
    }

    // Common error suggestions
    if (error.message.includes("Cannot draw yet")) {
      console.log(
        `   💡 Solution: Wait until raffle end time or max tickets reached`
      );
    } else if (error.message.includes("Contract not whitelisted")) {
      console.log(
        `   💡 Solution: Whitelist the raffle contract with NativeVRF`
      );
    } else if (error.message.includes("insufficient funds")) {
      console.log(`   💡 Solution: Add more ETH for VRF fees (try 0.01 ETH)`);
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

export { main as drawRaffle };
