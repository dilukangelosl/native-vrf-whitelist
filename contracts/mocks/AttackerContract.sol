// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../interfaces/INativeVRF.sol";

/**
 * @title AttackerContract
 * @dev Mock contract to test EOA requirements in NativeVRF
 */
contract AttackerContract {
    function attemptFulfill(
        address nativeVRF,
        uint256[] memory requestIds,
        uint256[] memory randInputs,
        bytes[] memory signatures
    ) external {
        INativeVRF(nativeVRF).fullfillRandomness(requestIds, randInputs, signatures);
    }
}