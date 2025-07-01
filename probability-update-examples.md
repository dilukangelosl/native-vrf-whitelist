# Gacha Contract - Probability Update Examples

## Method 1: Update Individual Probability

```solidity
// Update single rarity probability for tokenID 1
// Change Common from 69% to 70%
gacha.updateProbability(1, Rarity.Common, 7000);

// Change Rare from 5% to 6% for tokenID 1
gacha.updateProbability(1, Rarity.Rare, 600);
```

## Method 2: Update All Probabilities for One Token ID

```solidity
// Update all probabilities for tokenID 1 at once
// Array order: [Common, Uncommon, Rare, Epic, Legendary, Mythic, Eternal]
uint256[7] memory newProbabilities = [
    7000,  // Common: 70%
    2400,  // Uncommon: 24% 
    600,   // Rare: 6%
    0,     // Epic: 0%
    0,     // Legendary: 0%
    0,     // Mythic: 0%
    0      // Eternal: 0%
];
// Total must equal 10000 (100%)

gacha.updateAllProbabilities(1, newProbabilities);
```

## Method 3: Batch Update Multiple Token IDs

```solidity
// Update probabilities for multiple token IDs at once
uint256[] memory tokenIds = new uint256[](2);
tokenIds[0] = 1;
tokenIds[1] = 2;

uint256[7][] memory allProbs = new uint256[7][](2);

// Probabilities for tokenID 1
allProbs[0] = [
    6900,  // Common: 69%
    2500,  // Uncommon: 25%
    500,   // Rare: 5%
    100,   // Epic: 1%
    0,     // Legendary: 0%
    0,     // Mythic: 0%
    0      // Eternal: 0%
];

// Probabilities for tokenID 2
allProbs[1] = [
    2000,  // Common: 20%
    4900,  // Uncommon: 49%
    2500,  // Rare: 25%
    500,   // Epic: 5%
    100,   // Legendary: 1%
    0,     // Mythic: 0%
    0      // Eternal: 0%
];

gacha.batchUpdateProbabilities(tokenIds, allProbs);
```

## Current Default Probabilities

### TokenID 1 (Entry Level)
```solidity
rarityProbabilities[1][Rarity.Common] = 6900;    // 69%
rarityProbabilities[1][Rarity.Uncommon] = 2500;  // 25%
rarityProbabilities[1][Rarity.Rare] = 500;       // 5%
rarityProbabilities[1][Rarity.Epic] = 100;       // 1%
rarityProbabilities[1][Rarity.Legendary] = 0;    // 0%
rarityProbabilities[1][Rarity.Mythic] = 0;       // 0%
rarityProbabilities[1][Rarity.Eternal] = 0;      // 0%
```

### TokenID 2 (Mid Level)
```solidity
rarityProbabilities[2][Rarity.Common] = 2000;    // 20%
rarityProbabilities[2][Rarity.Uncommon] = 4900;  // 49%
rarityProbabilities[2][Rarity.Rare] = 2500;      // 25%
rarityProbabilities[2][Rarity.Epic] = 500;       // 5%
rarityProbabilities[2][Rarity.Legendary] = 100;  // 1%
rarityProbabilities[2][Rarity.Mythic] = 0;       // 0%
rarityProbabilities[2][Rarity.Eternal] = 0;      // 0%
```

### TokenID 3 (High Level)
```solidity
rarityProbabilities[3][Rarity.Common] = 0;       // 0%
rarityProbabilities[3][Rarity.Uncommon] = 2000;  // 20%
rarityProbabilities[3][Rarity.Rare] = 4900;      // 49%
rarityProbabilities[3][Rarity.Epic] = 2500;      // 25%
rarityProbabilities[3][Rarity.Legendary] = 500;  // 5%
rarityProbabilities[3][Rarity.Mythic] = 100;     // 1%
rarityProbabilities[3][Rarity.Eternal] = 0;      // 0%
```

### TokenID 4 (Premium Level)
```solidity
rarityProbabilities[4][Rarity.Common] = 0;       // 0%
rarityProbabilities[4][Rarity.Uncommon] = 0;     // 0%
rarityProbabilities[4][Rarity.Rare] = 2000;      // 20%
rarityProbabilities[4][Rarity.Epic] = 4900;      // 49%
rarityProbabilities[4][Rarity.Legendary] = 2500; // 25%
rarityProbabilities[4][Rarity.Mythic] = 500;     // 5%
rarityProbabilities[4][Rarity.Eternal] = 100;    // 1%
```

## Important Notes

1. **Total Must Equal 10000**: All probabilities for a token ID must sum to exactly 10000 (representing 100%)
2. **Basis Points**: 1% = 100 basis points, so 69% = 6900 basis points
3. **Only Owner**: All probability update functions can only be called by the contract owner
4. **Validation**: The contract automatically validates that probabilities don't exceed limits
5. **Events**: Each update emits a `ProbabilityUpdated` event for tracking

## Example Transaction Calls

```javascript
// Using ethers.js or web3.js
const gacha = new ethers.Contract(gachaAddress, gachaABI, signer);

// Method 1: Single update
await gacha.updateProbability(1, 0, 7000); // tokenID=1, Rarity.Common=0, 70%

// Method 2: All probabilities for one token
await gacha.updateAllProbabilities(1, [6900, 2500, 500, 100, 0, 0, 0]);

// Method 3: Batch update
await gacha.batchUpdateProbabilities(
  [1, 2], 
  [[6900, 2500, 500, 100, 0, 0, 0], [2000, 4900, 2500, 500, 100, 0, 0]]
);