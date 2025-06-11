import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixtures } from "../helpers/fixtures";

describe("NFT Whitelist Functionality", function () {
  let fixtures: any;

  beforeEach(async function () {
    fixtures = await loadFixtures();
  });

  describe("NFT Contract Whitelist Management", function () {
    describe("✅ Valid Scenarios", function () {
      it("Should allow owner to whitelist NFT contract", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;

        // Initially not whitelisted
        expect(
          await raffleContract.isNFTContractWhitelisted(mockERC721.address)
        ).to.be.false;

        // Whitelist the contract
        await expect(
          raffleContract
            .connect(accounts.owner)
            .setNFTContractWhitelist(mockERC721.address, true)
        )
          .to.emit(raffleContract, "NFTContractWhitelisted")
          .withArgs(mockERC721.address, true);

        // Should now be whitelisted
        expect(
          await raffleContract.isNFTContractWhitelisted(mockERC721.address)
        ).to.be.true;
      });

      it("Should allow owner to remove NFT from whitelist", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;

        // First whitelist
        await raffleContract
          .connect(accounts.owner)
          .setNFTContractWhitelist(mockERC721.address, true);
        expect(
          await raffleContract.isNFTContractWhitelisted(mockERC721.address)
        ).to.be.true;

        // Then remove from whitelist
        await expect(
          raffleContract
            .connect(accounts.owner)
            .setNFTContractWhitelist(mockERC721.address, false)
        )
          .to.emit(raffleContract, "NFTContractWhitelisted")
          .withArgs(mockERC721.address, false);

        expect(
          await raffleContract.isNFTContractWhitelisted(mockERC721.address)
        ).to.be.false;
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert when non-owner tries to whitelist", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;

        await expect(
          raffleContract
            .connect(accounts.creator1)
            .setNFTContractWhitelist(mockERC721.address, true)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should revert when trying to whitelist zero address", async function () {
        const { raffleContract, accounts } = fixtures;

        await expect(
          raffleContract
            .connect(accounts.owner)
            .setNFTContractWhitelist(ethers.constants.AddressZero, true)
        ).to.be.revertedWith("Invalid NFT contract address");
      });
    });
  });

  describe("Raffle Creation with NFT Whitelist", function () {
    describe("✅ Valid Scenarios", function () {
      it("Should create raffle with whitelisted NFT contract", async function () {
        const { raffleContract, mockERC20, mockERC721, accounts } = fixtures;

        // Whitelist the NFT contract
        await raffleContract
          .connect(accounts.owner)
          .setNFTContractWhitelist(mockERC721.address, true);

        // Approve prize
        await mockERC20
          .connect(accounts.creator1)
          .approve(raffleContract.address, ethers.utils.parseEther("100"));

        // Create raffle with NFT whitelist
        const tx = await raffleContract.connect(accounts.creator1).createRaffle(
          0, // ERC20
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("1"),
          10,
          100,
          5,
          86400,
          mockERC721.address // whitelistNftContract
        );

        await expect(tx)
          .to.emit(raffleContract, "RaffleCreated")
          .withArgs(
            1,
            accounts.creator1.address,
            mockERC20.address,
            ethers.utils.parseEther("100"),
            mockERC721.address
          );

        // Check raffle details
        const raffle = await raffleContract.getRaffle(1);
        expect(raffle.whitelistNftContract).to.equal(mockERC721.address);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert when trying to create raffle with non-whitelisted NFT", async function () {
        const { raffleContract, mockERC20, mockERC721, accounts } = fixtures;

        // Approve prize
        await mockERC20
          .connect(accounts.creator1)
          .approve(raffleContract.address, ethers.utils.parseEther("100"));

        // Try to create raffle with non-whitelisted NFT
        await expect(
          raffleContract.connect(accounts.creator1).createRaffle(
            0, // ERC20
            mockERC20.address,
            ethers.utils.parseEther("100"),
            0,
            ethers.constants.AddressZero,
            ethers.utils.parseEther("1"),
            10,
            100,
            5,
            86400,
            mockERC721.address // non-whitelisted NFT
          )
        ).to.be.revertedWith("NFT contract not whitelisted");
      });
    });
  });

  describe("Ticket Purchasing with NFT Requirements", function () {
    beforeEach(async function () {
      const { raffleContract, mockERC20, mockERC721, accounts } = fixtures;

      // Whitelist the NFT contract
      await raffleContract
        .connect(accounts.owner)
        .setNFTContractWhitelist(mockERC721.address, true);

      // Create a raffle that requires NFT ownership
      await mockERC20
        .connect(accounts.creator1)
        .approve(raffleContract.address, ethers.utils.parseEther("100"));
      await raffleContract.connect(accounts.creator1).createRaffle(
        0, // ERC20
        mockERC20.address,
        ethers.utils.parseEther("100"),
        0,
        ethers.constants.AddressZero,
        ethers.utils.parseEther("1"),
        10,
        100,
        5,
        86400,
        mockERC721.address // requires NFT ownership
      );
    });

    describe("✅ Valid Scenarios", function () {
      it("Should allow NFT owner to buy tickets", async function () {
        const { raffleContract, mockERC721, accounts } = fixtures;

        // Check the mint function signature of your mock ERC721
        // Option 1: If mint function takes only recipient address
        await mockERC721.mint(accounts.buyer1.address);
        
        // Option 2: If mint function takes recipient and tokenId (uncomment if needed)
        // await mockERC721.mint(accounts.buyer1.address, 1);

        // Verify NFT ownership before buying tickets
        const balance = await mockERC721.balanceOf(accounts.buyer1.address);
        expect(balance).to.be.gt(0);

        // Buy tickets
        await expect(
          raffleContract.connect(accounts.buyer1).buyTickets(1, 2, {
            value: ethers.utils.parseEther("2"),
          })
        )
          .to.emit(raffleContract, "TicketPurchased")
          .withArgs(1, accounts.buyer1.address, 2);

        // Check ticket count
        expect(
          await raffleContract.getUserTickets(1, accounts.buyer1.address)
        ).to.equal(2);
      });
    });

    describe("❌ Invalid Scenarios", function () {
      it("Should revert when non-NFT owner tries to buy tickets", async function () {
        const { raffleContract, accounts } = fixtures;

        // Deploy a fresh mock ERC721 contract for this test
        const MockERC721Factory = await ethers.getContractFactory("MockERC721Token");
        const freshMockERC721 = await MockERC721Factory.deploy();
        await freshMockERC721.deployed();

        // Whitelist the fresh mock NFT contract
        await raffleContract
          .connect(accounts.owner)
          .setNFTContractWhitelist(freshMockERC721.address, true);

        // Create a raffle with the fresh mock NFT requirement
        const { mockERC20 } = fixtures;
        await mockERC20
          .connect(accounts.creator1)
          .approve(raffleContract.address, ethers.utils.parseEther("100"));
        
        await raffleContract.connect(accounts.creator1).createRaffle(
          0, // ERC20
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("1"),
          10,
          100,
          5,
          86400,
          freshMockERC721.address // requires fresh NFT ownership
        );

        // Verify buyer2 doesn't own any NFTs from the fresh contract
        const balance = await freshMockERC721.balanceOf(accounts.buyer2.address);
        expect(balance).to.equal(0);

        // buyer2 doesn't own any NFTs - should revert
        await expect(
          raffleContract.connect(accounts.buyer2).buyTickets(2, 1, { // Use raffle ID 2
            value: ethers.utils.parseEther("1"),
          })
        ).to.be.revertedWith("Must own required NFT to participate");
      });
    });
  });

  describe("View Functions", function () {
    it("Should return correct NFT contract for raffle", async function () {
      const { raffleContract, mockERC20, mockERC721, accounts } = fixtures;

      // Whitelist NFT and create raffle
      await raffleContract
        .connect(accounts.owner)
        .setNFTContractWhitelist(mockERC721.address, true);
      await mockERC20
        .connect(accounts.creator1)
        .approve(raffleContract.address, ethers.utils.parseEther("100"));
      await raffleContract
        .connect(accounts.creator1)
        .createRaffle(
          0,
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("1"),
          10,
          100,
          5,
          86400,
          mockERC721.address
        );

      expect(await raffleContract.getRaffleWhitelistNftContract(1)).to.equal(
        mockERC721.address
      );
    });

    it("Should correctly check if user can participate", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      // Deploy a fresh mock ERC721 contract for this test
      const MockERC721Factory = await ethers.getContractFactory("MockERC721Token");
      const freshMockERC721 = await MockERC721Factory.deploy();
      await freshMockERC721.deployed();

      // Whitelist the fresh mock NFT contract
      await raffleContract
        .connect(accounts.owner)
        .setNFTContractWhitelist(freshMockERC721.address, true);

      // Create raffle with fresh mock NFT requirement
      await mockERC20
        .connect(accounts.creator1)
        .approve(raffleContract.address, ethers.utils.parseEther("100"));
      
      const tx = await raffleContract
        .connect(accounts.creator1)
        .createRaffle(
          0,
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("1"),
          10,
          100,
          5,
          86400,
          freshMockERC721.address
        );

      // Get the actual raffle ID from the event
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'RaffleCreated');
      const raffleId = event?.args?.[0];
      
      console.log("Created raffle with ID:", raffleId?.toString());

      // User without NFT cannot participate
      const balanceBefore = await freshMockERC721.balanceOf(accounts.buyer1.address);
      expect(balanceBefore).to.equal(0);
      
      expect(
        await raffleContract.canUserParticipate(raffleId, accounts.buyer1.address)
      ).to.be.false;

      // Mint NFT to user
      await freshMockERC721.mint(accounts.buyer1.address);
      
      // Verify the NFT was minted
      const balanceAfter = await freshMockERC721.balanceOf(accounts.buyer1.address);
      expect(balanceAfter).to.equal(1);

      // User with NFT can participate
      expect(
        await raffleContract.canUserParticipate(raffleId, accounts.buyer1.address)
      ).to.be.true;
    });

    it("Should allow anyone to participate in open raffle", async function () {
      const { raffleContract, mockERC20, accounts } = fixtures;

      // Create open raffle (no NFT requirement)
      await mockERC20
        .connect(accounts.creator1)
        .approve(raffleContract.address, ethers.utils.parseEther("100"));
      await raffleContract
        .connect(accounts.creator1)
        .createRaffle(
          0,
          mockERC20.address,
          ethers.utils.parseEther("100"),
          0,
          ethers.constants.AddressZero,
          ethers.utils.parseEther("1"),
          10,
          100,
          5,
          86400,
          ethers.constants.AddressZero // No NFT requirement
        );

      // Anyone can participate in open raffle
      expect(
        await raffleContract.canUserParticipate(1, accounts.buyer1.address)
      ).to.be.true;
      expect(
        await raffleContract.canUserParticipate(1, accounts.buyer2.address)
      ).to.be.true;
    });
  });
});