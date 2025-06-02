// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../NativeVRF.sol";

/**
 * @title MockNativeVRF
 * @dev Mock NativeVRF contract for testing purposes
 */
contract MockNativeVRF is NativeVRF {
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
}