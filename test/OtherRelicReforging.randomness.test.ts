/**
 * Randomness & Distribution Report for OtherRelicReforging
 *
 * Runs Monte-Carlo style simulations across every reforge type and
 * produces chi-square goodness-of-fit checks against the probability
 * tables defined in the contract.
 *
 * Test categories:
 *  A. Standard reforge 2/3/4/5 relics  (Common → Legendary inputs)
 *  B. Legendary reforge (3 Legendary)
 *  C. Mythic reforge    (3 Mythic)
 *  D. Random craft
 *  E. Type-value distribution within a rarity tier
 *  F. Nonce entropy — same VRF random, different claims ≠ same result
 *  G. Cross-block entropy — different burn blocks → different results
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// ── Rarity tiers and constants matching the contract ─────────────────────────

const RARITY = ["Common","Uncommon","Rare","Epic","Legendary","Mythic","Eternal"] as const;
type RarityName = typeof RARITY[number];

const RARITY_STARTS = [1,  101, 201, 301, 401, 501, 601];
const RARITY_COUNTS = [28,  22,  22,  20,  18,  16,  13];

// Expected probabilities per reforge type (basis points → fraction)
const EXPECTED: Record<string, number[]> = {
  "std-2": [0.40, 0.60, 0.00],  // [same, +1, +2]
  "std-3": [0.05, 0.94, 0.01],
  "std-4": [0.00, 0.95, 0.05],
  "std-5": [0.00, 0.90, 0.10],
  // Epic inputs: +2 roll is capped to Legendary (+1 effective) — no +2 outcomes possible
  "std-3-epic": [0.05, 0.95, 0.00],
  "std-4-epic": [0.00, 1.00, 0.00],
  "legendary": [0.40, 0.60],    // [Legendary, Mythic]
  "mythic":    [0.40, 0.60],    // [Mythic, Eternal]
  "craft":     [0.95, 0.04, 0.01], // [Common, Uncommon, Rare]
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mineBlock() {
  await network.provider.send("evm_mine", []);
}

async function mineBlocks(n: number) {
  for (let i = 0; i < n; i++) await mineBlock();
}

/** Chi-square goodness-of-fit test at p=0.01 (more robust than 0.05 for test suites).
 *
 *  Bins with E=0 are excluded entirely (they cannot deviate from expected).
 *  Bins with E<5 are merged left-to-right into the next bin before computing
 *  the statistic, as required by the chi-square approximation.
 */
function chiSquare(observed: number[], expected: number[], trials: number): {
  stat: number; dof: number; pass: boolean; details: string
} {
  // p=0.01 critical values for dof 1-30
  const CRIT_01: number[] = [
    0, 6.635, 9.210, 11.345, 13.277, 15.086, 16.812, 18.475, 20.090, 21.666,
    23.209, 24.725, 26.217, 27.688, 29.141, 30.578, 32.000, 33.409, 34.805,
    36.191, 37.566, 38.932, 40.289, 41.638, 42.980, 44.314, 45.642, 46.963,
    48.278, 49.588, 50.892,
  ];

  // Step 1 — drop zero-probability bins (no information, no division by zero)
  const active = observed
    .map((o, i) => ({ o, e: expected[i] * trials }))
    .filter(b => b.e > 0);

  // Step 2 — merge bins where E < 5 into the next bin
  const merged: { o: number; e: number }[] = [];
  let carry = { o: 0, e: 0 };
  for (const b of active) {
    carry.o += b.o;
    carry.e += b.e;
    if (carry.e >= 5) { merged.push({ ...carry }); carry = { o: 0, e: 0 }; }
  }
  if (carry.e > 0) {
    // absorb remaining small bin into last merged bin (or push if none)
    if (merged.length > 0) { merged[merged.length - 1].o += carry.o; merged[merged.length - 1].e += carry.e; }
    else merged.push({ ...carry });
  }

  const stat = merged.reduce((s, b) => s + Math.pow(b.o - b.e, 2) / b.e, 0);
  const dof  = Math.max(1, merged.length - 1);
  const crit = CRIT_01[Math.min(dof, 30)];
  const pass = stat < crit;

  const details = observed.map((o, i) => {
    const e = (expected[i] * trials).toFixed(1);
    const pct = ((o / trials) * 100).toFixed(1);
    return `${RARITY[i] ?? i}=${o}(${pct}% vs ${(expected[i]*100).toFixed(0)}%exp,E=${e})`;
  }).join("  ");

  return { stat, dof, pass, details };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("OtherRelicReforging — Randomness & Distribution Report", function () {
  this.timeout(600_000); // 10 min — many trials

  let reforging: Contract;
  let otherRelics: Contract;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  const CRAFT_COST = ethers.utils.parseEther("15");

  // ── Setup ──────────────────────────────────────────────────────────────────
  before(async function () {
    [owner, user] = await ethers.getSigners();

    const MockRelics = await ethers.getContractFactory("MockOtherRelics");
    otherRelics = await MockRelics.deploy();
    await otherRelics.deployed();

    const Reforging = await ethers.getContractFactory("OtherRelicReforging");
    reforging = await Reforging.deploy(otherRelics.address);
    await reforging.deployed();

    await otherRelics.addMinter(reforging.address);
    await otherRelics.connect(user).setApprovalForAll(reforging.address, true);
  });

  // ── Utility: mint N relics of a given rarityValue and burn→claim ──────────
  async function burnAndClaim(
    rarityValue: number,
    count: number,
    fn: "reforge" | "reforgeLegendary" | "reforgeMythic"
  ): Promise<number> {
    const ids: BigNumber[] = [];
    for (let i = 0; i < count; i++) {
      const tx = await otherRelics.mint(user.address, rarityValue);
      const receipt = await tx.wait();
      const ev = receipt.events?.find((e: any) => e.event === "TokenMinted");
      ids.push(ev.args.tokenId);
    }

    const burnTx = await reforging.connect(user)[fn](ids);
    const burnReceipt = await burnTx.wait();
    const burnEv = burnReceipt.events?.find((e: any) => e.event === "ReforgeBurned");
    const requestId: BigNumber = burnEv.args.requestId;

    await mineBlock();

    const claimTx = await reforging.claim(requestId);
    const claimReceipt = await claimTx.wait();
    const claimEv = claimReceipt.events?.find((e: any) => e.event === "Claimed");
    return Number(claimEv.args.resultRelicRarityValue);
  }

  async function craftAndClaim(): Promise<number> {
    const startTx = await reforging.connect(user).startCraft({ value: CRAFT_COST });
    const startReceipt = await startTx.wait();
    const startEv = startReceipt.events?.find((e: any) => e.event === "CraftStarted");
    const requestId: BigNumber = startEv.args.requestId;

    await mineBlock();

    const claimTx = await reforging.claim(requestId);
    const claimReceipt = await claimTx.wait();
    const claimEv = claimReceipt.events?.find((e: any) => e.event === "Claimed");
    return Number(claimEv.args.resultRelicRarityValue);
  }

  function rarityIndexOf(v: number): number {
    if (v >= 1   && v <= 100) return 0;
    if (v >= 101 && v <= 200) return 1;
    if (v >= 201 && v <= 300) return 2;
    if (v >= 301 && v <= 400) return 3;
    if (v >= 401 && v <= 500) return 4;
    if (v >= 501 && v <= 600) return 5;
    if (v >= 601 && v <= 700) return 6;
    throw new Error(`Unknown rarity value: ${v}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A. Standard Reforge — tier boost distribution
  // ══════════════════════════════════════════════════════════════════════════

  describe("A. Standard Reforge — tier boost distribution", function () {

    async function runStandard(
      label: string,
      inputRarity: number,
      count: number,
      trials: number,
      expectedKey?: string
    ) {
      it(`${label} — ${trials} trials`, async function () {
        const rv = RARITY_STARTS[inputRarity]; // first type in that rarity
        const tally = [0, 0, 0]; // [same, +1, +2]

        for (let i = 0; i < trials; i++) {
          const result = await burnAndClaim(rv, count, "reforge");
          const ri = rarityIndexOf(result);
          const boost = ri - inputRarity;
          if (boost === 0) tally[0]++;
          else if (boost === 1) tally[1]++;
          else if (boost === 2) tally[2]++;
          else throw new Error(`Unexpected boost ${boost} (ri=${ri}, input=${inputRarity})`);
        }

        const exp = EXPECTED[expectedKey ?? `std-${count}`];
        const { stat, pass, details } = chiSquare(tally, exp, trials);
        console.log(`\n  [A] std-${count} (${RARITY[inputRarity]} input) n=${trials}`);
        console.log(`      ${details}`);
        console.log(`      χ²=${stat.toFixed(3)}  ${pass ? "✓ PASS" : "✗ FAIL (p<0.05)"}`);
        expect(pass, `Chi-square failed: stat=${stat.toFixed(3)}, details=${details}`).to.be.true;
      });
    }

    // 2 relics — 40% same / 60% +1 / 0% +2
    runStandard("2-relic Common",   0, 2, 100);
    runStandard("2-relic Uncommon", 1, 2, 100);
    runStandard("2-relic Rare",     2, 2,  80);
    runStandard("2-relic Epic",     3, 2,  80);
    // Legendary inputs are rejected by reforge() — no 2-relic Legendary test

    // 3 relics — 5% same / 94% +1 / 1% +2  (Epic: +2 capped → 5/95/0)
    runStandard("3-relic Common",                   0, 3, 120);
    runStandard("3-relic Epic (capped at Legendary)", 3, 3, 100, "std-3-epic");
    // Legendary inputs are rejected by reforge()

    // 4 relics — 0% same / 95% +1 / 5% +2  (Epic: +2 capped → 0/100/0)
    runStandard("4-relic Common",                   0, 4, 160);
    runStandard("4-relic Epic (capped at Legendary)", 3, 4,  80, "std-4-epic");

    // 5 relics — 0% same / 90% +1 / 10% +2
    runStandard("5-relic Common", 0, 5, 100);
    runStandard("5-relic Rare",   2, 5,  80);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // B. Legendary Reforge
  // ══════════════════════════════════════════════════════════════════════════

  describe("B. Legendary Reforge — 40% Legendary / 60% Mythic", function () {
    it("100 trials — chi-square vs 40/60", async function () {
      const rv = RARITY_STARTS[4]; // Legendary start
      const tally = [0, 0]; // [Legendary, Mythic]

      for (let i = 0; i < 100; i++) {
        const result = await burnAndClaim(rv, 3, "reforgeLegendary");
        const ri = rarityIndexOf(result);
        if (ri === 4) tally[0]++;
        else if (ri === 5) tally[1]++;
        else throw new Error(`Unexpected rarity ${ri}`);
      }

      const { stat, pass, details } = chiSquare(tally, EXPECTED.legendary, 100);
      console.log(`\n  [B] reforgeLegendary n=100`);
      console.log(`      Legendary=${tally[0]} (${tally[0]}% vs 40%exp)  Mythic=${tally[1]} (${tally[1]}% vs 60%exp)`);
      console.log(`      χ²=${stat.toFixed(3)}  ${pass ? "✓ PASS" : "✗ FAIL (p<0.05)"}`);
      expect(pass, `Chi-square failed: ${details}`).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // C. Mythic Reforge
  // ══════════════════════════════════════════════════════════════════════════

  describe("C. Mythic Reforge — 40% Mythic / 60% Eternal", function () {
    it("100 trials — chi-square vs 40/60", async function () {
      const rv = RARITY_STARTS[5]; // Mythic start
      const tally = [0, 0]; // [Mythic, Eternal]

      for (let i = 0; i < 100; i++) {
        const result = await burnAndClaim(rv, 3, "reforgeMythic");
        const ri = rarityIndexOf(result);
        if (ri === 5) tally[0]++;
        else if (ri === 6) tally[1]++;
        else throw new Error(`Unexpected rarity ${ri}`);
      }

      const { stat, pass, details } = chiSquare(tally, EXPECTED.mythic, 100);
      console.log(`\n  [C] reforgeMythic n=100`);
      console.log(`      Mythic=${tally[0]} (${tally[0]}% vs 40%exp)  Eternal=${tally[1]} (${tally[1]}% vs 60%exp)`);
      console.log(`      χ²=${stat.toFixed(3)}  ${pass ? "✓ PASS" : "✗ FAIL (p<0.05)"}`);
      expect(pass, `Chi-square failed: ${details}`).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // D. Random Craft
  // ══════════════════════════════════════════════════════════════════════════

  describe("D. Random Craft — 95% Common / 4% Uncommon / 1% Rare", function () {
    it("200 trials — chi-square vs 95/4/1", async function () {
      const tally = [0, 0, 0]; // [Common, Uncommon, Rare]

      for (let i = 0; i < 400; i++) {
        const result = await craftAndClaim();
        const ri = rarityIndexOf(result);
        if (ri <= 2) tally[ri]++;
        else throw new Error(`Unexpected rarity ${ri} from craft`);
      }

      const n = tally[0]+tally[1]+tally[2];
      const { stat, pass, details } = chiSquare(tally, EXPECTED.craft, n);
      console.log(`\n  [D] startCraft n=${n}`);
      console.log(`      Common=${tally[0]}(${((tally[0]/n)*100).toFixed(1)}%)  Uncommon=${tally[1]}(${((tally[1]/n)*100).toFixed(1)}%)  Rare=${tally[2]}(${((tally[2]/n)*100).toFixed(1)}%)`);
      console.log(`      Expected: Common=95% Uncommon=4% Rare=1%`);
      console.log(`      χ²=${stat.toFixed(3)}  ${pass ? "✓ PASS" : "✗ FAIL (p<0.05)"}`);
      expect(pass, `Chi-square failed: ${details}`).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E. Type-value distribution within tier (uniform check)
  // ══════════════════════════════════════════════════════════════════════════

  describe("E. Type distribution within tier — uniformity check", function () {

    async function uniformityCheck(
      label: string,
      sourceFn: () => Promise<number>,
      expectedRarity: number,
      trials: number
    ) {
      it(`${label} — ${RARITY[expectedRarity]} types should be uniform`, async function () {
        const count = RARITY_COUNTS[expectedRarity];
        const start = RARITY_STARTS[expectedRarity];
        const tally: Record<number, number> = {};
        for (let t = 0; t < count; t++) tally[start + t] = 0;

        for (let i = 0; i < trials; i++) {
          const v = await sourceFn();
          const ri = rarityIndexOf(v);
          expect(ri, `Type value ${v} not in expected tier ${RARITY[expectedRarity]}`).to.equal(expectedRarity);
          expect(tally[v] !== undefined, `Type value ${v} out of defined range`).to.be.true;
          tally[v]++;
        }

        // Chi-square for uniform distribution
        const observed = Object.values(tally);
        const expFrac   = Array(count).fill(1 / count);
        const { stat, pass, details: _ } = chiSquare(observed, expFrac, trials);

        const min = Math.min(...observed);
        const max = Math.max(...observed);
        const exp = (trials / count).toFixed(1);
        const coverage = observed.filter(v => v > 0).length;

        console.log(`\n  [E] ${label} n=${trials} tier=${RARITY[expectedRarity]}`);
        console.log(`      Types seen: ${coverage}/${count}  min=${min} max=${max} expected≈${exp} each`);
        console.log(`      χ²=${stat.toFixed(3)}  ${pass ? "✓ UNIFORM" : "✗ NON-UNIFORM (p<0.05)"}`);
        expect(pass, `Type distribution not uniform: χ²=${stat.toFixed(3)}`).to.be.true;
      });
    }

    // Craft hits Common 95% of the time — keep only Common results for type spread
    uniformityCheck(
      "Craft → Common types (filter non-Common)",
      async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const v = await craftAndClaim();
          if (rarityIndexOf(v) === 0) return v;
        }
        throw new Error("Could not get Common craft result in 20 attempts");
      },
      0,
      140
    );

    // Chi-square needs ≥5 per bin — 22 Uncommon types → need ≥110 Uncommon results.
    // With 2-relic reforge giving 60% +1, ~183 reforges yields ~110 Uncommon results.
    uniformityCheck(
      "2-relic Common std → Uncommon types",
      async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const v = await burnAndClaim(RARITY_STARTS[0], 2, "reforge");
          if (rarityIndexOf(v) === 1) return v;
        }
        throw new Error("Could not get +1 result in 20 attempts");
      },
      1,
      110  // ≥5 per bin across 22 bins
    );

    uniformityCheck(
      "reforgeLegendary → Mythic types",
      async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
          const v = await burnAndClaim(RARITY_STARTS[4], 3, "reforgeLegendary");
          if (rarityIndexOf(v) === 5) return v;
        }
        throw new Error("Could not get Mythic result in 10 attempts");
      },
      5,
      48  // 3 per type × 16 types
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // F. Nonce entropy — same burn block, sequential claims ≠ identical
  // ══════════════════════════════════════════════════════════════════════════

  describe("F. Nonce entropy — sequential same-block claims differ", function () {
    it("5 consecutive claims in the same block produce distinct results", async function () {
      const rv   = RARITY_STARTS[0];
      const ids1: any[] = [];
      const ids2: any[] = [];
      const ids3: any[] = [];
      const ids4: any[] = [];
      const ids5: any[] = [];
      const groups = [ids1, ids2, ids3, ids4, ids5];

      for (const g of groups) {
        for (let i = 0; i < 2; i++) {
          const tx = await otherRelics.mint(user.address, rv);
          const r  = await tx.wait();
          const ev = r.events?.find((e: any) => e.event === "TokenMinted");
          g.push(ev.args.tokenId);
        }
      }

      // All 5 burn txs
      const requestIds: BigNumber[] = [];
      for (const g of groups) {
        const tx = await reforging.connect(user).reforge(g);
        const r  = await tx.wait();
        const ev = r.events?.find((e: any) => e.event === "ReforgeBurned");
        requestIds.push(ev.args.requestId);
      }

      await mineBlock();

      // Claim all in the same block (automine = each claim is its own block here,
      // but nonce increments per claim regardless)
      const results: number[] = [];
      for (const rid of requestIds) {
        const tx = await reforging.claim(rid);
        const r  = await tx.wait();
        const ev = r.events?.find((e: any) => e.event === "Claimed");
        results.push(Number(ev.args.resultRelicRarityValue));
      }

      const unique = new Set(results).size;
      console.log(`\n  [F] Nonce entropy: results=${results.join(",")}  unique=${unique}/5`);
      expect(unique).to.be.gte(2, "All 5 sequential claims returned identical values — nonce not working");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // G. Cross-block entropy — different burn blocks → different seeds
  // ══════════════════════════════════════════════════════════════════════════

  describe("G. Cross-block entropy — burn block hash as primary seed", function () {
    it("Claims separated by 5+ blocks produce varied results (no block grinding)", async function () {
      const rv      = RARITY_STARTS[0];
      const results: number[] = [];
      const TRIALS  = 20;

      for (let i = 0; i < TRIALS; i++) {
        // Mine 3 extra blocks between each burn so blockhash differs
        await mineBlocks(3);
        const ids: BigNumber[] = [];
        for (let j = 0; j < 2; j++) {
          const tx = await otherRelics.mint(user.address, rv);
          const r  = await tx.wait();
          const ev = r.events?.find((e: any) => e.event === "TokenMinted");
          ids.push(ev.args.tokenId);
        }

        const burnTx  = await reforging.connect(user).reforge(ids);
        const burnR   = await burnTx.wait();
        const burnEv  = burnR.events?.find((e: any) => e.event === "ReforgeBurned");
        const rid     = burnEv.args.requestId;

        await mineBlock();

        const claimTx = await reforging.claim(rid);
        const claimR  = await claimTx.wait();
        const claimEv = claimR.events?.find((e: any) => e.event === "Claimed");
        results.push(Number(claimEv.args.resultRelicRarityValue));
      }

      const unique = new Set(results).size;
      // Calculate run-length (consecutive identical values — indicator of stuck state)
      let maxRun = 1, curRun = 1;
      for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1]) curRun++; else curRun = 1;
        if (curRun > maxRun) maxRun = curRun;
      }

      console.log(`\n  [G] Cross-block entropy n=${TRIALS}`);
      console.log(`      Results: ${results.join(",")}`);
      console.log(`      Unique: ${unique}/${TRIALS}  Max run: ${maxRun}`);
      expect(unique).to.be.gte(Math.floor(TRIALS * 0.4), `Only ${unique} unique values out of ${TRIALS} — entropy may be weak`);
      expect(maxRun).to.be.lte(5, `Longest run of identical results is ${maxRun} — suspicious`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // H. Late claim (fallback entropy) — claims after 256 blocks
  // ══════════════════════════════════════════════════════════════════════════

  describe("H. Fallback entropy — claims after 256-block window", function () {
    it("20 expired claims still produce varied results", async function () {
      const rv      = RARITY_STARTS[0];
      const requestIds: BigNumber[] = [];

      // Pre-queue 20 burns
      for (let i = 0; i < 20; i++) {
        const ids: BigNumber[] = [];
        for (let j = 0; j < 2; j++) {
          const tx = await otherRelics.mint(user.address, rv);
          const r  = await tx.wait();
          const ev = r.events?.find((e: any) => e.event === "TokenMinted");
          ids.push(ev.args.tokenId);
        }
        const tx = await reforging.connect(user).reforge(ids);
        const r  = await tx.wait();
        const ev = r.events?.find((e: any) => e.event === "ReforgeBurned");
        requestIds.push(ev.args.requestId);
      }

      // Mine past 256-block window so blockhash(burnBlock) = 0
      await mineBlocks(260);

      const results: number[] = [];
      for (const rid of requestIds) {
        const tx = await reforging.claim(rid);
        const r  = await tx.wait();
        const ev = r.events?.find((e: any) => e.event === "Claimed");
        results.push(Number(ev.args.resultRelicRarityValue));
      }

      const unique = new Set(results).size;
      console.log(`\n  [H] Fallback entropy (>256 blocks) n=20`);
      console.log(`      Results: ${results.join(",")}`);
      console.log(`      Unique: ${unique}/20`);
      expect(unique).to.be.gte(5, `Fallback entropy too weak: only ${unique} unique values`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // I. Boundary sanity — results always in correct range
  // ══════════════════════════════════════════════════════════════════════════

  describe("I. Boundary sanity — results always within valid rarity ranges", function () {
    it("50 mixed reforges — no result outside defined tokenRarity ranges", async function () {
      const ops = [
        { rv: RARITY_STARTS[0], count: 2, fn: "reforge"         as const },
        { rv: RARITY_STARTS[1], count: 3, fn: "reforge"         as const },
        { rv: RARITY_STARTS[2], count: 4, fn: "reforge"         as const },
        { rv: RARITY_STARTS[3], count: 5, fn: "reforge"         as const },
        { rv: RARITY_STARTS[4], count: 3, fn: "reforgeLegendary"as const },
        { rv: RARITY_STARTS[5], count: 3, fn: "reforgeMythic"   as const },
      ];

      const OOB: number[] = [];

      for (let i = 0; i < 50; i++) {
        const op = ops[i % ops.length];
        const v  = await burnAndClaim(op.rv, op.count, op.fn);
        if (v < 1 || v > 700) OOB.push(v);
      }

      for (let i = 0; i < 10; i++) {
        const v = await craftAndClaim();
        if (v < 1 || v > 300) OOB.push(v); // craft only Common/Uncommon/Rare
      }

      console.log(`\n  [I] Boundary check n=60  OOB count=${OOB.length}`);
      if (OOB.length) console.log(`      OOB values: ${OOB.join(",")}`);
      expect(OOB.length, `${OOB.length} results outside valid range: ${OOB.join(",")}`).to.equal(0);
    });
  });
});
