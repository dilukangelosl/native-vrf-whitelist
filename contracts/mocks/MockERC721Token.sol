// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockERC721Token
 * @dev Mock ERC721 token for testing purposes
 */
contract MockERC721Token is ERC721 {
    uint256 private _tokenIdCounter;
    
    constructor() ERC721("Mock NFT", "MNFT") {}
    
    function mint(address to) external returns (uint256) {
        uint256 tokenId = ++_tokenIdCounter;
        _mint(to, tokenId);
        return tokenId;
    }
    
    function mintTo(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
    
    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }
    
    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }
}