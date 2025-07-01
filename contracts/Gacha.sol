// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// Interface for NativeVRF
interface INativeVRF {
    function requestRandom(
        uint256 numRequest
    ) external payable returns (uint256[] memory);
    function randomResults(uint256 requestId) external view returns (uint256);
    function isWhitelisted(address addr) external view returns (bool);
}

// Interface for OtherRelics contract
interface IOtherRelics {
    function mint(address to, uint256 rarity) external;
    function whitelistMinter(address minter) external view returns (bool);
}

/**
 * @title Gacha
 * @dev Burn ERC1155 OtherShards to mint ERC721 OtherRelics with different rarity chances
 * @author OtherEggsGenesis - Diluk Angelo (@cryptoangelodev)
 * @notice This contract allows users to burn OtherShards (ERC1155) tokens to get random OtherRelics (ERC721) tokens
 */
contract Gacha is Ownable, ReentrancyGuard, Pausable, ERC1155Holder {
    // Rarity enum for better code readability
    enum Rarity {
        Common, // 0
        Uncommon, // 1
        Rare, // 2
        Epic, // 3
        Legendary, // 4
        Mythic, // 5
        Eternal // 6
    }

    // Struct to store gacha request data
    struct GachaRequest {
        address user;
        uint256 shardTokenId;
        uint256 quantity;
        bool fulfilled;
        uint256[] resultTokenIds;
        Rarity[] resultRarities;
    }

    // Contract addresses
    INativeVRF public nativeVRF;
    IERC1155 public otherShards;
    IOtherRelics public otherRelics;

    // Rarity configurations
    struct RarityConfig {
        uint256 startTokenId;
        uint256 endTokenId;
        uint256 availableCount;
        uint256 totalCount;
    }

    mapping(Rarity => RarityConfig) public rarityConfigs;

    // Probability configurations for each shard token ID
    // tokenId => rarity => probability percentage (0-10000 basis points)
    mapping(uint256 => mapping(Rarity => uint256)) public rarityProbabilities;

    // Mapping from VRF request ID to gacha request
    mapping(uint256 => GachaRequest) public gachaRequests;

    // Counter for next token ID in each rarity
    mapping(Rarity => uint256) public nextTokenIdInRarity;

    // Nonce for generating multiple results from single VRF
    uint256 private nonce;

    // Events
    event GachaRequested(
        address indexed user,
        uint256 indexed vrfRequestId,
        uint256 shardTokenId,
        uint256 quantity
    );

    event GachaFulfilled(
        address indexed user,
        uint256 indexed vrfRequestId,
        uint256 shardTokenId,
        uint256 quantity,
        uint256[] relicTokenIds,
        Rarity[] rarities
    );

    event RarityConfigUpdated(
        Rarity indexed rarity,
        uint256 startTokenId,
        uint256 endTokenId,
        uint256 availableCount
    );

    event ProbabilityUpdated(
        uint256 indexed shardTokenId,
        Rarity indexed rarity,
        uint256 probability
    );

    constructor(
        address _nativeVRF,
        address _otherShards,
        address _otherRelics
    ) {
        require(_nativeVRF != address(0), "Invalid VRF address");
        require(_otherShards != address(0), "Invalid OtherShards address");
        require(_otherRelics != address(0), "Invalid OtherRelics address");

        nativeVRF = INativeVRF(_nativeVRF);
        otherShards = IERC1155(_otherShards);
        otherRelics = IOtherRelics(_otherRelics);
    }

    /**
     * @dev Initialize contract configurations (call after deployment)
     */
    function initialize() external onlyOwner {
        _initializeRarityConfigs();
        _initializeProbabilities();
    }

    /**
     * @dev Initialize rarity configurations based on requirements
     */
    function _initializeRarityConfigs() private {
        // Common: tokens 1-100, 28 available
        rarityConfigs[Rarity.Common] = RarityConfig({
            startTokenId: 1,
            endTokenId: 100,
            availableCount: 28,
            totalCount: 28
        });
        nextTokenIdInRarity[Rarity.Common] = 1;

        // Uncommon: tokens 101-200, 22 available
        rarityConfigs[Rarity.Uncommon] = RarityConfig({
            startTokenId: 101,
            endTokenId: 200,
            availableCount: 22,
            totalCount: 22
        });
        nextTokenIdInRarity[Rarity.Uncommon] = 101;

        // Rare: tokens 201-300, 22 available
        rarityConfigs[Rarity.Rare] = RarityConfig({
            startTokenId: 201,
            endTokenId: 300,
            availableCount: 22,
            totalCount: 22
        });
        nextTokenIdInRarity[Rarity.Rare] = 201;

        // Epic: tokens 301-400, 20 available
        rarityConfigs[Rarity.Epic] = RarityConfig({
            startTokenId: 301,
            endTokenId: 400,
            availableCount: 20,
            totalCount: 20
        });
        nextTokenIdInRarity[Rarity.Epic] = 301;

        // Legendary: tokens 401-500, 18 available
        rarityConfigs[Rarity.Legendary] = RarityConfig({
            startTokenId: 401,
            endTokenId: 500,
            availableCount: 18,
            totalCount: 18
        });
        nextTokenIdInRarity[Rarity.Legendary] = 401;

        // Mythic: tokens 501-600, 16 available
        rarityConfigs[Rarity.Mythic] = RarityConfig({
            startTokenId: 501,
            endTokenId: 600,
            availableCount: 16,
            totalCount: 16
        });
        nextTokenIdInRarity[Rarity.Mythic] = 501;

        // Eternal: tokens 601-700, 13 available
        rarityConfigs[Rarity.Eternal] = RarityConfig({
            startTokenId: 601,
            endTokenId: 700,
            availableCount: 13,
            totalCount: 13
        });
        nextTokenIdInRarity[Rarity.Eternal] = 601;
    }

    /**
     * @dev Initialize probability configurations for each shard token ID
     */
    function _initializeProbabilities() private {
        // TokenID 1 probabilities
        rarityProbabilities[1][Rarity.Common] = 6900; // 69%
        rarityProbabilities[1][Rarity.Uncommon] = 2500; // 25%
        rarityProbabilities[1][Rarity.Rare] = 500; // 5%
        rarityProbabilities[1][Rarity.Epic] = 100; // 1%
        rarityProbabilities[1][Rarity.Legendary] = 0; // 0%
        rarityProbabilities[1][Rarity.Mythic] = 0; // 0%
        rarityProbabilities[1][Rarity.Eternal] = 0; // 0%

        // TokenID 2 probabilities
        rarityProbabilities[2][Rarity.Common] = 2000; // 20%
        rarityProbabilities[2][Rarity.Uncommon] = 4900; // 49%
        rarityProbabilities[2][Rarity.Rare] = 2500; // 25%
        rarityProbabilities[2][Rarity.Epic] = 500; // 5%
        rarityProbabilities[2][Rarity.Legendary] = 100; // 1%
        rarityProbabilities[2][Rarity.Mythic] = 0; // 0%
        rarityProbabilities[2][Rarity.Eternal] = 0; // 0%

        // TokenID 3 probabilities
        rarityProbabilities[3][Rarity.Common] = 0; // 0%
        rarityProbabilities[3][Rarity.Uncommon] = 2000; // 20%
        rarityProbabilities[3][Rarity.Rare] = 4900; // 49%
        rarityProbabilities[3][Rarity.Epic] = 2500; // 25%
        rarityProbabilities[3][Rarity.Legendary] = 500; // 5%
        rarityProbabilities[3][Rarity.Mythic] = 100; // 1%
        rarityProbabilities[3][Rarity.Eternal] = 0; // 0%

        // TokenID 4 probabilities
        rarityProbabilities[4][Rarity.Common] = 0; // 0%
        rarityProbabilities[4][Rarity.Uncommon] = 0; // 0%
        rarityProbabilities[4][Rarity.Rare] = 2000; // 20%
        rarityProbabilities[4][Rarity.Epic] = 4900; // 49%
        rarityProbabilities[4][Rarity.Legendary] = 2500; // 25%
        rarityProbabilities[4][Rarity.Mythic] = 500; // 5%
        rarityProbabilities[4][Rarity.Eternal] = 100; // 1%
    }

    /**
     * @dev Burn shard token to get a random relic
     * @param shardTokenId The token ID of the shard to burn (1-4)
     */
    function burnForRelic(
        uint256 shardTokenId
    ) external payable nonReentrant whenNotPaused {
        _burnForRelic(shardTokenId, 1);
    }

    /**
     * @dev Burn multiple shard tokens to get random relics (bulk operation)
     * @param shardTokenId The token ID of the shard to burn (1-4)
     * @param quantity The number of shards to burn
     */
    function burnForRelicBatch(
        uint256 shardTokenId,
        uint256 quantity
    ) external payable nonReentrant whenNotPaused {
        require(quantity > 0 && quantity <= 100, "Invalid quantity (1-100)");
        _burnForRelic(shardTokenId, quantity);
    }

    /**
     * @dev Internal function to handle burning logic
     * @param shardTokenId The token ID of the shard to burn (1-4)
     * @param quantity The number of shards to burn
     */
    function _burnForRelic(uint256 shardTokenId, uint256 quantity) internal {
        require(
            shardTokenId >= 1 && shardTokenId <= 4,
            "Invalid shard token ID"
        );
        require(
            otherShards.balanceOf(msg.sender, shardTokenId) >= quantity,
            "Insufficient shard balance"
        );
        require(
            nativeVRF.isWhitelisted(address(this)),
            "Contract not whitelisted for VRF"
        );

        // Burn the shard tokens by transferring to this contract
        otherShards.safeTransferFrom(
            msg.sender,
            0x000000000000000000000000000000000000dEaD,
            shardTokenId,
            quantity,
            ""
        );

        // Request random number from VRF (single request for all quantities)
        uint256[] memory requestIds = nativeVRF.requestRandom{value: msg.value}(
            1
        );
        uint256 vrfRequestId = requestIds[0];

        // Store the gacha request
        gachaRequests[vrfRequestId] = GachaRequest({
            user: msg.sender,
            shardTokenId: shardTokenId,
            quantity: quantity,
            fulfilled: false,
            resultTokenIds: new uint256[](0),
            resultRarities: new Rarity[](0)
        });

        emit GachaRequested(msg.sender, vrfRequestId, shardTokenId, quantity);
    }

    /**
     * @dev Fulfill the gacha request after VRF provides randomness
     * @param vrfRequestId The VRF request ID to fulfill
     */
    function fulfillGacha(uint256 vrfRequestId) external nonReentrant {
        GachaRequest storage request = gachaRequests[vrfRequestId];
        require(request.user != address(0), "Invalid request ID");
        require(!request.fulfilled, "Request already fulfilled");

        uint256 randomNumber = nativeVRF.randomResults(vrfRequestId);
        require(randomNumber != 0, "VRF not fulfilled yet");

        uint256 quantity = request.quantity;
        uint256[] memory resultTokenIds = new uint256[](quantity);
        Rarity[] memory resultRarities = new Rarity[](quantity);

        // Process each gacha pull using the single VRF result with incremental nonce
        for (uint256 i = 0; i < quantity; i++) {
            // Generate unique random number for each pull using nonce
            uint256 pullRandom = uint256(
                keccak256(abi.encode(randomNumber, nonce, i, block.timestamp))
            );

            // Determine rarity based on probabilities
            Rarity resultRarity = _determineRarity(
                request.shardTokenId,
                pullRandom
            );

            // Check if the rarity has available tokens, if not try next available rarity
            if (rarityConfigs[resultRarity].availableCount == 0) {
                resultRarity = _getAvailableRarity();
            }

            require(
                rarityConfigs[resultRarity].availableCount > 0,
                "No tokens available for any rarity"
            );

            // Get the next token ID for this rarity
            uint256 relicTokenId = _getNextTokenId(resultRarity, pullRandom);

            // Store results
            resultTokenIds[i] = relicTokenId;
            resultRarities[i] = resultRarity;

            // Note: We don't decrease availableCount to allow duplicates
            // The availableCount is just used to check if a rarity type is enabled

            // Mint the relic to the user
            otherRelics.mint(request.user, relicTokenId);
        }

        // Update the request
        request.fulfilled = true;
        request.resultTokenIds = resultTokenIds;
        request.resultRarities = resultRarities;

        // Increment nonce for next batch
        nonce++;

        emit GachaFulfilled(
            request.user,
            vrfRequestId,
            request.shardTokenId,
            quantity,
            resultTokenIds,
            resultRarities
        );
    }

    /**
     * @dev Determine rarity based on shard token ID and random number
     * @param shardTokenId The shard token ID used
     * @param randomNumber The random number from VRF
     * @return The determined rarity
     */
    function _determineRarity(
        uint256 shardTokenId,
        uint256 randomNumber
    ) private view returns (Rarity) {
        uint256 roll = randomNumber % 10000; // Convert to 0-9999 range
        uint256 cumulativeProbability = 0;

        // First pass: try to find the intended rarity based on probability
        for (uint256 i = 0; i < 7; i++) {
            Rarity rarity = Rarity(i);
            uint256 probability = rarityProbabilities[shardTokenId][rarity];

            if (probability > 0) {
                cumulativeProbability += probability;
                if (roll < cumulativeProbability) {
                    // Check if this rarity has available tokens
                    if (rarityConfigs[rarity].availableCount > 0) {
                        return rarity;
                    } else {
                        // This rarity was selected but has no tokens available
                        // Find the closest available rarity with preference for higher rarities
                        return _getClosestAvailableRarity(rarity);
                    }
                }
            }
        }

        // Fallback: find any available rarity (should not happen with proper setup)
        return _getAvailableRarity();
    }

    /**
     * @dev Find the closest available rarity to the intended one
     * @param intendedRarity The rarity that was originally selected
     * @return The closest available rarity
     */
    function _getClosestAvailableRarity(
        Rarity intendedRarity
    ) private view returns (Rarity) {
        // First try rarities higher than intended (better for user)
        for (uint256 i = uint256(intendedRarity) + 1; i < 7; i++) {
            if (rarityConfigs[Rarity(i)].availableCount > 0) {
                return Rarity(i);
            }
        }

        // Then try rarities lower than intended
        for (uint256 i = 0; i < uint256(intendedRarity); i++) {
            if (rarityConfigs[Rarity(i)].availableCount > 0) {
                return Rarity(i);
            }
        }

        // This should not happen if _getAvailableRarity() is working
        revert("No available tokens for any rarity");
    }

    /**
     * @dev Get the next available token ID for a specific rarity
     * @param rarity The rarity to get token ID for
     * @param randomNumber Random number to determine which specific token in the rarity range
     * @return The token ID to mint
     */
    function _getNextTokenId(
        Rarity rarity,
        uint256 randomNumber
    ) private view returns (uint256) {
        RarityConfig storage config = rarityConfigs[rarity];
        
        // Ensure we only generate token IDs within the available range
        // For example, if totalCount is 22 and startTokenId is 201,
        // the maximum token ID should be 222 (201 + 21)
        uint256 maxOffset = config.totalCount - 1; // -1 because offset starts from 0
        uint256 randomOffset = randomNumber % config.totalCount;
        require(randomOffset <= maxOffset, "Token ID out of available range");
        
        uint256 tokenId = config.startTokenId + randomOffset;
        return tokenId;
    }

    /**
     * @dev Get any available rarity as fallback
     * @return The first available rarity
     */
    function _getAvailableRarity() private view returns (Rarity) {
        for (uint256 i = 0; i < 7; i++) {
            Rarity rarity = Rarity(i);
            if (rarityConfigs[rarity].availableCount > 0) {
                return rarity;
            }
        }
        revert("No available tokens for any rarity");
    }

    // Admin functions

    /**
     * @dev Update rarity configuration (only owner)
     */
    function updateRarityConfig(
        Rarity rarity,
        uint256 startTokenId,
        uint256 endTokenId,
        uint256 availableCount
    ) external onlyOwner {
        require(startTokenId <= endTokenId, "Invalid token ID range");
        require(
            availableCount <= (endTokenId - startTokenId + 1),
            "Available count exceeds range"
        );

        rarityConfigs[rarity] = RarityConfig({
            startTokenId: startTokenId,
            endTokenId: endTokenId,
            availableCount: availableCount,
            totalCount: availableCount
        });

        nextTokenIdInRarity[rarity] = startTokenId;

        emit RarityConfigUpdated(
            rarity,
            startTokenId,
            endTokenId,
            availableCount
        );
    }

    /**
     * @dev Update probability for a specific shard token ID and rarity (only owner)
     */
    function updateProbability(
        uint256 shardTokenId,
        Rarity rarity,
        uint256 probability
    ) external onlyOwner {
        require(
            shardTokenId >= 1 && shardTokenId <= 4,
            "Invalid shard token ID"
        );
        require(probability <= 10000, "Probability exceeds 100%");

        rarityProbabilities[shardTokenId][rarity] = probability;

        emit ProbabilityUpdated(shardTokenId, rarity, probability);
    }

    /**
     * @dev Update all probabilities for a specific shard token ID (only owner)
     * @param shardTokenId The shard token ID to update probabilities for
     * @param probabilities Array of probabilities for each rarity [Common, Uncommon, Rare, Epic, Legendary, Mythic, Eternal]
     */
    function updateAllProbabilities(
        uint256 shardTokenId,
        uint256[7] calldata probabilities
    ) external onlyOwner {
        require(
            shardTokenId >= 1 && shardTokenId <= 4,
            "Invalid shard token ID"
        );

        // Verify total probabilities equal 10000 (100%)
        uint256 totalProb = 0;
        for (uint256 i = 0; i < 7; i++) {
            require(
                probabilities[i] <= 10000,
                "Individual probability exceeds 100%"
            );
            totalProb += probabilities[i];
        }
        require(totalProb == 10000, "Total probabilities must equal 100%");

        // Update all probabilities
        for (uint256 i = 0; i < 7; i++) {
            Rarity rarity = Rarity(i);
            rarityProbabilities[shardTokenId][rarity] = probabilities[i];
            emit ProbabilityUpdated(shardTokenId, rarity, probabilities[i]);
        }
    }

    /**
     * @dev Batch update probabilities for multiple shard token IDs (only owner)
     * @param shardTokenIds Array of shard token IDs to update
     * @param allProbabilities 2D array of probabilities [shardTokenId][rarity]
     */
    function batchUpdateProbabilities(
        uint256[] calldata shardTokenIds,
        uint256[7][] calldata allProbabilities
    ) external onlyOwner {
        require(
            shardTokenIds.length == allProbabilities.length,
            "Arrays length mismatch"
        );

        for (uint256 j = 0; j < shardTokenIds.length; j++) {
            uint256 shardTokenId = shardTokenIds[j];
            require(
                shardTokenId >= 1 && shardTokenId <= 4,
                "Invalid shard token ID"
            );

            // Verify total probabilities equal 10000 (100%)
            uint256 totalProb = 0;
            for (uint256 i = 0; i < 7; i++) {
                require(
                    allProbabilities[j][i] <= 10000,
                    "Individual probability exceeds 100%"
                );
                totalProb += allProbabilities[j][i];
            }
            require(totalProb == 10000, "Total probabilities must equal 100%");

            // Update all probabilities for this shard token ID
            for (uint256 i = 0; i < 7; i++) {
                Rarity rarity = Rarity(i);
                rarityProbabilities[shardTokenId][rarity] = allProbabilities[j][
                    i
                ];
                emit ProbabilityUpdated(
                    shardTokenId,
                    rarity,
                    allProbabilities[j][i]
                );
            }
        }
    }

    /**
     * @dev Update contract addresses (only owner)
     */
    function updateContracts(
        address _nativeVRF,
        address _otherShards,
        address _otherRelics
    ) external onlyOwner {
        if (_nativeVRF != address(0)) {
            nativeVRF = INativeVRF(_nativeVRF);
        }
        if (_otherShards != address(0)) {
            otherShards = IERC1155(_otherShards);
        }
        if (_otherRelics != address(0)) {
            otherRelics = IOtherRelics(_otherRelics);
        }
    }

    /**
     * @dev Pause/unpause contract (only owner)
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency withdraw ETH (only owner)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // View functions

    /**
     * @dev Get gacha request details
     */
    function getGachaRequest(
        uint256 vrfRequestId
    ) external view returns (GachaRequest memory) {
        return gachaRequests[vrfRequestId];
    }

    /**
     * @dev Get rarity configuration
     */
    function getRarityConfig(
        Rarity rarity
    ) external view returns (RarityConfig memory) {
        return rarityConfigs[rarity];
    }

    /**
     * @dev Get probability for specific shard token ID and rarity
     */
    function getProbability(
        uint256 shardTokenId,
        Rarity rarity
    ) external view returns (uint256) {
        return rarityProbabilities[shardTokenId][rarity];
    }

    /**
     * @dev Get all probabilities for a specific shard token ID
     */
    function getAllProbabilities(
        uint256 shardTokenId
    ) external view returns (uint256[7] memory) {
        uint256[7] memory probabilities;
        for (uint256 i = 0; i < 7; i++) {
            probabilities[i] = rarityProbabilities[shardTokenId][Rarity(i)];
        }
        return probabilities;
    }

    /**
     * @dev Check if contract can fulfill VRF requests
     */
    function canFulfillVRF() external view returns (bool) {
        return nativeVRF.isWhitelisted(address(this));
    }

    // Allow contract to receive ETH for VRF payments
    receive() external payable {}
}
