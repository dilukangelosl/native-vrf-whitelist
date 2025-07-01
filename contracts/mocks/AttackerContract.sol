// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RaffleOnApe.sol";

/**
 * @title AttackerContract
 * @dev Contract to test reentrancy attacks on RaffleOnApe
 */
contract AttackerContract {
    RaffleOnape public raffleContract;
    uint256 public attackRaffleId;
    uint256 public attackCount;
    uint256 public maxAttacks = 3;
    bool public attacking = false;

    constructor(address _raffleContract) {
        raffleContract = RaffleOnape(_raffleContract);
    }

    function setAttackParams(uint256 _raffleId, uint256 _maxAttacks) external {
        attackRaffleId = _raffleId;
        maxAttacks = _maxAttacks;
        attackCount = 0;
    }

    function startAttack() external payable {
        attacking = true;
        attackCount = 0;
        raffleContract.buyTickets{value: msg.value}(attackRaffleId, 1);
    }

    function stopAttack() external {
        attacking = false;
        attackCount = 0;
    }

    // Reentrancy attack on receive
    receive() external payable {
        if (attacking && attackCount < maxAttacks) {
            attackCount++;
            // Try to reenter buyTickets
            try raffleContract.buyTickets{value: msg.value}(attackRaffleId, 1) {
                // Attack succeeded
            } catch {
                // Attack failed (expected with reentrancy protection)
            }
        }
    }

    // Reentrancy attack on fallback
    fallback() external payable {
        if (attacking && attackCount < maxAttacks) {
            attackCount++;
            // Try to reenter various functions
            try raffleContract.drawRaffle{value: 0.001 ether}(attackRaffleId) {
                // Attack succeeded
            } catch {
                // Attack failed (expected)
            }
        }
    }

    // Function to test reentrancy on createRaffle
    function attackCreateRaffle(
        uint8 _prizeType,
        address _prizeContract,
        uint128 _prizeAmount,
        uint64 _prizeTokenId,
        address _paymentToken,
        uint128 _ticketPrice,
        uint32 _maxTicketsPerUser,
        uint32 _totalMaxTickets,
        uint32 _duration,
        address _whitelistNftContract
    ) external {
        attacking = true;
        attackCount = 0;
        raffleContract.createRaffle(
            _prizeType,
            _prizeContract,
            _prizeAmount,
            _prizeTokenId,
            _paymentToken,
            _ticketPrice,
            _maxTicketsPerUser,
            _totalMaxTickets,
            1,
            _duration,
            _whitelistNftContract
        );
    }

    // Allow contract to receive tokens
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
