import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  increaseTime,
} from "../helpers/testHelpers";

describe("TicketPurchasing", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("buyTickets()", function () {
    let raffleId: number;

    beforeEach(async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );
    });

    describe("✅ Valid Scenarios", function () {
      it("Should buy tickets with ETH payment", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 2;
        const totalCost = params.ticketPrice.mul(quantity);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(raffleId, quantity, { value: totalCost })
        )
          .to.emit(raffleContract, "TicketPurchased")
          .withArgs(raffleId, accounts.buyer1.address, quantity);

        // Check user tickets
        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          accounts.buyer1.address
        );
        expect(userTickets).to.equal(quantity);

        // Check raffle current tickets
        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.currentTickets).to.equal(quantity);

        // Check participants array
        const participants = await raffleContract.getRaffleParticipants(
          raffleId
        );
        expect(participants).to.include(accounts.buyer1.address);
        expect(participants.length).to.equal(1);
      });

      it("Should buy tickets with ERC20 payment", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create ERC20 payment raffle
        const erc20RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20,
          mockERC20.address
        );

        const quantity = 3;

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(erc20RaffleId, quantity)
        )
          .to.emit(raffleContract, "TicketPurchased")
          .withArgs(erc20RaffleId, accounts.buyer1.address, quantity);

        const userTickets = await raffleContract.getUserTickets(
          erc20RaffleId,
          accounts.buyer1.address
        );
        expect(userTickets).to.equal(quantity);
      });

      it("Should buy multiple tickets in one transaction", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 5;
        const totalCost = params.ticketPrice.mul(quantity);

        await raffleContract
          .connect(accounts.buyer1)
          .buyTickets(raffleId, quantity, { value: totalCost });

        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          accounts.buyer1.address
        );
        expect(userTickets).to.equal(quantity);

        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.currentTickets).to.equal(quantity);
      });

      it("Should handle first-time buyer correctly", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 1;
        const totalCost = params.ticketPrice.mul(quantity);

        // Check initial state
        let participants = await raffleContract.getRaffleParticipants(raffleId);
        expect(participants.length).to.equal(0);

        await raffleContract
          .connect(accounts.buyer1)
          .buyTickets(raffleId, quantity, { value: totalCost });

        // Check participant added
        participants = await raffleContract.getRaffleParticipants(raffleId);
        expect(participants.length).to.equal(1);
        expect(participants[0]).to.equal(accounts.buyer1.address);
      });

      it("Should handle repeat buyer correctly", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity1 = 2;
        const quantity2 = 3;
        const totalCost1 = params.ticketPrice.mul(quantity1);
        const totalCost2 = params.ticketPrice.mul(quantity2);

        // First purchase
        await raffleContract
          .connect(accounts.buyer1)
          .buyTickets(raffleId, quantity1, { value: totalCost1 });

        // Second purchase
        await raffleContract
          .connect(accounts.buyer1)
          .buyTickets(raffleId, quantity2, { value: totalCost2 });

        // Check total tickets for user
        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          accounts.buyer1.address
        );
        expect(userTickets).to.equal(quantity1 + quantity2);

        // Check participant not duplicated
        const participants = await raffleContract.getRaffleParticipants(
          raffleId
        );
        expect(participants.length).to.equal(1);
        expect(participants[0]).to.equal(accounts.buyer1.address);

        // Check total raffle tickets
        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.currentTickets).to.equal(quantity1 + quantity2);
      });

      it("Should handle exact max tickets per user", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = params.maxTicketsPerUser;
        const totalCost = params.ticketPrice.mul(quantity);

        await raffleContract
          .connect(accounts.buyer1)
          .buyTickets(raffleId, quantity, { value: totalCost });

        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          accounts.buyer1.address
        );
        expect(userTickets).to.equal(quantity);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert for non-existent raffle", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 1;
        const totalCost = params.ticketPrice.mul(quantity);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(999, quantity, { value: totalCost })
        ).to.be.revertedWith("Raffle does not exist");
      });

      it("Should revert for ended raffle", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 1;
        const totalCost = params.ticketPrice.mul(quantity);

        // Increase time past raffle end
        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(raffleId, quantity, { value: totalCost })
        ).to.be.revertedWith("Raffle ended");
      });

      it("Should revert with quantity = 0", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(raffleId, 0, { value: 0 })
        ).to.be.revertedWith("Invalid quantity");
      });

      it("Should revert if exceeds maxTicketsPerUser", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = params.maxTicketsPerUser + 1;
        const totalCost = params.ticketPrice.mul(quantity);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(raffleId, quantity, { value: totalCost })
        ).to.be.revertedWith("Exceeds max tickets per user");
      });

      it("Should revert with incorrect ETH amount", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 2;
        const incorrectCost = params.ticketPrice; // Should be quantity * ticketPrice

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(raffleId, quantity, { value: incorrectCost })
        ).to.be.revertedWith("Incorrect ETH amount");
      });

      it("Should revert if ETH sent for ERC20 payment", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create ERC20 payment raffle
        const erc20RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20,
          mockERC20.address
        );

        const quantity = 1;
        const ethAmount = ethers.utils.parseEther("0.1");

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(erc20RaffleId, quantity, { value: ethAmount })
        ).to.be.revertedWith("ETH not accepted");
      });

      it("Should revert if insufficient ERC20 allowance", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create ERC20 payment raffle
        const erc20RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20,
          mockERC20.address
        );

        // Remove allowance
        await mockERC20
          .connect(accounts.buyer1)
          .approve(raffleContract.address, 0);

        const quantity = 1;

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .buyTickets(erc20RaffleId, quantity)
        ).to.be.reverted;
      });
    });
  });
});
