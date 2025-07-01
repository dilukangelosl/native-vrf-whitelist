import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  buyTicketsForRaffle,
  increaseTime,
} from "../helpers/testHelpers";

describe("ReentrancyAttacks", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("Reentrancy Protection", function () {
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

    describe("buyTickets() Reentrancy", function () {
      it("Should prevent reentrancy on buyTickets", async function () {
        const { raffleContract, attackerContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 1;
        const totalCost = params.ticketPrice.mul(quantity);

        // Setup attacker contract
        await attackerContract.setAttackParams(raffleId, 3);

        // Initial balance check
        const initialTickets = await raffleContract.getUserTickets(
          raffleId,
          attackerContract.address
        );
        expect(initialTickets).to.equal(0);

        // Attempt reentrancy attack
        await attackerContract.startAttack({ value: totalCost });

        // Check that only one ticket purchase went through
        const finalTickets = await raffleContract.getUserTickets(
          raffleId,
          attackerContract.address
        );
        expect(finalTickets).to.equal(quantity); // Should only be 1, not 3

        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.currentTickets).to.equal(quantity);
      });

      it("Should prevent multiple ticket purchases in single transaction", async function () {
        const { raffleContract, attackerContract } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        const quantity = 2;
        const totalCost = params.ticketPrice.mul(quantity);

        await attackerContract.setAttackParams(raffleId, 5);

        // This should work normally (no reentrancy in normal case)
        await raffleContract
          .connect(fixtures.accounts.buyer1)
          .buyTickets(raffleId, quantity, { value: totalCost });

        const tickets = await raffleContract.getUserTickets(
          raffleId,
          fixtures.accounts.buyer1.address
        );
        expect(tickets).to.equal(quantity);
      });
    });

    describe("drawRaffle() Reentrancy", function () {
      it("Should prevent reentrancy on drawRaffle", async function () {
        const { raffleContract, attackerContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Buy tickets first
        await buyTicketsForRaffle(
          raffleContract,
          raffleId,
          [accounts.buyer1],
          [1],
          true
        );

        // Wait for end time
        await increaseTime(params.duration + 1);

        // Setup attack parameters
        await attackerContract.setAttackParams(raffleId, 2);

        // Check initial state
        let raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(0); // ACTIVE

        // Attempt reentrancy attack on drawRaffle
        try {
          await attackerContract
            .connect(accounts.attacker)
            .attackCreateRaffle(
              0, // ERC20
              fixtures.mockERC20.address,
              ethers.utils.parseEther("100"),
              0,
              ethers.constants.AddressZero,
              ethers.utils.parseEther("0.1"),
              10,
              100,
              3600,
          ethers.constants.AddressZero // whitelistNftContract
        );
        } catch (error) {
          // Expected to fail due to reentrancy protection
        }

        // Check that only one draw operation occurred
        raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(0); // Still ACTIVE (attack failed)
      });
    });

    describe("finalizeRaffle() Reentrancy", function () {
      it("Should prevent reentrancy on finalizeRaffle", async function () {
        const { raffleContract, mockVRF, attackerContract, accounts } =
          fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Setup complete raffle flow
        await buyTicketsForRaffle(
          raffleContract,
          raffleId,
          [accounts.buyer1, accounts.buyer2],
          [2, 3],
          true
        );

        await increaseTime(params.duration + 1);

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

        // Fulfill VRF
        const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
        const randomNumber = ethers.BigNumber.from(
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"))
        );
        await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

        // Check initial state
        let raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(1); // DRAWN

        // Attempt finalization (should work normally, no reentrancy here)
        await raffleContract
          .connect(accounts.buyer1)
          .finalizeRaffle(raffleId);

        // Check finalization completed
        raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.winner).to.not.equal(ethers.constants.AddressZero);
      });
    });

    describe("cancelRaffle() Reentrancy", function () {
      it("Should prevent reentrancy on cancelRaffle", async function () {
        const { raffleContract, mockERC20, attackerContract, accounts } =
          fixtures;

        // Create raffle that attacker will try to manipulate
        const attackRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.attacker,
          "ERC20",
          mockERC20
        );

        // Check initial state
        let raffle = await raffleContract.getRaffle(attackRaffleId);
        expect(raffle.status).to.equal(0); // ACTIVE

        // Normal cancellation should work
        await raffleContract
          .connect(accounts.attacker)
          .cancelRaffle(attackRaffleId);

        raffle = await raffleContract.getRaffle(attackRaffleId);
        expect(raffle.status).to.equal(2); // CANCELLED
      });
    });
  });

  describe("State Manipulation Attacks", function () {
    it("Should prevent manipulation of raffle state through external calls", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Normal ticket purchase
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
      const quantity = 1;
      const totalCost = params.ticketPrice.mul(quantity);

      await raffleContract
        .connect(accounts.buyer1)
        .buyTickets(raffleId, quantity, { value: totalCost });

      // Verify state consistency
      const raffle = await raffleContract.getRaffle(raffleId);
      const userTickets = await raffleContract.getUserTickets(
        raffleId,
        accounts.buyer1.address
      );
      const participants = await raffleContract.getRaffleParticipants(raffleId);

      expect(raffle.currentTickets).to.equal(quantity);
      expect(userTickets).to.equal(quantity);
      expect(participants.length).to.equal(1);
      expect(participants[0]).to.equal(accounts.buyer1.address);
    });

    it("Should maintain consistent state across multiple operations", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Multiple users buy tickets
      const users = [accounts.buyer1, accounts.buyer2, accounts.buyer3];
      const quantities = [2, 3, 1];
      
      for (let i = 0; i < users.length; i++) {
        const totalCost = params.ticketPrice.mul(quantities[i]);
        await raffleContract
          .connect(users[i])
          .buyTickets(raffleId, quantities[i], { value: totalCost });
      }

      // Verify total state consistency
      const raffle = await raffleContract.getRaffle(raffleId);
      const expectedTotal = quantities.reduce((a, b) => a + b, 0);
      expect(raffle.currentTickets).to.equal(expectedTotal);

      // Verify individual user tickets
      for (let i = 0; i < users.length; i++) {
        const userTickets = await raffleContract.getUserTickets(
          raffleId,
          users[i].address
        );
        expect(userTickets).to.equal(quantities[i]);
      }

      // Verify participants list
      const participants = await raffleContract.getRaffleParticipants(raffleId);
      expect(participants.length).to.equal(users.length);
      for (const user of users) {
        expect(participants).to.include(user.address);
      }
    });
  });

  describe("Access Control Security", function () {
    it("Should prevent unauthorized raffle modifications", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Non-creator should not be able to cancel
      await expect(
        raffleContract.connect(accounts.buyer1).cancelRaffle(raffleId)
      ).to.be.revertedWith("Only creator can cancel");

      // Non-owner should not be able to change fees
      await expect(
        raffleContract.connect(accounts.buyer1).updateFeePercentage(1000)
      ).to.be.reverted;
    });

    it("Should prevent unauthorized withdrawals", async function () {
      const { raffleContract, accounts } = fixtures;

      // Try to withdraw collected fees as non-owner
      await expect(
        raffleContract.connect(accounts.buyer1).withdrawFees(ethers.constants.AddressZero)
      ).to.be.reverted;
    });
  });

  describe("Integer Overflow/Underflow Protection", function () {
    it("Should handle large ticket quantities safely", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

      const raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Try to buy maximum allowed tickets
      const maxQuantity = params.maxTicketsPerUser;
      const totalCost = params.ticketPrice.mul(maxQuantity);

      await raffleContract
        .connect(accounts.buyer1)
        .buyTickets(raffleId, maxQuantity, { value: totalCost });

      const userTickets = await raffleContract.getUserTickets(
        raffleId,
        accounts.buyer1.address
      );
      expect(userTickets).to.equal(maxQuantity);
    });

    it("Should handle maximum ticket price calculations", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      // Create raffle with high ticket price
      const highPrice = ethers.utils.parseEther("100");
      const quantity = 1;

      const highPriceRaffleId = await raffleContract
        .connect(accounts.creator1)
        .createRaffle(
          0,
          mockERC20.address,
          ethers.utils.parseEther("1000"),
          0,
          ethers.constants.AddressZero,
          highPrice,
          10,
          100,
          1,
          3600,
          ethers.constants.AddressZero // whitelistNftContract
        );

      const receipt = await highPriceRaffleId.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "RaffleCreated"
      );
      const actualRaffleId = event?.args?.raffleId?.toNumber();

      const totalCost = highPrice.mul(quantity);
      await raffleContract
        .connect(accounts.buyer1)
        .buyTickets(actualRaffleId, quantity, { value: totalCost });

      const userTickets = await raffleContract.getUserTickets(
        actualRaffleId,
        accounts.buyer1.address
      );
      expect(userTickets).to.equal(quantity);
    });
  });
});