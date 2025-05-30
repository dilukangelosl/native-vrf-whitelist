import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Test data constants
export const TEST_DATA = {
  RAFFLE_PARAMS: {
    ERC20: {
      prizeType: 0,
      prizeAmount: ethers.utils.parseEther("100"),
      ticketPrice: ethers.utils.parseEther("0.1"),
      maxTicketsPerUser: 10,
      totalMaxTickets: 100,
      duration: 3600, // 1 hour
    },
    ERC721: {
      prizeType: 1,
      prizeTokenId: 1,
      ticketPrice: ethers.utils.parseEther("0.05"),
      maxTicketsPerUser: 5,
      totalMaxTickets: 50,
      duration: 7200, // 2 hours
    },
    ERC1155: {
      prizeType: 2,
      prizeTokenId: 1,
      prizeAmount: 10,
      ticketPrice: ethers.utils.parseEther("0.01"),
      maxTicketsPerUser: 20,
      totalMaxTickets: 0, // unlimited
      duration: 86400, // 1 day
    },
  },

  VRF_COST: ethers.utils.parseEther("0.001"),
  DEFAULT_FEE: 7,
  MAX_FEE: 20,
};

// Time manipulation helpers
export async function increaseTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export async function setBlockTime(timestamp: number): Promise<void> {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine", []);
}

export async function getCurrentBlockTime(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

// Token setup helpers
export async function setupTokenBalances(
  mockERC20: Contract,
  mockERC721: Contract,
  mockERC1155: Contract,
  accounts: SignerWithAddress[]
): Promise<void> {
  // Mint ERC20 tokens to accounts
  for (let i = 1; i < accounts.length; i++) {
    await mockERC20.mint(accounts[i].address, ethers.utils.parseEther("10000"));
  }

  // Mint ERC721 tokens to accounts
  for (let i = 1; i < accounts.length; i++) {
    for (let j = 1; j <= 10; j++) {
      await mockERC721.mint(accounts[i].address);
    }
  }

  // Mint ERC1155 tokens to accounts
  for (let i = 1; i < accounts.length; i++) {
    await mockERC1155.mint(accounts[i].address, 1, 100, "0x");
    await mockERC1155.mint(accounts[i].address, 2, 50, "0x");
  }
}

export async function approveTokens(
  user: SignerWithAddress,
  spender: string,
  mockERC20: Contract,
  mockERC721: Contract,
  mockERC1155: Contract
): Promise<void> {
  // Approve ERC20
  await mockERC20.connect(user).approve(spender, ethers.constants.MaxUint256);

  // Approve ERC721
  await mockERC721.connect(user).setApprovalForAll(spender, true);

  // Approve ERC1155
  await mockERC1155.connect(user).setApprovalForAll(spender, true);
}

// Raffle helpers
export async function createSampleRaffle(
  raffleContract: Contract,
  creator: SignerWithAddress,
  type: "ERC20" | "ERC721" | "ERC1155",
  prizeContract: Contract,
  paymentToken: string = ethers.constants.AddressZero
): Promise<number> {
  const params = TEST_DATA.RAFFLE_PARAMS[type];

  const prizeAmount =
    type === "ERC721"
      ? 0
      : type === "ERC20"
      ? params.prizeAmount
      : (params as any).prizeAmount;
  const prizeTokenId =
    type === "ERC721"
      ? (params as any).prizeTokenId
      : type === "ERC1155"
      ? (params as any).prizeTokenId
      : 0;

  const tx = await raffleContract
    .connect(creator)
    .createRaffle(
      params.prizeType,
      prizeContract.address,
      prizeAmount,
      prizeTokenId,
      paymentToken,
      params.ticketPrice,
      params.maxTicketsPerUser,
      params.totalMaxTickets,
      params.duration
    );

  const receipt = await tx.wait();
  const event = receipt.events?.find((e: any) => e.event === "RaffleCreated");
  return event?.args?.raffleId?.toNumber() || 1;
}

export async function buyTicketsForRaffle(
  raffleContract: Contract,
  raffleId: number,
  users: SignerWithAddress[],
  quantities: number[],
  isETHPayment: boolean = true
): Promise<void> {
  const raffle = await raffleContract.getRaffle(raffleId);

  for (let i = 0; i < users.length; i++) {
    const quantity = quantities[i];
    const totalCost = raffle.ticketPrice.mul(quantity);

    if (isETHPayment) {
      await raffleContract
        .connect(users[i])
        .buyTickets(raffleId, quantity, { value: totalCost });
    } else {
      await raffleContract.connect(users[i]).buyTickets(raffleId, quantity);
    }
  }
}

export async function completeRaffleFlow(
  raffleContract: Contract,
  mockVRF: Contract,
  raffleId: number,
  caller: SignerWithAddress
): Promise<void> {
  // Draw raffle
  await raffleContract
    .connect(caller)
    .drawRaffle(raffleId, { value: TEST_DATA.VRF_COST });

  // Get VRF request ID
  const vrfRequestId = await raffleContract.raffleVRFRequests(raffleId);

  // Fulfill VRF with mock random number
  const randomNumber = ethers.utils.randomBytes(32);
  await mockVRF.fulfillRandomness(
    vrfRequestId,
    ethers.BigNumber.from(randomNumber)
  );

  // Finalize raffle
  await raffleContract.connect(caller).finalizeRaffle(raffleId);
}

// VRF helpers
export async function mockVRFResponse(
  mockVRF: Contract,
  requestId: number,
  randomNumber: BigNumber
): Promise<void> {
  await mockVRF.fulfillRandomness(requestId, randomNumber);
}

export async function waitForVRFFulfillment(
  mockVRF: Contract,
  requestId: number,
  maxWaitBlocks: number = 10
): Promise<boolean> {
  for (let i = 0; i < maxWaitBlocks; i++) {
    const result = await mockVRF.randomResults(requestId);
    if (!result.isZero()) {
      return true;
    }
    await ethers.provider.send("evm_mine", []);
  }
  return false;
}

// Event verification helpers
export function expectEvent(
  receipt: any,
  eventName: string,
  expectedArgs?: any
): void {
  const event = receipt.events?.find((e: any) => e.event === eventName);
  if (!event) {
    throw new Error(`Event ${eventName} not found`);
  }

  if (expectedArgs) {
    for (const [key, value] of Object.entries(expectedArgs)) {
      if (event.args[key] !== value) {
        throw new Error(
          `Event ${eventName} arg ${key} mismatch: expected ${value}, got ${event.args[key]}`
        );
      }
    }
  }
}

export function getEventArgs(receipt: any, eventName: string): any {
  const event = receipt.events?.find((e: any) => e.event === eventName);
  return event?.args;
}

// Balance tracking helpers
export async function getBalanceBefore(
  address: string,
  token?: Contract
): Promise<BigNumber> {
  if (token) {
    return await token.balanceOf(address);
  } else {
    return await ethers.provider.getBalance(address);
  }
}

export async function expectBalanceChange(
  address: string,
  expectedChange: BigNumber,
  token?: Contract
): Promise<() => Promise<void>> {
  const balanceBefore = await getBalanceBefore(address, token);

  return async () => {
    const balanceAfter = await getBalanceBefore(address, token);
    const actualChange = balanceAfter.sub(balanceBefore);

    if (!actualChange.eq(expectedChange)) {
      throw new Error(
        `Balance change mismatch: expected ${expectedChange.toString()}, got ${actualChange.toString()}`
      );
    }
  };
}

// Gas tracking helpers
export async function measureGas(
  txPromise: Promise<any>
): Promise<{ gasUsed: BigNumber; receipt: any }> {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return { gasUsed: receipt.gasUsed, receipt };
}

// Error expectation helpers
export async function expectRevert(
  txPromise: Promise<any>,
  errorMessage?: string
): Promise<void> {
  try {
    await txPromise;
    throw new Error("Expected transaction to revert");
  } catch (error: any) {
    if (errorMessage && !error.message.includes(errorMessage)) {
      throw new Error(
        `Expected revert with message "${errorMessage}", got "${error.message}"`
      );
    }
  }
}
