// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title MockERC1155Token
 * @dev Mock ERC1155 token for testing purposes
 */
contract MockERC1155Token is ERC1155 {
    uint256 private _tokenIdCounter;
    
    constructor() ERC1155("https://api.example.com/token/{id}.json") {}
    
    function mint(address to, uint256 tokenId, uint256 amount, bytes memory data) external {
        _mint(to, tokenId, amount, data);
    }
    
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external {
        _mintBatch(to, ids, amounts, data);
    }
    
    function burn(address from, uint256 tokenId, uint256 amount) external {
        _burn(from, tokenId, amount);
    }
    
    function burnBatch(address from, uint256[] memory ids, uint256[] memory amounts) external {
        _burnBatch(from, ids, amounts);
    }
    
    function exists(uint256 tokenId) external view returns (bool) {
        return totalSupply(tokenId) > 0;
    }
    
    function totalSupply(uint256 tokenId) public view returns (uint256) {
        // Simple implementation for testing
        return balanceOf(address(this), tokenId);
    }
}