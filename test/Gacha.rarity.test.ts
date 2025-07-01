import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Gacha Contract - Rarity Distribution Tests", function () {
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

  // Rarity enum mapping
  enum Rarity {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
    Epic = 3,
    Legendary = 4,
    Mythic = 5,
    Eternal = 6,
  }

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    // Get additional users for multi-user testing
    const signers = await ethers.getSigners();
    user2 = signers[2];
    user3 = signers[3];

    // Deploy MockNativeVRF
    const MockNativeVRF = await ethers.getContractFactory("MockNativeVRF");
    mockVRF = await MockNativeVRF.deploy(SEED);

    // Deploy MockERC1155Token (OtherShards)
    const MockERC1155 = await ethers.getContractFactory("MockERC1155Token");
    otherShards = await MockERC1155.deploy();

    // Deploy MockOtherRelics
    const MockOtherRelics = await ethers.getContractFactory("MockOtherRelics");
    otherRelics = await MockOtherRelics.deploy();

    // Deploy Gacha contract
    const Gacha = await ethers.getContractFactory("Gacha");
    gacha = await Gacha.deploy(
      mockVRF.address,
      otherShards.address,
      otherRelics.address
    );

    // Initialize the contract
    await gacha.initialize();

    // Setup permissions
    await mockVRF.whitelistAddress(gacha.address);
    await otherRelics.addMinter(gacha.address);

    // Mint large quantities of shards for distribution testing to multiple users
    const users = [user1, user2, user3];
    for (const user of users) {
      await otherShards.mint(user.address, 1, 200, "0x"); // 200 of token ID 1
      await otherShards.mint(user.address, 2, 200, "0x"); // 200 of token ID 2
      await otherShards.mint(user.address, 3, 200, "0x"); // 200 of token ID 3
      await otherShards.mint(user.address, 4, 200, "0x"); // 200 of token ID 4

      // Approve Gacha contract to spend shards
      await otherShards.connect(user).setApprovalForAll(gacha.address, true);
    }
  });

  describe("Probability Configuration Verification", function () {
    it("Should have correct TokenID 1 probability distribution", async function () {
      const probabilities = await gacha.getAllProbabilities(1);

      expect(probabilities[Rarity.Common]).to.equal(6900); // 69%
      expect(probabilities[Rarity.Uncommon]).to.equal(2500); // 25%
      expect(probabilities[Rarity.Rare]).to.equal(500); // 5%
      expect(probabilities[Rarity.Epic]).to.equal(100); // 1%
      expect(probabilities[Rarity.Legendary]).to.equal(0); // 0%
      expect(probabilities[Rarity.Mythic]).to.equal(0); // 0%
      expect(probabilities[Rarity.Eternal]).to.equal(0); // 0%

      // Verify total equals 100%
      const total = probabilities.reduce(
        (sum, prob) => sum + prob.toNumber(),
        0
      );
      expect(total).to.equal(10000);
    });

    it("Should have correct TokenID 2 probability distribution", async function () {
      const probabilities = await gacha.getAllProbabilities(2);

      expect(probabilities[Rarity.Common]).to.equal(2000); // 20%
      expect(probabilities[Rarity.Uncommon]).to.equal(4900); // 49%
      expect(probabilities[Rarity.Rare]).to.equal(2500); // 25%
      expect(probabilities[Rarity.Epic]).to.equal(500); // 5%
      expect(probabilities[Rarity.Legendary]).to.equal(100); // 1%
      expect(probabilities[Rarity.Mythic]).to.equal(0); // 0%
      expect(probabilities[Rarity.Eternal]).to.equal(0); // 0%

      const total = probabilities.reduce(
        (sum, prob) => sum + prob.toNumber(),
        0
      );
      expect(total).to.equal(10000);
    });

    it("Should have correct TokenID 3 probability distribution", async function () {
      const probabilities = await gacha.getAllProbabilities(3);

      expect(probabilities[Rarity.Common]).to.equal(0); // 0%
      expect(probabilities[Rarity.Uncommon]).to.equal(2000); // 20%
      expect(probabilities[Rarity.Rare]).to.equal(4900); // 49%
      expect(probabilities[Rarity.Epic]).to.equal(2500); // 25%
      expect(probabilities[Rarity.Legendary]).to.equal(500); // 5%
      expect(probabilities[Rarity.Mythic]).to.equal(100); // 1%
      expect(probabilities[Rarity.Eternal]).to.equal(0); // 0%

      const total = probabilities.reduce(
        (sum, prob) => sum + prob.toNumber(),
        0
      );
      expect(total).to.equal(10000);
    });

    it("Should have correct TokenID 4 probability distribution", async function () {
      const probabilities = await gacha.getAllProbabilities(4);

      expect(probabilities[Rarity.Common]).to.equal(0); // 0%
      expect(probabilities[Rarity.Uncommon]).to.equal(0); // 0%
      expect(probabilities[Rarity.Rare]).to.equal(2000); // 20%
      expect(probabilities[Rarity.Epic]).to.equal(4900); // 49%
      expect(probabilities[Rarity.Legendary]).to.equal(2500); // 25%
      expect(probabilities[Rarity.Mythic]).to.equal(500); // 5%
      expect(probabilities[Rarity.Eternal]).to.equal(100); // 1%

      const total = probabilities.reduce(
        (sum, prob) => sum + prob.toNumber(),
        0
      );
      expect(total).to.equal(10000);
    });
  });

  describe("Rarity Range Configuration", function () {
    it("Should have correct token ID ranges for each rarity", async function () {
      const rarityConfigs = [];
      for (let i = 0; i < 7; i++) {
        rarityConfigs.push(await gacha.rarityConfigs(i));
      }

      // Common: tokens 1-100, 28 available
      expect(rarityConfigs[Rarity.Common].startTokenId).to.equal(1);
      expect(rarityConfigs[Rarity.Common].endTokenId).to.equal(100);
      expect(rarityConfigs[Rarity.Common].availableCount).to.equal(28);

      // Uncommon: tokens 101-200, 22 available
      expect(rarityConfigs[Rarity.Uncommon].startTokenId).to.equal(101);
      expect(rarityConfigs[Rarity.Uncommon].endTokenId).to.equal(200);
      expect(rarityConfigs[Rarity.Uncommon].availableCount).to.equal(22);

      // Rare: tokens 201-300, 22 available
      expect(rarityConfigs[Rarity.Rare].startTokenId).to.equal(201);
      expect(rarityConfigs[Rarity.Rare].endTokenId).to.equal(300);
      expect(rarityConfigs[Rarity.Rare].availableCount).to.equal(22);

      // Epic: tokens 301-400, 20 available
      expect(rarityConfigs[Rarity.Epic].startTokenId).to.equal(301);
      expect(rarityConfigs[Rarity.Epic].endTokenId).to.equal(400);
      expect(rarityConfigs[Rarity.Epic].availableCount).to.equal(20);

      // Legendary: tokens 401-500, 18 available
      expect(rarityConfigs[Rarity.Legendary].startTokenId).to.equal(401);
      expect(rarityConfigs[Rarity.Legendary].endTokenId).to.equal(500);
      expect(rarityConfigs[Rarity.Legendary].availableCount).to.equal(18);

      // Mythic: tokens 501-600, 16 available
      expect(rarityConfigs[Rarity.Mythic].startTokenId).to.equal(501);
      expect(rarityConfigs[Rarity.Mythic].endTokenId).to.equal(600);
      expect(rarityConfigs[Rarity.Mythic].availableCount).to.equal(16);

      // Eternal: tokens 601-700, 13 available
      expect(rarityConfigs[Rarity.Eternal].startTokenId).to.equal(601);
      expect(rarityConfigs[Rarity.Eternal].endTokenId).to.equal(700);
      expect(rarityConfigs[Rarity.Eternal].availableCount).to.equal(13);
    });
  });

  describe("Single Gacha Rarity Testing", function () {
    async function performSingleGacha(
      shardTokenId: number,
      expectedRandom: number
    ): Promise<Rarity> {
      // Burn shard and get VRF request
      const tx = await gacha
        .connect(user1)
        .burnForRelic(shardTokenId, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      // Mock VRF fulfillment with specific random number
      await mockVRF.fulfillRandomness(vrfRequestId, expectedRandom);

      // Fulfill gacha
      await gacha.fulfillGacha(vrfRequestId);

      // Get result
      const request = await gacha.getGachaRequest(vrfRequestId);
      return request.resultRarities[0];
    }

    it("Should produce valid rarities for TokenID 1", async function () {
      // Test multiple random values for TokenID 1
      const testCases = [100, 1000, 5000, 9000, 9999];

      for (const randomNum of testCases) {
        const resultRarity = await performSingleGacha(1, randomNum);
        // TokenID 1 should only produce Common, Uncommon, Rare, Epic (probabilities > 0)
        expect(resultRarity).to.be.oneOf([
          Rarity.Common,
          Rarity.Uncommon,
          Rarity.Rare,
          Rarity.Epic,
        ]);
        expect(resultRarity).to.not.be.oneOf([
          Rarity.Legendary,
          Rarity.Mythic,
          Rarity.Eternal,
        ]);
      }
    });

    it("Should produce valid rarities for TokenID 2", async function () {
      // Test multiple random values for TokenID 2
      const testCases = [100, 1000, 5000, 9000, 9999];

      for (const randomNum of testCases) {
        const resultRarity = await performSingleGacha(2, randomNum);
        // TokenID 2 should only produce Common, Uncommon, Rare, Epic, Legendary (probabilities > 0)
        expect(resultRarity).to.be.oneOf([
          Rarity.Common,
          Rarity.Uncommon,
          Rarity.Rare,
          Rarity.Epic,
          Rarity.Legendary,
        ]);
        expect(resultRarity).to.not.be.oneOf([Rarity.Mythic, Rarity.Eternal]);
      }
    });

    it("Should produce valid rarities for TokenID 3", async function () {
      // Test multiple random values for TokenID 3
      const testCases = [100, 1000, 5000, 9000, 9999];

      for (const randomNum of testCases) {
        const resultRarity = await performSingleGacha(3, randomNum);
        // TokenID 3 should not produce Common or Eternal (probabilities = 0)
        expect(resultRarity).to.not.be.oneOf([Rarity.Common, Rarity.Eternal]);
        expect(resultRarity).to.be.oneOf([
          Rarity.Uncommon,
          Rarity.Rare,
          Rarity.Epic,
          Rarity.Legendary,
          Rarity.Mythic,
        ]);
      }
    });

    it("Should produce valid rarities for TokenID 4", async function () {
      // Test multiple random values for TokenID 4
      const testCases = [100, 1000, 5000, 9000, 9999];

      for (const randomNum of testCases) {
        const resultRarity = await performSingleGacha(4, randomNum);
        // TokenID 4 should not produce Common or Uncommon (probabilities = 0)
        expect(resultRarity).to.not.be.oneOf([Rarity.Common, Rarity.Uncommon]);
        expect(resultRarity).to.be.oneOf([
          Rarity.Rare,
          Rarity.Epic,
          Rarity.Legendary,
          Rarity.Mythic,
          Rarity.Eternal,
        ]);
      }
    });
  });

  describe("Batch Gacha Rarity Distribution", function () {
    it("Should handle batch gacha with different rarities", async function () {
      const batchSize = 10;

      // Burn batch and get VRF request
      const tx = await gacha
        .connect(user1)
        .burnForRelicBatch(2, batchSize, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      // Mock VRF fulfillment
      const randomNumber = ethers.BigNumber.from(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      );
      await mockVRF.fulfillRandomness(vrfRequestId, randomNumber);

      // Fulfill gacha
      await gacha.fulfillGacha(vrfRequestId);

      // Get results
      const request = await gacha.getGachaRequest(vrfRequestId);
      expect(request.resultRarities.length).to.equal(batchSize);
      expect(request.resultTokenIds.length).to.equal(batchSize);

      // Verify all results are valid rarities for TokenID 2
      for (let i = 0; i < batchSize; i++) {
        const rarity = request.resultRarities[i];
        // TokenID 2 should not produce Mythic or Eternal
        expect(rarity).to.not.be.oneOf([Rarity.Mythic, Rarity.Eternal]);
        expect(rarity).to.be.oneOf([
          Rarity.Common,
          Rarity.Uncommon,
          Rarity.Rare,
          Rarity.Epic,
          Rarity.Legendary,
        ]);
      }
    });

    it("Should produce different results with incremental nonce", async function () {
      const batchSize = 5;

      // First batch
      const tx1 = await gacha
        .connect(user1)
        .burnForRelicBatch(2, batchSize, { value: VRF_COST });
      const receipt1 = await tx1.wait();
      const event1 = receipt1.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId1 = event1?.args?.vrfRequestId;

      await mockVRF.fulfillRandomness(vrfRequestId1, 12345);
      await gacha.fulfillGacha(vrfRequestId1);

      // Second batch with same random number
      const tx2 = await gacha
        .connect(user1)
        .burnForRelicBatch(2, batchSize, { value: VRF_COST });
      const receipt2 = await tx2.wait();
      const event2 = receipt2.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId2 = event2?.args?.vrfRequestId;

      await mockVRF.fulfillRandomness(vrfRequestId2, 12345); // Same random number
      await gacha.fulfillGacha(vrfRequestId2);

      // Get results
      const request1 = await gacha.getGachaRequest(vrfRequestId1);
      const request2 = await gacha.getGachaRequest(vrfRequestId2);

      // Results should be different due to nonce increment
      let differences = 0;
      for (let i = 0; i < batchSize; i++) {
        if (request1.resultRarities[i] !== request2.resultRarities[i]) {
          differences++;
        }
      }

      // Expect at least some differences due to nonce-based variation
      expect(differences).to.be.greaterThan(0);
    });
  });

  describe("Token ID Assignment Within Rarity", function () {
    it("Should assign token IDs within correct rarity ranges", async function () {
      // Test multiple gachas to check token ID assignment
      const results: { tokenId: number; rarity: Rarity }[] = [];

      for (let i = 0; i < 5; i++) {
        const tx = await gacha
          .connect(user1)
          .burnForRelic(1, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        const vrfRequestId = event?.args?.vrfRequestId;

        await mockVRF.fulfillRandomness(vrfRequestId, 1000 + i);
        await gacha.fulfillGacha(vrfRequestId);

        const request = await gacha.getGachaRequest(vrfRequestId);
        results.push({
          tokenId: request.resultTokenIds[0].toNumber(),
          rarity: request.resultRarities[0],
        });
      }

      // Verify token IDs are within correct ranges for their rarities
      for (const result of results) {
        const config = await gacha.rarityConfigs(result.rarity);

        expect(result.tokenId).to.be.gte(config.startTokenId.toNumber());
        expect(result.tokenId).to.be.lte(config.endTokenId.toNumber());
      }
    });

    it("Should correctly track available count reduction", async function () {
      const initialCommonConfig = await gacha.rarityConfigs(Rarity.Common);
      const initialAvailable = initialCommonConfig.availableCount.toNumber();

      // Force Common rarity result by using low random number
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      await mockVRF.fulfillRandomness(vrfRequestId, 100); // Low number = Common
      await gacha.fulfillGacha(vrfRequestId);

      const request = await gacha.getGachaRequest(vrfRequestId);
      if (request.resultRarities[0] === Rarity.Common) {
        const finalCommonConfig = await gacha.rarityConfigs(Rarity.Common);
        expect(finalCommonConfig.availableCount).to.equal(initialAvailable - 1);
      }
    });
  });

  describe("Edge Cases in Rarity Distribution", function () {
    it("Should handle multiple random inputs consistently", async function () {
      // Test multiple random values to ensure consistent behavior
      const testResults: Rarity[] = [];

      for (let i = 0; i < 10; i++) {
        const tx = await gacha
          .connect(user1)
          .burnForRelic(1, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        const vrfRequestId = event?.args?.vrfRequestId;

        await mockVRF.fulfillRandomness(vrfRequestId, 1000 + i * 1000);
        await gacha.fulfillGacha(vrfRequestId);

        const request = await gacha.getGachaRequest(vrfRequestId);
        testResults.push(request.resultRarities[0]);
      }

      // All results should be valid for TokenID 1 (only Common, Uncommon, Rare, Epic allowed)
      for (const rarity of testResults) {
        expect(rarity).to.be.oneOf([
          Rarity.Common,
          Rarity.Uncommon,
          Rarity.Rare,
          Rarity.Epic,
        ]);
        expect(rarity).to.not.be.oneOf([
          Rarity.Legendary,
          Rarity.Mythic,
          Rarity.Eternal,
        ]);
      }
    });

    it("Should fallback to available rarity when preferred is exhausted", async function () {
      // Exhaust Common rarity
      await gacha.updateRarityConfig(Rarity.Common, 1, 100, 0); // Set available to 0

      // Try to get Common rarity with low random number
      const tx = await gacha
        .connect(user1)
        .burnForRelic(1, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find(
        (e: any) => e.event === "GachaRequested"
      );
      const vrfRequestId = event?.args?.vrfRequestId;

      await mockVRF.fulfillRandomness(vrfRequestId, 100); // Should be Common but will fallback
      await gacha.fulfillGacha(vrfRequestId);

      const request = await gacha.getGachaRequest(vrfRequestId);
      const resultRarity = request.resultRarities[0];

      // Should get a different rarity since Common is exhausted
      expect(resultRarity).to.not.equal(Rarity.Common);
      expect(resultRarity).to.be.oneOf([
        Rarity.Uncommon,
        Rarity.Rare,
        Rarity.Epic,
        Rarity.Legendary,
        Rarity.Mythic,
        Rarity.Eternal,
      ]);
    });
  });

  describe("Multi-User Rarity Distribution Testing", function () {
    it("Should allow multiple users to burn different token IDs simultaneously", async function () {
      // Different users burn different token IDs
      const userBurns = [
        {
          user: user1,
          tokenId: 1,
          expectedRarities: [
            Rarity.Common,
            Rarity.Uncommon,
            Rarity.Rare,
            Rarity.Epic,
          ],
        },
        {
          user: user2,
          tokenId: 2,
          expectedRarities: [
            Rarity.Common,
            Rarity.Uncommon,
            Rarity.Rare,
            Rarity.Epic,
            Rarity.Legendary,
          ],
        },
        {
          user: user3,
          tokenId: 3,
          expectedRarities: [
            Rarity.Uncommon,
            Rarity.Rare,
            Rarity.Epic,
            Rarity.Legendary,
            Rarity.Mythic,
          ],
        },
      ];

      const vrfRequestIds: any[] = [];

      // All users burn simultaneously
      for (const burn of userBurns) {
        const tx = await gacha
          .connect(burn.user)
          .burnForRelic(burn.tokenId, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        vrfRequestIds.push({
          vrfRequestId: event?.args?.vrfRequestId,
          user: burn.user.address,
          tokenId: burn.tokenId,
          expectedRarities: burn.expectedRarities,
        });
      }

      // Fulfill all VRF requests with different random numbers
      for (let i = 0; i < vrfRequestIds.length; i++) {
        const requestInfo = vrfRequestIds[i];
        await mockVRF.fulfillRandomness(
          requestInfo.vrfRequestId,
          1000 + i * 2000
        );
        await gacha.fulfillGacha(requestInfo.vrfRequestId);

        // Verify each user got appropriate rarity for their token ID
        const request = await gacha.getGachaRequest(requestInfo.vrfRequestId);
        const resultRarity = request.resultRarities[0];

        expect(resultRarity).to.be.oneOf(requestInfo.expectedRarities);

        // Verify user received the NFT
        const userBalance = await otherRelics.balanceOf(requestInfo.user);
        expect(userBalance).to.equal(1);
      }
    });

    it("Should handle batch burns from multiple users correctly", async function () {
      const batchSize = 5;
      const userBatches = [
        {
          user: user1,
          tokenId: 1,
          forbiddenRarities: [Rarity.Legendary, Rarity.Mythic, Rarity.Eternal],
        },
        {
          user: user2,
          tokenId: 4,
          forbiddenRarities: [Rarity.Common, Rarity.Uncommon],
        },
      ];

      const batchResults: any[] = [];

      // Multiple users do batch burns
      for (const batch of userBatches) {
        const tx = await gacha
          .connect(batch.user)
          .burnForRelicBatch(batch.tokenId, batchSize, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        batchResults.push({
          vrfRequestId: event?.args?.vrfRequestId,
          user: batch.user.address,
          tokenId: batch.tokenId,
          forbiddenRarities: batch.forbiddenRarities,
        });
      }

      // Fulfill all batch requests
      for (let i = 0; i < batchResults.length; i++) {
        const batchInfo = batchResults[i];
        await mockVRF.fulfillRandomness(
          batchInfo.vrfRequestId,
          5000 + i * 3000
        );
        await gacha.fulfillGacha(batchInfo.vrfRequestId);

        // Verify all results respect token ID constraints
        const request = await gacha.getGachaRequest(batchInfo.vrfRequestId);
        expect(request.resultRarities.length).to.equal(batchSize);

        for (let j = 0; j < batchSize; j++) {
          const rarity = request.resultRarities[j];
          expect(rarity).to.not.be.oneOf(batchInfo.forbiddenRarities);
        }

        // Verify user received correct number of NFTs
        const userBalance = await otherRelics.balanceOf(batchInfo.user);
        expect(userBalance).to.equal(batchSize);
      }
    });

    it("Should correctly track rarity depletion across multiple users", async function () {
      // Set a very low available count for Common rarity
      await gacha.updateRarityConfig(Rarity.Common, 1, 100, 3); // Only 3 Common tokens available

      const vrfRequests: any[] = [];

      // Multiple users try to get Common rarity (tokenID 1 has 69% Common chance)
      for (let i = 0; i < 5; i++) {
        const user = i < 3 ? user1 : user2; // Mix of users
        const tx = await gacha
          .connect(user)
          .burnForRelic(1, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        vrfRequests.push({
          vrfRequestId: event?.args?.vrfRequestId,
          user: user.address,
        });
      }

      let commonCount = 0;
      let nonCommonCount = 0;

      // Fulfill requests with low random numbers (should favor Common)
      for (let i = 0; i < vrfRequests.length; i++) {
        const requestInfo = vrfRequests[i];
        await mockVRF.fulfillRandomness(requestInfo.vrfRequestId, 100 + i); // Low numbers
        await gacha.fulfillGacha(requestInfo.vrfRequestId);

        const request = await gacha.getGachaRequest(requestInfo.vrfRequestId);
        const resultRarity = request.resultRarities[0];

        if (resultRarity === Rarity.Common) {
          commonCount++;
        } else {
          nonCommonCount++;
        }
      }

      // Should have gotten maximum 3 Common (due to availability limit)
      expect(commonCount).to.be.lte(3);
      // Remaining should be other rarities
      expect(nonCommonCount).to.be.gte(2);
      // Total should be 5
      expect(commonCount + nonCommonCount).to.equal(5);

      // Verify final Common availability is depleted or nearly depleted
      const finalCommonConfig = await gacha.rarityConfigs(Rarity.Common);
      expect(finalCommonConfig.availableCount).to.be.lte(3);
    });

    it("Should handle concurrent operations from multiple users without conflicts", async function () {
      // Test concurrent single burns and batch burns
      const operations = [
        { user: user1, type: "single", tokenId: 1 },
        { user: user2, type: "batch", tokenId: 2, quantity: 3 },
        { user: user3, type: "single", tokenId: 3 },
        { user: user1, type: "batch", tokenId: 4, quantity: 2 },
      ];

      const vrfRequests: any[] = [];

      // Execute all operations concurrently
      for (const op of operations) {
        let tx;
        if (op.type === "single") {
          tx = await gacha
            .connect(op.user)
            .burnForRelic(op.tokenId, { value: VRF_COST });
        } else {
          tx = await gacha
            .connect(op.user)
            .burnForRelicBatch(op.tokenId, op.quantity!, { value: VRF_COST });
        }

        const receipt = await tx.wait();
        const event = receipt.events?.find(
          (e: any) => e.event === "GachaRequested"
        );
        vrfRequests.push({
          vrfRequestId: event?.args?.vrfRequestId,
          user: op.user.address,
          type: op.type,
          tokenId: op.tokenId,
          expectedCount: op.type === "single" ? 1 : op.quantity!,
        });
      }

      // Fulfill all requests
      for (let i = 0; i < vrfRequests.length; i++) {
        const requestInfo = vrfRequests[i];
        await mockVRF.fulfillRandomness(
          requestInfo.vrfRequestId,
          2000 + i * 1500
        );
        await gacha.fulfillGacha(requestInfo.vrfRequestId);

        // Verify request was fulfilled correctly
        const request = await gacha.getGachaRequest(requestInfo.vrfRequestId);
        expect(request.fulfilled).to.equal(true);
        expect(request.resultRarities.length).to.equal(
          requestInfo.expectedCount
        );
        expect(request.resultTokenIds.length).to.equal(
          requestInfo.expectedCount
        );
      }

      // Verify each user received correct number of NFTs
      const user1Balance = await otherRelics.balanceOf(user1.address);
      const user2Balance = await otherRelics.balanceOf(user2.address);
      const user3Balance = await otherRelics.balanceOf(user3.address);

      expect(user1Balance).to.equal(3); // 1 single + 2 batch
      expect(user2Balance).to.equal(3); // 3 batch
      expect(user3Balance).to.equal(1); // 1 single
    });

    it("Should ensure token ID constraints are respected across users", async function () {
      // Test that different token IDs produce appropriate rarity constraints
      const tokenTests = [
        {
          tokenId: 1,
          user: user1,
          forbiddenRarities: [Rarity.Legendary, Rarity.Mythic, Rarity.Eternal],
        },
        {
          tokenId: 4,
          user: user2,
          forbiddenRarities: [Rarity.Common, Rarity.Uncommon],
        },
      ];

      for (const test of tokenTests) {
        for (let i = 0; i < 3; i++) {
          const tx = await gacha
            .connect(test.user)
            .burnForRelic(test.tokenId, { value: VRF_COST });
          const receipt = await tx.wait();
          const event = receipt.events?.find(
            (e: any) => e.event === "GachaRequested"
          );
          const vrfRequestId = event?.args?.vrfRequestId;

          await mockVRF.fulfillRandomness(vrfRequestId, 1000 + i * 1000);
          await gacha.fulfillGacha(vrfRequestId);

          const request = await gacha.getGachaRequest(vrfRequestId);
          const resultRarity = request.resultRarities[0];

          // Verify forbidden rarities never appear
          expect(resultRarity).to.not.be.oneOf(test.forbiddenRarities);
        }
      }
    });
  });
});
