import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  buyTicketsForRaffle,
  increaseTime,
} from "../helpers/testHelpers";

describe("RaffleDrawing", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("drawRaffle()", function () {
    let raffleId: number;

    beforeEach(async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;
      raffleId = await createSampleRaffle(
        raffleContract,
        accounts.creator1,
        "ERC20",
        mockERC20
      );

      // Buy some tickets so raffle can be drawn
      await buyTicketsForRaffle(
        raffleContract,
        raffleId,
        [accounts.buyer1, accounts.buyer2],
        [3, 2],
        true
      );
    });

    describe("✅ Valid Scenarios", function () {
      it("Should draw raffle after end time", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Increase time past raffle end
        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST })
        )
          .to.emit(raffleContract, "RaffleDrawn")
          .withArgs(raffleId, ethers.constants.AddressZero, 1); // VRF request ID should be 1

        // Check raffle status changed to DRAWN
        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(1); // DRAWN

        // Check VRF request ID stored
        const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
        expect(vrfRequestId).to.equal(1);
      });

      it("Should draw raffle when sold out", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create raffle with low total max tickets
        const lowMaxRaffleId = await raffleContract
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
            0,
            3600
          );

        const receipt = await lowMaxRaffleId.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "RaffleCreated"
        );
        const actualRaffleId = event?.args?.raffleId?.toNumber();

        // Buy all tickets
        await buyTicketsForRaffle(
          raffleContract,
          actualRaffleId,
          [accounts.buyer1, accounts.buyer2],
          [5, 5],
          true
        );

        // Should be able to draw immediately when sold out
        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(actualRaffleId, { value: TEST_DATA.VRF_COST })
        ).to.emit(raffleContract, "RaffleDrawn");

        const raffle = await raffleContract.getRaffle(actualRaffleId);
        expect(raffle.status).to.equal(1); // DRAWN
      });

      it("Should request VRF correctly", async function () {
        const { raffleContract, mockVRF, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await increaseTime(params.duration + 1);

        const balanceBefore = await ethers.provider.getBalance(
          mockVRF.address
        );

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

        // Check VRF was paid
        const balanceAfter = await ethers.provider.getBalance(mockVRF.address);
        expect(balanceAfter.sub(balanceBefore)).to.equal(TEST_DATA.VRF_COST);

        // Check VRF request was made
        const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
        expect(vrfRequestId).to.be.gt(0);
      });

      it("Should change status to DRAWN", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Check initial status
        let raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(0); // ACTIVE

        await increaseTime(params.duration + 1);

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

        // Check status changed
        raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(1); // DRAWN
      });

      it("Should emit RaffleDrawn event", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST })
        )
          .to.emit(raffleContract, "RaffleDrawn")
          .withArgs(raffleId, ethers.constants.AddressZero, 1);
      });

      it("Should store VRF request ID", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await increaseTime(params.duration + 1);

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

        const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);
        expect(vrfRequestId).to.equal(1);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert for non-existent raffle", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(999, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("Raffle does not exist");
      });

      it("Should revert if no tickets sold", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create new raffle with no tickets sold
        const emptyRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(emptyRaffleId, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("No tickets sold");
      });

      it("Should revert if called before end time and not sold out", async function () {
        const { raffleContract, accounts } = fixtures;

        // Don't increase time, raffle should still be active
        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("Cannot draw yet");
      });

      it("Should revert if contract not whitelisted in VRF", async function () {
        const { raffleContract, mockVRF, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Remove contract from VRF whitelist
        await mockVRF.removeFromWhitelist(raffleContract.address);

        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("Contract not whitelisted");
      });

      it("Should revert if insufficient VRF payment", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await increaseTime(params.duration + 1);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: ethers.utils.parseEther("0.0001") }) // Too little
        ).to.be.reverted;
      });

      it("Should revert if already drawn", async function () {
        const { raffleContract, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await increaseTime(params.duration + 1);

        // Draw once
        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

        // Try to draw again
        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("Raffle not active");
      });

      it("Should revert for cancelled raffle", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create new raffle and cancel it
        const cancelRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        await raffleContract
          .connect(accounts.creator1)
          .cancelRaffle(cancelRaffleId);

        await expect(
          raffleContract
            .connect(accounts.buyer1)
            .drawRaffle(cancelRaffleId, { value: TEST_DATA.VRF_COST })
        ).to.be.revertedWith("Raffle not active");
      });
    });
  });
});