import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import { expectRevert, increaseTime } from "../helpers/testHelpers";

describe("RaffleRefund", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("Refund Functionality", function () {
    it("Should enable refunds when minimum tickets not met", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const { creator1, buyer1, buyer2 } = accounts;

      const prizeAmount = ethers.utils.parseEther("100");
      const ticketPrice = ethers.utils.parseEther("1");
      const maxTicketsPerUser = 10;
      const totalMaxTickets = 100;
      const minTicketsNeededToDraw = 10; // Minimum 10 tickets needed
      const duration = 86400; // 1 day

      // Approve prize transfer
      await mockERC20
        .connect(creator1)
        .approve(raffleContract.address, prizeAmount);

      // Create raffle
      await raffleContract.connect(creator1).createRaffle(
        0, // ERC20
        mockERC20.address,
        prizeAmount,
        0,
        ethers.constants.AddressZero, // ETH payment
        ticketPrice,
        maxTicketsPerUser,
        totalMaxTickets,
        minTicketsNeededToDraw,
        duration
      );

      // Buy only 5 tickets (less than minimum)
      await raffleContract.connect(buyer1).buyTickets(1, 3, {
        value: ticketPrice.mul(3),
      });
      await raffleContract.connect(buyer2).buyTickets(1, 2, {
        value: ticketPrice.mul(2),
      });

      // Fast forward past end time
      await increaseTime(duration + 1);

      // Try to draw raffle - should trigger refund mode
      const tx = await raffleContract.drawRaffle(1);
      await expect(tx).to.emit(raffleContract, "RefundAvailable").withArgs(1);

      const raffle = await raffleContract.getRaffle(1);
      expect(raffle.status).to.equal(3); // REFUND_AVAILABLE
    });

    it("Should allow users to claim refunds", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const { creator1, buyer1, buyer2 } = accounts;

      const prizeAmount = ethers.utils.parseEther("100");
      const ticketPrice = ethers.utils.parseEther("1");
      const maxTicketsPerUser = 10;
      const totalMaxTickets = 100;
      const minTicketsNeededToDraw = 10;
      const duration = 86400;

      // Setup raffle
      await mockERC20.connect(creator1).approve(raffleContract.address, prizeAmount);
      await raffleContract.connect(creator1).createRaffle(
        0,
        mockERC20.address,
        prizeAmount,
        0,
        ethers.constants.AddressZero,
        ticketPrice,
        maxTicketsPerUser,
        totalMaxTickets,
        minTicketsNeededToDraw,
        duration
      );

      // Buy tickets
      const buyer1Tickets = 3;
      const buyer2Tickets = 2;
      await raffleContract.connect(buyer1).buyTickets(1, buyer1Tickets, {
        value: ticketPrice.mul(buyer1Tickets),
      });
      await raffleContract.connect(buyer2).buyTickets(1, buyer2Tickets, {
        value: ticketPrice.mul(buyer2Tickets),
      });

      // Fast forward and trigger refund mode
      await increaseTime(duration + 1);
      await raffleContract.drawRaffle(1);

      // Check refund amounts
      const buyer1RefundAmount = await raffleContract.getRefundAmount(
        1,
        buyer1.address
      );
      const buyer2RefundAmount = await raffleContract.getRefundAmount(
        1,
        buyer2.address
      );

      expect(buyer1RefundAmount).to.equal(ticketPrice.mul(buyer1Tickets));
      expect(buyer2RefundAmount).to.equal(ticketPrice.mul(buyer2Tickets));

      // Claim refunds
      const tx1 = await raffleContract.connect(buyer1).claimRefund(1);
      const tx2 = await raffleContract.connect(buyer2).claimRefund(1);

      await expect(tx1)
        .to.emit(raffleContract, "RefundClaimed")
        .withArgs(1, buyer1.address, ticketPrice.mul(buyer1Tickets));
      await expect(tx2)
        .to.emit(raffleContract, "RefundClaimed")
        .withArgs(1, buyer2.address, ticketPrice.mul(buyer2Tickets));

      // Check refund status
      expect(await raffleContract.hasUserRefunded(1, buyer1.address)).to.be.true;
      expect(await raffleContract.hasUserRefunded(1, buyer2.address)).to.be.true;

      // Check refund amounts are now 0
      expect(await raffleContract.getRefundAmount(1, buyer1.address)).to.equal(
        0
      );
      expect(await raffleContract.getRefundAmount(1, buyer2.address)).to.equal(
        0
      );
    });

    it("Should prevent double refunds", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const { creator1, buyer1 } = accounts;

      const prizeAmount = ethers.utils.parseEther("100");
      const ticketPrice = ethers.utils.parseEther("1");

      // Setup raffle in refund mode
      await mockERC20.connect(creator1).approve(raffleContract.address, prizeAmount);
      await raffleContract.connect(creator1).createRaffle(
        0,
        mockERC20.address,
        prizeAmount,
        0,
        ethers.constants.AddressZero,
        ticketPrice,
        10,
        100,
        10,
        86400
      );

      await raffleContract.connect(buyer1).buyTickets(1, 3, {
        value: ticketPrice.mul(3),
      });
      await increaseTime(86401);
      await raffleContract.drawRaffle(1);

      // First refund should succeed
      await raffleContract.connect(buyer1).claimRefund(1);

      // Second refund should fail
      await expectRevert(
        raffleContract.connect(buyer1).claimRefund(1),
        "Already refunded"
      );
    });

    it("Should not allow refunds when raffle is successful", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const { creator1, buyer1 } = accounts;

      const prizeAmount = ethers.utils.parseEther("100");
      const ticketPrice = ethers.utils.parseEther("1");

      // Setup raffle
      await mockERC20.connect(creator1).approve(raffleContract.address, prizeAmount);
      await raffleContract.connect(creator1).createRaffle(
        0,
        mockERC20.address,
        prizeAmount,
        0,
        ethers.constants.AddressZero,
        ticketPrice,
        10,
        100,
        5,
        86400 // minTicketsNeededToDraw = 5
      );

      // Buy enough tickets to meet minimum
      await raffleContract.connect(buyer1).buyTickets(1, 5, {
        value: ticketPrice.mul(5),
      });

      await increaseTime(86401);

      // Draw should succeed (not trigger refund mode)
      const tx = await raffleContract.drawRaffle(1, {
        value: ethers.utils.parseEther("0.1"),
      });
      await expect(tx).to.emit(raffleContract, "RaffleDrawn");

      const raffle = await raffleContract.getRaffle(1);
      expect(raffle.status).to.equal(1); // DRAWN

      // Refund should not be available
      await expectRevert(
        raffleContract.connect(buyer1).claimRefund(1),
        "Refund not available"
      );
    });

    it("Should return prize to creator when refund mode is triggered", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const { creator1, buyer1 } = accounts;

      const prizeAmount = ethers.utils.parseEther("100");
      const initialBalance = await mockERC20.balanceOf(creator1.address);

      // Setup and trigger refund
      await mockERC20.connect(creator1).approve(raffleContract.address, prizeAmount);
      await raffleContract.connect(creator1).createRaffle(
        0,
        mockERC20.address,
        prizeAmount,
        0,
        ethers.constants.AddressZero,
        ethers.utils.parseEther("1"),
        10,
        100,
        10,
        86400
      );

      await raffleContract.connect(buyer1).buyTickets(1, 3, {
        value: ethers.utils.parseEther("3"),
      });
      await increaseTime(86401);
      await raffleContract.drawRaffle(1);

      // Prize should be returned to creator
      const finalBalance = await mockERC20.balanceOf(creator1.address);
      expect(finalBalance).to.equal(initialBalance); // Prize returned
    });
  });
});
