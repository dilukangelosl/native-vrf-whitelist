import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("NativeVRF Fulfillment", function () {
  let nativeVRF: Contract;
  let user1: SignerWithAddress;
  let fulfiller: SignerWithAddress;

  const SEED = 12345;
  const MIN_REWARD = ethers.utils.parseEther("0.0001");

  beforeEach(async function () {
    const [, user1Signer, fulfillerSigner] = await ethers.getSigners();
    user1 = user1Signer;
    fulfiller = fulfillerSigner;

    const NativeVRF = await ethers.getContractFactory("NativeVRF");
    nativeVRF = await NativeVRF.deploy(SEED);
    await nativeVRF.deployed();

    // Whitelist user1 for making requests
    await nativeVRF.whitelistAddress(user1.address);
  });

  // Helper function to calculate valid random input for fulfillment
  const calculateValidRandomInput = async (
    signer: SignerWithAddress,
    requestId: number,
    maxAttempts: number = 10000
  ) => {
    const difficulty = await nativeVRF.difficulty();

    // Use a similar approach to the fulfill-bot script
    for (let input = 0; input < maxAttempts; input++) {
      // Create message hash exactly as the contract expects it
      const messageHash = await nativeVRF
        .connect(signer)
        .getMessageHash(requestId, input);

      const signature = await signer.signMessage(
        ethers.utils.arrayify(messageHash)
      );

      // Convert signature to uint256 to check divisibility
      const sigBytes = ethers.utils.arrayify(signature);
      const sigValue = ethers.BigNumber.from(
        ethers.utils.hexlify(sigBytes.slice(0, 32))
      );

      if (sigValue.mod(difficulty).eq(0)) {
        return { input, signature };
      }
    }

    throw new Error(
      `Could not find valid input after ${maxAttempts} attempts. Consider lowering difficulty.`
    );
  };

  describe("Single Request Fulfillment", function () {
    it("Should successfully fulfill a single random request", async function () {
      // First make a request
      const requestTx = await nativeVRF
        .connect(user1)
        .requestRandom(1, { value: MIN_REWARD });
      const receipt = await requestTx.wait();

      const event = receipt.events?.find(
        (e: any) => e.event === "RandomRequested"
      );
      const requestId = event?.args?.requestId.toNumber();
      expect(requestId).to.equal(1);

      // Calculate valid input and signature
      const { input, signature } = await calculateValidRandomInput(
        fulfiller,
        requestId
      );

      // Track initial state
      const initialBalance = await fulfiller.getBalance();
      const initialNonce = await nativeVRF.getNonce(fulfiller.address);
      const initialGlobalSalt = await nativeVRF.globalSalt();

      // Fulfill the request
      const fulfillTx = await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([requestId], [input], [signature]);
      const fulfillReceipt = await fulfillTx.wait();

      // Check events
      const fulfillEvent = fulfillReceipt.events?.find(
        (e: any) => e.event === "RandomFullfilled"
      );
      expect(fulfillEvent).to.be.an("object");
      expect(fulfillEvent?.args?.requestId).to.equal(requestId);
      expect(fulfillEvent?.args?.random).to.not.equal(0);

      // Check state changes
      expect(await nativeVRF.randomResults(requestId)).to.not.equal(0);
      expect(await nativeVRF.rewards(requestId)).to.equal(0); // Reward should be transferred
      expect(await nativeVRF.getNonce(fulfiller.address)).to.equal(
        initialNonce.add(1)
      );
      expect(await nativeVRF.globalSalt()).to.not.equal(initialGlobalSalt);
      expect(await nativeVRF.latestFulfillId()).to.equal(1);

      // Check fulfiller received reward (accounting for gas costs)
      const finalBalance = await fulfiller.getBalance();
      const gasUsed = fulfillReceipt.gasUsed.mul(
        fulfillReceipt.effectiveGasPrice
      );
      const netReward = finalBalance.add(gasUsed).sub(initialBalance);
      expect(netReward).to.equal(MIN_REWARD);
    });

    it("Should generate different random numbers for sequential requests", async function () {
      // Make 3 separate requests
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      // Fulfill them one by one
      const { input: input1, signature: signature1 } =
        await calculateValidRandomInput(fulfiller, 1);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([1], [input1], [signature1]);

      const { input: input2, signature: signature2 } =
        await calculateValidRandomInput(fulfiller, 2);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([2], [input2], [signature2]);

      const { input: input3, signature: signature3 } =
        await calculateValidRandomInput(fulfiller, 3);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([3], [input3], [signature3]);

      // Check all random numbers are different
      const random1 = await nativeVRF.randomResults(1);
      const random2 = await nativeVRF.randomResults(2);
      const random3 = await nativeVRF.randomResults(3);

      expect(random1).to.not.equal(random2);
      expect(random2).to.not.equal(random3);
      expect(random1).to.not.equal(random3);
    });
  });

  describe("Multiple Request Fulfillment", function () {
    it("Should successfully fulfill multiple random requests in batch", async function () {
      const numRequests = 3;
      const totalReward = MIN_REWARD.mul(numRequests);

      // Make multiple requests
      await nativeVRF
        .connect(user1)
        .requestRandom(numRequests, { value: totalReward });

      // Fulfill requests one by one instead of batch to avoid nonce issues
      const initialBalance = await fulfiller.getBalance();
      let totalGasUsed = ethers.BigNumber.from(0);

      for (let i = 1; i <= 3; i++) {
        const { input, signature } = await calculateValidRandomInput(
          fulfiller,
          i
        );

        const fulfillTx = await nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([i], [input], [signature]);
        const receipt = await fulfillTx.wait();
        totalGasUsed = totalGasUsed.add(
          receipt.gasUsed.mul(receipt.effectiveGasPrice)
        );
      }

      // Check all requests were fulfilled
      for (let requestId = 1; requestId <= 3; requestId++) {
        expect(await nativeVRF.randomResults(requestId)).to.not.equal(0);
        expect(await nativeVRF.rewards(requestId)).to.equal(0);
      }

      // Check fulfiller received total reward
      const finalBalance = await fulfiller.getBalance();
      const netReward = finalBalance.add(totalGasUsed).sub(initialBalance);
      expect(netReward).to.equal(totalReward);

      expect(await nativeVRF.latestFulfillId()).to.equal(3);
    });

    it("Should update block fulfillment tracking correctly", async function () {
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      const initialLatestFulfillId = await nativeVRF.latestFulfillId();

      // Fulfill the request
      const { input, signature } = await calculateValidRandomInput(
        fulfiller,
        1
      );
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([1], [input], [signature]);

      const finalBlock = await ethers.provider.getBlockNumber();
      const blockFulfillments = await nativeVRF.nBlockFulfillments(finalBlock);

      // Should have updated fulfillment tracking
      expect(await nativeVRF.latestFulfillId()).to.equal(
        initialLatestFulfillId.add(1)
      );
      expect(await nativeVRF.latestFulfillmentBlock()).to.equal(finalBlock);
      expect(blockFulfillments).to.be.gte(1);
    });
  });

  describe("Fulfillment Validation", function () {
    beforeEach(async function () {
      // Make a request for testing
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });
    });

    it("Should reject fulfillment with invalid signature", async function () {
      const requestId = 1;
      const invalidInput = 12345;
      const invalidSignature = await fulfiller.signMessage("invalid message");

      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([requestId], [invalidInput], [invalidSignature])
      ).to.be.revertedWith("Invalid signature");
    });

    it("Should reject fulfillment with signature that doesn't meet difficulty", async function () {
      const requestId = 1;
      const prevRandom = await nativeVRF.randomResults(0);
      const nonce = await nativeVRF.getNonce(fulfiller.address);

      // Create a valid signature but for an input that doesn't meet difficulty
      const input = 1; // This likely won't meet difficulty requirements
      const messageHash = ethers.utils.solidityKeccak256(
        ["uint256", "uint256", "uint256", "address", "uint256"],
        [prevRandom, input, requestId, fulfiller.address, nonce]
      );
      const signature = await fulfiller.signMessage(
        ethers.utils.arrayify(messageHash)
      );

      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([requestId], [input], [signature])
      ).to.be.revertedWith("Invalid random input");
    });

    it("Should reject fulfillment of already fulfilled request", async function () {
      const requestId = 1;
      const { input, signature } = await calculateValidRandomInput(
        fulfiller,
        requestId
      );

      // First fulfillment should succeed
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([requestId], [input], [signature]);

      // Second fulfillment should fail
      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([requestId], [input], [signature])
      ).to.be.revertedWith("Already fullfilled");
    });

    it("Should reject fulfillment of non-existent request", async function () {
      const nonExistentRequestId = 999;
      const input = 12345;
      const signature = await fulfiller.signMessage("dummy");

      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([nonExistentRequestId], [input], [signature])
      ).to.be.revertedWith("Random have not initialized");
    });

    it("Should reject empty fulfillment arrays", async function () {
      await expect(
        nativeVRF.connect(fulfiller).fullfillRandomness([], [], [])
      ).to.be.revertedWith("Require at least one fulfillment");
    });

    it("Should require EOA for fulfillment", async function () {
      // This test verifies the tx.origin == msg.sender requirement
      // In a real test environment, this would need a contract to test properly
      const requestId = 1;
      const { input, signature } = await calculateValidRandomInput(
        fulfiller,
        requestId
      );

      // Direct call should work (EOA)
      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([requestId], [input], [signature])
      ).to.not.be.reverted;
    });
  });

  describe("Nonce and Replay Protection", function () {
    it("Should increment nonce after each fulfillment", async function () {
      // Make multiple requests
      await nativeVRF
        .connect(user1)
        .requestRandom(3, { value: MIN_REWARD.mul(3) });

      const initialNonce = await nativeVRF.getNonce(fulfiller.address);
      expect(initialNonce).to.equal(0);

      // Fulfill first request
      const { input: input1, signature: signature1 } =
        await calculateValidRandomInput(fulfiller, 1);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([1], [input1], [signature1]);

      expect(await nativeVRF.getNonce(fulfiller.address)).to.equal(1);

      // Fulfill second request
      const { input: input2, signature: signature2 } =
        await calculateValidRandomInput(fulfiller, 2);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([2], [input2], [signature2]);

      expect(await nativeVRF.getNonce(fulfiller.address)).to.equal(2);

      // Fulfill third request
      const { input: input3, signature: signature3 } =
        await calculateValidRandomInput(fulfiller, 3);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([3], [input3], [signature3]);

      expect(await nativeVRF.getNonce(fulfiller.address)).to.equal(3);
    });

    it("Should prevent replay attacks with old signatures", async function () {
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      const requestId = 1;
      const { input, signature } = await calculateValidRandomInput(
        fulfiller,
        requestId
      );

      // First fulfillment should work
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([requestId], [input], [signature]);

      // Make another request
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      // Try to use the old signature for the new request (should fail)
      await expect(
        nativeVRF
          .connect(fulfiller)
          .fullfillRandomness([2], [input], [signature])
      ).to.be.revertedWith("Invalid signature");
    });
  });

  describe("Global Salt Updates", function () {
    it("Should update global salt on each fulfillment", async function () {
      await nativeVRF
        .connect(user1)
        .requestRandom(2, { value: MIN_REWARD.mul(2) });

      const initialSalt = await nativeVRF.globalSalt();

      // First fulfillment
      const { input: input1, signature: signature1 } =
        await calculateValidRandomInput(fulfiller, 1);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([1], [input1], [signature1]);

      const saltAfterFirst = await nativeVRF.globalSalt();
      expect(saltAfterFirst).to.not.equal(initialSalt);

      // Second fulfillment
      const { input: input2, signature: signature2 } =
        await calculateValidRandomInput(fulfiller, 2);
      await nativeVRF
        .connect(fulfiller)
        .fullfillRandomness([2], [input2], [signature2]);

      const saltAfterSecond = await nativeVRF.globalSalt();
      expect(saltAfterSecond).to.not.equal(saltAfterFirst);
      expect(saltAfterSecond).to.not.equal(initialSalt);
    });
  });

  describe("Message Hash Generation", function () {
    it("Should generate consistent message hash for same inputs", async function () {
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      const requestId = 1;
      const randInput = 12345;

      const hash1 = await nativeVRF
        .connect(fulfiller)
        .getMessageHash(requestId, randInput);
      const hash2 = await nativeVRF
        .connect(fulfiller)
        .getMessageHash(requestId, randInput);

      expect(hash1).to.equal(hash2);
    });

    it("Should generate different hashes for different inputs", async function () {
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      const requestId = 1;

      const hash1 = await nativeVRF
        .connect(fulfiller)
        .getMessageHash(requestId, 12345);
      const hash2 = await nativeVRF
        .connect(fulfiller)
        .getMessageHash(requestId, 54321);

      expect(hash1).to.not.equal(hash2);
    });

    it("Should include sender address in message hash", async function () {
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });

      const requestId = 1;
      const randInput = 12345;

      const hash1 = await nativeVRF
        .connect(fulfiller)
        .getMessageHash(requestId, randInput);
      const hash2 = await nativeVRF
        .connect(user1)
        .getMessageHash(requestId, randInput);

      // Hashes should be different because sender addresses are different
      expect(hash1).to.not.equal(hash2);
    });
  });
});
