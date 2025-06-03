import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";
import { TEST_DATA, expectRevert } from "../helpers/testHelpers";

describe("RaffleCreation", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("Contract Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      const { raffleContract, mockVRF } = fixtures;

      expect(await raffleContract.nativeVRF()).to.equal(mockVRF.address);
      expect(await raffleContract.raffleCounter()).to.equal(0);
      expect(await raffleContract.feePercentage()).to.equal(
        TEST_DATA.DEFAULT_FEE
      );
    });

    it("Should set owner correctly", async function () {
      const { raffleContract, accounts } = fixtures;

      expect(await raffleContract.owner()).to.equal(accounts.owner.address);
    });

    it("Should set nativeVRF address correctly", async function () {
      const { raffleContract, mockVRF } = fixtures;

      expect(await raffleContract.nativeVRF()).to.equal(mockVRF.address);
    });

    it("Should have raffleCounter = 0", async function () {
      const { raffleContract } = fixtures;

      expect(await raffleContract.raffleCounter()).to.equal(0);
    });

    it("Should have feePercentage = 7", async function () {
      const { raffleContract } = fixtures;

      expect(await raffleContract.feePercentage()).to.equal(7);
    });

    it("Should allow zero address for nativeVRF (no validation in constructor)", async function () {
      const RaffleOnape = await ethers.getContractFactory("RaffleOnape");

      const raffleContract = await RaffleOnape.deploy(
        ethers.constants.AddressZero
      );
      await raffleContract.deployed();

      expect(await raffleContract.nativeVRF()).to.equal(
        ethers.constants.AddressZero
      );
    });
  });

  describe("createRaffle()", function () {
    describe("✅ Valid Scenarios", function () {
      it("Should create ERC20 raffle successfully", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        const tx = await raffleContract
          .connect(accounts.creator1)
          .createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          );

        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "RaffleCreated"
        );

        expect(event).to.not.be.undefined;
        expect(event?.args?.raffleId).to.equal(1);
        expect(event?.args?.creator).to.equal(accounts.creator1.address);
        expect(event?.args?.prizeContract).to.equal(mockERC20.address);
        expect(event?.args?.prizeAmount).to.equal(params.prizeAmount);

        // Check raffle counter incremented
        expect(await raffleContract.raffleCounter()).to.equal(1);

        // Check raffle details
        const raffle = await raffleContract.getRaffle(1);
        expect(raffle.creator).to.equal(accounts.creator1.address);
        expect(raffle.prizeContract).to.equal(mockERC20.address);
        expect(raffle.prizeAmount).to.equal(params.prizeAmount);
        expect(raffle.ticketPrice).to.equal(params.ticketPrice);
        expect(raffle.maxTicketsPerUser).to.equal(params.maxTicketsPerUser);
        expect(raffle.totalMaxTickets).to.equal(params.totalMaxTickets);
        expect(raffle.currentTickets).to.equal(0);
        expect(raffle.prizeType).to.equal(params.prizeType);
        expect(raffle.status).to.equal(0); // ACTIVE
      });

      it("Should create ERC721 raffle successfully", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC721;

        const tx = await raffleContract
          .connect(accounts.creator1)
          .createRaffle(
            params.prizeType,
            mockERC721.address,
            0,
            (params as any).prizeTokenId,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          );

        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "RaffleCreated"
        );

        expect(event).to.not.be.undefined;
        expect(event?.args?.raffleId).to.equal(1);

        const raffle = await raffleContract.getRaffle(1);
        expect(raffle.prizeType).to.equal(params.prizeType);
        expect(raffle.prizeTokenId).to.equal((params as any).prizeTokenId);
      });

      it("Should create ERC1155 raffle successfully", async function () {
        const { raffleContract, mockERC1155, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC1155;

        const tx = await raffleContract
          .connect(accounts.creator1)
          .createRaffle(
            params.prizeType,
            mockERC1155.address,
            (params as any).prizeAmount,
            (params as any).prizeTokenId,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          );

        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "RaffleCreated"
        );

        expect(event).to.not.be.undefined;
        expect(event?.args?.raffleId).to.equal(1);

        const raffle = await raffleContract.getRaffle(1);
        expect(raffle.prizeType).to.equal(params.prizeType);
        expect(raffle.prizeTokenId).to.equal((params as any).prizeTokenId);
        expect(raffle.prizeAmount).to.equal((params as any).prizeAmount);
      });

      it("Should increment raffleCounter correctly", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        expect(await raffleContract.raffleCounter()).to.equal(0);

        await raffleContract
          .connect(accounts.creator1)
          .createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          );

        expect(await raffleContract.raffleCounter()).to.equal(1);

        await raffleContract
          .connect(accounts.creator2)
          .createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          );

        expect(await raffleContract.raffleCounter()).to.equal(2);
      });

      it("Should emit RaffleCreated event", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await expect(
          raffleContract
            .connect(accounts.creator1)
            .createRaffle(
              params.prizeType,
              mockERC20.address,
              params.prizeAmount,
              0,
              ethers.constants.AddressZero,
              params.ticketPrice,
              params.maxTicketsPerUser,
              params.totalMaxTickets,
              0,
              params.duration
            )
        )
          .to.emit(raffleContract, "RaffleCreated")
          .withArgs(
            1,
            accounts.creator1.address,
            mockERC20.address,
            params.prizeAmount
          );
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert with ticketPrice = 0", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            0, // Invalid ticket price
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          )
        ).to.be.revertedWith("Invalid ticket price");
      });

      it("Should revert with duration = 0", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            0,
            0 // Invalid duration
          )
        ).to.be.revertedWith("Invalid duration");
      });

      it("Should revert with maxTicketsPerUser = 0", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            params.prizeType,
            mockERC20.address,
            params.prizeAmount,
            0,
            ethers.constants.AddressZero,
            params.ticketPrice,
            0, // Invalid max tickets per user
            params.totalMaxTickets,
            1,
            params.duration
          )
        ).to.be.revertedWith("Invalid max tickets per user");
      });

      it("Should revert if insufficient ERC20 allowance for prize", async function () {
        const { raffleContract, mockERC20, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC20;

        // Remove allowance
        await mockERC20
          .connect(accounts.creator1)
          .approve(raffleContract.address, 0);

        await expect(
          raffleContract
            .connect(accounts.creator1)
            .createRaffle(
              params.prizeType,
              mockERC20.address,
              params.prizeAmount,
              0,
              ethers.constants.AddressZero,
              params.ticketPrice,
              params.maxTicketsPerUser,
              params.totalMaxTickets,
              0,
              params.duration
            )
        ).to.be.reverted;
      });

      it("Should revert if not owner of ERC721 token", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC721;

        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            params.prizeType,
            mockERC721.address,
            0,
            999, // Non-existent token ID
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          )
        ).to.be.reverted;
      });

      it("Should revert if insufficient ERC1155 balance", async function () {
        const { raffleContract, mockERC1155, accounts } = fixtures;
        const params = TEST_DATA.RAFFLE_PARAMS.ERC1155;

        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            params.prizeType,
            mockERC1155.address,
            ethers.utils.parseEther("1000"), // More than available
            (params as any).prizeTokenId,
            ethers.constants.AddressZero,
            params.ticketPrice,
            params.maxTicketsPerUser,
            params.totalMaxTickets,
            1,
            params.duration
          )
        ).to.be.reverted;
      });
    });
  });
});
