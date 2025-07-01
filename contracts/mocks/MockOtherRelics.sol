// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockOtherRelics
 * @dev Mock OtherRelics contract for testing purposes
 */
contract MockOtherRelics is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    
    // Mapping from tokenId to rarity
    mapping(uint256 => uint256) public tokenRarity;
    
    // Whitelist mapping for authorized minters
    mapping(address => bool) public whitelistMinter;
    
    // Events
    event TokenMinted(address indexed to, uint256 indexed tokenId, uint256 rarity);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    constructor() ERC721("MockOtherRelics", "MOR") {
        // Add contract deployer as authorized minter
        whitelistMinter[msg.sender] = true;
    }

    // Mint function - only whitelisted minters can call this
    function mint(address to, uint256 rarity) external {
        require(whitelistMinter[msg.sender], "Unauthorized minter");
        
        uint256 tokenId = nextTokenId;
        
        // Bind rarity to tokenId
        tokenRarity[tokenId] = rarity;
        
        // Mint the token
        _safeMint(to, tokenId);
        
        // Increment token ID for next mint
        nextTokenId++;
        
        emit TokenMinted(to, tokenId, rarity);
    }

    // Batch mint function for efficiency
    function mintBatch(address to, uint256[] calldata rarities) external {
        require(whitelistMinter[msg.sender], "Unauthorized minter");
        
        uint256 length = rarities.length;
        uint256 startTokenId = nextTokenId;
        
        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = startTokenId + i;
            
            // Bind rarity to tokenId
            tokenRarity[tokenId] = rarities[i];
            
            // Mint the token
            _safeMint(to, tokenId);
            
            emit TokenMinted(to, tokenId, rarities[i]);
        }
        
        // Update next token ID
        nextTokenId = startTokenId + length;
    }

    // Whitelist management functions
    function addMinter(address minter) external onlyOwner {
        whitelistMinter[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) external onlyOwner {
        whitelistMinter[minter] = false;
        emit MinterRemoved(minter);
    }

    function isMinter(address account) external view returns (bool) {
        return whitelistMinter[account];
    }

    // Rarity view function
    function getRarity(uint256 tokenId) external view returns (uint256) {
        require(_exists(tokenId), "Token does not exist");
        return tokenRarity[tokenId];
    }

    // Total supply view function
    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1;
    }

    // Helper function for testing - mint with specific token ID
    function mintWithTokenId(address to, uint256 tokenId, uint256 rarity) external {
        require(whitelistMinter[msg.sender], "Unauthorized minter");
        require(!_exists(tokenId), "Token already exists");
        
        tokenRarity[tokenId] = rarity;
        _safeMint(to, tokenId);
        
        // Update nextTokenId if needed
        if (tokenId >= nextTokenId) {
            nextTokenId = tokenId + 1;
        }
        
        emit TokenMinted(to, tokenId, rarity);
    }
}