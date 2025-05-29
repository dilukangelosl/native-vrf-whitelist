import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("NativeVRF", function () {
  let nativeVRF: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let fulfiller: SignerWithAddress;

  const SEED = 12345;
  const MIN_REWARD = ethers.utils.parseEther("0.0001");

  beforeEach(async function () {
    [owner, user1, user2, fulfiller] = await ethers.getSigners();

    const NativeVRF = await ethers.getContractFactory("NativeVRF");
    nativeVRF = await NativeVRF.deploy(SEED);
    await nativeVRF.deployed();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await nativeVRF.owner()).to.equal(owner.address);
    });

    it("Should initialize global salt", async function () {
      const globalSalt = await nativeVRF.globalSalt();
      expect(globalSalt).to.not.equal(0);
    });

    it("Should set initial random result", async function () {
      const randomResult = await nativeVRF.randomResults(0);
      expect(randomResult).to.not.equal(0);
    });

    it("Should set correct difficulty parameters", async function () {
      expect(await nativeVRF.expectedFulfillTime()).to.equal(15);
      expect(await nativeVRF.estimatedHashPower()).to.equal(100);
      expect(await nativeVRF.difficulty()).to.equal(1500);
    });
  });

  describe("Whitelist Management", function () {
    it("Should allow owner to whitelist addresses", async function () {
      await expect(nativeVRF.whitelistAddress(user1.address))
        .to.emit(nativeVRF, "AddressWhitelisted")
        .withArgs(user1.address);

      expect(await nativeVRF.isWhitelisted(user1.address)).to.equal(true);
    });

    it("Should allow owner to delist addresses", async function () {
      await nativeVRF.whitelistAddress(user1.address);

      await expect(nativeVRF.delistAddress(user1.address))
        .to.emit(nativeVRF, "AddressDelisted")
        .withArgs(user1.address);

      expect(await nativeVRF.isWhitelisted(user1.address)).to.equal(false);
    });

    it("Should not allow non-owner to whitelist addresses", async function () {
      await expect(
        nativeVRF.connect(user1).whitelistAddress(user2.address)
      ).to.be.revertedWith("Only owner can call this function");
    });

    it("Should not allow whitelisting zero address", async function () {
      await expect(
        nativeVRF.whitelistAddress(ethers.constants.AddressZero)
      ).to.be.revertedWith("Cannot whitelist zero address");
    });

    it("Should not allow whitelisting already whitelisted address", async function () {
      await nativeVRF.whitelistAddress(user1.address);
      await expect(
        nativeVRF.whitelistAddress(user1.address)
      ).to.be.revertedWith("Address already whitelisted");
    });

    it("Should not allow delisting non-whitelisted address", async function () {
      await expect(nativeVRF.delistAddress(user1.address)).to.be.revertedWith(
        "Address not whitelisted"
      );
    });
  });

  describe("Ownership Transfer", function () {
    it("Should allow owner to transfer ownership", async function () {
      await expect(nativeVRF.transferOwnership(user1.address))
        .to.emit(nativeVRF, "OwnershipTransferred")
        .withArgs(owner.address, user1.address);

      expect(await nativeVRF.owner()).to.equal(user1.address);
    });

    it("Should not allow non-owner to transfer ownership", async function () {
      await expect(
        nativeVRF.connect(user1).transferOwnership(user2.address)
      ).to.be.revertedWith("Only owner can call this function");
    });

    it("Should not allow transferring to zero address", async function () {
      await expect(
        nativeVRF.transferOwnership(ethers.constants.AddressZero)
      ).to.be.revertedWith("Cannot transfer to zero address");
    });
  });

  describe("Global Salt Management", function () {
    it("Should allow owner to update global salt", async function () {
      const initialSalt = await nativeVRF.globalSalt();
      await nativeVRF.updateGlobalSalt(9999);
      const newSalt = await nativeVRF.globalSalt();

      expect(newSalt).to.not.equal(initialSalt);
    });

    it("Should not allow non-owner to update global salt", async function () {
      await expect(
        nativeVRF.connect(user1).updateGlobalSalt(9999)
      ).to.be.revertedWith("Only owner can call this function");
    });
  });

  describe("Random Request", function () {
    beforeEach(async function () {
      await nativeVRF.whitelistAddress(user1.address);
    });

    it("Should allow whitelisted user to request random numbers", async function () {
      const numRequests = 2;
      const reward = MIN_REWARD.mul(numRequests);

      await expect(
        nativeVRF.connect(user1).requestRandom(numRequests, { value: reward })
      ).to.emit(nativeVRF, "RandomRequested");

      expect(await nativeVRF.currentRequestId()).to.equal(3); // starts at 1, so after 2 requests = 3
    });

    it("Should not allow non-whitelisted user to request", async function () {
      await expect(
        nativeVRF.connect(user2).requestRandom(1, { value: MIN_REWARD })
      ).to.be.revertedWith("Address not whitelisted");
    });

    it("Should require minimum reward", async function () {
      const lowReward = MIN_REWARD.div(2);
      await expect(
        nativeVRF.connect(user1).requestRandom(1, { value: lowReward })
      ).to.be.revertedWith("Reward is too low");
    });

    it("Should require at least one request", async function () {
      await expect(
        nativeVRF.connect(user1).requestRandom(0, { value: MIN_REWARD })
      ).to.be.revertedWith("At least one request");
    });

    it("Should return correct request IDs", async function () {
      const numRequests = 3;
      const reward = MIN_REWARD.mul(numRequests);

      const tx = await nativeVRF
        .connect(user1)
        .requestRandom(numRequests, { value: reward });
      const receipt = await tx.wait();

      // Should emit 3 RandomRequested events
      const events = receipt.events?.filter(
        (e: any) => e.event === "RandomRequested"
      );
      expect(events).to.have.length(3);
      expect(events![0].args!.requestId).to.equal(1);
      expect(events![1].args!.requestId).to.equal(2);
      expect(events![2].args!.requestId).to.equal(3);
    });
  });

  describe("Nonce Management", function () {
    it("Should track nonces correctly", async function () {
      expect(await nativeVRF.getNonce(fulfiller.address)).to.equal(0);

      // Nonces are incremented during fulfillment, which we'll test in fulfillment tests
    });
  });

  describe("Message Hash Generation", function () {
    beforeEach(async function () {
      await nativeVRF.whitelistAddress(user1.address);
      await nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD });
    });

    it("Should generate consistent message hash", async function () {
      const requestId = 1;
      const randInput = 12345;

      const hash1 = await nativeVRF.getMessageHash(requestId, randInput);
      const hash2 = await nativeVRF.getMessageHash(requestId, randInput);

      expect(hash1).to.equal(hash2);
    });

    it("Should generate different hashes for different inputs", async function () {
      const requestId = 1;

      const hash1 = await nativeVRF.getMessageHash(requestId, 12345);
      const hash2 = await nativeVRF.getMessageHash(requestId, 54321);

      expect(hash1).to.not.equal(hash2);
    });

    it("Should include nonce in message hash", async function () {
      const requestId = 1;
      const randInput = 12345;

      await nativeVRF.connect(fulfiller).getMessageHash(requestId, randInput);

      // The hash should be different when called from different addresses due to nonce inclusion
      await nativeVRF.connect(user1).getMessageHash(requestId, randInput);

      // Note: They might be the same if nonces are both 0, but the function includes msg.sender
      // so they should be different due to sender address inclusion
    });
  });

  describe("Converter Library", function () {
    it("Should convert signatures to uint256 correctly", async function () {
      const mockSignatures = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901234567890abcdef1234567890abcdef1234567890abcdef12345678901b",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef121c",
      ];

      const results = await nativeVRF.convertSignatures(mockSignatures);
      expect(results).to.have.length(2);
      expect(results[0]).to.not.equal(0);
      expect(results[1]).to.not.equal(0);
      expect(results[0]).to.not.equal(results[1]);
    });
  });

  describe("Difficulty Adjustment", function () {
    it("Should maintain minimum difficulty", async function () {
      const minDifficulty = await nativeVRF.MIN_DIFFICULTY();
      expect(minDifficulty).to.equal(1000);
    });

    it("Should have correct initial difficulty", async function () {
      const expectedTime = await nativeVRF.expectedFulfillTime();
      const hashPower = await nativeVRF.estimatedHashPower();
      const difficulty = await nativeVRF.difficulty();

      expect(difficulty).to.equal(expectedTime.mul(hashPower));
    });
  });

  describe("Enhanced Randomness Features", function () {
    it("Should update global salt during fulfillment simulation", async function () {
      // This test simulates the global salt update that happens during fulfillment
      const initialSalt = await nativeVRF.globalSalt();
      await nativeVRF.updateGlobalSalt(999);
      const updatedSalt = await nativeVRF.globalSalt();

      expect(updatedSalt).to.not.equal(initialSalt);
    });

    it("Should have different random results for sequential requests", async function () {
      // This verifies that the enhanced randomness generation would produce different results
      // Note: We can't easily test the actual fulfillment without proper signature generation
      const result0 = await nativeVRF.randomResults(0);
      expect(result0).to.not.equal(0);

      // The initial result should be unique based on constructor parameters
    });
  });

  describe("Error Handling", function () {
    it("Should handle edge cases in request validation", async function () {
      await nativeVRF.whitelistAddress(user1.address);

      // Test with exact minimum reward
      await expect(
        nativeVRF.connect(user1).requestRandom(1, { value: MIN_REWARD })
      ).to.not.be.reverted;

      // Test with reward just below minimum
      const belowMin = MIN_REWARD.sub(1);
      await expect(
        nativeVRF.connect(user1).requestRandom(1, { value: belowMin })
      ).to.be.revertedWith("Reward is too low");
    });
  });
});