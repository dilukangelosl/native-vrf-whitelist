// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../NativeVRF.sol";

/**
 * @title MockNativeVRF
 * @dev Mock NativeVRF contract for testing purposes
 */
contract MockNativeVRF is NativeVRF {
    // Mapping to store random results for mock fulfillment
    mapping(uint256 => uint256) public mockRandomResults;
    
    constructor(uint256 seed) NativeVRF(seed) {}

    // Mock function for testing random generation
    function mockRandomGeneration(uint256 seed) external view returns (uint256) {
        return uint256(keccak256(abi.encode(seed, block.timestamp)));
    }

    // Allow setting difficulty for testing
    function setDifficultyForTesting(uint256 _difficulty) external onlyOwner {
        difficulty = _difficulty;
    }

    // Allow setting nonce for testing
    function setNonceForTesting(address addr, uint256 nonce) external onlyOwner {
        addressNonces[addr] = nonce;
    }

    // Mock fulfillRandomness function for testing
    function fulfillRandomness(uint256 requestId, uint256 randomness) external {
        require(requestInitializers[requestId] != address(0), "Request not found");
        
        // Store the random result
        randomResults[requestId] = randomness;
        mockRandomResults[requestId] = randomness;
        
        // Emit the fulfillment event
        emit RandomFullfilled(requestId, randomness);
        
        // Update latest fulfill ID
        if (requestId > latestFulfillId) {
            latestFulfillId = requestId;
        }
    }

    // Mock function to remove from whitelist (alias for delistAddress)
    function removeFromWhitelist(address addr) external onlyOwner {
        require(whitelist[addr], "Address not whitelisted");
        whitelist[addr] = false;
        emit AddressDelisted(addr);
    }

    // Helper function to set random result directly for testing
    function setRandomResult(uint256 requestId, uint256 randomness) external onlyOwner {
        randomResults[requestId] = randomness;
        mockRandomResults[requestId] = randomness;
    }

    // Override requestRandom to make it simpler for testing
    function requestRandom(uint256 numRequest) external payable override onlyWhitelisted returns (uint256[] memory) {
        require(numRequest >= 1, "At least one request");

        uint256[] memory requestIds = new uint256[](numRequest);
        uint256 rewardPerRequest = msg.value > 0 ? msg.value / numRequest : 0;

        for (uint256 i = 0; i < numRequest; i++) {
            uint256 requestId = currentRequestId + i;
            requestInitializers[requestId] = msg.sender;
            rewards[requestId] = rewardPerRequest;
            requestIds[i] = requestId;
            emit RandomRequested(requestId);
        }
        
        currentRequestId = currentRequestId + numRequest;

        return requestIds;
    }
}