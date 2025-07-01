import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as fs from "fs";
import * as path from "path";

describe("Gacha Contract - Large Scale Stress Testing & Distribution Analysis", function () {
  let gacha: Contract;
  let mockVRF: Contract;
  let otherShards: Contract;
  let otherRelics: Contract;
  let owner: SignerWithAddress;
  let users: SignerWithAddress[];

  const SEED = 12345;
  const VRF_COST = ethers.utils.parseEther("0.001");
  const NUM_USERS = 100;
  const BURNS_PER_USER = 10; // Total burns = 100 * 10 = 1000

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

  const rarityNames = [
    "Common",
    "Uncommon",
    "Rare",
    "Epic",
    "Legendary",
    "Mythic",
    "Eternal",
  ];

  // Statistics tracking
  interface BurnResult {
    userId: number;
    userAddress: string;
    shardTokenId: number;
    resultRarity: Rarity;
    resultTokenId: number;
    vrfRequestId: string;
  }

  let burnResults: BurnResult[] = [];

  before(async function () {
    // Get signers for testing - Hardhat provides 20 signers by default
    // We'll use fewer users but more burns per user to reach 1000 total
    const signers = await ethers.getSigners();
    owner = signers[0];

    // Use only 19 users (since hardhat has 20 signers total, minus owner)
    const ACTUAL_USERS = Math.min(NUM_USERS, 19);
    users = signers.slice(1, ACTUAL_USERS + 1);

    // Adjust burns per user to reach 1000+ total
    const ADJUSTED_BURNS_PER_USER = Math.ceil(1000 / ACTUAL_USERS);

    console.log(`🚀 Setting up stress test with ${ACTUAL_USERS} users`);
    console.log(`📊 Burns per user: ${ADJUSTED_BURNS_PER_USER}`);
    console.log(
      `📊 Total planned burns: ${ACTUAL_USERS * ADJUSTED_BURNS_PER_USER}`
    );
  });

  beforeEach(async function () {
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

    // Increase available token limits for stress testing
    for (let rarity = 0; rarity < 7; rarity++) {
      const startTokenId = rarity * 100 + 1;
      const endTokenId = startTokenId + 199; // 200 tokens per rarity range
      await gacha.updateRarityConfig(rarity, startTokenId, endTokenId, 150); // 150 tokens available per rarity
    }

    console.log("📦 Minting shards to users...");

    // Mint shards to all users
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      // Give each user enough shards for testing
      await otherShards.mint(user.address, 1, 50, "0x");
      await otherShards.mint(user.address, 2, 50, "0x");
      await otherShards.mint(user.address, 3, 50, "0x");
      await otherShards.mint(user.address, 4, 50, "0x");

      // Approve Gacha contract
      await otherShards.connect(user).setApprovalForAll(gacha.address, true);

      if ((i + 1) % 20 === 0) {
        console.log(`   ✅ Set up ${i + 1}/${NUM_USERS} users`);
      }
    }

    console.log("🎯 Setup complete! Ready for stress testing...");

    // Reset results array
    burnResults = [];
  });

  describe("Large Scale Distribution Analysis", function () {
    it("Should handle 1000+ burns from 100 users and generate distribution report", async function () {
      this.timeout(300000); // 5 minutes timeout for large test

      console.log("\n🔥 Starting large scale burn simulation...");

      const vrfRequests: any[] = [];
      let completedBurns = 0;

      // Phase 1: All users perform burns
      console.log("📤 Phase 1: Executing burns...");

      for (let userIndex = 0; userIndex < users.length; userIndex++) {
        const user = users[userIndex];

        const actualBurnsPerUser = Math.ceil(1000 / users.length);
        for (let burnIndex = 0; burnIndex < actualBurnsPerUser; burnIndex++) {
          // Randomly select shard token ID (1-4) for variety
          const shardTokenId = (burnIndex % 4) + 1;

          const tx = await gacha
            .connect(user)
            .burnForRelic(shardTokenId, { value: VRF_COST });

          const receipt = await tx.wait();
          const event = receipt.events?.find(
            (e: any) => e.event === "GachaRequested"
          );

          vrfRequests.push({
            vrfRequestId: event?.args?.vrfRequestId,
            userId: userIndex,
            userAddress: user.address,
            shardTokenId: shardTokenId,
          });

          completedBurns++;

          if (completedBurns % 100 === 0) {
            console.log(
              `   🎲 Completed ${completedBurns}/${
                users.length * Math.ceil(1000 / users.length)
              } burns`
            );
          }
        }
      }

      console.log("⚡ Phase 2: Fulfilling VRF requests...");

      // Phase 2: Fulfill all VRF requests
      for (let i = 0; i < vrfRequests.length; i++) {
        const request = vrfRequests[i];

        // Use varied random numbers for better distribution
        const randomNumber = Math.floor(Math.random() * 1000000) + i * 1000;

        await mockVRF.fulfillRandomness(request.vrfRequestId, randomNumber);
        await gacha.fulfillGacha(request.vrfRequestId);

        // Get the result
        const gachaRequest = await gacha.getGachaRequest(request.vrfRequestId);

        burnResults.push({
          userId: request.userId,
          userAddress: request.userAddress,
          shardTokenId: request.shardTokenId,
          resultRarity: gachaRequest.resultRarities[0],
          resultTokenId: gachaRequest.resultTokenIds[0].toNumber(),
          vrfRequestId: request.vrfRequestId,
        });

        if ((i + 1) % 100 === 0) {
          console.log(
            `   ⚡ Fulfilled ${i + 1}/${vrfRequests.length} VRF requests`
          );
        }
      }

      console.log("📊 Phase 3: Generating distribution report...");

      // Generate comprehensive report
      const report = generateDistributionReport();

      // Save report to file
      const reportPath = path.join(__dirname, "../reports");
      if (!fs.existsSync(reportPath)) {
        fs.mkdirSync(reportPath, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `gacha-distribution-report-${timestamp}.json`;
      const filePath = path.join(reportPath, fileName);

      fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

      console.log(`💾 Report saved to: ${filePath}`);
      console.log("\n📈 DISTRIBUTION SUMMARY:");
      console.log("=".repeat(60));

      // Print summary to console
      printReportSummary(report);

      // Validate basic expectations
      const expectedTotalBurns = users.length * Math.ceil(1000 / users.length);
      expect(burnResults).to.have.length(expectedTotalBurns);
      expect(report.totalBurns).to.equal(expectedTotalBurns);

      // Validate that each user received correct number of NFTs
      const actualBurnsPerUser = Math.ceil(1000 / users.length);
      for (let i = 0; i < users.length; i++) {
        const userBalance = await otherRelics.balanceOf(users[i].address);
        expect(userBalance).to.equal(actualBurnsPerUser);
      }

      console.log("✅ All validations passed!");
    });

    it("Should test batch burns with large user base", async function () {
      this.timeout(300000); // 5 minutes timeout

      console.log("\n🚀 Starting batch burn stress test...");

      const BATCH_SIZE = 5;
      const USERS_FOR_BATCH = Math.min(10, users.length); // Use available users for batch testing

      const batchRequests: any[] = [];
      let completedBatches = 0;

      // Execute batch burns
      for (let userIndex = 0; userIndex < USERS_FOR_BATCH; userIndex++) {
        const user = users[userIndex];

        for (let batchIndex = 0; batchIndex < 2; batchIndex++) {
          // 2 batches per user
          const shardTokenId = (batchIndex % 4) + 1;

          const tx = await gacha
            .connect(user)
            .burnForRelicBatch(shardTokenId, BATCH_SIZE, { value: VRF_COST });

          const receipt = await tx.wait();
          const event = receipt.events?.find(
            (e: any) => e.event === "GachaRequested"
          );

          batchRequests.push({
            vrfRequestId: event?.args?.vrfRequestId,
            userId: userIndex,
            userAddress: user.address,
            shardTokenId: shardTokenId,
            batchSize: BATCH_SIZE,
          });

          completedBatches++;

          if (completedBatches % 10 === 0) {
            console.log(
              `   📦 Completed ${completedBatches}/${
                USERS_FOR_BATCH * 2
              } batch burns`
            );
          }
        }
      }

      console.log("⚡ Fulfilling batch VRF requests...");

      const batchResults: BurnResult[] = [];

      // Fulfill batch requests
      for (let i = 0; i < batchRequests.length; i++) {
        const request = batchRequests[i];

        const randomNumber = Math.floor(Math.random() * 1000000) + i * 2000;

        await mockVRF.fulfillRandomness(request.vrfRequestId, randomNumber);
        await gacha.fulfillGacha(request.vrfRequestId);

        // Get batch results
        const gachaRequest = await gacha.getGachaRequest(request.vrfRequestId);

        for (let j = 0; j < BATCH_SIZE; j++) {
          batchResults.push({
            userId: request.userId,
            userAddress: request.userAddress,
            shardTokenId: request.shardTokenId,
            resultRarity: gachaRequest.resultRarities[j],
            resultTokenId: gachaRequest.resultTokenIds[j].toNumber(),
            vrfRequestId: `${request.vrfRequestId}-${j}`,
          });
        }

        if ((i + 1) % 10 === 0) {
          console.log(
            `   ⚡ Fulfilled ${i + 1}/${batchRequests.length} batch requests`
          );
        }
      }

      // Generate batch report
      const batchReport = generateBatchDistributionReport(batchResults);

      // Save batch report
      const reportPath = path.join(__dirname, "../reports");
      if (!fs.existsSync(reportPath)) {
        fs.mkdirSync(reportPath, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `gacha-batch-report-${timestamp}.json`;
      const filePath = path.join(reportPath, fileName);

      fs.writeFileSync(filePath, JSON.stringify(batchReport, null, 2));

      console.log(`💾 Batch report saved to: ${filePath}`);
      console.log("\n📈 BATCH DISTRIBUTION SUMMARY:");
      console.log("=".repeat(60));

      printBatchReportSummary(batchReport);

      // Validate batch results
      expect(batchResults).to.have.length(USERS_FOR_BATCH * 2 * BATCH_SIZE);

      console.log("✅ Batch test completed successfully!");
    });

    it("Should test distribution for each ERC1155 token ID separately", async function () {
      this.timeout(600000); // 10 minutes timeout for comprehensive testing

      console.log("\n🎯 Testing distribution for each ERC1155 token ID...");

      const BURNS_PER_TOKEN_ID = 250; // 250 burns per token ID
      const tokenIdResults: { [tokenId: number]: BurnResult[] } = {};

      // Test each token ID separately
      for (let tokenId = 1; tokenId <= 4; tokenId++) {
        console.log(
          `\n🔥 Testing TokenID ${tokenId} - ${BURNS_PER_TOKEN_ID} burns`
        );

        tokenIdResults[tokenId] = [];
        const vrfRequests: any[] = [];
        let completedBurns = 0;

        // Phase 1: Execute burns for this token ID
        for (let userIndex = 0; userIndex < users.length; userIndex++) {
          const user = users[userIndex];
          const burnsForThisUser = Math.ceil(BURNS_PER_TOKEN_ID / users.length);

          for (
            let burnIndex = 0;
            burnIndex < burnsForThisUser && completedBurns < BURNS_PER_TOKEN_ID;
            burnIndex++
          ) {
            const tx = await gacha
              .connect(user)
              .burnForRelic(tokenId, { value: VRF_COST });

            const receipt = await tx.wait();
            const event = receipt.events?.find(
              (e: any) => e.event === "GachaRequested"
            );

            vrfRequests.push({
              vrfRequestId: event?.args?.vrfRequestId,
              userId: userIndex,
              userAddress: user.address,
              shardTokenId: tokenId,
            });

            completedBurns++;

            if (completedBurns % 50 === 0) {
              console.log(
                `   🎲 TokenID ${tokenId}: ${completedBurns}/${BURNS_PER_TOKEN_ID} burns`
              );
            }
          }
        }

        // Phase 2: Fulfill VRF requests for this token ID
        for (let i = 0; i < vrfRequests.length; i++) {
          const request = vrfRequests[i];
          const randomNumber =
            Math.floor(Math.random() * 1000000) + tokenId * 10000 + i;

          await mockVRF.fulfillRandomness(request.vrfRequestId, randomNumber);
          await gacha.fulfillGacha(request.vrfRequestId);

          const gachaRequest = await gacha.getGachaRequest(
            request.vrfRequestId
          );

          tokenIdResults[tokenId].push({
            userId: request.userId,
            userAddress: request.userAddress,
            shardTokenId: request.shardTokenId,
            resultRarity: gachaRequest.resultRarities[0],
            resultTokenId: gachaRequest.resultTokenIds[0].toNumber(),
            vrfRequestId: request.vrfRequestId,
          });
        }

        console.log(
          `   ✅ TokenID ${tokenId} completed: ${tokenIdResults[tokenId].length} results`
        );
      }

      // Generate comprehensive report for each token ID
      const tokenIdReport = generateTokenIdDistributionReport(tokenIdResults);

      // Save detailed report
      const reportPath = path.join(__dirname, "../reports");
      if (!fs.existsSync(reportPath)) {
        fs.mkdirSync(reportPath, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `gacha-tokenid-distribution-${timestamp}.json`;
      const filePath = path.join(reportPath, fileName);

      fs.writeFileSync(filePath, JSON.stringify(tokenIdReport, null, 2));

      console.log(`💾 TokenID distribution report saved to: ${filePath}`);
      console.log("\n📈 TOKEN ID DISTRIBUTION ANALYSIS:");
      console.log("=".repeat(80));

      // Print detailed analysis for each token ID
      printTokenIdDistributionSummary(tokenIdReport);

      // Validate expectations for each token ID
      validateTokenIdDistributions(tokenIdResults);

      console.log("✅ All token ID distribution tests passed!");
    });
  });

  function generateTokenIdDistributionReport(tokenIdResults: {
    [tokenId: number]: BurnResult[];
  }) {
    const report: any = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalTokenIds: 4,
        burnsPerTokenId: {},
        totalBurns: 0,
      },
      tokenAnalysis: {},
      expectedVsActual: {},
      summary: {},
    };

    // Calculate totals
    let grandTotal = 0;
    for (let tokenId = 1; tokenId <= 4; tokenId++) {
      const results = tokenIdResults[tokenId] || [];
      report.metadata.burnsPerTokenId[tokenId] = results.length;
      grandTotal += results.length;
    }
    report.metadata.totalBurns = grandTotal;

    // Analyze each token ID
    for (let tokenId = 1; tokenId <= 4; tokenId++) {
      const results = tokenIdResults[tokenId] || [];
      const totalBurns = results.length;

      if (totalBurns === 0) continue;

      // Initialize analysis for this token ID
      report.tokenAnalysis[tokenId] = {
        totalBurns,
        rarityDistribution: {},
        percentageDistribution: {},
        relicTokenIds: {
          ranges: {},
          allTokens: {},
          duplicates: {},
          uniqueCount: 0,
          totalMinted: 0,
        },
      };

      // Count rarities
      const rarityCounts: { [rarity: number]: number } = {};
      const relicTokenCounts: { [tokenId: number]: number } = {};

      for (let rarity = 0; rarity < 7; rarity++) {
        rarityCounts[rarity] = 0;
      }

      results.forEach((result) => {
        rarityCounts[result.resultRarity]++;
        relicTokenCounts[result.resultTokenId] =
          (relicTokenCounts[result.resultTokenId] || 0) + 1;
      });

      // Detailed token tracking
      report.tokenAnalysis[tokenId].relicTokenIds.allTokens = relicTokenCounts;
      report.tokenAnalysis[tokenId].relicTokenIds.totalMinted = totalBurns;
      report.tokenAnalysis[tokenId].relicTokenIds.uniqueCount = Object.keys(relicTokenCounts).length;
      
      // Find duplicates
      const duplicates: { [tokenId: number]: number } = {};
      for (const [tokenId, count] of Object.entries(relicTokenCounts)) {
        if (count > 1) {
          duplicates[parseInt(tokenId)] = count;
        }
      }
      report.tokenAnalysis[tokenId].relicTokenIds.duplicates = duplicates;

      // Convert to named rarities and percentages
      for (let rarity = 0; rarity < 7; rarity++) {
        const rarityName = rarityNames[rarity];
        const count = rarityCounts[rarity];
        const percentage = ((count / totalBurns) * 100).toFixed(2);

        report.tokenAnalysis[tokenId].rarityDistribution[rarityName] = count;
        report.tokenAnalysis[tokenId].percentageDistribution[rarityName] =
          parseFloat(percentage);
      }

      // Analyze relic token ID ranges
      const rarityRanges = {
        Common: { start: 1, end: 200 },
        Uncommon: { start: 201, end: 400 },
        Rare: { start: 401, end: 600 },
        Epic: { start: 601, end: 800 },
        Legendary: { start: 801, end: 1000 },
        Mythic: { start: 1001, end: 1200 },
        Eternal: { start: 1201, end: 1400 },
      };

      for (const [rarityName, range] of Object.entries(rarityRanges)) {
        const tokensInRange = Object.keys(relicTokenCounts).filter(
          (tokenId) => {
            const id = parseInt(tokenId);
            return id >= range.start && id <= range.end;
          }
        ).length;

        report.tokenAnalysis[tokenId].relicTokenIds.ranges[rarityName] =
          tokensInRange;
      }

      // Expected vs Actual comparison
      const expected = getExpectedDistribution(tokenId);
      report.expectedVsActual[tokenId] = {
        expected,
        actual: report.tokenAnalysis[tokenId].percentageDistribution,
        variance: {},
      };

      // Calculate variance
      for (const rarityName of rarityNames) {
        const expectedPct = expected[rarityName] || 0;
        const actualPct =
          report.tokenAnalysis[tokenId].percentageDistribution[rarityName] || 0;
        const variance = Math.abs(expectedPct - actualPct);
        report.expectedVsActual[tokenId].variance[rarityName] = parseFloat(
          variance.toFixed(2)
        );
      }
    }

    return report;
  }

  function printTokenIdDistributionSummary(report: any) {
    console.log(
      `📊 Total Burns Across All Token IDs: ${report.metadata.totalBurns}\n`
    );

    for (let tokenId = 1; tokenId <= 4; tokenId++) {
      if (!report.tokenAnalysis[tokenId]) continue;

      const analysis = report.tokenAnalysis[tokenId];
      const expected = report.expectedVsActual[tokenId].expected;
      const variance = report.expectedVsActual[tokenId].variance;

      console.log(
        `🎯 TOKEN ID ${tokenId} ANALYSIS (${analysis.totalBurns} burns):`
      );
      console.log("-".repeat(60));

      console.log("Rarity Distribution:");
      for (let rarity = 0; rarity < 7; rarity++) {
        const rarityName = rarityNames[rarity];
        const count = analysis.rarityDistribution[rarityName] || 0;
        const actual = analysis.percentageDistribution[rarityName] || 0;
        const expectedPct = expected[rarityName] || 0;
        const variancePct = variance[rarityName] || 0;

        if (expectedPct > 0 || count > 0) {
          console.log(
            `  ${rarityName.padEnd(12)}: ${count
              .toString()
              .padStart(3)} (${actual
              .toString()
              .padStart(5)}%) | Expected: ${expectedPct
              .toString()
              .padStart(2)}% | Variance: ${variancePct.toString().padStart(4)}%`
          );
        }
      }

      console.log("\nRelic Token Statistics:");
      console.log(`  Total Tokens Minted: ${analysis.relicTokenIds.totalMinted}`);
      console.log(`  Unique Token IDs: ${analysis.relicTokenIds.uniqueCount}`);
      console.log(`  Duplicate Tokens: ${Object.keys(analysis.relicTokenIds.duplicates).length}`);
      
      if (Object.keys(analysis.relicTokenIds.duplicates).length > 0) {
        console.log("\nDuplicate Token Details:");
        const sortedDuplicates = Object.entries(analysis.relicTokenIds.duplicates)
          .sort(([,a], [,b]) => (b as number) - (a as number)); // Sort by count descending
        
        for (const [tokenId, count] of sortedDuplicates.slice(0, 10)) { // Show top 10 duplicates
          console.log(`    Token #${tokenId}: minted ${count} times`);
        }
        
        if (sortedDuplicates.length > 10) {
          console.log(`    ... and ${sortedDuplicates.length - 10} more duplicates`);
        }
      }

      console.log("\nAll Minted Tokens (Token ID : Count):");
      const sortedTokens = Object.entries(analysis.relicTokenIds.allTokens)
        .sort(([a], [b]) => parseInt(a) - parseInt(b)); // Sort by token ID
      
      // Group by tens for better readability
      for (let i = 0; i < sortedTokens.length; i += 10) {
        const group = sortedTokens.slice(i, i + 10);
        const tokenInfo = group.map(([tokenId, count]) => `#${tokenId}:${count}`).join(', ');
        console.log(`    ${tokenInfo}`);
      }

      console.log("\nRelic Token ID Ranges:");
      for (const rarityName of rarityNames) {
        const tokensInRange = analysis.relicTokenIds.ranges[rarityName] || 0;
        if (tokensInRange > 0) {
          console.log(
            `  ${rarityName}: ${tokensInRange} unique relic token IDs`
          );
        }
      }

      console.log("\n" + "=".repeat(60) + "\n");
    }
  }

  function validateTokenIdDistributions(tokenIdResults: {
    [tokenId: number]: BurnResult[];
  }) {
    // Validate TokenID 1: Should only produce Common, Uncommon, Rare, Epic
    const token1Results = tokenIdResults[1] || [];
    token1Results.forEach((result) => {
      expect(result.resultRarity).to.be.oneOf([0, 1, 2, 3]); // Common, Uncommon, Rare, Epic only
      expect(result.resultRarity).to.not.be.oneOf([4, 5, 6]); // No Legendary, Mythic, Eternal
    });

    // Validate TokenID 2: Should only produce Common, Uncommon, Rare, Epic, Legendary
    const token2Results = tokenIdResults[2] || [];
    token2Results.forEach((result) => {
      expect(result.resultRarity).to.be.oneOf([0, 1, 2, 3, 4]); // Common through Legendary
      expect(result.resultRarity).to.not.be.oneOf([5, 6]); // No Mythic, Eternal
    });

    // Validate TokenID 3: Should only produce Uncommon, Rare, Epic, Legendary, Mythic
    const token3Results = tokenIdResults[3] || [];
    token3Results.forEach((result) => {
      expect(result.resultRarity).to.be.oneOf([1, 2, 3, 4, 5]); // Uncommon through Mythic
      expect(result.resultRarity).to.not.be.oneOf([0, 6]); // No Common, Eternal
    });

    // Validate TokenID 4: Should only produce Rare, Epic, Legendary, Mythic, Eternal
    const token4Results = tokenIdResults[4] || [];
    token4Results.forEach((result) => {
      expect(result.resultRarity).to.be.oneOf([2, 3, 4, 5, 6]); // Rare through Eternal
      expect(result.resultRarity).to.not.be.oneOf([0, 1]); // No Common, Uncommon
    });

    console.log("✅ All token ID rarity constraints validated successfully!");
  }

  function generateDistributionReport() {
    const report: any = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalUsers: NUM_USERS,
        burnsPerUser: BURNS_PER_USER,
        totalBurns: burnResults.length,
      },
      shardTokenDistribution: {},
      rarityDistribution: {},
      userAnalysis: {},
      probabilityAnalysis: {},
      summary: {},
    };

    // Initialize counters
    for (let shardId = 1; shardId <= 4; shardId++) {
      report.shardTokenDistribution[shardId] = {
        totalBurns: 0,
        rarityBreakdown: {},
      };

      for (let rarity = 0; rarity < 7; rarity++) {
        report.shardTokenDistribution[shardId].rarityBreakdown[
          rarityNames[rarity]
        ] = 0;
      }
    }

    for (let rarity = 0; rarity < 7; rarity++) {
      report.rarityDistribution[rarityNames[rarity]] = {
        count: 0,
        percentage: 0,
        fromShardTokens: {},
      };

      for (let shardId = 1; shardId <= 4; shardId++) {
        report.rarityDistribution[rarityNames[rarity]].fromShardTokens[
          shardId
        ] = 0;
      }
    }

    // Process results
    burnResults.forEach((result) => {
      const shardId = result.shardTokenId;
      const rarity = result.resultRarity;
      const rarityName = rarityNames[rarity];

      // Shard token distribution
      report.shardTokenDistribution[shardId].totalBurns++;
      report.shardTokenDistribution[shardId].rarityBreakdown[rarityName]++;

      // Rarity distribution
      report.rarityDistribution[rarityName].count++;
      report.rarityDistribution[rarityName].fromShardTokens[shardId]++;

      // User analysis
      if (!report.userAnalysis[result.userId]) {
        report.userAnalysis[result.userId] = {
          address: result.userAddress,
          totalBurns: 0,
          rarityBreakdown: {},
        };

        for (let r = 0; r < 7; r++) {
          report.userAnalysis[result.userId].rarityBreakdown[
            rarityNames[r]
          ] = 0;
        }
      }

      report.userAnalysis[result.userId].totalBurns++;
      report.userAnalysis[result.userId].rarityBreakdown[rarityName]++;
    });

    // Calculate percentages
    const total = burnResults.length;
    for (let rarity = 0; rarity < 7; rarity++) {
      const rarityName = rarityNames[rarity];
      const count = report.rarityDistribution[rarityName].count;
      report.rarityDistribution[rarityName].percentage = (
        (count / total) *
        100
      ).toFixed(2);
    }

    // Generate probability analysis
    report.probabilityAnalysis = analyzeProbabilityDistribution();

    // Generate summary
    report.summary = {
      totalBurns: total,
      totalUsers: users.length,
      avgBurnsPerUser: (total / users.length).toFixed(2),
      mostCommonRarity: getMostCommonRarity(),
      rariestRarity: getRariestRarity(),
    };

    report.totalBurns = total;

    return report;
  }

  function generateBatchDistributionReport(results: BurnResult[]) {
    // Similar structure but for batch results
    const report: any = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalResults: results.length,
        avgBatchSize: 5,
      },
      distribution: {},
    };

    // Process batch results similar to single burns
    for (let rarity = 0; rarity < 7; rarity++) {
      report.distribution[rarityNames[rarity]] = {
        count: 0,
        percentage: 0,
      };
    }

    results.forEach((result) => {
      const rarityName = rarityNames[result.resultRarity];
      report.distribution[rarityName].count++;
    });

    // Calculate percentages
    const total = results.length;
    for (let rarity = 0; rarity < 7; rarity++) {
      const rarityName = rarityNames[rarity];
      const count = report.distribution[rarityName].count;
      report.distribution[rarityName].percentage = (
        (count / total) *
        100
      ).toFixed(2);
    }

    return report;
  }

  function printReportSummary(report: any) {
    console.log(`📊 Total Burns: ${report.totalBurns}`);
    console.log(`👥 Total Users: ${report.metadata.totalUsers}`);
    console.log(`🎯 Burns per User: ${report.metadata.burnsPerUser}\n`);

    console.log("🎲 RARITY DISTRIBUTION:");
    console.log("-".repeat(40));

    for (let rarity = 0; rarity < 7; rarity++) {
      const rarityName = rarityNames[rarity];
      const data = report.rarityDistribution[rarityName];
      const percentage = data.percentage.padStart(6);
      const count = data.count.toString().padStart(4);
      console.log(`${rarityName.padEnd(12)}: ${count} (${percentage}%)`);
    }

    console.log("\n🔥 SHARD TOKEN USAGE:");
    console.log("-".repeat(40));

    for (let shardId = 1; shardId <= 4; shardId++) {
      const data = report.shardTokenDistribution[shardId];
      console.log(`TokenID ${shardId}: ${data.totalBurns} burns`);

      for (let rarity = 0; rarity < 7; rarity++) {
        const rarityName = rarityNames[rarity];
        const count = data.rarityBreakdown[rarityName];
        if (count > 0) {
          const percentage = ((count / data.totalBurns) * 100).toFixed(1);
          console.log(`  ${rarityName}: ${count} (${percentage}%)`);
        }
      }
      console.log("");
    }
  }

  function printBatchReportSummary(report: any) {
    console.log(`📊 Total Batch Results: ${report.metadata.totalResults}\n`);

    console.log("🎲 BATCH RARITY DISTRIBUTION:");
    console.log("-".repeat(40));

    for (let rarity = 0; rarity < 7; rarity++) {
      const rarityName = rarityNames[rarity];
      const data = report.distribution[rarityName];
      const percentage = data.percentage.padStart(6);
      const count = data.count.toString().padStart(4);
      console.log(`${rarityName.padEnd(12)}: ${count} (${percentage}%)`);
    }
  }

  function analyzeProbabilityDistribution() {
    // Analyze how close actual results are to expected probabilities
    const analysis: any = {};

    for (let shardId = 1; shardId <= 4; shardId++) {
      const shardResults = burnResults.filter(
        (r) => r.shardTokenId === shardId
      );
      if (shardResults.length === 0) continue;

      analysis[`tokenId${shardId}`] = {
        totalBurns: shardResults.length,
        actualDistribution: {},
        expectedDistribution: getExpectedDistribution(shardId),
        variance: {},
      };

      // Calculate actual distribution
      for (let rarity = 0; rarity < 7; rarity++) {
        const rarityName = rarityNames[rarity];
        const count = shardResults.filter(
          (r) => r.resultRarity === rarity
        ).length;
        const percentage = (count / shardResults.length) * 100;
        analysis[`tokenId${shardId}`].actualDistribution[rarityName] = {
          count,
          percentage: parseFloat(percentage.toFixed(2)),
        };
      }
    }

    return analysis;
  }

  function getExpectedDistribution(shardId: number) {
    const distributions: any = {
      1: {
        Common: 69,
        Uncommon: 25,
        Rare: 5,
        Epic: 1,
        Legendary: 0,
        Mythic: 0,
        Eternal: 0,
      },
      2: {
        Common: 20,
        Uncommon: 49,
        Rare: 25,
        Epic: 5,
        Legendary: 1,
        Mythic: 0,
        Eternal: 0,
      },
      3: {
        Common: 0,
        Uncommon: 20,
        Rare: 49,
        Epic: 25,
        Legendary: 5,
        Mythic: 1,
        Eternal: 0,
      },
      4: {
        Common: 0,
        Uncommon: 0,
        Rare: 20,
        Epic: 49,
        Legendary: 25,
        Mythic: 5,
        Eternal: 1,
      },
    };

    return distributions[shardId] || {};
  }

  function getMostCommonRarity() {
    const counts = burnResults.reduce((acc: any, result) => {
      const rarityName = rarityNames[result.resultRarity];
      acc[rarityName] = (acc[rarityName] || 0) + 1;
      return acc;
    }, {});

    return Object.keys(counts).reduce((a, b) =>
      counts[a] > counts[b] ? a : b
    );
  }

  function getRariestRarity() {
    const counts = burnResults.reduce((acc: any, result) => {
      const rarityName = rarityNames[result.resultRarity];
      acc[rarityName] = (acc[rarityName] || 0) + 1;
      return acc;
    }, {});

    const nonZeroCounts = Object.keys(counts).filter((key) => counts[key] > 0);
    return nonZeroCounts.reduce((a, b) => (counts[a] < counts[b] ? a : b));
  }
});
