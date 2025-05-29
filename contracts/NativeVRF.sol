// SPDX-License-Identifier: MIT
// Native VRF Contracts (last updated v0.0.1) (NativeVRF.sol)
pragma solidity 0.8.30;

import "./libraries/Converter.sol";
import "./libraries/Signature.sol";

/**
 * @title NativeVRF
 * @dev This contract handles the random number generation in a native way. It offers simplified and secured process for on-chain
 * random number generation. People can use this contract as a center to generate random numbers. It does not require any hardware
 * specifics to setup a random request and fulfillments. This means that the contract can be freely deployed in any new EVM blockchains.
 * It allows DAO control, which provides high level of decentralization.
 */
contract NativeVRF {
    // Access control variables
    address public owner;
    mapping(address => bool) public whitelist;

    // Difficulty variables
    uint256 public constant MIN_DIFFICULTY = 1000;
    uint256 public expectedFulfillTime = 15; // seconds
    uint256 public estimatedHashPower = 100; // hash per second
    uint256 public difficulty = expectedFulfillTime * estimatedHashPower; // estimated attemps to generate a random feed input

    // Difficulty adjustment variables
    mapping(uint256 => uint256) public nBlockFulfillments; // mapping of block number and number of fulfillment in that block
    uint256 public latestFulfillmentBlock; // latest block number that fulfillments occur

    // Random control variables
    uint256 public currentRequestId = 1; // random id counter
    uint256 public latestFulfillId = 0;
    mapping(uint256 => uint256) public randomResults; // mapping of request id and generated random number
    mapping(uint256 => address) public requestInitializers; // mapping of request id and random requester address

    // Incentive variables
    uint256 public minReward = 0.0001 ether; // minumum reward per request
    mapping(uint256 => uint256) public rewards; // mapping of request id and amount of rewards

    // Events
    event RandomRequested(uint256 indexed requestId);
    event RandomFullfilled(uint256 indexed requestId, uint256 random);
    event AddressWhitelisted(address indexed addr);
    event AddressDelisted(address indexed addr);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    modifier onlyWhitelisted() {
        require(whitelist[msg.sender], "Address not whitelisted");
        _;
    }

    /**
     * @dev Initialize the first random result to generate later random numbers
     */
    constructor(uint256 seed) {
        owner = msg.sender;
        requestInitializers[0] = msg.sender;
        randomResults[0] = uint256(
            keccak256(
                abi.encode(
                    seed,
                    0,
                    msg.sender,
                    tx.gasprice,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    blockhash(block.number - 1),
                    address(this)
                )
            )
        );

        latestFulfillmentBlock = block.number;
        nBlockFulfillments[block.number] = 1;
    }

    /**
     * @dev Request random numbers by putting rewards to the smart contract
     * Requirements:
     * - The caller must be whitelisted
     * - The reward per request must be grater than the `minReward` value
     */
    function requestRandom(uint256 numRequest) external payable onlyWhitelisted returns (uint256[] memory) {
        require(numRequest >= 1, "At least one request");

        uint256[] memory requestIds = new uint256[](numRequest);
        uint256 rewardPerRequest = msg.value / numRequest;
        require(rewardPerRequest >= minReward, "Reward is too low");

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

    /**
     * @dev Add an address to the whitelist
     * Requirements:
     * - Only the owner can call this function
     */
    function whitelistAddress(address addr) external onlyOwner {
        require(addr != address(0), "Cannot whitelist zero address");
        require(!whitelist[addr], "Address already whitelisted");
        whitelist[addr] = true;
        emit AddressWhitelisted(addr);
    }

    /**
     * @dev Remove an address from the whitelist
     * Requirements:
     * - Only the owner can call this function
     */
    function delistAddress(address addr) external onlyOwner {
        require(whitelist[addr], "Address not whitelisted");
        whitelist[addr] = false;
        emit AddressDelisted(addr);
    }

    /**
     * @dev Check if an address is whitelisted
     */
    function isWhitelisted(address addr) external view returns (bool) {
        return whitelist[addr];
    }

    /**
     * @dev Transfer ownership to a new owner
     * Requirements:
     * - Only the owner can call this function
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Cannot transfer to zero address");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /**
     * @dev Fulfill random numbers by calculating signatures off-chain
     * Requirements:
     * - The length of all data must be equal
     * - The provided input must be complied with the corresponding signature value
     * - The signature values must be lower than the `threshold` value
     */
    function fullfillRandomness(uint256[] memory _requestIds, uint256[] memory _randInputs, bytes[] memory _signatures) external {
        require(tx.origin == msg.sender, "Require fulfill by EOA");
        require(_requestIds.length > 0, "Require at least one fulfillment");

        uint256 totalReward = 0;

        for (uint256 i = 0; i < _requestIds.length; i++) {
            fullfillRandomnessInternal(_requestIds[i], _randInputs[i], _signatures[i]);
            totalReward += rewards[_requestIds[i]];
            rewards[_requestIds[i]] = 0;
        }

        payable(msg.sender).transfer(totalReward);

        nBlockFulfillments[block.number] += _requestIds.length;
        latestFulfillId += _requestIds.length;

        if (block.number > latestFulfillmentBlock) {
            recalculateThreshold();
            latestFulfillmentBlock = block.number;
        }
    }

    /**
     * @dev Validate random fulfill inputs and record random result if the inputs are valid
     * Requirements:
     * - The request must not yet be fulfilled
     * - The previous request must be already fulfilled
     * - The signature value must be less than the `threshold` value
     * 
     * Signature verification process:
     * - Compute message hash from the provided input
     * - Verify signature from the message hash and the sender address
     * - Convert the signature into a number value and compare to the `threshold` value
     */
    function fullfillRandomnessInternal(
        uint256 _requestId,
        uint256 _randInput,
        bytes memory _signature
    ) private {

        require(
            requestInitializers[_requestId] != address(0),
            "Random have not initialized"
        );
        require(randomResults[_requestId] == 0, "Already fullfilled");
        require(randomResults[_requestId-1] != 0, "No prior result");

        bytes32 messageHash = getMessageHash(_requestId, _randInput);

        require(
            Signature.verify(msg.sender, messageHash, _signature),
            "Invalid signature"
        );

        uint256 sigValue = Converter.toUint256(_signature);
        // require(sigValue < threshold, "Invalid random input");
        require(sigValue % difficulty == 0, "Invalid random input");

        uint256 prevRand = randomResults[_requestId - 1];

        uint256 random = uint256(
            keccak256(
                abi.encode(
                    _randInput,
                    prevRand,
                    requestInitializers[_requestId],
                    tx.gasprice,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    blockhash(block.number - 1),
                    address(this)
                )
            )
        );

        randomResults[_requestId] = random;

        emit RandomFullfilled(_requestId, random);
    }

    /**
     * @dev Adjust the threshold value to maintain system security and simplicity
     */
    function recalculateThreshold() private {
        uint256 prevFulFills = nBlockFulfillments[latestFulfillmentBlock];
        uint256 blockDiff = block.number - latestFulfillmentBlock;
        if (blockDiff > prevFulFills) {
            difficulty = MIN_DIFFICULTY;
        } else {
            difficulty = expectedFulfillTime * estimatedHashPower * (prevFulFills / blockDiff);
        }
    }

    /**
     * @dev Compute message hash from the provided input
     */
    function getMessageHash(uint256 _requestId, uint256 _randInput)
        public
        view
        returns (bytes32)
    {
        uint256 prevRand = _requestId > 0 ? randomResults[_requestId - 1] : 0; 
        return
            keccak256(
                abi.encodePacked(
                    prevRand,
                    _randInput
                )
            );
    }

    /**
     * @dev Convert signatures to number values
     */
    function convertSignatures(bytes[] memory _signatures)
        external
        pure
        returns (uint256[] memory)
    {
        uint256[] memory results = new uint256[](_signatures.length);
        for (uint256 i = 0; i < _signatures.length; i++) {
            results[i] = uint256(Converter.toUint256(_signatures[i]));
        }
        return results;
    }
}
