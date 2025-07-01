import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  GachaRequested as GachaRequestedEvent,
  GachaFulfilled as GachaFulfilledEvent,
  Paused as PausedEvent,
  Unpaused as UnpausedEvent,
} from "../generated/Gacha/Gacha";
import {
  User,
  BurnEvent,
  GachaRequest,
  GachaFulfillment,
  TokenStats,
  GlobalStats,
  DailyStats,
  LeaderboardEntry,
  HourlyStats,
} from "../generated/schema";

// Constants for token points
const FLICKER_POINTS = BigInt.fromI32(1); // Token ID 1
const ECHO_POINTS = BigInt.fromI32(2); // Token ID 2
const BLAZE_POINTS = BigInt.fromI32(10); // Token ID 3
const SHADOWFLAME_POINTS = BigInt.fromI32(50); // Token ID 4

// Token names mapping
const TOKEN_NAMES = ["", "Flicker", "Echo", "Blaze", "Shadowflame"];

// Helper function to get points for a token ID
function getPointsForToken(tokenId: BigInt): BigInt {
  const id = tokenId.toI32();
  if (id == 1) return FLICKER_POINTS;
  if (id == 2) return ECHO_POINTS;
  if (id == 3) return BLAZE_POINTS;
  if (id == 4) return SHADOWFLAME_POINTS;
  return BigInt.fromI32(0);
}

// Helper function to get token name
function getTokenName(tokenId: BigInt): string {
  const id = tokenId.toI32();
  if (id >= 1 && id <= 4) {
    return TOKEN_NAMES[id];
  }
  return "Unknown";
}

// Helper function to get or create user
function getOrCreateUser(address: Address, timestamp: BigInt): User {
  let user = User.load(address);
  if (user == null) {
    user = new User(address);
    user.totalPoints = BigInt.fromI32(0);
    user.totalBurns = BigInt.fromI32(0);
    user.flickerBurns = BigInt.fromI32(0);
    user.echoBurns = BigInt.fromI32(0);
    user.blazeBurns = BigInt.fromI32(0);
    user.shadowflameBurns = BigInt.fromI32(0);
    user.createdAt = timestamp;
    user.lastBurnAt = timestamp;
    user.save();

    // Update global stats
    const globalStats = getOrCreateGlobalStats();
    globalStats.totalUsers = globalStats.totalUsers.plus(BigInt.fromI32(1));
    globalStats.save();
  }
  return user;
}

// Helper function to get or create token stats
function getOrCreateTokenStats(tokenId: BigInt): TokenStats {
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId));
  let tokenStats = TokenStats.load(tokenIdBytes);
  if (tokenStats == null) {
    tokenStats = new TokenStats(tokenIdBytes);
    tokenStats.tokenId = tokenId;
    tokenStats.tokenName = getTokenName(tokenId);
    tokenStats.pointsPerBurn = getPointsForToken(tokenId);
    tokenStats.totalBurned = BigInt.fromI32(0);
    tokenStats.totalBurns = BigInt.fromI32(0);
    tokenStats.totalPointsEarned = BigInt.fromI32(0);
    tokenStats.uniqueBurners = BigInt.fromI32(0);
    tokenStats.save();
  }
  return tokenStats;
}

// Helper function to get or create global stats
function getOrCreateGlobalStats(): GlobalStats {
  const statsId = Bytes.fromHexString("0x676c6f62616c5f7374617473"); // "global_stats" in hex
  let stats = GlobalStats.load(statsId);
  if (stats == null) {
    stats = new GlobalStats(statsId);
    stats.totalUsers = BigInt.fromI32(0);
    stats.totalBurnEvents = BigInt.fromI32(0);
    stats.totalTokensBurned = BigInt.fromI32(0);
    stats.totalPointsEarned = BigInt.fromI32(0);
    stats.totalGachaRequests = BigInt.fromI32(0);
    stats.totalGachaFulfillments = BigInt.fromI32(0);
    stats.totalRelicsMinted = BigInt.fromI32(0);
    stats.flickerBurned = BigInt.fromI32(0);
    stats.echoBurned = BigInt.fromI32(0);
    stats.blazeBurned = BigInt.fromI32(0);
    stats.shadowflameBurned = BigInt.fromI32(0);
    stats.flickerPoints = BigInt.fromI32(0);
    stats.echoPoints = BigInt.fromI32(0);
    stats.blazePoints = BigInt.fromI32(0);
    stats.shadowflamePoints = BigInt.fromI32(0);
    stats.save();
  }
  return stats;
}

// Helper function to get or create daily stats
function getOrCreateDailyStats(timestamp: BigInt): DailyStats {
  // Get start of day timestamp
  const dayStart = timestamp.minus(timestamp.mod(BigInt.fromI32(86400)));
  const dayId = Bytes.fromByteArray(Bytes.fromBigInt(dayStart));

  let dailyStats = DailyStats.load(dayId);
  if (dailyStats == null) {
    dailyStats = new DailyStats(dayId);
    dailyStats.date = dayStart;
    dailyStats.tokensBurned = BigInt.fromI32(0);
    dailyStats.burnEvents = BigInt.fromI32(0);
    dailyStats.pointsEarned = BigInt.fromI32(0);
    dailyStats.uniqueUsers = BigInt.fromI32(0);
    dailyStats.gachaRequests = BigInt.fromI32(0);
    dailyStats.gachaFulfillments = BigInt.fromI32(0);
    dailyStats.relicsMinted = BigInt.fromI32(0);
    dailyStats.save();
  }
  return dailyStats;
}

// Helper function to get or create hourly stats
function getOrCreateHourlyStats(timestamp: BigInt): HourlyStats {
  // Get start of hour timestamp
  const hourStart = timestamp.minus(timestamp.mod(BigInt.fromI32(3600)));
  const hourId = Bytes.fromByteArray(Bytes.fromBigInt(hourStart));

  let hourlyStats = HourlyStats.load(hourId);
  if (hourlyStats == null) {
    hourlyStats = new HourlyStats(hourId);
    hourlyStats.hour = hourStart;
    hourlyStats.tokensBurned = BigInt.fromI32(0);
    hourlyStats.burnEvents = BigInt.fromI32(0);
    hourlyStats.pointsEarned = BigInt.fromI32(0);
    hourlyStats.uniqueUsers = BigInt.fromI32(0);
    hourlyStats.gachaRequests = BigInt.fromI32(0);
    hourlyStats.gachaFulfillments = BigInt.fromI32(0);
    hourlyStats.save();
  }
  return hourlyStats;
}

// Helper function to update leaderboard entry
function updateLeaderboardEntry(user: User): void {
  let leaderboardEntry = LeaderboardEntry.load(user.id);
  if (leaderboardEntry == null) {
    leaderboardEntry = new LeaderboardEntry(user.id);
    leaderboardEntry.rank = BigInt.fromI32(0); // Will be calculated separately
  }
  leaderboardEntry.user = user.id;
  leaderboardEntry.totalPoints = user.totalPoints;
  leaderboardEntry.totalBurns = user.totalBurns;
  leaderboardEntry.flickerBurns = user.flickerBurns;
  leaderboardEntry.echoBurns = user.echoBurns;
  leaderboardEntry.blazeBurns = user.blazeBurns;
  leaderboardEntry.shadowflameBurns = user.shadowflameBurns;
  leaderboardEntry.updatedAt = user.lastBurnAt;
  leaderboardEntry.save();
}

export function handleGachaRequested(event: GachaRequestedEvent): void {
  // Create or get user
  const user = getOrCreateUser(event.params.user, event.block.timestamp);

  // Calculate points earned from this burn
  const pointsPerToken = getPointsForToken(event.params.shardTokenId);
  const totalPointsEarned = pointsPerToken.times(event.params.quantity);

  // Create burn event
  const burnEventId = event.transaction.hash.concatI32(event.logIndex.toI32());
  const burnEvent = new BurnEvent(burnEventId);
  burnEvent.user = user.id;
  burnEvent.shardTokenId = event.params.shardTokenId;
  burnEvent.quantity = event.params.quantity;
  burnEvent.pointsEarned = totalPointsEarned;
  burnEvent.timestamp = event.block.timestamp;
  burnEvent.blockNumber = event.block.number;
  burnEvent.transactionHash = event.transaction.hash;
  burnEvent.vrfRequestId = event.params.vrfRequestId;
  burnEvent.save();

  // Create gacha request
  const gachaRequestId = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.vrfRequestId)
  );
  const gachaRequest = new GachaRequest(gachaRequestId);
  gachaRequest.vrfRequestId = event.params.vrfRequestId;
  gachaRequest.user = user.id;
  gachaRequest.shardTokenId = event.params.shardTokenId;
  gachaRequest.quantity = event.params.quantity;
  gachaRequest.pointsEarned = totalPointsEarned;
  gachaRequest.fulfilled = false;
  gachaRequest.resultTokenIds = [];
  gachaRequest.timestamp = event.block.timestamp;
  gachaRequest.blockNumber = event.block.number;
  gachaRequest.transactionHash = event.transaction.hash;
  gachaRequest.fulfilledAt = BigInt.fromI32(0);
  gachaRequest.fulfilledBlockNumber = BigInt.fromI32(0);
  gachaRequest.fulfilledTransactionHash = Bytes.fromHexString(
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
  gachaRequest.save();

  // Update user stats
  user.totalPoints = user.totalPoints.plus(totalPointsEarned);
  user.totalBurns = user.totalBurns.plus(event.params.quantity);
  user.lastBurnAt = event.block.timestamp;

  // Update user token-specific burns
  const tokenId = event.params.shardTokenId.toI32();
  if (tokenId == 1) {
    user.flickerBurns = user.flickerBurns.plus(event.params.quantity);
  } else if (tokenId == 2) {
    user.echoBurns = user.echoBurns.plus(event.params.quantity);
  } else if (tokenId == 3) {
    user.blazeBurns = user.blazeBurns.plus(event.params.quantity);
  } else if (tokenId == 4) {
    user.shadowflameBurns = user.shadowflameBurns.plus(event.params.quantity);
  }
  user.save();

  // Update token stats
  const tokenStats = getOrCreateTokenStats(event.params.shardTokenId);
  tokenStats.totalBurned = tokenStats.totalBurned.plus(event.params.quantity);
  tokenStats.totalBurns = tokenStats.totalBurns.plus(BigInt.fromI32(1));
  tokenStats.totalPointsEarned =
    tokenStats.totalPointsEarned.plus(totalPointsEarned);
  tokenStats.save();

  // Update global stats
  const globalStats = getOrCreateGlobalStats();
  globalStats.totalBurnEvents = globalStats.totalBurnEvents.plus(
    BigInt.fromI32(1)
  );
  globalStats.totalTokensBurned = globalStats.totalTokensBurned.plus(
    event.params.quantity
  );
  globalStats.totalPointsEarned =
    globalStats.totalPointsEarned.plus(totalPointsEarned);
  globalStats.totalGachaRequests = globalStats.totalGachaRequests.plus(
    BigInt.fromI32(1)
  );

  // Update global token-specific stats
  if (tokenId == 1) {
    globalStats.flickerBurned = globalStats.flickerBurned.plus(
      event.params.quantity
    );
    globalStats.flickerPoints =
      globalStats.flickerPoints.plus(totalPointsEarned);
  } else if (tokenId == 2) {
    globalStats.echoBurned = globalStats.echoBurned.plus(event.params.quantity);
    globalStats.echoPoints = globalStats.echoPoints.plus(totalPointsEarned);
  } else if (tokenId == 3) {
    globalStats.blazeBurned = globalStats.blazeBurned.plus(
      event.params.quantity
    );
    globalStats.blazePoints = globalStats.blazePoints.plus(totalPointsEarned);
  } else if (tokenId == 4) {
    globalStats.shadowflameBurned = globalStats.shadowflameBurned.plus(
      event.params.quantity
    );
    globalStats.shadowflamePoints =
      globalStats.shadowflamePoints.plus(totalPointsEarned);
  }
  globalStats.save();

  // Update daily stats
  const dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.tokensBurned = dailyStats.tokensBurned.plus(event.params.quantity);
  dailyStats.burnEvents = dailyStats.burnEvents.plus(BigInt.fromI32(1));
  dailyStats.pointsEarned = dailyStats.pointsEarned.plus(totalPointsEarned);
  dailyStats.gachaRequests = dailyStats.gachaRequests.plus(BigInt.fromI32(1));
  dailyStats.save();

  // Update hourly stats
  const hourlyStats = getOrCreateHourlyStats(event.block.timestamp);
  hourlyStats.tokensBurned = hourlyStats.tokensBurned.plus(
    event.params.quantity
  );
  hourlyStats.burnEvents = hourlyStats.burnEvents.plus(BigInt.fromI32(1));
  hourlyStats.pointsEarned = hourlyStats.pointsEarned.plus(totalPointsEarned);
  hourlyStats.gachaRequests = hourlyStats.gachaRequests.plus(BigInt.fromI32(1));
  hourlyStats.save();

  // Update leaderboard entry
  updateLeaderboardEntry(user);
}

export function handleGachaFulfilled(event: GachaFulfilledEvent): void {
  // Load the gacha request
  const gachaRequestId = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.vrfRequestId)
  );
  const gachaRequest = GachaRequest.load(gachaRequestId);

  if (gachaRequest != null) {
    // Update gacha request as fulfilled
    gachaRequest.fulfilled = true;
    gachaRequest.resultTokenIds = event.params.relicTokenIds;
    gachaRequest.fulfilledAt = event.block.timestamp;
    gachaRequest.fulfilledBlockNumber = event.block.number;
    gachaRequest.fulfilledTransactionHash = event.transaction.hash;
    gachaRequest.save();
  }

  // Create gacha fulfillment event
  const fulfillmentId = event.transaction.hash.concatI32(
    event.logIndex.toI32()
  );
  const fulfillment = new GachaFulfillment(fulfillmentId);
  fulfillment.vrfRequestId = event.params.vrfRequestId;
  fulfillment.user = event.params.user;
  fulfillment.shardTokenId = event.params.shardTokenId;
  fulfillment.quantity = event.params.quantity;
  fulfillment.resultTokenIds = event.params.relicTokenIds;

  // Convert rarity enum array to BigInt array
  const rarities: BigInt[] = [];
  for (let i = 0; i < event.params.rarities.length; i++) {
    rarities.push(BigInt.fromI32(event.params.rarities[i]));
  }
  fulfillment.resultRarities = rarities;
  fulfillment.timestamp = event.block.timestamp;
  fulfillment.blockNumber = event.block.number;
  fulfillment.transactionHash = event.transaction.hash;
  fulfillment.save();

  // Update global stats
  const globalStats = getOrCreateGlobalStats();
  globalStats.totalGachaFulfillments = globalStats.totalGachaFulfillments.plus(
    BigInt.fromI32(1)
  );
  globalStats.totalRelicsMinted = globalStats.totalRelicsMinted.plus(
    BigInt.fromI32(event.params.relicTokenIds.length)
  );
  globalStats.save();

  // Update daily stats
  const dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.gachaFulfillments = dailyStats.gachaFulfillments.plus(
    BigInt.fromI32(1)
  );
  dailyStats.relicsMinted = dailyStats.relicsMinted.plus(
    BigInt.fromI32(event.params.relicTokenIds.length)
  );
  dailyStats.save();

  // Update hourly stats
  const hourlyStats = getOrCreateHourlyStats(event.block.timestamp);
  hourlyStats.gachaFulfillments = hourlyStats.gachaFulfillments.plus(
    BigInt.fromI32(1)
  );
  hourlyStats.save();
}

export function handlePaused(event: PausedEvent): void {
  // Contract paused - could add contract state tracking if needed
}

export function handleUnpaused(event: UnpausedEvent): void {
  // Contract unpaused - could add contract state tracking if needed
}
