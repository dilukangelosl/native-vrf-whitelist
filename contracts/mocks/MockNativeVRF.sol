// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title MockNativeVRF
 * @dev Mock NativeVRF contract for testing purposes
 */
contract MockNativeVRF {
    mapping(address => bool) public whitelist;
    mapping(uint256 => uint256) public randomResults;
    uint256 public requestCounter;
    uint256 public vrfCost = 0.001 ether;
    
    event RandomRequested(uint256 indexed requestId, address indexed requester);
    event RandomFulfilled(uint256 indexed requestId, uint256 randomNumber);
    event AddressWhitelisted(address indexed addr);
    event AddressRemovedFromWhitelist(address indexed addr);
    
    function requestRandom(uint256 numRequest) external payable returns (uint256[] memory) {
        require(whitelist[msg.sender], "Not whitelisted");
        require(msg.value >= vrfCost * numRequest, "Insufficient payment");
        
        uint256[] memory requestIds = new uint256[](numRequest);
        
        for (uint256 i = 0; i < numRequest; i++) {
            uint256 requestId = ++requestCounter;
            requestIds[i] = requestId;
            emit RandomRequested(requestId, msg.sender);
        }
        
        return requestIds;
    }
    
    function fulfillRandomness(uint256 requestId, uint256 randomNumber) external {
        randomResults[requestId] = randomNumber;
        emit RandomFulfilled(requestId, randomNumber);
    }
    
    function isWhitelisted(address addr) external view returns (bool) {
        return whitelist[addr];
    }
    
    function whitelistAddress(address addr) external {
        whitelist[addr] = true;
        emit AddressWhitelisted(addr);
    }
    
    function removeFromWhitelist(address addr) external {
        whitelist[addr] = false;
        emit AddressRemovedFromWhitelist(addr);
    }
    
    function setVRFCost(uint256 _cost) external {
        vrfCost = _cost;
    }
    
    // Helper function for testing - automatically fulfill with a pseudo-random number
    function requestAndFulfillRandom(uint256 numRequest) external payable returns (uint256[] memory) {
        uint256[] memory requestIds = this.requestRandom{value: msg.value}(numRequest);
        
        for (uint256 i = 0; i < requestIds.length; i++) {
            uint256 pseudoRandom = uint256(keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                requestIds[i],
                msg.sender
            )));
            this.fulfillRandomness(requestIds[i], pseudoRandom);
        }
        
        return requestIds;
    }
    
    // Allow contract to receive ETH
    receive() external payable {}
}