import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("PrizeDrawConsumer", function () {
  let nativeVRF: Contract;
  let prizeDrawConsumer: Contract;
  let owner: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;
  let player3: SignerWithAddress;
  let player4: SignerWithAddress;

  const SEED = 12345;
  const MIN_REWARD = ethers.utils.parseEther("0.0001");
  const DRAW_COST = ethers.utils.parseEther("0.001");

  beforeEach(async function () {
    [owner, player1, player2, player3, player4] = await ethers.getSigners();

    // Deploy Native VRF first
    const NativeVRF = await ethers.getContractFactory("NativeVRF");
    nativeVRF = await NativeVRF.deploy(SEED);
    await nativeVRF.deployed();

    // Deploy PrizeDrawConsumer
    const PrizeDrawConsumer = await ethers.getContractFactory(
      "PrizeDrawConsumer"
    );
    prizeDrawConsumer = await PrizeDrawConsumer.deploy(nativeVRF.address);
    await prizeDrawConsumer.deployed();

    // Whitelist the PrizeDrawConsumer in Native VRF
    await nativeVRF.whitelistAddress(prizeDrawConsumer.address);
  });

  describe("Deployment", function () {
    it("Should set the correct Native VRF address", async function () {
      expect(await prizeDrawConsumer.nativeVRF()).to.equal(nativeVRF.address);
    });

    it("Should set the correct owner", async function () {
      expect(await prizeDrawConsumer.owner()).to.equal(owner.address);
    });

    it("Should create default draw configuration", async function () {
      const drawConfig = await prizeDrawConsumer.getDrawConfiguration(1);
      expect(drawConfig.description).to.equal("Default 5-Prize Draw");
      expect(drawConfig.prizeCount).to.equal(5);
      expect(drawConfig.totalWeight).to.equal(10000);
      expect(drawConfig.isActive).to.equal(true);
    });

    it("Should have correct default prize configuration", async function () {
      // Check Prize 1 - 30%
      const prize1 = await prizeDrawConsumer.getPrizeDetails(1, 0);
      expect(prize1.name).to.equal("Grand Prize - Gold Coin");
      expect(prize1.weight).to.equal(3000);
      expect(prize1.probability).to.equal(3000); // 30.00%

      // Check Prize 2 - 20%
      const prize2 = await prizeDrawConsumer.getPrizeDetails(1, 1);
      expect(prize2.name).to.equal("Second Prize - Silver Medal");
      expect(prize2.weight).to.equal(2000);
      expect(prize2.probability).to.equal(2000); // 20.00%

      // Check Prize 5 - 2%
      const prize5 = await prizeDrawConsumer.getPrizeDetails(1, 4);
      expect(prize5.name).to.equal("Fifth Prize - Participation Token");
      expect(prize5.weight).to.equal(200);
      expect(prize5.probability).to.equal(200); // 2.00%
    });
  });

  describe("Draw Configuration Management", function () {
    it("Should allow owner to create new draw configuration", async function () {
      const prizeNames = ["First Prize", "Second Prize"];
      const prizeWeights = [5000, 3000]; // 50% and 30%, 20% no prize
      const prizeValues = [
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("0.5"),
      ];

      await expect(
        prizeDrawConsumer.createDrawConfiguration(
          "Custom Draw",
          prizeNames,
          prizeWeights,
          prizeValues
        )
      ).to.emit(prizeDrawConsumer, "DrawConfigured");

      const drawConfig = await prizeDrawConsumer.getDrawConfiguration(2);
      expect(drawConfig.description).to.equal("Custom Draw");
      expect(drawConfig.prizeCount).to.equal(2);
      expect(drawConfig.isActive).to.equal(true);
    });

    it("Should not allow non-owner to create draw configuration", async function () {
      await expect(
        prizeDrawConsumer
          .connect(player1)
          .createDrawConfiguration("Test", ["Prize"], [5000], [0])
      ).to.be.revertedWith("Only owner can call this function");
    });

    it("Should reject invalid configurations", async function () {
      // Mismatched arrays
      await expect(
        prizeDrawConsumer.createDrawConfiguration(
          "Invalid",
          ["Prize1", "Prize2"],
          [5000],
          [0, 0]
        )
      ).to.be.revertedWith("Arrays length mismatch");

      // Total weight exceeding 10000
      await expect(
        prizeDrawConsumer.createDrawConfiguration(
          "Invalid",
          ["Prize1"],
          [10001],
          [0]
        )
      ).to.be.revertedWith("Total weight cannot exceed 10000");

      // Zero weight
      await expect(
        prizeDrawConsumer.createDrawConfiguration(
          "Invalid",
          ["Prize1"],
          [0],
          [0]
        )
      ).to.be.revertedWith("Prize weight must be greater than 0");
    });

    it("Should allow owner to activate/deactivate draw configurations", async function () {
      await prizeDrawConsumer.setDrawConfigActive(1, false);
      const drawConfig = await prizeDrawConsumer.getDrawConfiguration(1);
      expect(drawConfig.isActive).to.equal(false);

      await prizeDrawConsumer.setDrawConfigActive(1, true);
      const drawConfigActive = await prizeDrawConsumer.getDrawConfiguration(1);
      expect(drawConfigActive.isActive).to.equal(true);
    });
  });

  describe("Probability Calculations", function () {
    it("Should calculate correct probabilities for default configuration", async function () {
      const probabilities = await prizeDrawConsumer.calculateProbabilities(1);

      // Prize probabilities (converted from basis points to percentages)
      expect(probabilities[0]).to.equal(3000); // 30%
      expect(probabilities[1]).to.equal(2000); // 20%
      expect(probabilities[2]).to.equal(1000); // 10%
      expect(probabilities[3]).to.equal(800); // 8%
      expect(probabilities[4]).to.equal(200); // 2%
      expect(probabilities[5]).to.equal(3000); // 30% no prize
    });

    it("Should handle custom probability distributions", async function () {
      // Create a simple 50-50 configuration
      await prizeDrawConsumer.createDrawConfiguration(
        "50-50 Draw",
        ["Winner"],
        [5000], // 50%
        [ethers.utils.parseEther("1")]
      );

      const probabilities = await prizeDrawConsumer.calculateProbabilities(2);
      expect(probabilities[0]).to.equal(5000); // 50% win
      expect(probabilities[1]).to.equal(5000); // 50% no prize
    });
  });

  describe("Prize Selection Algorithm", function () {
    it("Should simulate draws consistently", async function () {
      // Test with deterministic random numbers
      // Prize weights: 3000, 2000, 1000, 800, 200 = 7000 total for prizes
      // Ranges: 0-2999 (Prize 1), 3000-4999 (Prize 2), 5000-5999 (Prize 3),
      //         6000-6799 (Prize 4), 6800-6999 (Prize 5), 7000-9999 (No Prize)
      const testCases = [
        { random: 0, expectedPrize: 1 }, // Should hit first prize (0-2999)
        { random: 3000, expectedPrize: 2 }, // Should hit second prize (3000-4999)
        { random: 5000, expectedPrize: 3 }, // Should hit third prize (5000-5999)
        { random: 6000, expectedPrize: 4 }, // Should hit fourth prize (6000-6799)
        { random: 6800, expectedPrize: 5 }, // Should hit fifth prize (6800-6999)
        { random: 7000, expectedPrize: 0 }, // Should hit no prize (7000-9999)
      ];

      for (const testCase of testCases) {
        const result = await prizeDrawConsumer.simulateDraw(1, testCase.random);
        expect(result).to.equal(testCase.expectedPrize);
      }
    });

    it("Should distribute prizes according to weights over many simulations", async function () {
      const simulations = 1000;
      const results = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      // Run many simulations with different random numbers
      for (let i = 0; i < simulations; i++) {
        const randomNum = Math.floor(Math.random() * 10000);
        const result = await prizeDrawConsumer.simulateDraw(1, randomNum);
        const resultKey = result.toNumber() as keyof typeof results;
        results[resultKey]++;
      }

      // Check that distribution is approximately correct (within 20% tolerance)
      const tolerance = 0.2;
      expect(results[1]).to.be.closeTo(300, 300 * tolerance); // 30% ± 20%
      expect(results[2]).to.be.closeTo(200, 200 * tolerance); // 20% ± 20%
      expect(results[0]).to.be.closeTo(300, 300 * tolerance); // 30% no prize ± 20%
    });
  });

  describe("Multi-User Draw Requests", function () {
    beforeEach(async function () {
      // Fund the prize draw consumer for gas fees
      await owner.sendTransaction({
        to: prizeDrawConsumer.address,
        value: ethers.utils.parseEther("1"),
      });
    });

    it("Should handle multiple simultaneous draw requests", async function () {
      const players = [player1, player2, player3, player4];
      const requestPromises = [];

      // All players request draws simultaneously
      for (const player of players) {
        const promise = prizeDrawConsumer
          .connect(player)
          .requestDraw(1, { value: DRAW_COST });
        requestPromises.push(promise);
      }

      const results = await Promise.all(requestPromises);

      // Verify all requests were successful
      for (let i = 0; i < results.length; i++) {
        const receipt = await results[i].wait();
        const events = receipt.events?.filter(
          (e: any) => e.event === "DrawRequested"
        );
        expect(events).to.have.length(1);
        expect(events![0].args!.player).to.equal(players[i].address);
      }
    });

    it("Should track individual player requests correctly", async function () {
      // Player 1 makes a request
      const tx1 = await prizeDrawConsumer
        .connect(player1)
        .requestDraw(1, { value: DRAW_COST });
      const receipt1 = await tx1.wait();
      const drawRequestedEvents1 = receipt1.events?.filter(
        (e: any) => e.event === "DrawRequested"
      );
      const requestId1 = drawRequestedEvents1![0].args!.requestId;

      // Player 2 makes a request
      const tx2 = await prizeDrawConsumer
        .connect(player2)
        .requestDraw(1, { value: DRAW_COST });
      const receipt2 = await tx2.wait();
      const drawRequestedEvents2 = receipt2.events?.filter(
        (e: any) => e.event === "DrawRequested"
      );
      const requestId2 = drawRequestedEvents2![0].args!.requestId;

      // Verify request details
      const result1 = await prizeDrawConsumer.getDrawResult(requestId1);
      expect(result1.player).to.equal(player1.address);
      expect(result1.fulfilled).to.equal(false);

      const result2 = await prizeDrawConsumer.getDrawResult(requestId2);
      expect(result2.player).to.equal(player2.address);
      expect(result2.fulfilled).to.equal(false);
    });

    it("Should handle multiple requests from same player", async function () {
      // Player 1 makes multiple requests
      const tx1 = await prizeDrawConsumer
        .connect(player1)
        .requestDraw(1, { value: DRAW_COST });
      const tx2 = await prizeDrawConsumer
        .connect(player1)
        .requestDraw(1, { value: DRAW_COST });

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const drawRequestedEvents1 = receipt1.events?.filter(
        (e: any) => e.event === "DrawRequested"
      );
      const drawRequestedEvents2 = receipt2.events?.filter(
        (e: any) => e.event === "DrawRequested"
      );
      const requestId1 = drawRequestedEvents1![0].args!.requestId;
      const requestId2 = drawRequestedEvents2![0].args!.requestId;

      expect(requestId1).to.not.equal(requestId2);

      const result1 = await prizeDrawConsumer.getDrawResult(requestId1);
      const result2 = await prizeDrawConsumer.getDrawResult(requestId2);

      expect(result1.player).to.equal(player1.address);
      expect(result2.player).to.equal(player1.address);
    });

    it("Should require sufficient payment for draws", async function () {
      await expect(
        prizeDrawConsumer
          .connect(player1)
          .requestDraw(1, { value: MIN_REWARD.div(2) })
      ).to.be.revertedWith("Reward is too low");
    });

    it("Should reject requests for inactive draw configurations", async function () {
      await prizeDrawConsumer.setDrawConfigActive(1, false);

      await expect(
        prizeDrawConsumer.connect(player1).requestDraw(1, { value: DRAW_COST })
      ).to.be.revertedWith("Draw configuration not active");
    });
  });

  describe("Gas Efficiency Tests", function () {
    it("Should have reasonable gas costs for draw requests", async function () {
      const tx = await prizeDrawConsumer
        .connect(player1)
        .requestDraw(1, { value: DRAW_COST });
      const receipt = await tx.wait();

      // Gas should be reasonable for a draw request
      expect(receipt.gasUsed.toNumber()).to.be.lessThan(200000);
    });

    it("Should have efficient prize selection", async function () {
      // Test gas cost of simulation (view function)
      const gasEstimate = await prizeDrawConsumer.estimateGas.simulateDraw(
        1,
        12345
      );
      expect(gasEstimate.toNumber()).to.be.lessThan(50000);
    });

    it("Should scale well with number of prizes", async function () {
      // Create a configuration with many prizes
      const manyPrizes = Array(20).fill("Prize");
      const manyWeights = Array(20).fill(400); // 400 * 20 = 8000, 20% no prize
      const manyValues = Array(20).fill(0);

      await prizeDrawConsumer.createDrawConfiguration(
        "Many Prizes",
        manyPrizes,
        manyWeights,
        manyValues
      );

      // Test gas cost should still be reasonable
      const gasEstimate = await prizeDrawConsumer.estimateGas.simulateDraw(
        2,
        12345
      );
      expect(gasEstimate.toNumber()).to.be.lessThan(100000);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle maximum weight values correctly", async function () {
      await prizeDrawConsumer.createDrawConfiguration(
        "Max Weight",
        ["Guaranteed Prize"],
        [10000], // 100% chance
        [ethers.utils.parseEther("1")]
      );

      // Should always return prize 1
      for (let i = 0; i < 10; i++) {
        const result = await prizeDrawConsumer.simulateDraw(2, i * 1000);
        expect(result).to.equal(1);
      }
    });

    it("Should handle minimum weight values correctly", async function () {
      await prizeDrawConsumer.createDrawConfiguration(
        "Min Weight",
        ["Rare Prize"],
        [1], // 0.01% chance
        [ethers.utils.parseEther("1")]
      );

      // Only random number 0 should hit the prize
      expect(await prizeDrawConsumer.simulateDraw(2, 0)).to.equal(1);
      expect(await prizeDrawConsumer.simulateDraw(2, 1)).to.equal(0);
      expect(await prizeDrawConsumer.simulateDraw(2, 9999)).to.equal(0);
    });

    it("Should handle random number edge cases", async function () {
      // Test with very large random numbers
      const largeRandom = ethers.constants.MaxUint256;
      const result = await prizeDrawConsumer.simulateDraw(1, largeRandom);
      expect(result).to.be.at.least(0).and.at.most(5);
    });

    it("Should protect against invalid request IDs", async function () {
      await expect(prizeDrawConsumer.getDrawResult(999999)).to.not.be.reverted; // Should return default values

      const result = await prizeDrawConsumer.getDrawResult(999999);
      expect(result.player).to.equal(ethers.constants.AddressZero);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to withdraw funds", async function () {
      // Send some ETH to the contract
      await owner.sendTransaction({
        to: prizeDrawConsumer.address,
        value: ethers.utils.parseEther("1"),
      });

      const initialBalance = await owner.getBalance();

      await prizeDrawConsumer.withdraw();

      const finalBalance = await owner.getBalance();
      expect(finalBalance).to.be.gt(initialBalance);
      expect(
        await ethers.provider.getBalance(prizeDrawConsumer.address)
      ).to.equal(0);
    });

    it("Should allow ownership transfer", async function () {
      await expect(prizeDrawConsumer.transferOwnership(player1.address))
        .to.emit(prizeDrawConsumer, "OwnershipTransferred")
        .withArgs(owner.address, player1.address);

      expect(await prizeDrawConsumer.owner()).to.equal(player1.address);
    });

    it("Should not allow non-owner to call owner functions", async function () {
      await expect(
        prizeDrawConsumer.connect(player1).withdraw()
      ).to.be.revertedWith("Only owner can call this function");

      await expect(
        prizeDrawConsumer.connect(player1).transferOwnership(player2.address)
      ).to.be.revertedWith("Only owner can call this function");
    });
  });

  describe("Integration with Native VRF", function () {
    it("Should properly integrate with Native VRF contract", async function () {
      // This test verifies the integration works as expected
      const tx = await prizeDrawConsumer
        .connect(player1)
        .requestDraw(1, { value: DRAW_COST });
      const receipt = await tx.wait();

      // Should emit DrawRequested event
      const events = receipt.events?.filter(
        (e: any) => e.event === "DrawRequested"
      );
      expect(events).to.have.length(1);
    });

    it("Should handle Native VRF address correctly", async function () {
      expect(await prizeDrawConsumer.nativeVRF()).to.equal(nativeVRF.address);
    });
  });
});
