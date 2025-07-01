import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { approveTokens, setupTokenBalances } from "./testHelpers";

export interface TestFixtures {
  raffleContract: Contract;
  mockERC20: Contract;
  mockERC721: Contract;
  mockERC1155: Contract;
  mockVRF: Contract;
  attackerContract: Contract;
  accounts: {
    owner: SignerWithAddress;
    creator1: SignerWithAddress;
    creator2: SignerWithAddress;
    buyer1: SignerWithAddress;
    buyer2: SignerWithAddress;
    buyer3: SignerWithAddress;
    attacker: SignerWithAddress;
    random: SignerWithAddress;
  };
}

export async function deployTestFixtures(): Promise<TestFixtures> {
  const signers = await ethers.getSigners();
  const [owner, creator1, creator2, buyer1, buyer2, buyer3, attacker, random] =
    signers;

  // Deploy mock tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20Token");
  const mockERC20 = await MockERC20.deploy();
  await mockERC20.deployed();

  const MockERC721 = await ethers.getContractFactory("MockERC721Token");
  const mockERC721 = await MockERC721.deploy();
  await mockERC721.deployed();

  const MockERC1155 = await ethers.getContractFactory("MockERC1155Token");
  const mockERC1155 = await MockERC1155.deploy();
  await mockERC1155.deployed();

  // Deploy mock VRF
  const MockNativeVRF = await ethers.getContractFactory("MockNativeVRF");
  const mockVRF = await MockNativeVRF.deploy(123456); // Provide seed parameter
  await mockVRF.deployed();

  // Deploy raffle contract
  const RaffleOnape = await ethers.getContractFactory("RaffleOnape");
  const raffleContract = await RaffleOnape.deploy(mockVRF.address);
  await raffleContract.deployed();

  // Deploy attacker contract
  const AttackerContract = await ethers.getContractFactory("AttackerContract");
  const attackerContract = await AttackerContract.deploy(
    raffleContract.address
  );
  await attackerContract.deployed();

  // Setup initial state
  await mockVRF.whitelistAddress(raffleContract.address);

  // Setup token balances for all accounts
  const accounts = [
    owner,
    creator1,
    creator2,
    buyer1,
    buyer2,
    buyer3,
    attacker,
    random,
  ];
  await setupTokenBalances(mockERC20, mockERC721, mockERC1155, accounts);

  // Approve tokens for all accounts
  for (const account of accounts) {
    await approveTokens(
      account,
      raffleContract.address,
      mockERC20,
      mockERC721,
      mockERC1155
    );
    await approveTokens(
      account,
      attackerContract.address,
      mockERC20,
      mockERC721,
      mockERC1155
    );
  }

  return {
    raffleContract,
    mockERC20,
    mockERC721,
    mockERC1155,
    mockVRF,
    attackerContract,
    accounts: {
      owner,
      creator1,
      creator2,
      buyer1,
      buyer2,
      buyer3,
      attacker,
      random,
    },
  };
}

export async function loadFixtures(): Promise<TestFixtures> {
  return await deployTestFixtures();
}
