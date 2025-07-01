import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Gacha Contract - Token ID Range Tests", function () {
  let gacha: Contract;
  let mockVRF: Contract;
  let otherShards: Contract;
  let otherRelics: Contract;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;

  const SEED = 12345;
  const VRF_COST = ethers.utils.parseEther("0.001");

  // Used in test assertions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
    Mythic,
    Eternal,
  }

  beforeEach(async function () {
    [deployer, user1] = await ethers.getSigners();

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
    gacha = await Gacha.deploy(mockVRF.address, otherShards.address, otherRelics.address);
    await gacha.deployed();

    // Initialize the contract
    await gacha.initialize();

    // Setup permissions
    await mockVRF.whitelistAddress(gacha.address);
    await otherRelics.addMinter(gacha.address);

    // Mint shards to user for testing
    await otherShards.mint(user1.address, 1, 100, "0x"); // 100 of token ID 1
    await otherShards.mint(user1.address, 2, 50, "0x"); // 50 of token ID 2
    await otherShards.mint(user1.address, 3, 25, "0x"); // 25 of token ID 3
    await otherShards.mint(user1.address, 4, 10, "0x"); // 10 of token ID 4

    // Approve Gacha contract to spend shards
    await otherShards.connect(user1).setApprovalForAll(gacha.address, true);
  });

  describe("Token ID Range Constraints", function () {
    it("Should generate token IDs within the available range for Rare rarity", async function () {
      const testCount = 10;
      const tokenIds: number[] = [];

      for (let i = 0; i < testCount; i++) {
        // Use TokenID 3 which has high probability (49%) for Rare
        const tx = await gacha.connect(user1).burnForRelic(3, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find((e: any) => e.event === "GachaRequested");
        const vrfRequestId = event?.args?.vrfRequestId;

        await mockVRF.fulfillRandomness(vrfRequestId, 2000 + i * 1000);
        await gacha.fulfillGacha(vrfRequestId);

        const request = await gacha.getGachaRequest(vrfRequestId);
        const resultRarity = request.resultRarities[0];
        const resultTokenId = request.resultTokenIds[0].toNumber();

        if (resultRarity === Rarity.Rare) {
          tokenIds.push(resultTokenId);
        }
      }

      const rareConfig = await gacha.getRarityConfig(Rarity.Rare);
      const startTokenId = rareConfig.startTokenId.toNumber();
      const availableCount = rareConfig.totalCount.toNumber();
      const maxValidTokenId = startTokenId + availableCount - 1;

      for (const tokenId of tokenIds) {
        expect(tokenId).to.be.gte(startTokenId, "Token ID below start range");
        expect(tokenId).to.be.lte(maxValidTokenId, "Token ID above available range");
        expect(tokenId).to.be.lt(startTokenId + availableCount, "Token ID exceeds available count");
      }
    });

    it("Should respect token ID ranges for all rarities", async function () {
      for (let rarityValue = 0; rarityValue < 7; rarityValue++) {
        const config = await gacha.rarityConfigs(rarityValue);
        const startTokenId = config.startTokenId.toNumber();
        const availableCount = config.totalCount.toNumber();
        const maxValidTokenId = startTokenId + availableCount - 1;

        for (let i = 0; i < 5; i++) {
          const tx = await gacha.connect(user1).burnForRelic(4, { value: VRF_COST });
          const receipt = await tx.wait();
          const event = receipt.events?.find((e: any) => e.event === "GachaRequested");
          const vrfRequestId = event?.args?.vrfRequestId;

          await mockVRF.fulfillRandomness(vrfRequestId, i * 2000);
          await gacha.fulfillGacha(vrfRequestId);

          const request = await gacha.getGachaRequest(vrfRequestId);
          const resultRarity = request.resultRarities[0];
          const resultTokenId = request.resultTokenIds[0].toNumber();

          if (resultRarity === rarityValue) {
            expect(resultTokenId).to.be.gte(startTokenId, 
              `${Rarity[rarityValue]}: Token ID below start range`);
            expect(resultTokenId).to.be.lte(maxValidTokenId,
              `${Rarity[rarityValue]}: Token ID above available range`);
            expect(resultTokenId).to.be.lt(startTokenId + availableCount,
              `${Rarity[rarityValue]}: Token ID exceeds available count`);
          }
        }
      }
    });

    it("Should maintain token ID constraints in batch operations", async function () {
      const batchSize = 5;

      const tx = await gacha.connect(user1).burnForRelicBatch(3, batchSize, { value: VRF_COST });
      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "GachaRequested");
      const vrfRequestId = event?.args?.vrfRequestId;

      await mockVRF.fulfillRandomness(vrfRequestId, 12345);
      await gacha.fulfillGacha(vrfRequestId);

      const request = await gacha.getGachaRequest(vrfRequestId);

      for (let i = 0; i < batchSize; i++) {
        const resultRarity = request.resultRarities[i];
        const resultTokenId = request.resultTokenIds[i].toNumber();
        const config = await gacha.rarityConfigs(resultRarity);

        const startTokenId = config.startTokenId.toNumber();
        const availableCount = config.totalCount.toNumber();
        const maxValidTokenId = startTokenId + availableCount - 1;

        expect(resultTokenId).to.be.gte(startTokenId, 
          `Batch item ${i}: Token ID below start range`);
        expect(resultTokenId).to.be.lte(maxValidTokenId,
          `Batch item ${i}: Token ID above available range`);
        expect(resultTokenId).to.be.lt(startTokenId + availableCount,
          `Batch item ${i}: Token ID exceeds available count`);
      }
    });

    it("Should properly handle edge cases in token ID generation", async function () {
      for (let i = 0; i < 7; i++) {
        const config = await gacha.rarityConfigs(i);
        await gacha.updateRarityConfig(
          i,
          config.startTokenId,
          config.endTokenId,
          1 // Set available count to 1
        );
      }

      for (let i = 0; i < 5; i++) {
        const tx = await gacha.connect(user1).burnForRelic(4, { value: VRF_COST });
        const receipt = await tx.wait();
        const event = receipt.events?.find((e: any) => e.event === "GachaRequested");
        const vrfRequestId = event?.args?.vrfRequestId;

        await mockVRF.fulfillRandomness(vrfRequestId, i * 1500);
        await gacha.fulfillGacha(vrfRequestId);

        const request = await gacha.getGachaRequest(vrfRequestId);
        const resultRarity = request.resultRarities[0];
        const resultTokenId = request.resultTokenIds[0].toNumber();
        const config = await gacha.rarityConfigs(resultRarity);

        expect(resultTokenId).to.equal(config.startTokenId.toNumber());
      }
    });
  });
});
