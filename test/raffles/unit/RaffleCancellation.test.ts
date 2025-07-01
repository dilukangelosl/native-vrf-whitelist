import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import {
  TEST_DATA,
  createSampleRaffle,
  buyTicketsForRaffle,
} from "../helpers/testHelpers";

describe("RaffleCancellation", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("cancelRaffle()", function () {
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
      it("Should cancel ERC20 raffle before tickets sold", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        const creatorBalanceBefore = await mockERC20.balanceOf(
          accounts.creator1.address
        );

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(raffleId)
        )
          .to.emit(raffleContract, "RaffleCancelled")
          .withArgs(raffleId);

        // Check raffle status changed to CANCELLED
        const raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(2); // CANCELLED

        // Check prize returned to creator
        const creatorBalanceAfter = await mockERC20.balanceOf(
          accounts.creator1.address
        );
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
          params.prizeAmount
        );
      });

      it("Should cancel ERC721 raffle before tickets sold", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;

        const erc721RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC721",
          mockERC721
        );

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(erc721RaffleId)
        )
          .to.emit(raffleContract, "RaffleCancelled")
          .withArgs(erc721RaffleId);

        // Check raffle status
        const raffle = await raffleContract.getRaffle(erc721RaffleId);
        expect(raffle.status).to.equal(2); // CANCELLED

        // Check NFT returned to creator
        const params = TEST_DATA.RAFFLE_PARAMS.ERC721;
        const tokenOwner = await mockERC721.ownerOf(
          (params as any).prizeTokenId
        );
        expect(tokenOwner).to.equal(accounts.creator1.address);
      });

      it("Should cancel ERC1155 raffle before tickets sold", async function () {
        const { raffleContract, mockERC1155, accounts } = fixtures;

        const erc1155RaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC1155",
          mockERC1155
        );

        const creatorBalanceBefore = await mockERC1155.balanceOf(
          accounts.creator1.address,
          (TEST_DATA.RAFFLE_PARAMS.ERC1155 as any).prizeTokenId
        );

        await expect(
          raffleContract
            .connect(accounts.creator1)
            .cancelRaffle(erc1155RaffleId)
        )
          .to.emit(raffleContract, "RaffleCancelled")
          .withArgs(erc1155RaffleId);

        // Check raffle status
        const raffle = await raffleContract.getRaffle(erc1155RaffleId);
        expect(raffle.status).to.equal(2); // CANCELLED

        // Check tokens returned to creator
        const creatorBalanceAfter = await mockERC1155.balanceOf(
          accounts.creator1.address,
          (TEST_DATA.RAFFLE_PARAMS.ERC1155 as any).prizeTokenId
        );
        const params = TEST_DATA.RAFFLE_PARAMS.ERC1155;
        expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.equal(
          (params as any).prizeAmount
        );
      });

      it("Should emit RaffleCancelled event", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(raffleId)
        )
          .to.emit(raffleContract, "RaffleCancelled")
          .withArgs(raffleId);
      });

      it("Should change status to CANCELLED", async function () {
        const { raffleContract, accounts } = fixtures;

        // Check initial status
        let raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(0); // ACTIVE

        await raffleContract.connect(accounts.creator1).cancelRaffle(raffleId);

        // Check status changed
        raffle = await raffleContract.getRaffle(raffleId);
        expect(raffle.status).to.equal(2); // CANCELLED
      });

      it("Should return prize to creator", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        const balanceBefore = await mockERC20.balanceOf(
          accounts.creator1.address
        );

        await raffleContract.connect(accounts.creator1).cancelRaffle(raffleId);

        const balanceAfter = await mockERC20.balanceOf(
          accounts.creator1.address
        );

        expect(balanceAfter.sub(balanceBefore)).to.equal(params.prizeAmount);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert if not called by creator", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.buyer1).cancelRaffle(raffleId)
        ).to.be.revertedWith("Only creator can cancel");
      });

      it("Should revert if tickets already sold", async function () {
        const { raffleContract, accounts } = fixtures;

        // Buy some tickets first
        await buyTicketsForRaffle(
          raffleContract,
          raffleId,
          [accounts.buyer1],
          [1],
          true
        );

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(raffleId)
        ).to.be.revertedWith("Tickets already sold");
      });

      it("Should revert if raffle already drawn", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        // Create new raffle, buy tickets, and draw it
        const drawnRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        await buyTicketsForRaffle(
          raffleContract,
          drawnRaffleId,
          [accounts.buyer1],
          [1],
          true
        );

        // Wait for end time and draw
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;
        await ethers.provider.send("evm_increaseTime", [params.duration + 1]);
        await ethers.provider.send("evm_mine", []);

        await raffleContract
          .connect(accounts.buyer1)
          .drawRaffle(drawnRaffleId, { value: TEST_DATA.VRF_COST });

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(drawnRaffleId)
        ).to.be.revertedWith("Raffle not active");
      });

      it("Should revert if raffle already cancelled", async function () {
        const { raffleContract, accounts } = fixtures;

        // Cancel once
        await raffleContract.connect(accounts.creator1).cancelRaffle(raffleId);

        // Try to cancel again
        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(raffleId)
        ).to.be.revertedWith("Raffle not active");
      });

      it("Should revert for non-existent raffle", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.creator1).cancelRaffle(999)
        ).to.be.revertedWith("Only creator can cancel");
      });

      it("Should revert if someone else tries to cancel", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract.connect(accounts.creator2).cancelRaffle(raffleId)
        ).to.be.revertedWith("Only creator can cancel");

        await expect(
          raffleContract.connect(accounts.buyer1).cancelRaffle(raffleId)
        ).to.be.revertedWith("Only creator can cancel");

        await expect(
          raffleContract.connect(accounts.random).cancelRaffle(raffleId)
        ).to.be.revertedWith("Only creator can cancel");
      });
    });

    describe("Edge Cases", function () {
      it("Should handle cancellation immediately after creation", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        const newRaffleId = await createSampleRaffle(
          raffleContract,
          accounts.creator2,
          "ERC20",
          mockERC20
        );

        // Cancel immediately after creation
        await expect(
          raffleContract.connect(accounts.creator2).cancelRaffle(newRaffleId)
        ).to.emit(raffleContract, "RaffleCancelled");
      });

      it("Should handle multiple raffles cancellation by same creator", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;

        const raffle1 = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        const raffle2 = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        // Cancel both raffles
        await raffleContract.connect(accounts.creator1).cancelRaffle(raffle1);
        await raffleContract.connect(accounts.creator1).cancelRaffle(raffle2);

        // Check both are cancelled
        const raffleStatus1 = await raffleContract.getRaffle(raffle1);
        const raffleStatus2 = await raffleContract.getRaffle(raffle2);

        expect(raffleStatus1.status).to.equal(2); // CANCELLED
        expect(raffleStatus2.status).to.equal(2); // CANCELLED
      });

      it("Should handle cancellation with different prize types", async function () {
        const { raffleContract, mockERC20, mockERC721, mockERC1155, accounts } =
          fixtures;

        const erc20Raffle = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC20",
          mockERC20
        );

        const erc721Raffle = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC721",
          mockERC721
        );

        const erc1155Raffle = await createSampleRaffle(
          raffleContract,
          accounts.creator1,
          "ERC1155",
          mockERC1155
        );

        // Cancel all different types
        await raffleContract
          .connect(accounts.creator1)
          .cancelRaffle(erc20Raffle);
        await raffleContract
          .connect(accounts.creator1)
          .cancelRaffle(erc721Raffle);
        await raffleContract
          .connect(accounts.creator1)
          .cancelRaffle(erc1155Raffle);

        // All should be cancelled
        expect((await raffleContract.getRaffle(erc20Raffle)).status).to.equal(
          2
        );
        expect((await raffleContract.getRaffle(erc721Raffle)).status).to.equal(
          2
        );
        expect(
          (await raffleContract.getRaffle(erc1155Raffle)).status
        ).to.equal(2);
      });
    });
  });
});