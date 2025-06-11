import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  buyTicketsForRaffle,
  increaseTime,
} from "../helpers/testHelpers";

describe("RaffleFinalization", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("finalizeRaffle()", function () {
    let raffleId: number;

    beforeEach(async function () {
      const { raffleContract, mockERC20, mockVRF, accounts } = fixtures;
      raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Buy tickets
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2, accounts.buyer3],
        [3, 2, 1],
        true
      );

      // Draw raffle
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
      await increaseTime(params.duration + 1);
      
      const tx = await raffleContract
        .connect(accounts.buyer1)
        .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

      // Get VRF request ID and fulfill it
      const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
      const randomNumber = ethers.BigNumber.from(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"))
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);
    });

    describe("✅ Valid Scenarios", function () {
      it("Should finalize raffle with multiple participants", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId)
        ).to.emit(raffleContract, "PrizeClaimed");

        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.winner).to.not.equal(ethers.constants.AddressZero);
      });

      it("Should select winner correctly based on VRF", async function () {
        const { raffleContract, accounts } = fixtures;

        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        const raffle = await raffleContract.getRaffle(raffleId);
        
        // Winner should be one of the participants
        const participants = await raffleContract.getRaffleParticipants(
          raffleId
        );
        expect(participants).to.include(raffle.winner);
      });

      it("Should transfer ERC20 prize to winner", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        const raffle = await raffleContract.getRaffle(raffleId);
        const winnerBalance = await mockERC20.balanceOf(raffle.winner);
        
        // Winner should have received the prize (plus their initial balance)
        expect(winnerBalance).to.be.gte(params.prizeAmount);
      });

      it("Should transfer ERC721 prize to winner", async function () {
        const { raffleContract, mockERC721, mockVRF, accounts } = fixtures;

        // Create ERC721 raffle
        const erc721RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC721",
          mockERC721
        );

        await buyTicketsForRaffle(
          raffleContract,
          erc721RaffleId,
          [accounts.buyer1, accounts.buyer2],
          [2, 3],
          true
        );

        // Draw and fulfill
        const params = TEST_DATA.RAFFLE_PARAMS.ERC721;
        await increaseTime(params.duration + 1);
        
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(erc721RaffleId, { value: TEST_DATA.VRF_COST });

        const vrfRequestId = await raffleContract.raffleVRFRequests(
          erc721RaffleId
        );
        const randomNumber = ethers.BigNumber.from(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test721"))
        );
        await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(erc721RaffleId);

        const raffle = await raffleContract.getRaffle(erc721RaffleId);
        const tokenOwner = await mockERC721.ownerOf(
          (TEST_DATA.RAFFLE_PARAMS.ERC721 as any).prizeTokenId
        );
        
        expect(tokenOwner).to.equal(raffle.winner);
      });

      it("Should transfer ERC1155 prize to winner", async function () {
        const { raffleContract, mockERC1155, mockVRF, accounts } = fixtures;

        // Create ERC1155 raffle
        const erc1155RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC1155",
          mockERC1155
        );

        await buyTicketsForRaffle(
          raffleContract,
          erc1155RaffleId,
          [accounts.buyer1, accounts.buyer2],
          [2, 3],
          true
        );

        // Draw and fulfill
        const params = TEST_DATA.RAFFLE_PARAMS.ERC1155;
        await increaseTime(params.duration + 1);
        
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(erc1155RaffleId, { value: TEST_DATA.VRF_COST });

        const vrfRequestId = await raffleContract.raffleVRFRequests(
          erc1155RaffleId
        );
        const randomNumber = ethers.BigNumber.from(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test1155"))
        );
        await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(erc1155RaffleId);

        const raffle = await raffleContract.getRaffle(erc1155RaffleId);
        const winnerBalance = await mockERC1155.balanceOf(
          raffle.winner,
          (TEST_DATA.RAFFLE_PARAMS.ERC1155 as any).prizeTokenId
        );
        
        expect(winnerBalance).to.be.gte(
          (TEST_DATA.RAFFLE_PARAMS.ERC1155 as any).prizeAmount
        );
      });

      it("Should distribute ETH funds correctly", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        const creatorBalanceBefore = await ethers.provider.getBalance(
          accounts.creator1.address
        );

        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        const creatorBalanceAfter = await ethers.provider.getBalance(
          accounts.creator1.address
        );

        // Creator should receive payment minus fees
        const totalRevenue = params.ticketPrice.mul(6); // 3+2+1 tickets
        const fee = totalRevenue.mul(TEST_DATA.DEFAULT_FEE).div(10000);
        const expectedCreatorAmount = totalRevenue.sub(fee);

        expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
          expectedCreatorAmount
        );
      });

      it("Should distribute ERC20 funds correctly", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create ERC20 payment raffle
        const erc20PaymentRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator2,
          "ERC20",
          mockERC20,
          mockERC20.address
        );

        await buyTicketsForRaffle(
          raffleContract,
          erc20PaymentRaffleId,
          [accounts.buyer1, accounts.buyer2],
          [3, 2],
          false // ERC20 payment
        );

        // Draw and fulfill
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        await increaseTime(params.duration + 1);
        
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(erc20PaymentRaffleId, { value: TEST_DATA.VRF_COST });

        const vrfRequestId = await raffleContract.raffleVRFRequests(
          erc20PaymentRaffleId
        );
        const randomNumber = ethers.BigNumber.from(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("testERC20"))
        );
        await fixtures.mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

        const creatorBalanceBefore = await mockERC20.balanceOf(
          accounts.creator2.address
        );

        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(erc20PaymentRaffleId);

        const creatorBalanceAfter = await mockERC20.balanceOf(
          accounts.creator2.address
        );

        // Creator should receive payment minus fees
        const totalRevenue = params.ticketPrice.mul(5); // 3+2 tickets
        const fee = totalRevenue.mul(TEST_DATA.DEFAULT_FEE).div(10000);
        const expectedCreatorAmount = totalRevenue.sub(fee);

        expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
          expectedCreatorAmount
        );
      });

      it("Should calculate fees correctly", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Get initial contract balance (should have the total revenue from ticket sales)
        const contractBalanceBefore = await ethers.provider.getBalance(
          raffleContract.address
        );

        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        const contractBalanceAfter = await ethers.provider.getBalance(
          raffleContract.address
        );

        // Contract should retain the fees and pay out creator's share
        const totalRevenue = params.ticketPrice.mul(6); // 3+2+1 tickets
        const expectedFee = totalRevenue.mul(TEST_DATA.DEFAULT_FEE).div(10000);
        const creatorShare = totalRevenue.sub(expectedFee);

        // The change in contract balance should be negative (paying out creator share)
        // but the remaining balance should be at least the fee amount
        expect(contractBalanceAfter).to.be.gte(expectedFee);
      });

      it("Should emit PrizeClaimed event", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId)
        ).to.emit(raffleContract, "PrizeClaimed");
      });

      it("Should set winner address correctly", async function () {
        const { raffleContract, accounts } = fixtures;

        // Check initial state
        let raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.winner).to.equal(ethers.constants.AddressZero);

        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.winner).to.not.equal(ethers.constants.AddressZero);

        // Winner should be one of the participants
        const participants = await raffleContract.getRaffleParticipants(
          raffleId
        );
        expect(participants).to.include(raffle.winner);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert if raffle not drawn", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create new raffle that hasn't been drawn
        const newRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        await buyTicketsForRaffle(
          raffleContract,
          newRaffleId,
          [accounts.buyer1],
          [1],
          true
        );

        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(newRaffleId)
        ).to.be.revertedWith("Raffle not drawn");
      });

      it("Should revert if VRF not fulfilled", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create new raffle and draw it but don't fulfill VRF
        const newRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        await buyTicketsForRaffle(
          raffleContract,
          newRaffleId,
          [accounts.buyer1],
          [5],
          true
        );

        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        await increaseTime(params.duration + 1);
        
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(newRaffleId, { value: TEST_DATA.VRF_COST });

        // Don't fulfill VRF, try to finalize
        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(newRaffleId)
        ).to.be.revertedWith("VRF not fulfilled");
      });

      it("Should revert if already finalized", async function () {
        const { raffleContract, accounts } = fixtures;

        // Finalize once
        await raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId);

        // Try to finalize again
        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(raffleId)
        ).to.be.revertedWith("Already finalized");
      });

      it("Should revert for non-existent raffle", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.buyer1).finalizeRaffle(999)
        ).to.be.revertedWith("Raffle not drawn");
      });
    });
  });
});