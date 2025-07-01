import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Gacha Contract", function () {
  let gacha: Contract;
  let mockVRF: Contract;
  let otherShards: Contract;
  let otherRelics: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const SEED = 12345;
  const VRF_COST = ethers.utils.parseEther("0.001");

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockNativeVRF
    const MockNativeVRF = await ethers.getContractFactory("MockNativeVRF");
    mockVRF = await MockNativeVRF.deploy(SEED);
    await mockVRF.deployed();

    // Deploy MockERC1155Token (OtherShards)
    const MockERC1155 = await ethers.getContractFactory("MockERC1155Token");
    otherShards = await MockERC1155.deploy();
    await otherShards.deployed();

    // Deploy MockOtherRelics
    const MockOtherRelics = await ethers.getContractFactory("MockOtherRelics");
    otherRelics = await MockOtherRelics.deploy();
    await otherRelics.deployed();

    // Deploy Gacha contract
    const Gacha = await ethers.getContractFactory("Gacha");
    gacha = await Gacha.deploy(
      mockVRF.address,
      otherShards.address,
      otherRelics.address
    );
    await gacha.deployed();

    // Initialize the contract
    await gacha.initialize();

    // Setup permissions
    await mockVRF.whitelistAddress(gacha.address);
    await otherRelics.addMinter(gacha.address);

    // Mint shards to users for testing
    await otherShards.mint(user1.address, 1, 100, "0x"); // 100 of token ID 1
    await otherShards.mint(user1.address, 2, 50, "0x"); // 50 of token ID 2
    await otherShards.mint(user1.address, 3, 25, "0x"); // 25 of token ID 3
    await otherShards.mint(user1.address, 4, 10, "0x"); // 10 of token ID 4

    await otherShards.mint(user2.address, 1, 50, "0x");
    await otherShards.mint(user2.address, 2, 25, "0x");

    // Approve Gacha contract to spend shards
    await otherShards.connect(user1).setApprovalForAll(gacha.address, true);
    await otherShards.connect(user2).setApprovalForAll(gacha.address, true);
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial configuration", async function () {
      expect(await gacha.nativeVRF()).to.equal(mockVRF.address);
      expect(await gacha.otherShards()).to.equal(otherShards.address);
      expect(await gacha.otherRelics()).to.equal(otherRelics.address);
      expect(await gacha.owner()).to.equal(owner.address);
    });

    it("Should initialize rarity configurations correctly", async function () {
      // Check Common rarity config (enum value 0)
      const commonConfig = await gacha.rarityConfigs(0);
      expect(commonConfig.startTokenId).to.equal(1);
      expect(commonConfig.endTokenId).to.equal(100);
      expect(commonConfig.availableCount).to.equal(28);
      expect(commonConfig.totalCount).to.equal(28);

      // Check Eternal rarity config (enum value 6)
      const eternalConfig = await gacha.rarityConfigs(6);
      expect(eternalConfig.startTokenId).to.equal(601);
      expect(eternalConfig.endTokenId).to.equal(700);
      expect(eternalConfig.availableCount).to.equal(13);
      expect(eternalConfig.totalCount).to.equal(13);
    });

    it("Should initialize probabilities correctly", async function () {
      // Check TokenID 1 probabilities
      expect(await gacha.rarityProbabilities(1, 0)).to.equal(6900); // Common: 69%
      expect(await gacha.rarityProbabilities(1, 1)).to.equal(2500); // Uncommon: 25%
      expect(await gacha.rarityProbabilities(1, 2)).to.equal(500); // Rare: 5%
      expect(await gacha.rarityProbabilities(1, 3)).to.equal(100); // Epic: 1%

      // Check TokenID 4 probabilities
      expect(await gacha.rarityProbabilities(4, 0)).to.equal(0); // Common: 0%
      expect(await gacha.rarityProbabilities(4, 3)).to.equal(4900); // Epic: 49%
      expect(await gacha.rarityProbabilities(4, 6)).to.equal(100); // Eternal: 1%
    });

    it("Should initialize next token IDs correctly", async function () {
      expect(await gacha.nextTokenIdInRarity(0)).to.equal(1); // Common
      expect(await gacha.nextTokenIdInRarity(1)).to.equal(101); // Uncommon
      expect(await gacha.nextTokenIdInRarity(6)).to.equal(601); // Eternal
    });
  });

  describe("Single Burn Functionality", function () {
    it("Should burn shard and request VRF successfully", async function () {
      const initialBalance = await otherShards.balanceOf(user1.address, 1);

      await expect(gacha.connect(user1).burnForRelic(1, { value: VRF_COST }))
        .to.emit(gacha, "GachaRequested")
        .to.emit(mockVRF, "RandomRequested");

      // Check shard was burned
      const finalBalance = await otherShards.balanceOf(user1.address, 1);
      expect(finalBalance).to.equal(initialBalance.sub(1));

      // Check VRF request was made
      expect(await mockVRF.currentRequestId()).to.equal(2); // starts at 1, after request = 2
    });

    it("Should revert if user has insufficient shard balance", async function () {
      await expect(
        gacha.connect(user3).burnForRelic(1, { value: VRF_COST })
      ).to.be.revertedWith("Insufficient shard balance");
    });

    it("Should revert for invalid shard token ID", async function () {
      await expect(
        gacha.connect(user1).burnForRelic(0, { value: VRF_COST })
      ).to.be.revertedWith("Invalid shard token ID");

      await expect(
        gacha.connect(user1).burnForRelic(5, { value: VRF_COST })
      ).to.be.revertedWith("Invalid shard token ID");
    });

    it("Should revert when contract is paused", async function () {
      await gacha.pause();

      await expect(
        gacha.connect(user1).burnForRelic(1, { value: VRF_COST })
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Batch Burn Functionality", function () {
    it("Should burn multiple shards with single VRF request", async function () {
      const quantity = 5;
      const initialBalance = await otherShards.balanceOf(user1.address, 1);

      await expect(
        gacha.connect(user1).burnForRelicBatch(1, quantity, { value: VRF_COST })
      )
        .to.emit(gacha, "GachaRequested")
        .to.emit(mockVRF, "RandomRequested");

      // Check shards were burned
      const finalBalance = await otherShards.balanceOf(user1.address, 1);
      expect(finalBalance).to.equal(initialBalance.sub(quantity));

      // Check only one VRF request was made
      expect(await mockVRF.currentRequestId()).to.equal(2);
    });

    it("Should revert for invalid batch quantity", async function () {
      await expect(
        gacha.connect(user1).burnForRelicBatch(1, 0, { value: VRF_COST })
      ).to.be.revertedWith("Invalid quantity (1-100)");

      await expect(
        gacha.connect(user1).burnForRelicBatch(1, 101, { value: VRF_COST })
      ).to.be.revertedWith("Invalid quantity (1-100)");
    });

    it("Should revert if insufficient balance for batch", async function () {
      // User1 has 100 tokens of ID 1, so trying to burn 101 should fail
      // But first the validation checks quantity, so we need to use a valid quantity
      // that exceeds balance
      await expect(
        gacha.connect(user1).burnForRelicBatch(1, 100, { value: VRF_COST })
      ).to.not.be.reverted; // This should succeed

      // Now try with user3 who has no tokens
      await expect(
        gacha.connect(user3).burnForRelicBatch(1, 1, { value: VRF_COST })
      ).to.be.revertedWith("Insufficient shard balance");
    });
  });

  describe("Gacha Fulfillment", function () {
    let vrfRequestId: BigNumber;

    beforeEach(async function () {
      // Make a gacha request
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      vrfRequestId = event?.args?.vrfRequestId;
    });

    it("Should fulfill single gacha request successfully", async function () {
      // Mock VRF fulfillment
      const randomNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32));
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      const initialRelicBalance = await otherRelics.balanceOf(user1.address);

      await expect(gacha.fulfillGacha(vrfRequestId))
        .to.emit(gacha, "GachaFulfilled")
        .to.emit(otherRelics, "TokenMinted");

      // Check relic was minted
      const finalRelicBalance = await otherRelics.balanceOf(user1.address);
      expect(finalRelicBalance).to.equal(initialRelicBalance.add(1));

      // Check request is marked as fulfilled
      const request = await gacha.getGachaRequest(vrfRequestId);
      expect(request.fulfilled).to.equal(true);
      expect(request.resultTokenIds.length).to.equal(1);
    });

    it("Should fulfill batch gacha request successfully", async function () {
      // Make a batch request
      const quantity = 3;
      const tx = await gacha
        .connect(user1)
        .burnForRelicBatch(2, quantity, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const batchVrfRequestId = event?.args?.vrfRequestId;

      // Mock VRF fulfillment
      const randomNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32));
      await mockVRF.fulfillRandomness(batchVrfRequestId, randomNumber);

      const initialRelicBalance = await otherRelics.balanceOf(user1.address);

      await expect(gacha.fulfillGacha(batchVrfRequestId)).to.emit(
        gacha,
        "GachaFulfilled"
      );

      // Check relics were minted
      const finalRelicBalance = await otherRelics.balanceOf(user1.address);
      expect(finalRelicBalance).to.equal(initialRelicBalance.add(quantity));

      // Check request details
      const request = await gacha.getGachaRequest(batchVrfRequestId);
      expect(request.fulfilled).to.equal(true);
      expect(request.resultTokenIds.length).to.equal(quantity);
      expect(request.resultRarities.length).to.equal(quantity);
    });

    it("Should revert if VRF not fulfilled yet", async function () {
      await expect(gacha.fulfillGacha(vrfRequestId)).to.be.revertedWith(
        "VRF not fulfilled yet"
      );
    });

    it("Should revert if request already fulfilled", async function () {
      // Mock VRF fulfillment and fulfill
      const randomNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32));
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);
      await gacha.fulfillGacha(vrfRequestId);

      // Try to fulfill again
      await expect(gacha.fulfillGacha(vrfRequestId)).to.be.revertedWith(
        "Request already fulfilled"
      );
    });

    it("Should revert for invalid request ID", async function () {
      const invalidRequestId = 999;
      await expect(gacha.fulfillGacha(invalidRequestId)).to.be.revertedWith(
        "Invalid request ID"
      );
    });
  });

  describe("Probability Management", function () {
    it("Should allow owner to update single probability", async function () {
      await expect(gacha.updateProbability(1, 0, 7000)) // Update Common for tokenID 1 to 70%
        .to.emit(gacha, "ProbabilityUpdated")
        .withArgs(1, 0, 7000);

      expect(await gacha.rarityProbabilities(1, 0)).to.equal(7000);
    });

    it("Should allow owner to update all probabilities for one token ID", async function () {
      const newProbs = [7000, 2000, 800, 200, 0, 0, 0]; // Must sum to 10000

      await gacha.updateAllProbabilities(1, newProbs);

      expect(await gacha.rarityProbabilities(1, 0)).to.equal(7000); // Common
      expect(await gacha.rarityProbabilities(1, 1)).to.equal(2000); // Uncommon
      expect(await gacha.rarityProbabilities(1, 2)).to.equal(800); // Rare
      expect(await gacha.rarityProbabilities(1, 3)).to.equal(200); // Epic
    });

    it("Should allow batch update of probabilities", async function () {
      const tokenIds = [1, 2];
      const allProbs = [
        [7000, 2000, 800, 200, 0, 0, 0], // TokenID 1
        [1000, 5000, 3000, 800, 200, 0, 0], // TokenID 2
      ];

      await gacha.batchUpdateProbabilities(tokenIds, allProbs);

      expect(await gacha.rarityProbabilities(1, 0)).to.equal(7000);
      expect(await gacha.rarityProbabilities(2, 1)).to.equal(5000);
    });

    it("Should revert if non-owner tries to update probabilities", async function () {
      await expect(
        gacha.connect(user1).updateProbability(1, 0, 7000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert if probability exceeds 100%", async function () {
      await expect(gacha.updateProbability(1, 0, 10001)).to.be.revertedWith(
        "Probability exceeds 100%"
      );
    });

    it("Should revert if total probabilities don't equal 100%", async function () {
      const invalidProbs = [5000, 2000, 800, 200, 0, 0, 0]; // Sum = 8000, not 10000

      await expect(
        gacha.updateAllProbabilities(1, invalidProbs)
      ).to.be.revertedWith("Total probabilities must equal 100%");
    });

    it("Should revert for invalid shard token ID", async function () {
      await expect(gacha.updateProbability(0, 0, 5000)).to.be.revertedWith(
        "Invalid shard token ID"
      );

      await expect(gacha.updateProbability(5, 0, 5000)).to.be.revertedWith(
        "Invalid shard token ID"
      );
    });
  });

  describe("Rarity Configuration Management", function () {
    it("Should allow owner to update rarity configuration", async function () {
      await expect(
        gacha.updateRarityConfig(0, 1, 50, 15) // Common: tokens 1-50, 15 available
      )
        .to.emit(gacha, "RarityConfigUpdated")
        .withArgs(0, 1, 50, 15);

      const config = await gacha.rarityConfigs(0);
      expect(config.startTokenId).to.equal(1);
      expect(config.endTokenId).to.equal(50);
      expect(config.availableCount).to.equal(15);
      expect(config.totalCount).to.equal(15);
    });

    it("Should revert if non-owner tries to update rarity config", async function () {
      await expect(
        gacha.connect(user1).updateRarityConfig(0, 1, 50, 15)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert for invalid token ID range", async function () {
      await expect(
        gacha.updateRarityConfig(0, 100, 50, 15) // start > end
      ).to.be.revertedWith("Invalid token ID range");
    });

    it("Should revert if available count exceeds range", async function () {
      await expect(
        gacha.updateRarityConfig(0, 1, 10, 15) // 15 available in range of 10
      ).to.be.revertedWith("Available count exceeds range");
    });
  });

  describe("Contract Administration", function () {
    it("Should allow owner to pause and unpause", async function () {
      await gacha.pause();
      expect(await gacha.paused()).to.equal(true);

      await gacha.unpause();
      expect(await gacha.paused()).to.equal(false);
    });

    it("Should allow owner to update contract addresses", async function () {
      const MockERC1155 = await ethers.getContractFactory("MockERC1155Token");
      const newShards = await MockERC1155.deploy();
      await newShards.deployed();

      await gacha.updateContracts(
        ethers.constants.AddressZero,
        newShards.address,
        ethers.constants.AddressZero
      );
      expect(await gacha.otherShards()).to.equal(newShards.address);
    });

    it("Should allow owner to emergency withdraw ETH", async function () {
      // Send some ETH to contract
      await user1.sendTransaction({
        to: gacha.address,
        value: ethers.utils.parseEther("1"),
      });

      const initialBalance = await ethers.provider.getBalance(owner.address);
      await gacha.emergencyWithdraw();
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should revert if non-owner tries admin functions", async function () {
      await expect(gacha.connect(user1).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(gacha.connect(user1).emergencyWithdraw()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("View Functions", function () {
    it("Should return correct gacha request details", async function () {
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      const request = await gacha.getGachaRequest(vrfRequestId);
      expect(request.user).to.equal(user1.address);
      expect(request.shardTokenId).to.equal(1);
      expect(request.quantity).to.equal(1);
      expect(request.fulfilled).to.equal(false);
    });

    it("Should return correct rarity configurations", async function () {
      const commonConfig = await gacha.getRarityConfig(0);
      expect(commonConfig.startTokenId).to.equal(1);
      expect(commonConfig.availableCount).to.equal(28);
    });

    it("Should return correct probability for shard token ID and rarity", async function () {
      expect(await gacha.getProbability(1, 0)).to.equal(6900); // Common for tokenID 1
    });

    it("Should return all probabilities for a shard token ID", async function () {
      const allProbs = await gacha.getAllProbabilities(1);
      expect(allProbs[0]).to.equal(6900); // Common
      expect(allProbs[1]).to.equal(2500); // Uncommon
      expect(allProbs[2]).to.equal(500); // Rare
    });

    it("Should check VRF fulfillment capability", async function () {
      expect(await gacha.canFulfillVRF()).to.equal(true);

      // Remove whitelist and check again
      await mockVRF.delistAddress(gacha.address);
      expect(await gacha.canFulfillVRF()).to.equal(false);
    });
  });

  describe("Error Cases and Edge Scenarios", function () {
    it("Should handle case when rarity has no available tokens", async function () {
      // Reduce available count for all rarities to 0 except one
      await gacha.updateRarityConfig(0, 1, 100, 0); // Common: 0 available
      await gacha.updateRarityConfig(1, 101, 200, 0); // Uncommon: 0 available
      await gacha.updateRarityConfig(2, 201, 300, 1); // Rare: 1 available
      await gacha.updateRarityConfig(3, 301, 400, 0); // Epic: 0 available
      await gacha.updateRarityConfig(4, 401, 500, 0); // Legendary: 0 available
      await gacha.updateRarityConfig(5, 501, 600, 0); // Mythic: 0 available
      await gacha.updateRarityConfig(6, 601, 700, 0); // Eternal: 0 available

      // Make request
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      // Fulfill VRF
      const randomNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32));
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      // Should mint the only available rarity (Rare)
      await gacha.fulfillGacha(vrfRequestId);

      const request = await gacha.getGachaRequest(vrfRequestId);
      expect(request.fulfilled).to.equal(true);
    });

    it("Should revert when no tokens are available for any rarity", async function () {
      // Set all rarities to 0 available
      for (let i = 0; i < 7; i++) {
        await gacha.updateRarityConfig(i, 1, 100, 0);
      }

      // Make request
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      // Fulfill VRF
      const randomNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32));
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      // Should revert
      await expect(gacha.fulfillGacha(vrfRequestId)).to.be.revertedWith(
        "No available tokens for any rarity"
      );
    });

    it("Should handle contract not whitelisted for VRF", async function () {
      await mockVRF.delistAddress(gacha.address);

      await expect(
        gacha.connect(user1).burnForRelic(1, { value: VRF_COST })
      ).to.be.revertedWith("Contract not whitelisted for VRF");
    });

    it("Should reject zero address in constructor", async function () {
      const Gacha = await ethers.getContractFactory("Gacha");

      await expect(
        Gacha.deploy(
          ethers.constants.AddressZero,
          otherShards.address,
          otherRelics.address
        )
      ).to.be.revertedWith("Invalid VRF address");

      await expect(
        Gacha.deploy(
          mockVRF.address,
          ethers.constants.AddressZero,
          otherRelics.address
        )
      ).to.be.revertedWith("Invalid OtherShards address");

      await expect(
        Gacha.deploy(
          mockVRF.address,
          otherShards.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Invalid OtherRelics address");
    });
  });
});
