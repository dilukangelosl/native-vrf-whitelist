// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Interface for NativeVRF
interface INativeVRF {
    function requestRandom(
        uint256 numRequest
    ) external payable returns (uint256[] memory);
    function randomResults(uint256 requestId) external view returns (uint256);
    function isWhitelisted(address addr) external view returns (bool);
}

/**
 * @title RaffleOnApe
 * @dev Ultra gas-efficient raffle contract with NativeVRF integration
 * @author Diluk Angelo (@cryptoangelodev) - Product of @OtherEggGenesis
 * @notice Gas Opimized Raffle Contract using NativeVRF for random number generation
 * @dev Supports ERC20, ERC721, and ERC1155 prizes
 */

contract RaffleOnape is Ownable, ReentrancyGuard, ERC721Holder, ERC1155Holder {
    // Prize types
    enum PrizeType {
        ERC20,
        ERC721,
        ERC1155
    }

    // Raffle status
    enum RaffleStatus {
        ACTIVE,
        DRAWN,
        CANCELLED,
        REFUND_AVAILABLE
    }

    // Packed raffle struct for gas optimization
    struct Raffle {
        address creator; // 20 bytes
        address prizeContract; // 20 bytes
        address paymentToken; // 20 bytes (address(0) for ETH)
        address winner; // 20 bytes
        uint128 prizeAmount; // 16 bytes (for ERC20 amounts)
        uint128 ticketPrice; // 16 bytes
        uint64 prizeTokenId; // 8 bytes (for NFT token IDs)
        uint32 maxTicketsPerUser; // 4 bytes
        uint32 totalMaxTickets; // 4 bytes (0 = unlimited)
        uint32 currentTickets; // 4 bytes
        uint32 endTime; // 4 bytes
        uint32 minTicketsNeededToDraw; // 4 bytes
        uint8 prizeType; // 1 byte (PrizeType enum)
        uint8 status; // 1 byte (RaffleStatus enum)
        address whitelistNftContract; // 20 bytes (address(0) for open raffle)
    }

    // Storage variables
    INativeVRF public nativeVRF;
    uint256 public raffleCounter;
    uint256 public feePercentage = 690; // 6.9% default fee (basis points: 690/10000 = 6.9%)
    bool public canCreate = true;
    // Mappings
    mapping(uint256 => Raffle) public raffles;
    mapping(uint256 => uint256) public raffleVRFRequests; // raffleId => VRF requestId
    mapping(uint256 => mapping(address => uint32)) public userTickets; // raffleId => user => ticket count
    mapping(uint256 => address[]) public raffleParticipants; // raffleId => participants array
    mapping(uint256 => mapping(address => bool)) public hasRefunded; // raffleId => user => refunded status
    mapping(address => bool) public whitelistedNFTContracts; // whitelisted NFT contracts

    // Events
    event RaffleCreated(
        uint256 indexed raffleId,
        address indexed creator,
        address prizeContract,
        uint256 prizeAmount,
        address whitelistNftContract
    );
    event TicketPurchased(
        uint256 indexed raffleId,
        address indexed buyer,
        uint32 quantity
    );
    event RaffleDrawn(
        uint256 indexed raffleId,
        address indexed winner,
        uint256 vrfRequestId
    );
    event PrizeClaimed(uint256 indexed raffleId, address indexed winner);
    event RaffleCancelled(uint256 indexed raffleId);
    event RefundAvailable(uint256 indexed raffleId);
    event RefundClaimed(
        uint256 indexed raffleId,
        address indexed user,
        uint256 amount
    );
    event FeeUpdated(uint256 newFeePercentage);
    event NativeVRFUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event NFTContractWhitelisted(address indexed nftContract, bool status);

    constructor(address _nativeVRF) Ownable() {
        nativeVRF = INativeVRF(_nativeVRF);
    }



    /**
     * @dev Create a new raffle
     */
    function createRaffle(
        uint8 _prizeType,
        address _prizeContract,
        uint128 _prizeAmount,
        uint64 _prizeTokenId,
        address _paymentToken,
        uint128 _ticketPrice,
        uint32 _maxTicketsPerUser,
        uint32 _totalMaxTickets,
        uint32 _minTicketsNeededToDraw,
        uint32 _duration,
        address _whitelistNftContract
    ) external nonReentrant returns (uint256) {
        require(canCreate, "Raffle creation disabled");
        require(_ticketPrice > 0, "Invalid ticket price");
        require(_duration > 0, "Invalid duration");
        require(_maxTicketsPerUser > 0, "Invalid max tickets per user");
        require(_minTicketsNeededToDraw > 0, "Invalid minimum tickets");
        
        // Check if NFT contract is whitelisted (if not zero address)
        if (_whitelistNftContract != address(0)) {
            require(whitelistedNFTContracts[_whitelistNftContract], "NFT contract not whitelisted");
        }

        uint256 raffleId = ++raffleCounter;

        Raffle storage raffle = raffles[raffleId];
        raffle.creator = msg.sender;
        raffle.prizeContract = _prizeContract;
        raffle.paymentToken = _paymentToken;
        raffle.prizeAmount = _prizeAmount;
        raffle.prizeTokenId = _prizeTokenId;
        raffle.ticketPrice = _ticketPrice;
        raffle.maxTicketsPerUser = _maxTicketsPerUser;
        raffle.totalMaxTickets = _totalMaxTickets;
        raffle.minTicketsNeededToDraw = _minTicketsNeededToDraw;
        raffle.endTime = uint32(block.timestamp + _duration);
        raffle.prizeType = _prizeType;
        raffle.status = uint8(RaffleStatus.ACTIVE);
        raffle.whitelistNftContract = _whitelistNftContract;

        // Transfer prize to contract
        _transferPrizeToContract(
            _prizeType,
            _prizeContract,
            _prizeAmount,
            _prizeTokenId
        );

        emit RaffleCreated(raffleId, msg.sender, _prizeContract, _prizeAmount, _whitelistNftContract);
        return raffleId;
    }


    /**
     * @dev Set raffle creation status
     */
    function setRaffleCreationStatus(
        bool _canCreate
    ) external onlyOwner {
        canCreate = _canCreate;
    }

    /**
     * @dev Buy tickets for a raffle
     */
    function buyTickets(
        uint256 _raffleId,
        uint32 _quantity
    ) external payable nonReentrant {
        Raffle storage raffle = raffles[_raffleId];
        require(raffle.creator != address(0), "Raffle does not exist");
        require(
            raffle.status == uint8(RaffleStatus.ACTIVE),
            "Raffle not active"
        );
        require(block.timestamp < raffle.endTime, "Raffle ended");
        require(_quantity > 0, "Invalid quantity");
        
        // Check NFT ownership if raffle requires it
        if (raffle.whitelistNftContract != address(0)) {
            require(
                IERC721(raffle.whitelistNftContract).balanceOf(msg.sender) > 0,
                "Must own required NFT to participate"
            );
        }

        uint32 userCurrentTickets = userTickets[_raffleId][msg.sender];
        require(
            userCurrentTickets + _quantity <= raffle.maxTicketsPerUser,
            "Exceeds max tickets per user"
        );

        if (raffle.totalMaxTickets > 0) {
            require(
                raffle.currentTickets + _quantity <= raffle.totalMaxTickets,
                "Exceeds total max tickets"
            );
        }

        uint256 totalCost = uint256(raffle.ticketPrice) * _quantity;

        // Handle payment
        if (raffle.paymentToken == address(0)) {
            require(msg.value == totalCost, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not accepted");
            IERC20(raffle.paymentToken).transferFrom(
                msg.sender,
                address(this),
                totalCost
            );
        }

        // Update state
        if (userCurrentTickets == 0) {
            raffleParticipants[_raffleId].push(msg.sender);
        }
        userTickets[_raffleId][msg.sender] = userCurrentTickets + _quantity;
        raffle.currentTickets += _quantity;

        emit TicketPurchased(_raffleId, msg.sender, _quantity);
    }

    /**
     * @dev Draw the raffle winner using VRF
     */
    function drawRaffle(uint256 _raffleId) external payable nonReentrant {
        Raffle storage raffle = raffles[_raffleId];
        require(raffle.creator != address(0), "Raffle does not exist");
        require(
            raffle.status == uint8(RaffleStatus.ACTIVE),
            "Raffle not active"
        );
        require(raffle.currentTickets > 0, "No tickets sold");

        bool canDraw = block.timestamp >= raffle.endTime ||
            (raffle.totalMaxTickets > 0 &&
                raffle.currentTickets >= raffle.totalMaxTickets);
        require(canDraw, "Cannot draw yet");

        // Check if minimum tickets threshold is met
        if (raffle.currentTickets < raffle.minTicketsNeededToDraw) {
            raffle.status = uint8(RaffleStatus.REFUND_AVAILABLE);

            // Return prize to creator
            _transferPrizeToWinner(_raffleId, raffle.creator);

            emit RefundAvailable(_raffleId);
            return;
        }

        // Request random number from VRF
        require(
            nativeVRF.isWhitelisted(address(this)),
            "Contract not whitelisted"
        );
        uint256[] memory requestIds = nativeVRF.requestRandom{value: msg.value}(
            1
        );
        raffleVRFRequests[_raffleId] = requestIds[0];

        raffle.status = uint8(RaffleStatus.DRAWN);

        emit RaffleDrawn(_raffleId, address(0), requestIds[0]);
    }

    /**
     * @dev Finalize raffle after VRF fulfillment
     */
    function finalizeRaffle(uint256 _raffleId) external nonReentrant {
        Raffle storage raffle = raffles[_raffleId];
        require(raffle.status == uint8(RaffleStatus.DRAWN), "Raffle not drawn");
        require(raffle.winner == address(0), "Already finalized");

        uint256 vrfRequestId = raffleVRFRequests[_raffleId];
        uint256 randomNumber = nativeVRF.randomResults(vrfRequestId);
        require(randomNumber != 0, "VRF not fulfilled");

        // Calculate winner
        address winner = _selectWinner(_raffleId, randomNumber);
        raffle.winner = winner;

        // Transfer prize to winner
        _transferPrizeToWinner(_raffleId, winner);

        // Transfer fees and remaining funds
        _distributeFunds(_raffleId);

        emit PrizeClaimed(_raffleId, winner);
    }

    /**
     * @dev Cancel raffle (only creator, before end time, no tickets sold)
     */
    function cancelRaffle(uint256 _raffleId) external nonReentrant {
        Raffle storage raffle = raffles[_raffleId];
        require(msg.sender == raffle.creator, "Only creator can cancel");
        require(
            raffle.status == uint8(RaffleStatus.ACTIVE),
            "Raffle not active"
        );
        require(raffle.currentTickets == 0, "Tickets already sold");

        raffle.status = uint8(RaffleStatus.CANCELLED);

        // Return prize to creator
        _transferPrizeToWinner(_raffleId, raffle.creator);

        emit RaffleCancelled(_raffleId);
    }
    /**
     * @dev Claim refund when minimum tickets not met
     */
    function claimRefund(uint256 _raffleId) external nonReentrant {
        Raffle storage raffle = raffles[_raffleId];
        require(raffle.creator != address(0), "Raffle does not exist");
        require(
            raffle.status == uint8(RaffleStatus.REFUND_AVAILABLE),
            "Refund not available"
        );
        require(userTickets[_raffleId][msg.sender] > 0, "No tickets purchased");
        require(!hasRefunded[_raffleId][msg.sender], "Already refunded");

        uint32 ticketCount = userTickets[_raffleId][msg.sender];
        uint256 refundAmount = uint256(raffle.ticketPrice) * ticketCount;

        // Mark as refunded
        hasRefunded[_raffleId][msg.sender] = true;

        // Transfer refund
        if (raffle.paymentToken == address(0)) {
            payable(msg.sender).transfer(refundAmount);
        } else {
            IERC20(raffle.paymentToken).transfer(msg.sender, refundAmount);
        }

        emit RefundClaimed(_raffleId, msg.sender, refundAmount);
    }

    // View functions for frontend

    /**
     * @dev Get raffle details
     */
    function getRaffle(
        uint256 _raffleId
    ) external view returns (Raffle memory) {
        return raffles[_raffleId];
    }

    /**
     * @dev Get raffles with pagination
     */
    function getRaffles(
        uint256 _offset,
        uint256 _limit
    ) external view returns (Raffle[] memory, uint256) {
        uint256 total = raffleCounter;
        if (_offset >= total) return (new Raffle[](0), total);

        uint256 end = _offset + _limit;
        if (end > total) end = total;

        Raffle[] memory result = new Raffle[](end - _offset);
        for (uint256 i = _offset; i < end; i++) {
            result[i - _offset] = raffles[i + 1]; // raffleId starts from 1
        }

        return (result, total);
    }

    /**
     * @dev Get user's ticket count for a raffle
     */
    function getUserTickets(
        uint256 _raffleId,
        address _user
    ) external view returns (uint32) {
        return userTickets[_raffleId][_user];
    }

    /**
     * @dev Get raffle participants
     */
    function getRaffleParticipants(
        uint256 _raffleId
    ) external view returns (address[] memory) {
        return raffleParticipants[_raffleId];
    }

    /**
     * @dev Check if user has claimed refund
     */
    function hasUserRefunded(
        uint256 _raffleId,
        address _user
    ) external view returns (bool) {
        return hasRefunded[_raffleId][_user];
    }

    /**
     * @dev Get refund amount for a user
     */
    function getRefundAmount(
        uint256 _raffleId,
        address _user
    ) external view returns (uint256) {
        Raffle storage raffle = raffles[_raffleId];
        if (
            raffle.status != uint8(RaffleStatus.REFUND_AVAILABLE) ||
            hasRefunded[_raffleId][_user]
        ) {
            return 0;
        }
        uint32 ticketCount = userTickets[_raffleId][_user];
        return uint256(raffle.ticketPrice) * ticketCount;
    }

    /**
     * @dev Get whitelist NFT contract address for a raffle
     */
    function getRaffleWhitelistNftContract(uint256 _raffleId) external view returns (address) {
        return raffles[_raffleId].whitelistNftContract;
    }

    /**
     * @dev Check if user can participate in raffle (checks NFT ownership if required)
     */
    function canUserParticipate(uint256 _raffleId, address _user) external view returns (bool) {
        Raffle storage raffle = raffles[_raffleId];
        
        // If no NFT contract specified, anyone can participate
        if (raffle.whitelistNftContract == address(0)) {
            return true;
        }
        
        // Check if user owns the required NFT
        return IERC721(raffle.whitelistNftContract).balanceOf(_user) > 0;
    }

    // Admin functions

    /**
     * @dev Update fee percentage (only owner)
     */
    function updateFeePercentage(uint256 _newFeePercentage) external onlyOwner {
        require(_newFeePercentage <= 2000, "Fee too high"); // Max 20% (2000 basis points)
        feePercentage = _newFeePercentage;
        emit FeeUpdated(_newFeePercentage);
    }

    /**
     * @dev Update nativeVRF address (only owner)
     */
    function updateNativeVRF(address _newNativeVRF) external onlyOwner {
        require(_newNativeVRF != address(0), "Invalid address");
        require(_newNativeVRF != address(nativeVRF), "Same address");

        address oldAddress = address(nativeVRF);
        nativeVRF = INativeVRF(_newNativeVRF);

        emit NativeVRFUpdated(oldAddress, _newNativeVRF);
    }

    /**
     * @dev Withdraw accumulated fees (only owner)
     */
    function withdrawFees(address _token) external onlyOwner {
        if (_token == address(0)) {
            payable(owner()).transfer(address(this).balance);
        } else {
            IERC20 token = IERC20(_token);
            token.transfer(owner(), token.balanceOf(address(this)));
        }
    }

    /**
     * @dev Whitelist/unwhitelist NFT contract (only owner)
     */
    function setNFTContractWhitelist(address _nftContract, bool _status) external onlyOwner {
        require(_nftContract != address(0), "Invalid NFT contract address");
        whitelistedNFTContracts[_nftContract] = _status;
        emit NFTContractWhitelisted(_nftContract, _status);
    }

    /**
     * @dev Batch whitelist/unwhitelist NFT contracts (only owner)
     */
    function batchSetNFTContractWhitelist(address[] calldata _nftContracts, bool _status) external onlyOwner {
        for (uint256 i = 0; i < _nftContracts.length; i++) {
            require(_nftContracts[i] != address(0), "Invalid NFT contract address");
            whitelistedNFTContracts[_nftContracts[i]] = _status;
            emit NFTContractWhitelisted(_nftContracts[i], _status);
        }
    }

    /**
     * @dev Check if NFT contract is whitelisted
     */
    function isNFTContractWhitelisted(address _nftContract) external view returns (bool) {
        return whitelistedNFTContracts[_nftContract];
    }

    // Internal functions

    function _transferPrizeToContract(
        uint8 _prizeType,
        address _prizeContract,
        uint128 _prizeAmount,
        uint64 _prizeTokenId
    ) internal {
        if (_prizeType == uint8(PrizeType.ERC20)) {
            IERC20(_prizeContract).transferFrom(
                msg.sender,
                address(this),
                _prizeAmount
            );
        } else if (_prizeType == uint8(PrizeType.ERC721)) {
            IERC721(_prizeContract).safeTransferFrom(
                msg.sender,
                address(this),
                _prizeTokenId
            );
        } else if (_prizeType == uint8(PrizeType.ERC1155)) {
            IERC1155(_prizeContract).safeTransferFrom(
                msg.sender,
                address(this),
                _prizeTokenId,
                _prizeAmount,
                ""
            );
        }
    }

    function _transferPrizeToWinner(
        uint256 _raffleId,
        address _winner
    ) internal {
        Raffle storage raffle = raffles[_raffleId];

        if (raffle.prizeType == uint8(PrizeType.ERC20)) {
            IERC20(raffle.prizeContract).transfer(_winner, raffle.prizeAmount);
        } else if (raffle.prizeType == uint8(PrizeType.ERC721)) {
            IERC721(raffle.prizeContract).safeTransferFrom(
                address(this),
                _winner,
                raffle.prizeTokenId
            );
        } else if (raffle.prizeType == uint8(PrizeType.ERC1155)) {
            IERC1155(raffle.prizeContract).safeTransferFrom(
                address(this),
                _winner,
                raffle.prizeTokenId,
                raffle.prizeAmount,
                ""
            );
        }
    }

    function _selectWinner(
        uint256 _raffleId,
        uint256 _randomNumber
    ) internal view returns (address) {
        Raffle storage raffle = raffles[_raffleId];
        uint256 winningTicket = (_randomNumber % raffle.currentTickets) + 1;

        address[] memory participants = raffleParticipants[_raffleId];
        uint256 ticketCount = 0;

        for (uint256 i = 0; i < participants.length; i++) {
            ticketCount += userTickets[_raffleId][participants[i]];
            if (ticketCount >= winningTicket) {
                return participants[i];
            }
        }

        return participants[0]; // Fallback
    }

    function _distributeFunds(uint256 _raffleId) internal {
        Raffle storage raffle = raffles[_raffleId];
        uint256 totalRevenue = uint256(raffle.ticketPrice) *
            raffle.currentTickets;
        uint256 fee = (totalRevenue * feePercentage) / 10000;
        uint256 creatorAmount = totalRevenue - fee;

        if (raffle.paymentToken == address(0)) {
            payable(raffle.creator).transfer(creatorAmount);
            // Fee stays in contract for owner withdrawal
        } else {
            IERC20 token = IERC20(raffle.paymentToken);
            token.transfer(raffle.creator, creatorAmount);
            // Fee stays in contract for owner withdrawal
        }
    }
}
