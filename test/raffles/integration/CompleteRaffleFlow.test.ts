import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  buyTicketsForRaffle,
  increaseTime,
} from "../helpers/testHelpers";

describe("CompleteRaffleFlow", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("End-to-End Raffle Scenarios", function () {
    it("Should complete full ERC20 raffle with ETH payment flow", async function () {
      const { raffleContract, mockERC20, mockVRF, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

      // 1. Create raffle
      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Verify raffle created
      let raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.status).to.equal(0); // ACTIVE
      expect(raffle.creator).to.equal(accounts.creator1.address);
      expect(raffle.prizeContract).to.equal(mockERC20.address);

      // 2. Multiple users buy tickets
      const buyers = [accounts.buyer1, accounts.buyer2, accounts.buyer3];
      const quantities = [3, 4, 2];

      for (let i = 0; i < buyers.length; i++) {
        const totalCost = params.ticketPrice.mul(quantities[i]);
        await raffleContract
          .connect(buyers[i])
          .buyTickets(raffleId, quantities[i], { value: totalCost });
      }

      // Verify tickets purchased
      raffle = await raffleContract.getRaffle(raffleId);
      const expectedTotal = quantities.reduce((a, b) => a + b, 0);
      expect(raffle.currentTickets).to.equal(expectedTotal);

      // Verify participants
      const participants = await raffleContract.getRaffleParticipants(raffleId);
      expect(participants.length).to.equal(buyers.length);

      // 3. Wait for raffle to end and draw
      await increaseTime(params.duration + 1);

      const creatorBalanceBefore = await ethers.provider.getBalance(
        accounts.creator1.address
      );

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      // Verify drawn
      raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.status).to.equal(1); // DRAWN

      // 4. Fulfill VRF and finalize
      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("integration-test"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      // 5. Verify final state
      raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.winner).to.not.equal(ethers.constants.AddressZero);
      expect(participants).to.include(raffle.winner);

      // Verify winner received prize
      const winnerBalance = await mockERC20.balanceOf(raffle.winner);
      expect(winnerBalance).to.be.gte(params.prizeAmount);

      // Verify creator received payment
      const creatorBalanceAfter = await ethers.provider.getBalance(
        accounts.creator1.address
      );
      const totalRevenue = params.ticketPrice.mul(expectedTotal);
      const fee = totalRevenue.mul(TEST_DATA.DEFAULT_FEE).div(100);
      const expectedCreatorAmount = totalRevenue.sub(fee);

      expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
        expectedCreatorAmount
      );
    });

    it("Should complete full ERC721 raffle flow", async function () {
      const { raffleContract, mockERC721, mockVRF, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC721;

      // Create ERC721 raffle
      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC721",
        mockERC721
      );

      // Buy tickets
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2],
        [2, 3],
        true
      );

      // Complete the flow
      await increaseTime(params.duration + 1);

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("nft-test"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      // Verify NFT transfer
      const raffle = await raffleContract.getRaffle(raffleId);
      const tokenOwner = await mockERC721.ownerOf((params as any).prizeTokenId);
      expect(tokenOwner).to.equal(raffle.winner);
    });

    it("Should complete full ERC1155 raffle flow", async function () {
      const { raffleContract, mockERC1155, mockVRF, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC1155;

      // Create ERC1155 raffle
      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC1155",
        mockERC1155
      );

      // Buy tickets
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2, accounts.buyer3],
        [1, 2, 1],
        true
      );

      // Complete the flow
      await increaseTime(params.duration + 1);

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("erc1155-test"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      // Verify token transfer
      const raffle = await raffleContract.getRaffle(raffleId);
      const winnerBalance = await mockERC1155.balanceOf(
        raffle.winner,
        (params as any).prizeTokenId
      );
      expect(winnerBalance).to.be.gte((params as any).prizeAmount);
    });

    it("Should handle ERC20 payment token flow", async function () {
      const { raffleContract, mockERC20, mockVRF, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

      // Create raffle with ERC20 payment
      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20,
        mockERC20.address // ERC20 payment
      );

      // Buy tickets with ERC20
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2],
        [2, 3],
        false // ERC20 payment
      );

      // Track creator's ERC20 balance
      const creatorBalanceBefore = await mockERC20.balanceOf(
        accounts.creator1.address
      );

      // Complete the flow
      await increaseTime(params.duration + 1);

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("erc20-payment"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      // Verify creator received ERC20 payment
      const creatorBalanceAfter = await mockERC20.balanceOf(
        accounts.creator1.address
      );
      const totalRevenue = params.ticketPrice.mul(5); // 2+3 tickets
      const fee = totalRevenue.mul(TEST_DATA.DEFAULT_FEE).div(100);
      const expectedCreatorAmount = totalRevenue.sub(fee);

      expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
        expectedCreatorAmount
      );
    });

    it("Should handle sold-out raffle scenario", async function () {
      const { raffleContract, mockERC20, mockVRF, accounts } = fixtures;

      // Create raffle with limited tickets
      const limitedRaffleId = await raffleContract
        .connect(accounts.creator1)
        .createRaffle(
          0,
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("0.1"),
          5,
          10, // Only 10 total tickets
          1,
          3600
        );

      const receipt = await limitedRaffleId.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "RaffleCreated"
      );
      const raffleId = event?.args?.raffleId?.toNumber();

      // Buy all tickets
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2],
        [5, 5],
        true
      );

      // Should be able to draw immediately when sold out
      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("sold-out"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      const raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.winner).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should handle multiple concurrent raffles", async function () {
      const { raffleContract, mockERC20, mockERC721, mockVRF, accounts } =
        fixtures;

      try {
        // Create ERC20 raffle
        console.log("Creating ERC20 raffle...");
        const erc20RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );
        console.log("ERC20 Raffle ID:", erc20RaffleId);

        // Check who owns what tokens in the ERC721 contract
        console.log("Checking existing ERC721 token ownership...");
        try {
          const owner0 = await mockERC721.ownerOf(0);
          console.log("Token 0 owner:", owner0);
        } catch (e) {
          console.log("Token 0 doesn't exist");
        }

        try {
          const owner1 = await mockERC721.ownerOf(1);
          console.log("Token 1 owner:", owner1);
        } catch (e) {
          console.log("Token 1 doesn't exist");
        }

        // Transfer an existing token to creator2, or use creator1 for both raffles
        console.log("Ensuring creator2 has an NFT...");
        try {
          // Try to transfer token 1 from creator1 to creator2
          await mockERC721
            .connect(accounts.creator1)
            .transferFrom(
              accounts.creator1.address,
              accounts.creator2.address,
              1
            );
          console.log("Transferred token 1 to creator2");
        } catch (error) {
          console.log("Transfer failed, using creator1 for ERC721 raffle too");

          // Create ERC721 raffle with creator1 (who should own tokens)
          console.log("Creating ERC721 raffle with creator1...");
          const erc721RaffleId = await createSampleRaffle(
            raffleContract,
            accounts.creator1,
            "ERC721",
            mockERC721
          );
          console.log("ERC721 Raffle ID:", erc721RaffleId);

          // Buy tickets for both raffles
          console.log("Buying tickets for ERC20 raffle...");
          await buyTicketsForRaffle(
            raffleContract,
            erc20RaffleId,
            [accounts.buyer1, accounts.buyer2],
            [2, 3],
            true
          );

          console.log("Buying tickets for ERC721 raffle...");
          await buyTicketsForRaffle(
            raffleContract,
            erc721RaffleId,
            [accounts.buyer1, accounts.buyer3],
            [1, 2],
            true
          );

          // Complete both raffles
          const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
          console.log("Advancing time...");
          await increaseTime(params.duration + 1);

          // Draw both raffles
          console.log("Drawing raffles...");
          await raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(erc20RaffleId, { value: TEST_DATA.VRF_COST });

          await raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(erc721RaffleId, { value: TEST_DATA.VRF_COST });

          // Fulfill VRF for both
          console.log("Fulfilling VRF...");
          const vrfRequestId1 = await raffleContract.raffleVRFRequests(
            erc20RaffleId
          );
          const vrfRequestId2 = await raffleContract.raffleVRFRequests(
            erc721RaffleId
          );

          await mockVRF.fulfillRandomness(
            vrfRequestId1,
            ethers.BigNumber.from(
              ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-1"))
            )
          );

          await mockVRF.fulfillRandomness(
            vrfRequestId2,
            ethers.BigNumber.from(
              ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-2"))
            )
          );

          // Finalize both
          console.log("Finalizing raffles...");
          await raffleContract
            .connect(accounts.buyer1)
            .finalizeRaffle(erc20RaffleId);
          await raffleContract
            .connect(accounts.buyer1)
            .finalizeRaffle(erc721RaffleId);

          // Verify both completed
          const raffle1 = await raffleContract.getRaffle(erc20RaffleId);
          const raffle2 = await raffleContract.getRaffle(erc721RaffleId);

          expect(raffle1.winner).to.not.equal(ethers.constants.AddressZero);
          expect(raffle2.winner).to.not.equal(ethers.constants.AddressZero);

          console.log("=== TEST COMPLETED SUCCESSFULLY ===");
          return; // Exit early since we completed the test
        }

        // If transfer succeeded, continue with creator2
        console.log("Creating ERC721 raffle with creator2...");
        const erc721RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator2,
          "ERC721",
          mockERC721
        );
        console.log("ERC721 Raffle ID:", erc721RaffleId);

        // Buy tickets for ERC20 raffle
        console.log("Buying tickets for ERC20 raffle...");
        await buyTicketsForRaffle(
          raffleContract,
          erc20RaffleId,
          [accounts.buyer1, accounts.buyer2],
          [2, 3],
          true
        );

        // Buy tickets for ERC721 raffle
        console.log("Buying tickets for ERC721 raffle...");
        await buyTicketsForRaffle(
          raffleContract,
          erc721RaffleId,
          [accounts.buyer1, accounts.buyer3],
          [1, 2],
          true
        );

        // Complete both raffles - check both raffle end times
        console.log("Checking raffle end times...");
        let raffle1 = await raffleContract.getRaffle(erc20RaffleId);
        let raffle2 = await raffleContract.getRaffle(erc721RaffleId);

        console.log(
          "Current block timestamp:",
          await ethers.provider.getBlock("latest").then((b) => b.timestamp)
        );
        console.log("ERC20 raffle end time:", raffle1.endTime.toString());
        console.log("ERC721 raffle end time:", raffle2.endTime.toString());

        // Calculate how much time to advance (use the later end time + buffer)
        const currentTime = await ethers.provider
          .getBlock("latest")
          .then((b) => b.timestamp);

        // Handle both BigNumber and regular number cases
        const endTime1 =
          typeof raffle1.endTime === "number"
            ? raffle1.endTime
            : raffle1.endTime.toNumber();
        const endTime2 =
          typeof raffle2.endTime === "number"
            ? raffle2.endTime
            : raffle2.endTime.toNumber();

        const maxEndTime = Math.max(endTime1, endTime2);
        const timeToAdvance = maxEndTime - currentTime + 10; // +10 second buffer

        console.log("Time to advance:", timeToAdvance);
        await increaseTime(timeToAdvance);

        // Draw both raffles
        console.log("Drawing raffles...");
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(erc20RaffleId, { value: TEST_DATA.VRF_COST });

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(erc721RaffleId, { value: TEST_DATA.VRF_COST });

        // Fulfill VRF for both
        console.log("Fulfilling VRF...");
        const vrfRequestId1 = await raffleContract.raffleVRFRequests(
          erc20RaffleId
        );
        const vrfRequestId2 = await raffleContract.raffleVRFRequests(
          erc721RaffleId
        );

        await mockVRF.fulfillRandomness(
          vrfRequestId1,
          ethers.BigNumber.from(
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-1"))
          )
        );

        await mockVRF.fulfillRandomness(
          vrfRequestId2,
          ethers.BigNumber.from(
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("multi-2"))
          )
        );

        // Finalize both
        console.log("Finalizing raffles...");
        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(erc20RaffleId);
        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(erc721RaffleId);

        // Verify both completed
        raffle1 = await raffleContract.getRaffle(erc20RaffleId);
        raffle2 = await raffleContract.getRaffle(erc721RaffleId);

        expect(raffle1.winner).to.not.equal(ethers.constants.AddressZero);
        expect(raffle2.winner).to.not.equal(ethers.constants.AddressZero);

        console.log("=== TEST COMPLETED SUCCESSFULLY ===");
      } catch (error) {
        console.error("=== TEST FAILED ===");
        console.error("Error:", error.message);
        throw error;
      }
    });

    it("Should handle raffle cancellation before any tickets sold", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Cancel before any tickets sold
      await raffleContract.connect(accounts.creator1).cancelRaffle(raffleId);

      const raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.status).to.equal(2); // CANCELLED

      // Verify prize returned to creator
      const creatorBalance = await mockERC20.balanceOf(
        accounts.creator1.address
      );
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
      expect(creatorBalance).to.be.gte(params.prizeAmount);
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("Should handle single participant raffle", async function () {
      const { raffleContract, mockERC20, mockVRF, accounts } = fixtures;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Only one participant
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1],
        [1],
        true
      );

      // Complete the flow manually
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
      await increaseTime(params.duration + 1);

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("single-participant"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      const raffle = await raffleContract.getRaffle(raffleId);
      expect(raffle.winner).to.equal(accounts.buyer1.address);
    });

    it("Should properly handle maximum participants", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Many participants each buying 1 ticket
      const manyBuyers = [
        accounts.buyer1,
        accounts.buyer2,
        accounts.buyer3,
        accounts.creator2,
      ];
      for (let i = 0; i < manyBuyers.length; i++) {
        const totalCost = params.ticketPrice.mul(1);
        await raffleContract
          .connect(manyBuyers[i])
          .buyTickets(raffleId, 1, { value: totalCost });
      }

      const participants = await raffleContract.getRaffleParticipants(raffleId);
      expect(participants.length).to.be.gte(3);

      // Complete normally
      await increaseTime(params.duration + 1);

      await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      await fixtures.mockVRF.fulfillRandomness(
        vrfRequestId,
        ethers.BigNumber.from(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("many-participants"))
        )
      );

      await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

      const raffle = await raffleContract.getRaffle(raffleId);
      expect(participants).to.include(raffle.winner);
    });
  });
});
