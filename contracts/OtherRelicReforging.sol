// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IOtherRelics {
    function mint(address to, uint256 rarity) external;
    function tokenRarity(uint256 tokenId) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/**
 * @title  OtherRelicReforging
 * @notice Burn relics to reforge them into equal-or-higher rarity relics.
 *         Uses a two-step commit-reveal flow: burn in one block, claim in the
 *         next. The result is seeded by blockhash(burnBlock), which is unknown
 *         to the caller at burn time, preventing front-running.
 * @author Diluk Angelo · x.com/cryptoangelodev
 */
contract OtherRelicReforging is Ownable, ReentrancyGuard, Pausable {

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum Rarity {
        Common,     // tokenRarity 1-100   (28 types)
        Uncommon,   // tokenRarity 101-200 (22 types)
        Rare,       // tokenRarity 201-300 (22 types)
        Epic,       // tokenRarity 301-400 (20 types)
        Legendary,  // tokenRarity 401-500 (18 types)
        Mythic,     // tokenRarity 501-600 (16 types)
        Eternal     // tokenRarity 601-700 (13 types)
    }

    enum ReforgeType { Standard, Legendary, Mythic, Craft }

    struct PendingRequest {
        address user;
        ReforgeType reforgeType;
        Rarity baseRarity;
        uint256 relicCount;
        uint256 burnBlock;
        bool claimed;
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant COMMON_START    = 1;
    uint256 public constant COMMON_END      = 100;
    uint256 public constant UNCOMMON_START  = 101;
    uint256 public constant UNCOMMON_END    = 200;
    uint256 public constant RARE_START      = 201;
    uint256 public constant RARE_END        = 300;
    uint256 public constant EPIC_START      = 301;
    uint256 public constant EPIC_END        = 400;
    uint256 public constant LEGENDARY_START = 401;
    uint256 public constant LEGENDARY_END   = 500;
    uint256 public constant MYTHIC_START    = 501;
    uint256 public constant MYTHIC_END      = 600;
    uint256 public constant ETERNAL_START   = 601;
    uint256 public constant ETERNAL_END     = 700;

    uint256 public constant COMMON_COUNT    = 28;
    uint256 public constant UNCOMMON_COUNT  = 22;
    uint256 public constant RARE_COUNT      = 22;
    uint256 public constant EPIC_COUNT      = 20;
    uint256 public constant LEGENDARY_COUNT = 18;
    uint256 public constant MYTHIC_COUNT    = 16;
    uint256 public constant ETERNAL_COUNT   = 13;

    address public constant DEAD_ADDRESS    = 0x000000000000000000000000000000000000dEaD;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IOtherRelics public otherRelics;
    uint256 public craftCost    = 15 ether;
    uint256 public nextRequestId = 1;
    uint256 public totalReforges;
    uint256 public totalCrafts;

    mapping(uint256 => PendingRequest) public pendingRequests;
    mapping(address => uint256[])      private userRequestIds;

    // Incremented after every claim; prevents two claims in the same block from
    // sharing identical entropy.
    uint256 private nonce;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ReforgeBurned(
        address indexed user,
        uint256 indexed requestId,
        ReforgeType     reforgeType,
        uint256[]       relicIds,
        uint256         burnBlock
    );
    event Claimed(
        address indexed user,
        uint256 indexed requestId,
        ReforgeType     reforgeType,
        Rarity          inputRarity,
        Rarity          resultRarity,
        uint256         resultRelicRarityValue
    );
    event CraftStarted(address indexed user, uint256 indexed requestId, uint256 burnBlock);
    event CraftCostUpdated(uint256 oldCost, uint256 newCost);
    event OtherRelicsUpdated(address indexed newAddress);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidRelicCount();
    error NotRelicOwner(uint256 tokenId);
    error InconsistentRarity();
    error InconsistentRelicType();
    error DuplicateRelic(uint256 tokenId);
    error InvalidRarityForReforge(Rarity rarity);
    error InvalidRelicRarityValue(uint256 value);
    error InsufficientCraftPayment();
    error RequestNotFound();
    error AlreadyClaimed();
    error ClaimTooEarly();
    error TransferFailed();
    error NoBalance();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _otherRelics) {
        if (_otherRelics == address(0)) revert ZeroAddress();
        otherRelics = IOtherRelics(_otherRelics);
    }

    // -------------------------------------------------------------------------
    // Step 1 — burn / start
    // -------------------------------------------------------------------------

    /**
     * @notice Burn 2-5 relics of the same type (Common through Epic only).
     *         Maximum result is capped at Legendary.
     *
     * Odds by count (basis points):
     *   2 relics → 4000 same / 6000 +1 /    0 +2
     *   3 relics →  500 same / 9400 +1 /  100 +2
     *   4 relics →    0 same / 9500 +1 /  500 +2
     *   5 relics →    0 same / 9000 +1 / 1000 +2
     */
    function reforge(uint256[] calldata relicIds)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        uint256 count = relicIds.length;
        if (count < 2 || count > 5) revert InvalidRelicCount();

        Rarity base = _validateAndBurnRelics(relicIds);
        if (base == Rarity.Legendary || base == Rarity.Mythic || base == Rarity.Eternal)
            revert InvalidRarityForReforge(base);

        requestId = _createRequest(ReforgeType.Standard, base, count);
        emit ReforgeBurned(msg.sender, requestId, ReforgeType.Standard, relicIds, block.number);
    }

    /**
     * @notice Burn exactly 3 Legendary relics of the same type.
     *         40% → Legendary, 60% → Mythic.
     */
    function reforgeLegendary(uint256[] calldata relicIds)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        if (relicIds.length != 3) revert InvalidRelicCount();

        Rarity base = _validateAndBurnRelics(relicIds);
        if (base != Rarity.Legendary) revert InvalidRarityForReforge(base);

        requestId = _createRequest(ReforgeType.Legendary, Rarity.Legendary, 3);
        emit ReforgeBurned(msg.sender, requestId, ReforgeType.Legendary, relicIds, block.number);
    }

    /**
     * @notice Burn exactly 3 Mythic relics of the same type.
     *         40% → Mythic, 60% → Eternal.
     */
    function reforgeMythic(uint256[] calldata relicIds)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        if (relicIds.length != 3) revert InvalidRelicCount();

        Rarity base = _validateAndBurnRelics(relicIds);
        if (base != Rarity.Mythic) revert InvalidRarityForReforge(base);

        requestId = _createRequest(ReforgeType.Mythic, Rarity.Mythic, 3);
        emit ReforgeBurned(msg.sender, requestId, ReforgeType.Mythic, relicIds, block.number);
    }

    /**
     * @notice Pay craftCost APE to queue a random craft.
     *         95% Common, 4% Uncommon, 1% Rare.
     *         Overpayment is refunded.
     */
    function startCraft()
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        if (msg.value < craftCost) revert InsufficientCraftPayment();

        uint256 excess = msg.value - craftCost;
        if (excess > 0) {
            (bool ok,) = payable(msg.sender).call{value: excess}("");
            if (!ok) revert TransferFailed();
        }

        requestId = _createRequest(ReforgeType.Craft, Rarity.Common, 0);
        emit CraftStarted(msg.sender, requestId, block.number);
    }

    // -------------------------------------------------------------------------
    // Step 2 — claim
    // -------------------------------------------------------------------------

    /**
     * @notice Claim the result of a pending request.
     *         Must be called at least one block after the burn.
     *         Anyone can trigger a claim; the relic always mints to the
     *         original requester.
     *         If the burn block is older than 256 blocks its hash is gone;
     *         current block data is used as fallback so relics are never stuck.
     */
    function claim(uint256 requestId) external nonReentrant {
        PendingRequest storage req = pendingRequests[requestId];

        if (req.user == address(0)) revert RequestNotFound();
        if (req.claimed)            revert AlreadyClaimed();
        if (block.number <= req.burnBlock) revert ClaimTooEarly();

        // Cache all values from storage before any state mutation or external call.
        address     recipient   = req.user;
        ReforgeType rtype       = req.reforgeType;
        Rarity      inputRarity = req.baseRarity;
        uint256     relicCount  = req.relicCount;
        uint256     burnBlock   = req.burnBlock;

        uint256 random = _deriveRandom(burnBlock, requestId, recipient);

        Rarity resultRarity;
        if      (rtype == ReforgeType.Standard)  resultRarity = _determineStandardResult(inputRarity, relicCount, random);
        else if (rtype == ReforgeType.Legendary) resultRarity = _determineLegendaryResult(random);
        else if (rtype == ReforgeType.Mythic)    resultRarity = _determineMythicResult(random);
        else                                     resultRarity = _determineCraftResult(random);

        uint256 resultRelicRarityValue = _getRandomRelicRarityValue(resultRarity, random);

        // Effects before interaction.
        req.claimed = true;
        nonce++;
        if (rtype == ReforgeType.Craft) totalCrafts++;
        else                            totalReforges++;

        otherRelics.mint(recipient, resultRelicRarityValue);

        emit Claimed(recipient, requestId, rtype, inputRarity, resultRarity, resultRelicRarityValue);
    }

    // -------------------------------------------------------------------------
    // Internal — randomness
    // -------------------------------------------------------------------------

    function _deriveRandom(
        uint256 burnBlock,
        uint256 requestId,
        address user
    ) internal view returns (uint256) {
        bytes32 bh = blockhash(burnBlock);
        // blockhash only available for the last 256 blocks; fall back to the
        // previous block so long-delayed claims still resolve.
        if (bh == bytes32(0)) bh = blockhash(block.number - 1);

        return uint256(
            keccak256(
                abi.encodePacked(
                    bh,
                    block.prevrandao,
                    block.timestamp,
                    block.number,
                    requestId,
                    user,
                    nonce
                )
            )
        );
    }

    // -------------------------------------------------------------------------
    // Internal — request management
    // -------------------------------------------------------------------------

    function _createRequest(
        ReforgeType rtype,
        Rarity      baseRarity,
        uint256     relicCount
    ) internal returns (uint256 requestId) {
        requestId = nextRequestId++;
        pendingRequests[requestId] = PendingRequest({
            user:        msg.sender,
            reforgeType: rtype,
            baseRarity:  baseRarity,
            relicCount:  relicCount,
            burnBlock:   block.number,
            claimed:     false
        });
        userRequestIds[msg.sender].push(requestId);
    }

    // -------------------------------------------------------------------------
    // Internal — validation & burn
    // -------------------------------------------------------------------------

    function _validateAndBurnRelics(uint256[] calldata relicIds)
        internal
        returns (Rarity)
    {
        uint256 count = relicIds.length;

        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = i + 1; j < count; j++) {
                if (relicIds[i] == relicIds[j]) revert DuplicateRelic(relicIds[i]);
            }
        }

        if (otherRelics.ownerOf(relicIds[0]) != msg.sender)
            revert NotRelicOwner(relicIds[0]);

        uint256 firstRarityValue = otherRelics.tokenRarity(relicIds[0]);
        Rarity  baseRarity       = _rarityFromValue(firstRarityValue);

        for (uint256 i = 1; i < count; i++) {
            if (otherRelics.ownerOf(relicIds[i]) != msg.sender)
                revert NotRelicOwner(relicIds[i]);

            uint256 rv = otherRelics.tokenRarity(relicIds[i]);
            if (rv != firstRarityValue) {
                Rarity r = _rarityFromValue(rv);
                if (r != baseRarity) revert InconsistentRarity();
                revert InconsistentRelicType();
            }
        }

        for (uint256 i = 0; i < count; i++) {
            otherRelics.transferFrom(msg.sender, DEAD_ADDRESS, relicIds[i]);
        }

        return baseRarity;
    }

    // -------------------------------------------------------------------------
    // Internal — probability tables
    // -------------------------------------------------------------------------

    function _rarityFromValue(uint256 value) internal pure returns (Rarity) {
        if (value >= COMMON_START    && value <= COMMON_END)    return Rarity.Common;
        if (value >= UNCOMMON_START  && value <= UNCOMMON_END)  return Rarity.Uncommon;
        if (value >= RARE_START      && value <= RARE_END)      return Rarity.Rare;
        if (value >= EPIC_START      && value <= EPIC_END)      return Rarity.Epic;
        if (value >= LEGENDARY_START && value <= LEGENDARY_END) return Rarity.Legendary;
        if (value >= MYTHIC_START    && value <= MYTHIC_END)    return Rarity.Mythic;
        if (value >= ETERNAL_START   && value <= ETERNAL_END)   return Rarity.Eternal;
        revert InvalidRelicRarityValue(value);
    }

    function _determineStandardResult(
        Rarity  baseRarity,
        uint256 count,
        uint256 random
    ) internal pure returns (Rarity) {
        uint256 roll = random % 10000;

        uint256 sameCutoff;
        uint256 plusOneCutoff;
        if      (count == 2) { sameCutoff = 4000; plusOneCutoff = 10000; }
        else if (count == 3) { sameCutoff =  500; plusOneCutoff =  9900; }
        else if (count == 4) { sameCutoff =    0; plusOneCutoff =  9500; }
        else                 { sameCutoff =    0; plusOneCutoff =  9000; }

        uint256 boost;
        if      (roll < sameCutoff)   boost = 0;
        else if (roll < plusOneCutoff) boost = 1;
        else                           boost = 2;

        Rarity result = Rarity(uint256(baseRarity) + boost);
        if (result > Rarity.Legendary) result = Rarity.Legendary;
        return result;
    }

    function _determineLegendaryResult(uint256 random) internal pure returns (Rarity) {
        return (random % 10000) < 4000 ? Rarity.Legendary : Rarity.Mythic;
    }

    function _determineMythicResult(uint256 random) internal pure returns (Rarity) {
        return (random % 10000) < 4000 ? Rarity.Mythic : Rarity.Eternal;
    }

    function _determineCraftResult(uint256 random) internal pure returns (Rarity) {
        uint256 roll = random % 10000;
        if (roll < 9500) return Rarity.Common;
        if (roll < 9900) return Rarity.Uncommon;
        return Rarity.Rare;
    }

    /**
     * @dev Re-hashes `random` before the modulo so the type selection uses
     *      independent bits from the rarity roll, eliminating correlation.
     */
    function _getRandomRelicRarityValue(Rarity rarity, uint256 random)
        internal
        pure
        returns (uint256)
    {
        uint256 typeRand = uint256(keccak256(abi.encode(random, uint256(rarity))));

        uint256 start;
        uint256 count;
        if      (rarity == Rarity.Common)    { start = COMMON_START;    count = COMMON_COUNT;    }
        else if (rarity == Rarity.Uncommon)  { start = UNCOMMON_START;  count = UNCOMMON_COUNT;  }
        else if (rarity == Rarity.Rare)      { start = RARE_START;      count = RARE_COUNT;      }
        else if (rarity == Rarity.Epic)      { start = EPIC_START;      count = EPIC_COUNT;      }
        else if (rarity == Rarity.Legendary) { start = LEGENDARY_START; count = LEGENDARY_COUNT; }
        else if (rarity == Rarity.Mythic)    { start = MYTHIC_START;    count = MYTHIC_COUNT;    }
        else                                 { start = ETERNAL_START;   count = ETERNAL_COUNT;   }

        return start + (typeRand % count);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setCraftCost(uint256 _craftCost) external onlyOwner {
        emit CraftCostUpdated(craftCost, _craftCost);
        craftCost = _craftCost;
    }

    function setOtherRelics(address _otherRelics) external onlyOwner {
        if (_otherRelics == address(0)) revert ZeroAddress();
        otherRelics = IOtherRelics(_otherRelics);
        emit OtherRelicsUpdated(_otherRelics);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawCraftFees(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalance();
        (bool ok,) = to.call{value: balance}("");
        if (!ok) revert TransferFailed();
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    function getPendingRequest(uint256 requestId)
        external
        view
        returns (PendingRequest memory)
    {
        return pendingRequests[requestId];
    }

    function getUserRequestIds(address user)
        external
        view
        returns (uint256[] memory)
    {
        return userRequestIds[user];
    }

    function isClaimable(uint256 requestId) external view returns (bool) {
        PendingRequest storage req = pendingRequests[requestId];
        return req.user != address(0) && !req.claimed && block.number > req.burnBlock;
    }
}
