import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function mineBlock() {
  await network.provider.send("evm_mine", []);
}

async function mineBlocks(n: number) {
  for (let i = 0; i < n; i++) await mineBlock();
}

// Rarity enum mirrors contract
enum Rarity {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
  Mythic = 5,
  Eternal = 6,
}

enum ReforgeType {
  Standard = 0,
  Legendary = 1,
  Mythic = 2,
  Craft = 3,
}

// tokenRarity value ranges per tier (mirrors contract constants)
const RARITY_STARTS = [1, 101, 201, 301, 401, 501, 601];
const RARITY_COUNTS = [28, 22, 22, 20, 18, 16, 13];

function rarityValueForTier(rarity: Rarity, offset = 0): number {
  return RARITY_STARTS[rarity] + (offset % RARITY_COUNTS[rarity]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("OtherRelicReforging", function () {
  let reforging: Contract;
  let otherRelics: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const CRAFT_COST = ethers.utils.parseEther("15");
  const DEAD = "0x000000000000000000000000000000000000dEaD";

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const MockOtherRelics = await ethers.getContractFactory("MockOtherRelics");
    otherRelics = await MockOtherRelics.deploy();
    await otherRelics.deployed();

    const OtherRelicReforging = await ethers.getContractFactory("OtherRelicReforging");
    reforging = await OtherRelicReforging.deploy(otherRelics.address);
    await reforging.deployed();

    await otherRelics.addMinter(reforging.address);

    await otherRelics.connect(user1).setApprovalForAll(reforging.address, true);
    await otherRelics.connect(user2).setApprovalForAll(reforging.address, true);
    await otherRelics.connect(user3).setApprovalForAll(reforging.address, true);
  });

  // ─── Test helpers ──────────────────────────────────────────────────────────

  async function mintRelics(
    to: SignerWithAddress,
    rarityValue: number,
    count: number
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const tx = await otherRelics.mint(to.address, rarityValue);
      const receipt = await tx.wait();
      const ev = receipt.events?.find((e: any) => e.event === "TokenMinted");
      ids.push(ev.args.tokenId.toNumber());
    }
    return ids;
  }

  async function burnAndClaim(
    user: SignerWithAddress,
    relicIds: number[],
    fn: "reforge" | "reforgeLegendary" | "reforgeMythic"
  ) {
    const burnTx = await reforging.connect(user)[fn](relicIds);
    const burnReceipt = await burnTx.wait();
    const burnEv = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned");
    const requestId: BigNumber = burnEv.args.requestId;

    await mineBlock();

    const claimTx = await reforging.claim(requestId);
    const claimReceipt = await claimTx.wait();
    const claimEv = claimReceipt.events?.find((e: any) => e.event === "Claimed");
    return { requestId, claimEv };
  }

  async function craftAndClaim(user: SignerWithAddress) {
    const startTx = await reforging.connect(user).startCraft({ value: CRAFT_COST });
    const startReceipt = await startTx.wait();
    const startEv = startReceipt.events?.find((e: any) => e.event === "CraftStarted");
    const requestId: BigNumber = startEv.args.requestId;

    await mineBlock();

    const claimTx = await reforging.claim(requestId);
    const claimReceipt = await claimTx.wait();
    const claimEv = claimReceipt.events?.find((e: any) => e.event === "Claimed");
    return { requestId, claimEv };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Deployment
  // ──────────────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores OtherRelics address", async function () {
      expect(await reforging.otherRelics()).to.equal(otherRelics.address);
    });

    it("sets owner correctly", async function () {
      expect(await reforging.owner()).to.equal(owner.address);
    });

    it("sets default craft cost to 15 APE", async function () {
      expect(await reforging.craftCost()).to.equal(CRAFT_COST);
    });

    it("starts nextRequestId at 1", async function () {
      expect(await reforging.nextRequestId()).to.equal(1);
    });

    it("reverts on zero OtherRelics address", async function () {
      const Factory = await ethers.getContractFactory("OtherRelicReforging");
      await expect(Factory.deploy(ethers.constants.AddressZero)).to.be.reverted; // ZeroAddress
    });

    it("starts with zero totalReforges and totalCrafts", async function () {
      expect(await reforging.totalReforges()).to.equal(0);
      expect(await reforging.totalCrafts()).to.equal(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reforge() — burn step
  // ──────────────────────────────────────────────────────────────────────────

  describe("reforge() — burn step", function () {
    it("burns relics and emits ReforgeBurned", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const tx = await reforging.connect(user1).reforge(ids);
      const receipt = await tx.wait();
      const ev = receipt.events?.find((e: any) => e.event === "ReforgeBurned");
      expect(ev).to.not.be.undefined;
      expect(ev.args.user).to.equal(user1.address);
      expect(ev.args.reforgeType).to.equal(ReforgeType.Standard);
    });

    it("transfers burned relics to dead address", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      expect(await otherRelics.ownerOf(ids[0])).to.equal(DEAD);
      expect(await otherRelics.ownerOf(ids[1])).to.equal(DEAD);
    });

    it("returns and increments requestId", async function () {
      const ids1 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const ids2 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);

      const r1 = await (await reforging.connect(user1).reforge(ids1)).wait();
      expect(r1.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId).to.equal(1);

      const r2 = await (await reforging.connect(user1).reforge(ids2)).wait();
      expect(r2.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId).to.equal(2);
    });

    it("stores pending request with correct data", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Rare), 3);
      const tx = await reforging.connect(user1).reforge(ids);
      const blockNum = (await tx.wait()).blockNumber;

      const req = await reforging.getPendingRequest(1);
      expect(req.user).to.equal(user1.address);
      expect(req.reforgeType).to.equal(ReforgeType.Standard);
      expect(req.baseRarity).to.equal(Rarity.Rare);
      expect(req.relicCount).to.equal(3);
      expect(req.burnBlock).to.equal(blockNum);
      expect(req.claimed).to.equal(false);
    });

    it("tracks requestId in user history", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Epic), 2);
      await reforging.connect(user1).reforge(ids);
      const history = await reforging.getUserRequestIds(user1.address);
      expect(history.length).to.equal(1);
      expect(history[0]).to.equal(1);
    });

    // ── Validation errors ──────────────────────────────────────────────────

    it("reverts with InvalidRelicCount for < 2 relics", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 1);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRelicCount
    });

    it("reverts with InvalidRelicCount for > 5 relics", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 6);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRelicCount
    });

    it("reverts with DuplicateRelic when same tokenId appears twice", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 1);
      await expect(reforging.connect(user1).reforge([ids[0], ids[0]])).to.be.reverted; // DuplicateRelic
    });

    it("reverts with NotRelicOwner when caller does not own relics", async function () {
      const ids = await mintRelics(user2, rarityValueForTier(Rarity.Common), 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // NotRelicOwner
    });

    it("reverts with NotRelicOwner when second relic owned by another user", async function () {
      const id1 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 1);
      const id2 = await mintRelics(user2, rarityValueForTier(Rarity.Common), 1);
      await expect(reforging.connect(user1).reforge([id1[0], id2[0]])).to.be.reverted; // NotRelicOwner
    });

    it("reverts with InconsistentRarity when relics span different tiers", async function () {
      const commonId = await mintRelics(user1, rarityValueForTier(Rarity.Common), 1);
      const uncommonId = await mintRelics(user1, rarityValueForTier(Rarity.Uncommon), 1);
      await expect(
        reforging.connect(user1).reforge([commonId[0], uncommonId[0]])
      ).to.be.reverted; // InconsistentRarity
    });

    it("reverts with InconsistentRelicType when same tier but different type", async function () {
      const id1 = await mintRelics(user1, 1, 1); // Common type 1
      const id2 = await mintRelics(user1, 2, 1); // Common type 2
      await expect(
        reforging.connect(user1).reforge([id1[0], id2[0]])
      ).to.be.reverted; // InconsistentRelicType
    });

    it("reverts with InvalidRarityForReforge for Legendary input", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts with InvalidRarityForReforge for Mythic input", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts with InvalidRarityForReforge for Eternal input", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Eternal), 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts InvalidRelicRarityValue for tokenRarity = 0", async function () {
      const ids = await mintRelics(user1, 0, 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRelicRarityValue
    });

    it("reverts InvalidRelicRarityValue for tokenRarity > 700", async function () {
      const ids = await mintRelics(user1, 701, 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // InvalidRelicRarityValue
    });

    it("reverts when contract is paused", async function () {
      await reforging.pause();
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.revertedWith("Pausable: paused");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reforgeLegendary() — burn step
  // ──────────────────────────────────────────────────────────────────────────

  describe("reforgeLegendary() — burn step", function () {
    it("accepts exactly 3 Legendary relics and emits ReforgeBurned", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      const receipt = await (await reforging.connect(user1).reforgeLegendary(ids)).wait();
      const ev = receipt.events?.find((e: any) => e.event === "ReforgeBurned");
      expect(ev).to.not.be.undefined;
      expect(ev.args.reforgeType).to.equal(ReforgeType.Legendary);
    });

    it("stores ReforgeType.Legendary and correct baseRarity in request", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      await reforging.connect(user1).reforgeLegendary(ids);
      const req = await reforging.getPendingRequest(1);
      expect(req.reforgeType).to.equal(ReforgeType.Legendary);
      expect(req.baseRarity).to.equal(Rarity.Legendary);
    });

    it("burns all 3 relics to dead address", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      await reforging.connect(user1).reforgeLegendary(ids);
      for (const id of ids) {
        expect(await otherRelics.ownerOf(id)).to.equal(DEAD);
      }
    });

    it("reverts with InvalidRelicCount for 2 relics", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 2);
      await expect(reforging.connect(user1).reforgeLegendary(ids)).to.be.reverted; // InvalidRelicCount
    });

    it("reverts with InvalidRelicCount for 4 relics", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 4);
      await expect(reforging.connect(user1).reforgeLegendary(ids)).to.be.reverted; // InvalidRelicCount
    });

    it("reverts InvalidRarityForReforge when input is not Legendary", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Epic), 3);
      await expect(reforging.connect(user1).reforgeLegendary(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts InvalidRarityForReforge when input is Mythic", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      await expect(reforging.connect(user1).reforgeLegendary(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts when paused", async function () {
      await reforging.pause();
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      await expect(reforging.connect(user1).reforgeLegendary(ids)).to.be.revertedWith("Pausable: paused");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reforgeMythic() — burn step
  // ──────────────────────────────────────────────────────────────────────────

  describe("reforgeMythic() — burn step", function () {
    it("accepts exactly 3 Mythic relics and emits ReforgeBurned", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      const receipt = await (await reforging.connect(user1).reforgeMythic(ids)).wait();
      const ev = receipt.events?.find((e: any) => e.event === "ReforgeBurned");
      expect(ev).to.not.be.undefined;
      expect(ev.args.reforgeType).to.equal(ReforgeType.Mythic);
    });

    it("stores ReforgeType.Mythic and correct baseRarity", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      await reforging.connect(user1).reforgeMythic(ids);
      const req = await reforging.getPendingRequest(1);
      expect(req.reforgeType).to.equal(ReforgeType.Mythic);
      expect(req.baseRarity).to.equal(Rarity.Mythic);
    });

    it("reverts with InvalidRelicCount for 2 relics", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 2);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.be.reverted; // InvalidRelicCount
    });

    it("reverts InvalidRarityForReforge when input is not Mythic", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts InvalidRarityForReforge when input is Eternal", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Eternal), 3);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.be.reverted; // InvalidRarityForReforge
    });

    it("reverts when paused", async function () {
      await reforging.pause();
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.be.revertedWith("Pausable: paused");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // startCraft() — start step
  // ──────────────────────────────────────────────────────────────────────────

  describe("startCraft() — start step", function () {
    it("emits CraftStarted with correct user and requestId", async function () {
      const receipt = await (
        await reforging.connect(user1).startCraft({ value: CRAFT_COST })
      ).wait();
      const ev = receipt.events?.find((e: any) => e.event === "CraftStarted");
      expect(ev).to.not.be.undefined;
      expect(ev.args.user).to.equal(user1.address);
      expect(ev.args.requestId).to.equal(1);
    });

    it("stores request with ReforgeType.Craft", async function () {
      await reforging.connect(user1).startCraft({ value: CRAFT_COST });
      const req = await reforging.getPendingRequest(1);
      expect(req.user).to.equal(user1.address);
      expect(req.reforgeType).to.equal(ReforgeType.Craft);
      expect(req.claimed).to.equal(false);
    });

    it("keeps craftCost APE in contract balance", async function () {
      const before = await ethers.provider.getBalance(reforging.address);
      await reforging.connect(user1).startCraft({ value: CRAFT_COST });
      const after = await ethers.provider.getBalance(reforging.address);
      expect(after.sub(before)).to.equal(CRAFT_COST);
    });

    it("refunds excess ETH to caller", async function () {
      const extra = ethers.utils.parseEther("1");
      const balBefore = await ethers.provider.getBalance(user1.address);
      const tx = await reforging.connect(user1).startCraft({ value: CRAFT_COST.add(extra) });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(tx.gasPrice!);
      const balAfter = await ethers.provider.getBalance(user1.address);
      // Net spend should be craftCost + gas, not craftCost + extra + gas
      const netSpend = balBefore.sub(balAfter).sub(gasUsed);
      expect(netSpend).to.be.closeTo(CRAFT_COST, ethers.utils.parseEther("0.001"));
    });

    it("reverts InsufficientCraftPayment when msg.value < craftCost", async function () {
      await expect(
        reforging.connect(user1).startCraft({ value: CRAFT_COST.sub(1) })
      ).to.be.reverted; // InsufficientCraftPayment
    });

    it("reverts when paused", async function () {
      await reforging.pause();
      await expect(
        reforging.connect(user1).startCraft({ value: CRAFT_COST })
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // claim() — step 2
  // ──────────────────────────────────────────────────────────────────────────

  describe("claim() — claim step", function () {
    it("reverts ClaimTooEarly when claim is in the same block as burn", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);

      // Disable automine so burn and claim land in the same block
      await network.provider.send("evm_setAutomine", [false]);
      try {
        // Await each submission so both txs reach the mempool before evm_mine fires.
        // With automine off, `await contract.method()` resolves when the node
        // accepts the tx (puts it in mempool), NOT when it is mined.
        const burnTx = await reforging.connect(user1).reforge(ids);

        // Send claim via raw sendTransaction with explicit gasLimit to bypass
        // ethers.js gas estimation (which would simulate & fail on current state).
        const claimData = reforging.interface.encodeFunctionData("claim", [1]);
        const claimRaw = await user2.sendTransaction({
          to: reforging.address,
          data: claimData,
          gasLimit: 200_000,
        });

        // Mine both txs into the same block
        await network.provider.send("evm_mine", []);
        await network.provider.send("evm_setAutomine", [true]);

        // Burn should have succeeded
        await burnTx.wait();

        // Claim should have reverted (ClaimTooEarly: block.number == burnBlock)
        await expect(claimRaw.wait()).to.be.reverted;
      } catch (e) {
        await network.provider.send("evm_setAutomine", [true]);
        throw e;
      }
    });

    it("reverts RequestNotFound for non-existent requestId", async function () {
      await expect(reforging.claim(999)).to.be.reverted; // RequestNotFound
    });

    it("reverts AlreadyClaimed on double-claim", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      await reforging.claim(requestId);

      await expect(reforging.claim(requestId)).to.be.reverted; // AlreadyClaimed
    });

    it("can be called by anyone — relic minted to original user", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      // user2 calls claim on user1's request
      const claimReceipt = await (await reforging.connect(user2).claim(requestId)).wait();
      const claimEv = claimReceipt.events?.find((e: any) => e.event === "Claimed");

      expect(claimEv.args.user).to.equal(user1.address);
      expect(await otherRelics.balanceOf(user1.address)).to.equal(1);
      expect(await otherRelics.balanceOf(user2.address)).to.equal(0);
    });

    it("marks request as claimed after successful claim", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      await reforging.claim(requestId);

      expect((await reforging.getPendingRequest(requestId)).claimed).to.equal(true);
    });

    it("mints exactly one relic to user per claim", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      // User1 burned both relics — balance now 0
      const afterBurn = await otherRelics.balanceOf(user1.address);

      await mineBlock();
      await reforging.claim(requestId);

      const afterClaim = await otherRelics.balanceOf(user1.address);
      expect(afterClaim.sub(afterBurn)).to.equal(1); // exactly 1 new relic
    });

    it("emits Claimed with correct user, requestId, and reforgeType", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      const claimReceipt = await (await reforging.claim(requestId)).wait();
      const ev = claimReceipt.events?.find((e: any) => e.event === "Claimed");

      expect(ev.args.user).to.equal(user1.address);
      expect(ev.args.requestId).to.equal(requestId);
      expect(ev.args.reforgeType).to.equal(ReforgeType.Standard);
      expect(ev.args.inputRarity).to.equal(Rarity.Common);
    });

    it("increments totalReforges (not totalCrafts) on reforge claim", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      await reforging.claim(requestId);

      expect(await reforging.totalReforges()).to.equal(1);
      expect(await reforging.totalCrafts()).to.equal(0);
    });

    it("increments totalCrafts (not totalReforges) on craft claim", async function () {
      const startReceipt = await (
        await reforging.connect(user1).startCraft({ value: CRAFT_COST })
      ).wait();
      const requestId = startReceipt.events?.find((e: any) => e.event === "CraftStarted").args.requestId;

      await mineBlock();
      await reforging.claim(requestId);

      expect(await reforging.totalCrafts()).to.equal(1);
      expect(await reforging.totalReforges()).to.equal(0);
    });

    it("uses fallback entropy when claimed after 256 blocks", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnReceipt = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      // Mine past the 256-block blockhash window
      await mineBlocks(260);

      await expect(reforging.claim(requestId)).to.emit(reforging, "Claimed");
      expect(await otherRelics.balanceOf(user1.address)).to.equal(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full round-trip — Standard Reforge
  // ──────────────────────────────────────────────────────────────────────────

  describe("Full round-trip — Standard Reforge", function () {
    async function runStandardReforge(
      user: SignerWithAddress,
      inputRarity: Rarity,
      count: number
    ): Promise<number> {
      const rv = rarityValueForTier(inputRarity);
      const ids = await mintRelics(user, rv, count);
      const { claimEv } = await burnAndClaim(user, ids, "reforge");

      const resultRarity: number = claimEv.args.resultRarity;
      const resultRarityValue: number = claimEv.args.resultRelicRarityValue.toNumber();

      // Result must be >= inputRarity (never downgraded)
      expect(resultRarity).to.be.gte(inputRarity);
      // max +1 for 2 relics, +2 for 3-5 relics; output hard-capped at Legendary
      const maxBoost = count === 2 ? 1 : 2;
      expect(resultRarity).to.be.lte(Math.min(inputRarity + maxBoost, Rarity.Legendary));

      // tokenRarity value must be in correct tier range
      expect(resultRarityValue).to.be.gte(RARITY_STARTS[resultRarity]);
      expect(resultRarityValue).to.be.lt(RARITY_STARTS[resultRarity] + RARITY_COUNTS[resultRarity]);

      return resultRarity;
    }

    it("2 relics: result is same or +1 tier, never +2", async function () {
      for (let i = 0; i < 10; i++) {
        const result = await runStandardReforge(user1, Rarity.Common, 2);
        expect(result).to.be.lte(Rarity.Uncommon); // max +1 from Common
      }
    });

    it("3 relics: result is same, +1, or +2 tier", async function () {
      for (let i = 0; i < 10; i++) {
        await runStandardReforge(user1, Rarity.Uncommon, 3);
      }
    });

    it("4 relics: result is +1 or +2 tier (never same)", async function () {
      for (let i = 0; i < 10; i++) {
        const result = await runStandardReforge(user1, Rarity.Common, 4);
        expect(result).to.be.gte(Rarity.Uncommon); // never same tier
      }
    });

    it("5 relics: result is +1 or +2 tier (never same)", async function () {
      for (let i = 0; i < 10; i++) {
        const result = await runStandardReforge(user1, Rarity.Common, 5);
        expect(result).to.be.gte(Rarity.Uncommon);
      }
    });

    it("Rare input (3 relics): result is Rare, Epic, or Legendary", async function () {
      const result = await runStandardReforge(user1, Rarity.Rare, 3);
      expect([Rarity.Rare, Rarity.Epic, Rarity.Legendary]).to.include(result);
    });

    it("Epic input (3 relics): result is Epic or Legendary (never Mythic — +2 capped)", async function () {
      const result = await runStandardReforge(user1, Rarity.Epic, 3);
      expect([Rarity.Epic, Rarity.Legendary]).to.include(result);
    });

    it("Legendary input: rejects with InvalidRarityForReforge", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted;
    });

    it("all 4 valid standard input rarities (Common–Epic) work without revert", async function () {
      const validInputs = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic];
      for (const r of validInputs) {
        const ids = await mintRelics(user1, rarityValueForTier(r), 2);
        await expect(reforging.connect(user1).reforge(ids)).to.not.be.reverted;
        await mineBlock();
        const ids2 = await reforging.getUserRequestIds(user1.address);
        await reforging.claim(ids2[ids2.length - 1]);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full round-trip — Legendary Reforge
  // ──────────────────────────────────────────────────────────────────────────

  describe("Full round-trip — reforgeLegendary()", function () {
    it("result is always Legendary or Mythic", async function () {
      for (let i = 0; i < 15; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
        const { claimEv } = await burnAndClaim(user1, ids, "reforgeLegendary");
        const result: number = claimEv.args.resultRarity;
        expect([Rarity.Legendary, Rarity.Mythic]).to.include(result);
      }
    });

    it("resultRelicRarityValue is in the correct tier range", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      const { claimEv } = await burnAndClaim(user1, ids, "reforgeLegendary");
      const rv: number = claimEv.args.resultRelicRarityValue.toNumber();
      const result: number = claimEv.args.resultRarity;
      expect(rv).to.be.gte(RARITY_STARTS[result]);
      expect(rv).to.be.lt(RARITY_STARTS[result] + RARITY_COUNTS[result]);
    });

    it("emits Claimed with reforgeType = Legendary", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
      const { claimEv } = await burnAndClaim(user1, ids, "reforgeLegendary");
      expect(claimEv.args.reforgeType).to.equal(ReforgeType.Legendary);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full round-trip — Mythic Reforge
  // ──────────────────────────────────────────────────────────────────────────

  describe("Full round-trip — reforgeMythic()", function () {
    it("result is always Mythic or Eternal", async function () {
      for (let i = 0; i < 15; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
        const { claimEv } = await burnAndClaim(user1, ids, "reforgeMythic");
        const result: number = claimEv.args.resultRarity;
        expect([Rarity.Mythic, Rarity.Eternal]).to.include(result);
      }
    });

    it("resultRelicRarityValue is in Mythic or Eternal range", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      const { claimEv } = await burnAndClaim(user1, ids, "reforgeMythic");
      const rv: number = claimEv.args.resultRelicRarityValue.toNumber();
      const result: number = claimEv.args.resultRarity;
      expect(rv).to.be.gte(RARITY_STARTS[result]);
      expect(rv).to.be.lt(RARITY_STARTS[result] + RARITY_COUNTS[result]);
    });

    it("emits Claimed with reforgeType = Mythic", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
      const { claimEv } = await burnAndClaim(user1, ids, "reforgeMythic");
      expect(claimEv.args.reforgeType).to.equal(ReforgeType.Mythic);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full round-trip — Random Craft
  // ──────────────────────────────────────────────────────────────────────────

  describe("Full round-trip — startCraft() / claim()", function () {
    it("result is always Common, Uncommon, or Rare", async function () {
      for (let i = 0; i < 15; i++) {
        const { claimEv } = await craftAndClaim(user1);
        const result: number = claimEv.args.resultRarity;
        expect([Rarity.Common, Rarity.Uncommon, Rarity.Rare]).to.include(result);
      }
    });

    it("resultRelicRarityValue is in the correct tier range", async function () {
      const { claimEv } = await craftAndClaim(user1);
      const rv: number = claimEv.args.resultRelicRarityValue.toNumber();
      const result: number = claimEv.args.resultRarity;
      expect(rv).to.be.gte(RARITY_STARTS[result]);
      expect(rv).to.be.lt(RARITY_STARTS[result] + RARITY_COUNTS[result]);
    });

    it("mints relic to crafter", async function () {
      await craftAndClaim(user1);
      expect(await otherRelics.balanceOf(user1.address)).to.equal(1);
    });

    it("emits Claimed with reforgeType = Craft", async function () {
      const { claimEv } = await craftAndClaim(user1);
      expect(claimEv.args.reforgeType).to.equal(ReforgeType.Craft);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Probability distribution — statistical sanity checks
  // ──────────────────────────────────────────────────────────────────────────

  describe("Probability distribution — statistical checks", function () {
    this.timeout(180_000);

    it("2-relic reforge: ~40 % same tier, ~60 % +1 (never +2), 40 trials", async function () {
      let sameTier = 0, plusOne = 0;
      const TRIALS = 40;

      for (let i = 0; i < TRIALS; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
        const { claimEv } = await burnAndClaim(user1, ids, "reforge");
        const result: number = claimEv.args.resultRarity;
        if (result === Rarity.Common) sameTier++;
        else plusOne++;
      }

      expect(sameTier + plusOne).to.equal(TRIALS); // no +2 ever for 2 relics
      expect(sameTier / TRIALS).to.be.within(0.20, 0.65); // target 40 %
      expect(plusOne / TRIALS).to.be.within(0.35, 0.80); // target 60 %
    });

    it("4-relic reforge: never same tier, both +1 and +2 possible, 20 trials", async function () {
      let plusOne = 0, plusTwo = 0;
      const TRIALS = 20;

      for (let i = 0; i < TRIALS; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 4);
        const { claimEv } = await burnAndClaim(user1, ids, "reforge");
        const result: number = claimEv.args.resultRarity;
        expect(result).to.not.equal(Rarity.Common); // 0 % same tier
        if (result === Rarity.Uncommon) plusOne++;
        else plusTwo++;
      }

      expect(plusOne + plusTwo).to.equal(TRIALS);
      expect(plusOne).to.be.gte(10); // target 95 % +1
    });

    it("legendary reforge: both Legendary and Mythic appear within 30 trials", async function () {
      const results = new Set<number>();
      for (let i = 0; i < 30; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
        const { claimEv } = await burnAndClaim(user1, ids, "reforgeLegendary");
        results.add(claimEv.args.resultRarity);
      }
      expect(results.has(Rarity.Legendary)).to.be.true;
      expect(results.has(Rarity.Mythic)).to.be.true;
    });

    it("mythic reforge: both Mythic and Eternal appear within 30 trials", async function () {
      const results = new Set<number>();
      for (let i = 0; i < 30; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Mythic), 3);
        const { claimEv } = await burnAndClaim(user1, ids, "reforgeMythic");
        results.add(claimEv.args.resultRarity);
      }
      expect(results.has(Rarity.Mythic)).to.be.true;
      expect(results.has(Rarity.Eternal)).to.be.true;
    });

    it("craft: Common dominant in 30 trials (≥ 20/30)", async function () {
      let commonCount = 0;
      for (let i = 0; i < 30; i++) {
        const { claimEv } = await craftAndClaim(user1);
        if (claimEv.args.resultRarity === Rarity.Common) commonCount++;
      }
      expect(commonCount).to.be.gte(20); // target 95 %
    });

    it("nonce prevents identical entropy across sequential same-rarity claims", async function () {
      const results = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const ids = await mintRelics(user1, rarityValueForTier(Rarity.Legendary), 3);
        const { claimEv } = await burnAndClaim(user1, ids, "reforgeLegendary");
        results.add(`${claimEv.args.resultRarity}-${claimEv.args.resultRelicRarityValue}`);
      }
      // 5 trials over the same rarity — highly unlikely all identical
      expect(results.size).to.be.gte(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Rarity range coverage for _getRarityFromValue — all boundary values
  // ──────────────────────────────────────────────────────────────────────────

  describe("Rarity value parsing — boundary values", function () {
    async function assertValidInput(value: number) {
      const ids = await mintRelics(user1, value, 2);
      await expect(reforging.connect(user1).reforge(ids)).to.not.be.reverted;
      await mineBlock();
      const reqIds = await reforging.getUserRequestIds(user1.address);
      await reforging.claim(reqIds[reqIds.length - 1]);
    }

    async function assertInvalidInput(value: number) {
      const ids = await mintRelics(user1, value, 2);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted;
    }

    it("value 1 (Common min) is valid", async () => assertValidInput(1));
    it("value 100 (Common max) is valid", async () => assertValidInput(100));
    it("value 101 (Uncommon min) is valid", async () => assertValidInput(101));
    it("value 200 (Uncommon max) is valid", async () => assertValidInput(200));
    it("value 201 (Rare min) is valid", async () => assertValidInput(201));
    it("value 300 (Rare max) is valid", async () => assertValidInput(300));
    it("value 301 (Epic min) is valid", async () => assertValidInput(301));
    it("value 400 (Epic max) is valid", async () => assertValidInput(400));
    // Legendary, Mythic, and Eternal are parsed correctly but all rejected by standard reforge
    it("value 401 (Legendary min) rejected by standard reforge", async () => assertInvalidInput(401));
    it("value 500 (Legendary max) rejected by standard reforge", async () => assertInvalidInput(500));
    it("value 501 (Mythic min) rejected by standard reforge", async () => assertInvalidInput(501));
    it("value 600 (Mythic max) rejected by standard reforge", async () => assertInvalidInput(600));
    it("value 601 (Eternal min) rejected by standard reforge", async () => assertInvalidInput(601));
    it("value 700 (Eternal max) rejected by standard reforge", async () => assertInvalidInput(700));

    // Truly invalid values (not in any rarity range)
    it("value 0 is invalid (no range)", async () => assertInvalidInput(0));
    it("value 701 is invalid (no range)", async () => assertInvalidInput(701));

    // Mythic parsed correctly and accepted by reforgeMythic
    it("value 501 is parsed as Mythic and accepted by reforgeMythic", async function () {
      const ids = await mintRelics(user1, 501, 3);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.not.be.reverted;
    });

    // Eternal parsed correctly and accepted by reforgeMythic (via chain: Mythic→Eternal result)
    it("value 601 is parsed as Eternal and rejected by reforgeMythic (not Mythic)", async function () {
      const ids = await mintRelics(user1, 601, 3);
      await expect(reforging.connect(user1).reforgeMythic(ids)).to.be.reverted; // InvalidRarityForReforge(Eternal)
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Anti-abuse
  // ──────────────────────────────────────────────────────────────────────────

  describe("Anti-abuse", function () {
    it("duplicate check catches all-same in 3-relic array", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 1);
      await expect(
        reforging.connect(user1).reforge([ids[0], ids[0], ids[0]])
      ).to.be.reverted; // DuplicateRelic
    });

    it("duplicate check catches a single repeat in 5-relic array", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 4);
      await expect(
        reforging.connect(user1).reforge([ids[0], ids[1], ids[2], ids[3], ids[0]])
      ).to.be.reverted; // DuplicateRelic
    });

    it("cannot reforge relic transferred away before burn", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await otherRelics.connect(user1).transferFrom(user1.address, user2.address, ids[1]);
      await expect(reforging.connect(user1).reforge(ids)).to.be.reverted; // NotRelicOwner
    });

    it("cannot craft with zero value", async function () {
      await expect(reforging.connect(user1).startCraft({ value: 0 })).to.be.reverted; // InsufficientCraftPayment
    });

    it("multiple users have independent request sequences", async function () {
      const ids1 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const ids2 = await mintRelics(user2, rarityValueForTier(Rarity.Legendary), 3);

      const r1 = await (await reforging.connect(user1).reforge(ids1)).wait();
      const reqId1 = r1.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      const r2 = await (await reforging.connect(user2).reforgeLegendary(ids2)).wait();
      const reqId2 = r2.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();

      await reforging.claim(reqId1);
      await reforging.claim(reqId2);

      expect(await otherRelics.balanceOf(user1.address)).to.equal(1);
      expect(await otherRelics.balanceOf(user2.address)).to.equal(1);
      expect((await reforging.getPendingRequest(reqId1)).claimed).to.be.true;
      expect((await reforging.getPendingRequest(reqId2)).claimed).to.be.true;
    });

    it("cannot claim someone else's request to steal the relic", async function () {
      // user2 tries to claim user1's request — they can, but relic goes to user1 not user2
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const r = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = r.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      await reforging.connect(user2).claim(requestId); // user2 triggers but relic → user1

      expect(await otherRelics.balanceOf(user1.address)).to.equal(1);
      expect(await otherRelics.balanceOf(user2.address)).to.equal(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Admin
  // ──────────────────────────────────────────────────────────────────────────

  describe("Admin — setCraftCost()", function () {
    it("owner updates craft cost and emits CraftCostUpdated", async function () {
      const newCost = ethers.utils.parseEther("20");
      await expect(reforging.setCraftCost(newCost))
        .to.emit(reforging, "CraftCostUpdated")
        .withArgs(CRAFT_COST, newCost);
      expect(await reforging.craftCost()).to.equal(newCost);
    });

    it("non-owner cannot update craft cost", async function () {
      await expect(
        reforging.connect(user1).setCraftCost(ethers.utils.parseEther("5"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("updated cost is enforced on subsequent startCraft calls", async function () {
      const newCost = ethers.utils.parseEther("20");
      await reforging.setCraftCost(newCost);

      await expect(
        reforging.connect(user1).startCraft({ value: CRAFT_COST })
      ).to.be.reverted; // InsufficientCraftPayment

      await expect(
        reforging.connect(user1).startCraft({ value: newCost })
      ).to.emit(reforging, "CraftStarted");
    });
  });

  describe("Admin — setOtherRelics()", function () {
    it("owner updates OtherRelics address and emits event", async function () {
      const MockOtherRelics = await ethers.getContractFactory("MockOtherRelics");
      const newRelics = await MockOtherRelics.deploy();
      await newRelics.deployed();

      await expect(reforging.setOtherRelics(newRelics.address))
        .to.emit(reforging, "OtherRelicsUpdated")
        .withArgs(newRelics.address);
      expect(await reforging.otherRelics()).to.equal(newRelics.address);
    });

    it("reverts on zero address", async function () {
      await expect(
        reforging.setOtherRelics(ethers.constants.AddressZero)
      ).to.be.reverted; // ZeroAddress
    });

    it("non-owner cannot update address", async function () {
      await expect(
        reforging.connect(user1).setOtherRelics(otherRelics.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Admin — pause / unpause", function () {
    it("owner can pause and unpause", async function () {
      await reforging.pause();
      expect(await reforging.paused()).to.be.true;
      await reforging.unpause();
      expect(await reforging.paused()).to.be.false;
    });

    it("non-owner cannot pause", async function () {
      await expect(reforging.connect(user1).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("non-owner cannot unpause", async function () {
      await reforging.pause();
      await expect(reforging.connect(user1).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("claim still works while paused (relics already burned)", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const r = await (await reforging.connect(user1).reforge(ids)).wait();
      const requestId = r.events?.find((e: any) => e.event === "ReforgeBurned").args.requestId;

      await mineBlock();
      await reforging.pause();

      // Claim is not guarded by whenNotPaused — user must always be able to claim
      await expect(reforging.claim(requestId)).to.emit(reforging, "Claimed");
    });
  });

  describe("Admin — withdrawCraftFees()", function () {
    it("owner withdraws accumulated craft fees", async function () {
      await reforging.connect(user1).startCraft({ value: CRAFT_COST });

      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx = await reforging.withdrawCraftFees(owner.address);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(tx.gasPrice!);
      const balAfter = await ethers.provider.getBalance(owner.address);

      expect(balAfter.sub(balBefore).add(gasUsed)).to.equal(CRAFT_COST);
      expect(await ethers.provider.getBalance(reforging.address)).to.equal(0);
    });

    it("reverts when no fees to withdraw", async function () {
      await expect(reforging.withdrawCraftFees(owner.address)).to.be.reverted; // NoBalance
    });

    it("reverts on zero address recipient", async function () {
      await reforging.connect(user1).startCraft({ value: CRAFT_COST });
      await expect(
        reforging.withdrawCraftFees(ethers.constants.AddressZero)
      ).to.be.reverted; // ZeroAddress
    });

    it("non-owner cannot withdraw", async function () {
      await reforging.connect(user1).startCraft({ value: CRAFT_COST });
      await expect(
        reforging.connect(user1).withdrawCraftFees(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // View Functions
  // ──────────────────────────────────────────────────────────────────────────

  describe("View Functions", function () {
    it("getPendingRequest returns zero struct for unknown id", async function () {
      const req = await reforging.getPendingRequest(999);
      expect(req.user).to.equal(ethers.constants.AddressZero);
    });

    it("getUserRequestIds returns all IDs for a user across multiple operations", async function () {
      const ids1 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const ids2 = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids1);
      await reforging.connect(user1).reforge(ids2);

      const history = await reforging.getUserRequestIds(user1.address);
      expect(history.length).to.equal(2);
      expect(history[0]).to.equal(1);
      expect(history[1]).to.equal(2);
    });

    it("isClaimable returns false right after burn (same block)", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids); // burnBlock = current
      expect(await reforging.isClaimable(1)).to.be.false;
    });

    it("isClaimable returns true after one block", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      await mineBlock();
      expect(await reforging.isClaimable(1)).to.be.true;
    });

    it("isClaimable returns false after claim", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      await mineBlock();
      await reforging.claim(1);
      expect(await reforging.isClaimable(1)).to.be.false;
    });

    it("isClaimable returns false for non-existent requestId", async function () {
      expect(await reforging.isClaimable(999)).to.be.false;
    });

    it("nextRequestId increments with each new operation", async function () {
      expect(await reforging.nextRequestId()).to.equal(1);

      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      expect(await reforging.nextRequestId()).to.equal(2);

      await reforging.connect(user1).startCraft({ value: CRAFT_COST });
      expect(await reforging.nextRequestId()).to.equal(3);
    });

    it("contract constants are publicly readable", async function () {
      expect(await reforging.COMMON_START()).to.equal(1);
      expect(await reforging.COMMON_END()).to.equal(100);
      expect(await reforging.LEGENDARY_START()).to.equal(401);
      expect(await reforging.ETERNAL_END()).to.equal(700);
      expect(await reforging.COMMON_COUNT()).to.equal(28);
      expect(await reforging.MYTHIC_COUNT()).to.equal(16);
      expect(await reforging.ETERNAL_COUNT()).to.equal(13);
      // BLOCKHASH_EXPIRY removed from contract (was unused constant)
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Block boundary edge cases
  // ──────────────────────────────────────────────────────────────────────────

  describe("Block boundary edge cases", function () {
    it("isClaimable is false at burnBlock, true at burnBlock+1", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      const burnTx = await reforging.connect(user1).reforge(ids);
      const burnBlock = (await burnTx.wait()).blockNumber;

      expect(await ethers.provider.getBlockNumber()).to.equal(burnBlock);
      expect(await reforging.isClaimable(1)).to.be.false;

      await mineBlock();
      expect(await ethers.provider.getBlockNumber()).to.equal(burnBlock + 1);
      expect(await reforging.isClaimable(1)).to.be.true;
    });

    it("claim succeeds at burnBlock+1", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      await mineBlock();
      await expect(reforging.claim(1)).to.emit(reforging, "Claimed");
    });

    it("claim succeeds at burnBlock+2", async function () {
      const ids = await mintRelics(user1, rarityValueForTier(Rarity.Common), 2);
      await reforging.connect(user1).reforge(ids);
      await mineBlocks(2);
      await expect(reforging.claim(1)).to.emit(reforging, "Claimed");
    });
  });
});
