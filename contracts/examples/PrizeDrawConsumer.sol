// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../interfaces/INativeVRF.sol";

/**
 * @title PrizeDrawConsumer
 * @dev A tutorial contract that demonstrates how to use Native VRF for weighted prize selection.
 *
 * @author Diluk Angelo (@cryptoangelodev)
 * @notice This is a fork of https://github.com/Native-VRF/native-vrf
 *
 * This contract shows how to:
 * 1. Request randomness from Native VRF
 * 2. Use the random number to select prizes based on percentage weights
 * 3. Implement gas-efficient weighted selection algorithm
 * 4. Handle multiple prize draws with different configurations
 *
 * Example Prize Configuration:
 * - Prize 1: 30% chance (weight: 3000)
 * - Prize 2: 20% chance (weight: 2000)
 * - Prize 3: 10% chance (weight: 1000)
 * - Prize 4: 8% chance (weight: 800)
 * - Prize 5: 2% chance (weight: 200)
 * - No Prize: 30% chance (remaining weight: 3000)
 *
 * Total weight: 10000 (representing 100.00%)
 */
contract PrizeDrawConsumer {
    // Reference to the Native VRF contract
    INativeVRF public immutable nativeVRF;
    
    // Contract owner for administrative functions
    address public owner;
    
    // Prize configuration structure
    struct Prize {
        string name;        // Name of the prize (e.g., "Gold Coin", "Silver Medal")
        uint256 weight;     // Weight determining the probability (out of 10000)
        uint256 value;      // Value of the prize in wei (for tracking purposes)
        bool exists;        // Whether this prize slot is configured
    }
    
    // Draw configuration structure
    struct DrawConfig {
        Prize[] prizes;           // Array of prizes
        uint256 totalWeight;      // Sum of all prize weights
        bool isActive;            // Whether this draw configuration is active
        string description;       // Description of the draw
    }
    
    // Mapping from draw ID to draw configuration
    mapping(uint256 => DrawConfig) public drawConfigs;
    
    // Mapping from request ID to draw information
    mapping(uint256 => DrawRequest) public drawRequests;
    
    // Structure to track individual draw requests
    struct DrawRequest {
        address player;           // Address of the player who initiated the draw
        uint256 drawConfigId;     // ID of the draw configuration used
        uint256 randomSeed;       // Random seed from Native VRF
        uint256 selectedPrizeId;  // ID of the selected prize (0 means no prize)
        bool fulfilled;           // Whether the request has been fulfilled
        uint256 timestamp;        // When the request was made
    }
    
    // Counter for draw configurations
    uint256 public nextDrawConfigId = 1;
    
    // Counter for draw requests
    uint256 public nextRequestId = 1;
    
    // Events for tracking draw activities
    event DrawConfigured(uint256 indexed drawConfigId, string description);
    event DrawRequested(uint256 indexed requestId, address indexed player, uint256 drawConfigId);
    event DrawFulfilled(uint256 indexed requestId, address indexed player, uint256 prizeId, string prizeName);
    event PrizeWon(address indexed player, uint256 prizeId, string prizeName, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier validDrawConfig(uint256 drawConfigId) {
        require(drawConfigs[drawConfigId].isActive, "Draw configuration not active");
        _;
    }
    
    /**
     * @dev Constructor sets up the contract with Native VRF reference
     * @param _nativeVRF Address of the deployed Native VRF contract
     */
    constructor(address _nativeVRF) {
        require(_nativeVRF != address(0), "Invalid Native VRF address");
        nativeVRF = INativeVRF(_nativeVRF);
        owner = msg.sender;
        
        // Create a default prize configuration for demonstration
        _createDefaultPrizeConfiguration();
    }
    
    /**
     * @dev Creates a default prize configuration as an example
     * This demonstrates the typical setup for a 5-prize draw with weighted probabilities
     */
    function _createDefaultPrizeConfiguration() private {
        uint256 drawConfigId = nextDrawConfigId++;
        
        // Initialize the draw configuration
        drawConfigs[drawConfigId].description = "Default 5-Prize Draw";
        drawConfigs[drawConfigId].isActive = true;
        
        // Configure prizes with their weights (out of 10000 for precision)
        // Prize 1: 30% chance (3000/10000)
        drawConfigs[drawConfigId].prizes.push(Prize({
            name: "Grand Prize - Gold Coin",
            weight: 3000,
            value: 1 ether,
            exists: true
        }));
        
        // Prize 2: 20% chance (2000/10000)
        drawConfigs[drawConfigId].prizes.push(Prize({
            name: "Second Prize - Silver Medal",
            weight: 2000,
            value: 0.5 ether,
            exists: true
        }));
        
        // Prize 3: 10% chance (1000/10000)
        drawConfigs[drawConfigId].prizes.push(Prize({
            name: "Third Prize - Bronze Trophy",
            weight: 1000,
            value: 0.1 ether,
            exists: true
        }));
        
        // Prize 4: 8% chance (800/10000)
        drawConfigs[drawConfigId].prizes.push(Prize({
            name: "Fourth Prize - Lucky Charm",
            weight: 800,
            value: 0.05 ether,
            exists: true
        }));
        
        // Prize 5: 2% chance (200/10000)
        drawConfigs[drawConfigId].prizes.push(Prize({
            name: "Fifth Prize - Participation Token",
            weight: 200,
            value: 0.01 ether,
            exists: true
        }));
        
        // Calculate total weight (remaining 30% goes to "no prize")
        drawConfigs[drawConfigId].totalWeight = 10000;
        
        emit DrawConfigured(drawConfigId, "Default 5-Prize Draw");
    }
    
    /**
     * @dev Creates a new prize draw configuration
     * @param description Description of the draw
     * @param prizeNames Array of prize names
     * @param prizeWeights Array of prize weights (should sum to less than 10000)
     * @param prizeValues Array of prize values in wei
     * @return drawConfigId ID of the created draw configuration
     */
    function createDrawConfiguration(
        string memory description,
        string[] memory prizeNames,
        uint256[] memory prizeWeights,
        uint256[] memory prizeValues
    ) external onlyOwner returns (uint256 drawConfigId) {
        require(prizeNames.length == prizeWeights.length, "Arrays length mismatch");
        require(prizeNames.length == prizeValues.length, "Arrays length mismatch");
        require(prizeNames.length > 0, "At least one prize required");
        
        drawConfigId = nextDrawConfigId++;
        
        // Initialize the draw configuration
        drawConfigs[drawConfigId].description = description;
        drawConfigs[drawConfigId].isActive = true;
        
        uint256 totalWeight = 0;
        
        // Add each prize to the configuration
        for (uint256 i = 0; i < prizeNames.length; i++) {
            require(prizeWeights[i] > 0, "Prize weight must be greater than 0");
            
            drawConfigs[drawConfigId].prizes.push(Prize({
                name: prizeNames[i],
                weight: prizeWeights[i],
                value: prizeValues[i],
                exists: true
            }));
            
            totalWeight += prizeWeights[i];
        }
        
        require(totalWeight <= 10000, "Total weight cannot exceed 10000");
        drawConfigs[drawConfigId].totalWeight = 10000; // Always use 10000 as base
        
        emit DrawConfigured(drawConfigId, description);
    }
    
    /**
     * @dev Requests a random draw using the specified configuration
     * @param drawConfigId ID of the draw configuration to use
     * @return requestId ID of the draw request for tracking
     * 
     * This function demonstrates how to request randomness from Native VRF.
     * The actual prize selection happens in the fulfillment callback.
     */
    function requestDraw(uint256 drawConfigId) 
        external 
        payable 
        validDrawConfig(drawConfigId) 
        returns (uint256 requestId) 
    {
        // Request randomness from Native VRF
        // Note: This requires the contract to be whitelisted in Native VRF
        uint256[] memory vrfRequestIds = nativeVRF.requestRandom{value: msg.value}(1);
        uint256 vrfRequestId = vrfRequestIds[0];
        
        // Create our internal request tracking
        requestId = nextRequestId++;
        
        drawRequests[requestId] = DrawRequest({
            player: msg.sender,
            drawConfigId: drawConfigId,
            randomSeed: 0, // Will be set when fulfilled
            selectedPrizeId: 0, // Will be set when fulfilled
            fulfilled: false,
            timestamp: block.timestamp
        });
        
        // Store mapping from VRF request ID to our request ID
        // Note: In a production contract, you'd want a more robust mapping system
        // This is simplified for tutorial purposes
        
        emit DrawRequested(requestId, msg.sender, drawConfigId);
        
        return requestId;
    }
    
    /**
     * @dev Fulfills a draw request with randomness from Native VRF
     * @param requestId Our internal request ID
     * @param randomness Random number from Native VRF
     * 
     * This function demonstrates the gas-efficient weighted selection algorithm.
     * It uses a cumulative weight approach for O(n) prize selection.
     */
    function fulfillDraw(uint256 requestId, uint256 randomness) external {
        DrawRequest storage request = drawRequests[requestId];
        require(!request.fulfilled, "Request already fulfilled");
        require(request.player != address(0), "Invalid request");
        
        // Store the random seed
        request.randomSeed = randomness;
        
        // Select prize using weighted random selection
        uint256 selectedPrizeId = _selectPrizeByWeight(request.drawConfigId, randomness);
        
        // Update request with results
        request.selectedPrizeId = selectedPrizeId;
        request.fulfilled = true;
        
        // Get prize information
        string memory prizeName = "";
        uint256 prizeValue = 0;
        
        if (selectedPrizeId > 0) {
            Prize storage selectedPrize = drawConfigs[request.drawConfigId].prizes[selectedPrizeId - 1];
            prizeName = selectedPrize.name;
            prizeValue = selectedPrize.value;
            
            emit PrizeWon(request.player, selectedPrizeId, prizeName, prizeValue);
        } else {
            prizeName = "No Prize";
        }
        
        emit DrawFulfilled(requestId, request.player, selectedPrizeId, prizeName);
    }
    
    /**
     * @dev Gas-efficient weighted prize selection algorithm
     * @param drawConfigId ID of the draw configuration
     * @param randomness Random number to use for selection
     * @return prizeId Selected prize ID (0 means no prize)
     * 
     * Algorithm explanation:
     * 1. Normalize the random number to the total weight range (0-9999)
     * 2. Iterate through prizes, accumulating weights
     * 3. Return the first prize where random number < cumulative weight
     * 4. If no prize is selected, return 0 (no prize)
     * 
     * Time Complexity: O(n) where n is the number of prizes
     * Gas Efficiency: Single loop, early termination possible
     */
    function _selectPrizeByWeight(uint256 drawConfigId, uint256 randomness) 
        private 
        view 
        returns (uint256 prizeId) 
    {
        DrawConfig storage config = drawConfigs[drawConfigId];
        
        // Normalize random number to weight range (0 to totalWeight-1)
        uint256 normalizedRandom = randomness % config.totalWeight;
        
        // Cumulative weight for selection
        uint256 cumulativeWeight = 0;
        
        // Iterate through prizes to find the selected one
        for (uint256 i = 0; i < config.prizes.length; i++) {
            cumulativeWeight += config.prizes[i].weight;
            
            // If random number falls within this prize's weight range
            if (normalizedRandom < cumulativeWeight) {
                return i + 1; // Return 1-based prize ID
            }
        }
        
        // If no prize was selected (remaining weight goes to "no prize")
        return 0;
    }
    
    /**
     * @dev Gets the details of a draw configuration
     * @param drawConfigId ID of the draw configuration
     * @return description Description of the draw
     * @return prizeCount Number of prizes in the configuration
     * @return totalWeight Total weight of the configuration
     * @return isActive Whether the configuration is active
     */
    function getDrawConfiguration(uint256 drawConfigId) 
        external 
        view 
        returns (
            string memory description,
            uint256 prizeCount,
            uint256 totalWeight,
            bool isActive
        ) 
    {
        DrawConfig storage config = drawConfigs[drawConfigId];
        return (
            config.description,
            config.prizes.length,
            config.totalWeight,
            config.isActive
        );
    }
    
    /**
     * @dev Gets details of a specific prize in a draw configuration
     * @param drawConfigId ID of the draw configuration
     * @param prizeIndex Index of the prize (0-based)
     * @return name Name of the prize
     * @return weight Weight of the prize
     * @return value Value of the prize in wei
     * @return probability Probability as percentage (with 2 decimal places)
     */
    function getPrizeDetails(uint256 drawConfigId, uint256 prizeIndex)
        external
        view
        returns (
            string memory name,
            uint256 weight,
            uint256 value,
            uint256 probability
        )
    {
        require(prizeIndex < drawConfigs[drawConfigId].prizes.length, "Invalid prize index");
        
        Prize storage prize = drawConfigs[drawConfigId].prizes[prizeIndex];
        uint256 prob = (prize.weight * 10000) / drawConfigs[drawConfigId].totalWeight;
        
        return (prize.name, prize.weight, prize.value, prob);
    }
    
    /**
     * @dev Gets the result of a draw request
     * @param requestId ID of the draw request
     * @return player Address of the player
     * @return drawConfigId Draw configuration used
     * @return selectedPrizeId Selected prize ID (0 means no prize)
     * @return fulfilled Whether the request has been fulfilled
     * @return timestamp When the request was made
     */
    function getDrawResult(uint256 requestId)
        external
        view
        returns (
            address player,
            uint256 drawConfigId,
            uint256 selectedPrizeId,
            bool fulfilled,
            uint256 timestamp
        )
    {
        DrawRequest storage request = drawRequests[requestId];
        return (
            request.player,
            request.drawConfigId,
            request.selectedPrizeId,
            request.fulfilled,
            request.timestamp
        );
    }
    
    /**
     * @dev Calculates the exact probability of winning each prize
     * @param drawConfigId ID of the draw configuration
     * @return probabilities Array of probabilities (percentage with 2 decimal places)
     * 
     * This is a utility function for frontend applications to display odds.
     * Returns probabilities as integers where 10000 = 100.00%
     */
    function calculateProbabilities(uint256 drawConfigId)
        external
        view
        validDrawConfig(drawConfigId)
        returns (uint256[] memory probabilities)
    {
        DrawConfig storage config = drawConfigs[drawConfigId];
        probabilities = new uint256[](config.prizes.length + 1); // +1 for "no prize"
        
        // Calculate probability for each prize
        for (uint256 i = 0; i < config.prizes.length; i++) {
            probabilities[i] = (config.prizes[i].weight * 10000) / config.totalWeight;
        }
        
        // Calculate probability for "no prize"
        uint256 totalPrizeWeight = 0;
        for (uint256 i = 0; i < config.prizes.length; i++) {
            totalPrizeWeight += config.prizes[i].weight;
        }
        probabilities[config.prizes.length] = ((config.totalWeight - totalPrizeWeight) * 10000) / config.totalWeight;
    }
    
    /**
     * @dev Simulates a draw without using actual randomness (for testing)
     * @param drawConfigId ID of the draw configuration
     * @param testRandomness Test random number to use
     * @return selectedPrizeId Prize that would be selected
     * 
     * This function is useful for testing and demonstrating the selection algorithm.
     */
    function simulateDraw(uint256 drawConfigId, uint256 testRandomness)
        external
        view
        validDrawConfig(drawConfigId)
        returns (uint256 selectedPrizeId)
    {
        return _selectPrizeByWeight(drawConfigId, testRandomness);
    }
    
    /**
     * @dev Enables or disables a draw configuration
     * @param drawConfigId ID of the draw configuration
     * @param isActive Whether to activate or deactivate
     */
    function setDrawConfigActive(uint256 drawConfigId, bool isActive) external onlyOwner {
        drawConfigs[drawConfigId].isActive = isActive;
    }
    
    /**
     * @dev Transfers ownership of the contract
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner address");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }
    
    /**
     * @dev Emergency withdrawal function for contract funds
     * Only the owner can withdraw, useful for prize fund management
     */
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    /**
     * @dev Allows the contract to receive ETH for prize funding
     */
    receive() external payable {}
}