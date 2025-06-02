import { ethers } from "hardhat";
const addressList = require("../../addressList/apechain.json");

async function main() {
  console.log("=== RaffleOnApe Draw Debug Script ===\n");

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
  console.log("🔍 Debugging from address:", signer.address);
  console.log(
    "💰 ETH Balance:",
    ethers.utils.formatEther(await signer.getBalance()),
    "ETH\n"
  );

  // Get the latest raffle ID
  const raffleCounter = await raffleContract.raffleCounter();
  console.log("📊 Total raffles created:", raffleCounter.toString());

  if (raffleCounter.eq(0)) {
    console.log("❌ No raffles found!");
    return;
  }

  // Analyze the latest raffle (most likely the one you're trying to draw)
  const raffleId = raffleCounter;
  console.log(`\n🎯 Analyzing Raffle ID: ${raffleId}`);
  console.log("=".repeat(50));

  try {
    const raffle = await raffleContract.getRaffle(raffleId);

    // Decode raffle status
    const statusNames = ["ACTIVE", "DRAWN", "CANCELLED", "REFUND_AVAILABLE"];
    const currentStatus = statusNames[raffle.status] || "UNKNOWN";

    console.log("📋 Raffle Details:");
    console.log(`   Creator: ${raffle.creator}`);
    console.log(`   Status: ${currentStatus} (${raffle.status})`);
    console.log(`   Current Tickets: ${raffle.currentTickets}`);
    console.log(`   Min Tickets to Draw: ${raffle.minTicketsNeededToDraw}`);
    console.log(`   Max Tickets Total: ${raffle.totalMaxTickets}`);
    console.log(
      `   End Time: ${new Date(raffle.endTime * 1000).toLocaleString()}`
    );
    console.log(
      `   Ticket Price: ${ethers.utils.formatEther(raffle.ticketPrice)} ETH`
    );
    console.log(
      `   Prize Amount: ${ethers.utils.formatEther(raffle.prizeAmount)}`
    );
    console.log(`   Winner: ${raffle.winner}`);

    // Check current time vs end time
    const currentTime = Math.floor(Date.now() / 1000);
    const timeRemaining = raffle.endTime - currentTime;
    console.log(`\n⏰ Time Analysis:`);
    console.log(
      `   Current Time: ${new Date(currentTime * 1000).toLocaleString()}`
    );
    console.log(
      `   End Time: ${new Date(raffle.endTime * 1000).toLocaleString()}`
    );
    console.log(
      `   Time Remaining: ${
        timeRemaining > 0 ? `${timeRemaining} seconds` : "EXPIRED"
      }`
    );

    // Check if raffle can be drawn
    console.log(`\n🔍 Draw Conditions Analysis:`);

    // Condition 1: Raffle must be ACTIVE
    const isActive = raffle.status === 0;
    console.log(`   ✓ Is Active: ${isActive ? "✅ YES" : "❌ NO"}`);

    // Condition 2: Must have tickets sold
    const hasTickets = raffle.currentTickets > 0;
    console.log(`   ✓ Has Tickets: ${hasTickets ? "✅ YES" : "❌ NO"}`);

    // Condition 3: Time expired OR max tickets reached
    const timeExpired = currentTime >= raffle.endTime;
    const maxTicketsReached =
      raffle.totalMaxTickets > 0 &&
      raffle.currentTickets >= raffle.totalMaxTickets;
    const canDrawByTime = timeExpired || maxTicketsReached;
    console.log(`   ✓ Time Expired: ${timeExpired ? "✅ YES" : "❌ NO"}`);
    console.log(
      `   ✓ Max Tickets Reached: ${maxTicketsReached ? "✅ YES" : "❌ NO"}`
    );
    console.log(
      `   ✓ Can Draw (Time/Tickets): ${canDrawByTime ? "✅ YES" : "❌ NO"}`
    );

    // Condition 4: Min tickets threshold
    const meetsMinThreshold =
      raffle.currentTickets >= raffle.minTicketsNeededToDraw;
    console.log(
      `   ✓ Meets Min Threshold: ${meetsMinThreshold ? "✅ YES" : "❌ NO"}`
    );
    console.log(
      `     - Current: ${raffle.currentTickets}, Required: ${raffle.minTicketsNeededToDraw}`
    );

    // Check VRF whitelist status
    console.log(`\n🔗 VRF Integration Check:`);
    try {
      const isWhitelisted = await nativeVRFContract.isWhitelisted(
        addressList.raffle
      );
      console.log(
        `   ✓ Contract Whitelisted: ${isWhitelisted ? "✅ YES" : "❌ NO"}`
      );

      if (!isWhitelisted) {
        console.log(
          `   ⚠️  CRITICAL: RaffleOnApe contract is NOT whitelisted with NativeVRF!`
        );
        console.log(`   📋 Contract Address: ${addressList.raffle}`);
        console.log(`   📋 NativeVRF Address: ${addressList.NativeVRF}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error checking whitelist: ${error.message}`);
    }

    // Check if there's a pending VRF request
    if (raffle.status === 1) {
      // DRAWN status
      console.log(`\n🎲 VRF Request Analysis:`);
      try {
        const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
        console.log(`   VRF Request ID: ${vrfRequestId}`);

        if (vrfRequestId.gt(0)) {
          try {
            const randomResult = await nativeVRFContract.randomResults(
              vrfRequestId
            );
            console.log(`   Random Result: ${randomResult}`);
            console.log(
              `   VRF Fulfilled: ${randomResult.gt(0) ? "✅ YES" : "❌ NO"}`
            );

            if (randomResult.gt(0)) {
              console.log(
                `   🎯 Ready to finalize! Call finalizeRaffle(${raffleId})`
              );
            } else {
              console.log(`   ⏳ Waiting for VRF fulfillment...`);
            }
          } catch (error: any) {
            console.log(`   ❌ Error checking random result: ${error.message}`);
          }
        }
      } catch (error: any) {
        console.log(`   ❌ Error checking VRF request: ${error.message}`);
      }
    }

    // Get participants info
    console.log(`\n👥 Participants Analysis:`);
    try {
      const participants = await raffleContract.getRaffleParticipants(raffleId);
      console.log(`   Total Participants: ${participants.length}`);

      if (participants.length > 0) {
        console.log(`   Participants:`);
        for (let i = 0; i < participants.length; i++) {
          const userTickets = await raffleContract.getUserTickets(
            raffleId,
            participants[i]
          );
          console.log(
            `     ${i + 1}. ${participants[i]} - ${userTickets} tickets`
          );
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Error fetching participants: ${error.message}`);
    }

    // Final recommendation
    console.log(`\n🎯 DIAGNOSIS & RECOMMENDATIONS:`);
    console.log("=".repeat(50));

    if (!isActive) {
      if (raffle.status === 1) {
        console.log(
          `✅ Raffle is already drawn! You need to call finalizeRaffle(${raffleId})`
        );
      } else if (raffle.status === 2) {
        console.log(`❌ Raffle is cancelled`);
      } else if (raffle.status === 3) {
        console.log(`❌ Raffle is in refund mode (minimum tickets not met)`);
      }
    } else if (!hasTickets) {
      console.log(`❌ No tickets sold - cannot draw`);
    } else if (!canDrawByTime) {
      console.log(
        `❌ Cannot draw yet - wait until ${new Date(
          raffle.endTime * 1000
        ).toLocaleString()}`
      );
    } else if (!meetsMinThreshold) {
      console.log(
        `❌ Minimum tickets threshold not met (${raffle.currentTickets}/${raffle.minTicketsNeededToDraw})`
      );
      console.log(`   When drawn, this will trigger refund mode`);
    } else {
      console.log(`✅ Raffle CAN be drawn!`);

      // Check whitelist issue
      try {
        const isWhitelisted = await nativeVRFContract.isWhitelisted(
          addressList.raffle
        );
        if (!isWhitelisted) {
          console.log(`❌ BLOCKING ISSUE: Contract not whitelisted with VRF`);
          console.log(
            `   Solution: Whitelist ${addressList.raffle} with NativeVRF`
          );
        } else {
          console.log(
            `✅ Ready to draw! Call drawRaffle(${raffleId}) with VRF fee`
          );

          // Estimate VRF fee
          console.log(`\n💰 VRF Fee Estimation:`);
          console.log(`   Check NativeVRF contract for required fee amount`);
          console.log(
            `   Typically ranges from 0.001 to 0.01 ETH depending on network`
          );
        }
      } catch (error: any) {
        console.log(`❌ Error checking whitelist: ${error.message}`);
      }
    }

    // Show sample draw command
    if (isActive && hasTickets && canDrawByTime && meetsMinThreshold) {
      console.log(`\n📝 Sample draw command:`);
      console.log(
        `   await raffleContract.drawRaffle(${raffleId}, { value: ethers.utils.parseEther("0.001") })`
      );
    }
  } catch (error: any) {
    console.log(`❌ Error analyzing raffle: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  throw error;
});
