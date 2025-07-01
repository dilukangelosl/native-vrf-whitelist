import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  RaffleCreated as RaffleCreatedEvent,
  TicketPurchased as TicketPurchasedEvent,
  RaffleDrawn as RaffleDrawnEvent,
  PrizeClaimed as PrizeClaimedEvent,
  RaffleCancelled as RaffleCancelledEvent,
  RefundAvailable as RefundAvailableEvent,
  RefundClaimed as RefundClaimedEvent,
  FeeUpdated as FeeUpdatedEvent,
  NativeVRFUpdated as NativeVRFUpdatedEvent,
  NFTContractWhitelisted as NFTContractWhitelistedEvent,
  RaffleOnApe,
} from "../generated/RaffleOnApe/RaffleOnApe";
import {
  Raffle,
  Ticket,
  Refund,
  User,
  GlobalStats,
  RaffleCreatedEvent as RaffleCreatedEventEntity,
  RaffleDrawnEvent as RaffleDrawnEventEntity,
  PrizeClaimedEvent as PrizeClaimedEventEntity,
  RaffleCancelledEvent as RaffleCancelledEventEntity,
  RefundAvailableEvent as RefundAvailableEventEntity,
  NFTContractWhitelistedEvent as NFTContractWhitelistedEventEntity,
} from "../generated/schema";

// Helper function to get or create user
function getOrCreateUser(address: Address, timestamp: BigInt): User {
  let user = User.load(address);
  if (user == null) {
    user = new User(address);
    user.totalRafflesCreated = BigInt.fromI32(0);
    user.totalTicketsPurchased = BigInt.fromI32(0);
    user.totalRefundsClaimed = BigInt.fromI32(0);
    user.totalPrizesWon = BigInt.fromI32(0);
    user.totalVolumeSpent = BigInt.fromI32(0);
    user.totalVolumeEarned = BigInt.fromI32(0);
    user.totalFeesGenerated = BigInt.fromI32(0);
    user.createdAt = timestamp;
    user.save();
  }
  return user;
}

// Helper function to get or create global stats
function getOrCreateGlobalStats(): GlobalStats {
  let stats = GlobalStats.load(Bytes.fromHexString("0x01"));
  if (stats == null) {
    stats = new GlobalStats(Bytes.fromHexString("0x01"));
    stats.totalRaffles = BigInt.fromI32(0);
    stats.totalTicketsSold = BigInt.fromI32(0);
    stats.totalValueLocked = BigInt.fromI32(0);
    stats.totalRefunds = BigInt.fromI32(0);
    stats.totalPrizesClaimed = BigInt.fromI32(0);
    stats.totalVolume = BigInt.fromI32(0);
    stats.totalFeesGenerated = BigInt.fromI32(0);
    stats.totalCreatorEarnings = BigInt.fromI32(0);
    stats.save();
  }
  return stats;
}

export function handleRaffleCreated(event: RaffleCreatedEvent): void {
  // Create or get user
  const user = getOrCreateUser(event.params.creator, event.block.timestamp);

  // Create raffle entity
  const raffle = new Raffle(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  raffle.raffleId = event.params.raffleId;
  raffle.creator = user.id;
  raffle.prizeContract = event.params.prizeContract;
  raffle.prizeAmount = event.params.prizeAmount;
  raffle.whitelistNftContract = event.params.whitelistNftContract;
  raffle.createdAt = event.block.timestamp;
  raffle.blockNumber = event.block.number;
  raffle.transactionHash = event.transaction.hash;

  // Get raffle details from contract
  const contract = RaffleOnApe.bind(event.address);
  const raffleData = contract.getRaffle(event.params.raffleId);

  raffle.paymentToken = raffleData.paymentToken;
  raffle.winner = null; // No winner initially
  raffle.ticketPrice = raffleData.ticketPrice;
  raffle.prizeTokenId = raffleData.prizeTokenId;
  raffle.maxTicketsPerUser = BigInt.fromI32(
    raffleData.maxTicketsPerUser.toI32()
  );
  raffle.totalMaxTickets = BigInt.fromI32(raffleData.totalMaxTickets.toI32());
  raffle.currentTickets = BigInt.fromI32(raffleData.currentTickets.toI32());
  raffle.endTime = BigInt.fromI32(raffleData.endTime.toI32());
  raffle.minTicketsNeededToDraw = BigInt.fromI32(
    raffleData.minTicketsNeededToDraw.toI32()
  );
  raffle.prizeType = raffleData.prizeType;
  raffle.status = raffleData.status;
  raffle.vrfRequestId = null; // Will be set when drawn

  raffle.save();

  // Create event entity
  const eventEntity = new RaffleCreatedEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.raffleId = event.params.raffleId;
  eventEntity.creator = event.params.creator;
  eventEntity.prizeContract = event.params.prizeContract;
  eventEntity.prizeAmount = event.params.prizeAmount;
  eventEntity.whitelistNftContract = event.params.whitelistNftContract;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();

  // Update user stats
  user.totalRafflesCreated = user.totalRafflesCreated.plus(BigInt.fromI32(1));
  user.save();

  // Update global stats
  const stats = getOrCreateGlobalStats();
  stats.totalRaffles = stats.totalRaffles.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleTicketPurchased(event: TicketPurchasedEvent): void {
  // Create or get user
  const user = getOrCreateUser(event.params.buyer, event.block.timestamp);

  // Create ticket entity
  const ticket = new Ticket(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  ticket.raffle = Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId));
  ticket.buyer = user.id;
  ticket.quantity = BigInt.fromI32(event.params.quantity.toI32());
  ticket.timestamp = event.block.timestamp;
  ticket.blockNumber = event.block.number;
  ticket.transactionHash = event.transaction.hash;
  ticket.save();

  // Get raffle and calculate volume
  const raffle = Raffle.load(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  if (raffle != null) {
    const contract = RaffleOnApe.bind(event.address);
    const raffleData = contract.getRaffle(event.params.raffleId);
    raffle.currentTickets = BigInt.fromI32(raffleData.currentTickets.toI32());
    raffle.save();

    // Calculate ticket purchase volume
    const ticketVolume = raffle.ticketPrice.times(
      BigInt.fromI32(event.params.quantity.toI32())
    );

    // Calculate fees (6.9% default, but get current fee from contract in basis points)
    const feePercentage = contract.feePercentage();
    const fees = ticketVolume
      .times(BigInt.fromI32(feePercentage.toI32()))
      .div(BigInt.fromI32(10000));
    const creatorEarnings = ticketVolume.minus(fees);

    // Update user volume stats
    user.totalVolumeSpent = user.totalVolumeSpent.plus(ticketVolume);

    // Update raffle creator earnings
    const creator = getOrCreateUser(
      Address.fromBytes(raffle.creator),
      event.block.timestamp
    );
    creator.totalVolumeEarned = creator.totalVolumeEarned.plus(creatorEarnings);
    creator.totalFeesGenerated = creator.totalFeesGenerated.plus(fees);
    creator.save();

    // Update global stats with volume and fees
    const stats = getOrCreateGlobalStats();
    stats.totalVolume = stats.totalVolume.plus(ticketVolume);
    stats.totalFeesGenerated = stats.totalFeesGenerated.plus(fees);
    stats.totalCreatorEarnings =
      stats.totalCreatorEarnings.plus(creatorEarnings);
    stats.totalTicketsSold = stats.totalTicketsSold.plus(
      BigInt.fromI32(event.params.quantity.toI32())
    );
    stats.save();
  }

  // Update user stats
  user.totalTicketsPurchased = user.totalTicketsPurchased.plus(
    BigInt.fromI32(event.params.quantity.toI32())
  );
  user.save();
}

export function handleRaffleDrawn(event: RaffleDrawnEvent): void {
  // Update raffle status
  const raffle = Raffle.load(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  if (raffle != null) {
    raffle.status = 1; // DRAWN
    raffle.vrfRequestId = event.params.vrfRequestId;
    if (
      event.params.winner.toHex() !==
      "0x0000000000000000000000000000000000000000"
    ) {
      const winnerUser = getOrCreateUser(
        event.params.winner,
        event.block.timestamp
      );
      raffle.winner = winnerUser.id;
    }
    raffle.save();
  }

  // Create event entity
  const eventEntity = new RaffleDrawnEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.raffleId = event.params.raffleId;
  eventEntity.winner = event.params.winner;
  eventEntity.vrfRequestId = event.params.vrfRequestId;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();
}

export function handlePrizeClaimed(event: PrizeClaimedEvent): void {
  // Create or get winner user
  const winnerUser = getOrCreateUser(
    event.params.winner,
    event.block.timestamp
  );

  // Update raffle winner
  const raffle = Raffle.load(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  if (raffle != null) {
    raffle.winner = winnerUser.id;
    raffle.save();
  }

  // Create event entity
  const eventEntity = new PrizeClaimedEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.raffleId = event.params.raffleId;
  eventEntity.winner = event.params.winner;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();

  // Update user stats
  winnerUser.totalPrizesWon = winnerUser.totalPrizesWon.plus(BigInt.fromI32(1));
  winnerUser.save();

  // Update global stats
  const stats = getOrCreateGlobalStats();
  stats.totalPrizesClaimed = stats.totalPrizesClaimed.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleRaffleCancelled(event: RaffleCancelledEvent): void {
  // Update raffle status
  const raffle = Raffle.load(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  if (raffle != null) {
    raffle.status = 2; // CANCELLED
    raffle.save();
  }

  // Create event entity
  const eventEntity = new RaffleCancelledEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.raffleId = event.params.raffleId;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();
}

export function handleRefundAvailable(event: RefundAvailableEvent): void {
  // Update raffle status
  const raffle = Raffle.load(
    Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId))
  );
  if (raffle != null) {
    raffle.status = 3; // REFUND_AVAILABLE
    raffle.save();
  }

  // Create event entity
  const eventEntity = new RefundAvailableEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.raffleId = event.params.raffleId;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();
}

export function handleRefundClaimed(event: RefundClaimedEvent): void {
  // Create or get user
  const user = getOrCreateUser(event.params.user, event.block.timestamp);

  // Create refund entity
  const refund = new Refund(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  refund.raffle = Bytes.fromByteArray(Bytes.fromBigInt(event.params.raffleId));
  refund.user = user.id;
  refund.amount = event.params.amount;
  refund.timestamp = event.block.timestamp;
  refund.blockNumber = event.block.number;
  refund.transactionHash = event.transaction.hash;
  refund.save();

  // Update user stats
  user.totalRefundsClaimed = user.totalRefundsClaimed.plus(BigInt.fromI32(1));
  user.save();

  // Update global stats
  const stats = getOrCreateGlobalStats();
  stats.totalRefunds = stats.totalRefunds.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleFeeUpdated(event: FeeUpdatedEvent): void {
  // TODO: Create fee updated event entity for tracking fee changes
  // Will be implemented after code generation
  // const feeEvent = new FeeUpdatedEventEntity(
  //   event.transaction.hash.concatI32(event.logIndex.toI32())
  // );
  // feeEvent.newFeePercentage = event.params.newFeePercentage;
  // feeEvent.timestamp = event.block.timestamp;
  // feeEvent.blockNumber = event.block.number;
  // feeEvent.transactionHash = event.transaction.hash;
  // feeEvent.save();
}

// Helper functions for leaderboard management (to be implemented after code generation)

// function updateTopParticipant(user: User): void {
//   let participant = TopParticipant.load(user.id);
//   if (participant == null) {
//     participant = new TopParticipant(user.id);
//     participant.user = user.id;
//     participant.rank = BigInt.fromI32(0);
//   }
//   participant.totalTicketsPurchased = user.totalTicketsPurchased;
//   participant.totalVolumeSpent = user.totalVolumeSpent;
//   participant.lastUpdated = BigInt.fromI32(Date.now());
//   participant.save();
// }

// function updateTopWinner(user: User): void {
//   let winner = TopWinner.load(user.id);
//   if (winner == null) {
//     winner = new TopWinner(user.id);
//     winner.user = user.id;
//     winner.rank = BigInt.fromI32(0);
//     winner.totalPrizeValue = BigInt.fromI32(0);
//   }
//   winner.totalPrizesWon = user.totalPrizesWon;
//   winner.lastUpdated = BigInt.fromI32(Date.now());
//   winner.save();
// }

// function updateTopCreator(user: User): void {
//   let creator = TopCreator.load(user.id);
//   if (creator == null) {
//     creator = new TopCreator(user.id);
//     creator.user = user.id;
//     creator.rank = BigInt.fromI32(0);
//   }
//   creator.totalRafflesCreated = user.totalRafflesCreated;
//   creator.totalVolumeGenerated = user.totalVolumeEarned;
//   creator.totalFeesGenerated = user.totalFeesGenerated;
//   creator.lastUpdated = BigInt.fromI32(Date.now());
//   creator.save();
// }

export function handleNativeVRFUpdated(event: NativeVRFUpdatedEvent): void {
  // This is an admin event, we can log it or track VRF address changes if needed
  // For now, we'll just acknowledge it exists
}

export function handleNFTContractWhitelisted(
  event: NFTContractWhitelistedEvent
): void {
  // Create NFT contract whitelist event entity
  const eventEntity = new NFTContractWhitelistedEventEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  eventEntity.nftContract = event.params.nftContract;
  eventEntity.status = event.params.status;
  eventEntity.timestamp = event.block.timestamp;
  eventEntity.blockNumber = event.block.number;
  eventEntity.transactionHash = event.transaction.hash;
  eventEntity.save();
}
