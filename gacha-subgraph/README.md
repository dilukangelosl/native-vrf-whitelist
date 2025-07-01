# Gacha Leaderboard Subgraph

A subgraph for tracking the Gacha contract leaderboard and burn statistics. This subgraph monitors token burning events and maintains a point-based leaderboard system.

## Overview

The Gacha contract allows users to burn ERC1155 tokens (shards) to get random ERC721 tokens (relics). This subgraph tracks all burning activities and maintains a comprehensive leaderboard based on points earned.

### Point System

Each token type has a different point value when burned:

- **Flicker** (Token ID 1): 1 point per burn
- **Echo** (Token ID 2): 2 points per burn  
- **Blaze** (Token ID 3): 10 points per burn
- **Shadowflame** (Token ID 4): 50 points per burn

## Contract Details

- **Contract Address**: `0x7D4EE498fd49bcDBB9275F27feC4233932e08d03`
- **Network**: Apechain
- **Start Block**: `18221935`

## Entities

### User
Tracks individual players and their statistics:
- Total points earned
- Total tokens burned
- Token-specific burn counts
- Timestamps for activity tracking

### BurnEvent
Records individual burn transactions:
- User who burned tokens
- Token type and quantity burned
- Points earned from the burn
- Associated VRF request ID

### GachaRequest & GachaFulfillment
Track the complete gacha process:
- Initial burn request
- VRF fulfillment with minted relics
- Result token IDs and rarities

### TokenStats
Statistics for each token type:
- Total burned quantities
- Total points generated
- Number of unique burners

### GlobalStats & Leaderboard
Overall system statistics and leaderboard data:
- Global burn and point totals
- User rankings
- Daily and hourly analytics

## Key Features

1. **Real-time Leaderboard**: Track top users by points earned
2. **Burn Analytics**: Detailed statistics on token burning patterns
3. **Gacha Tracking**: Complete tracking of gacha requests and fulfillments
4. **Time-based Analytics**: Daily and hourly statistics for trend analysis
5. **Token-specific Metrics**: Individual statistics for each token type

## Setup Instructions

1. **Install Dependencies**
   ```bash
   cd gacha-subgraph
   npm install
   # or
   pnpm install
   ```

2. **Generate Code**
   ```bash
   npm run codegen
   ```

3. **Build Subgraph**
   ```bash
   npm run build
   ```

4. **Deploy to Local Node**
   ```bash
   npm run create-local
   npm run deploy-server
   ```

5. **Deploy to Hosted Service**
   ```bash
   npm run deploy
   ```

## Example Queries

### Top 10 Leaderboard
```graphql
query TopUsers {
  leaderboardEntries(
    first: 10
    orderBy: totalPoints
    orderDirection: desc
  ) {
    user {
      id
    }
    totalPoints
    totalBurns
    flickerBurns
    echoBurns
    blazeBurns
    shadowflameBurns
    updatedAt
  }
}
```

### Top Users (Alternative Query)
```graphql
query TopUsersAlternative {
  users(
    first: 10
    orderBy: totalPoints
    orderDirection: desc
  ) {
    id
    totalPoints
    totalBurns
    flickerBurns
    echoBurns
    blazeBurns
    shadowflameBurns
    lastBurnAt
  }
}
```

### User Statistics
```graphql
query UserStats($userAddress: Bytes!) {
  user(id: $userAddress) {
    totalPoints
    totalBurns
    flickerBurns
    echoBurns
    blazeBurns
    shadowflameBurns
    burnEvents(first: 10, orderBy: timestamp, orderDirection: desc) {
      shardTokenId
      quantity
      pointsEarned
      timestamp
    }
  }
}
```

### Token Statistics
```graphql
query TokenStats {
  tokenStats(orderBy: tokenId) {
    tokenId
    tokenName
    pointsPerBurn
    totalBurned
    totalBurns
    totalPointsEarned
    uniqueBurners
  }
}
```

### Global Statistics
```graphql
query GlobalStats {
  globalStats(id: "0x676c6f62616c5f7374617473") {
    totalUsers
    totalBurnEvents
    totalTokensBurned
    totalPointsEarned
    flickerBurned
    echoBurned
    blazeBurned
    shadowflameBurned
    flickerPoints
    echoPoints
    blazePoints
    shadowflamePoints
  }
}
```

### Recent Burn Events
```graphql
query RecentBurns {
  burnEvents(
    first: 20
    orderBy: timestamp
    orderDirection: desc
  ) {
    user {
      id
    }
    shardTokenId
    quantity
    pointsEarned
    timestamp
    transactionHash
  }
}
```

### Daily Analytics
```graphql
query DailyAnalytics($days: Int!) {
  dailyStats(
    first: $days
    orderBy: date
    orderDirection: desc
  ) {
    date
    tokensBurned
    burnEvents
    pointsEarned
    uniqueUsers
    gachaRequests
    gachaFulfillments
  }
}
```

## Event Monitoring

The subgraph monitors these contract events:

1. **GachaRequested**: When users burn tokens to request gacha
2. **GachaFulfilled**: When VRF provides randomness and relics are minted
3. **Paused/Unpaused**: Contract state changes

## Data Flow

1. User burns tokens → `GachaRequested` event
2. Points calculated based on token type and quantity
3. User stats, token stats, and global stats updated
4. Leaderboard entry created/updated
5. VRF fulfills request → `GachaFulfilled` event
6. Gacha request marked as fulfilled with results

## Analytics Features

- **Leaderboard Rankings**: Real-time user rankings by points
- **Burn Patterns**: Track which tokens are burned most frequently
- **User Engagement**: Monitor active users and burn frequency
- **Token Economics**: Analyze point distribution across token types
- **Time-based Trends**: Daily and hourly burn statistics

## Development

To modify the subgraph:

1. Update `schema.graphql` for new entities
2. Modify `subgraph.yaml` for new events or contract changes
3. Update `src/gacha-mapping.ts` for new event handlers
4. Run `npm run codegen` to regenerate types
5. Test and deploy

## Notes

- The subgraph starts indexing from block `18221935` on Apechain
- Points are calculated immediately when tokens are burned (on `GachaRequested`)
- All statistics are updated in real-time as events are processed
- The leaderboard can handle large numbers of users efficiently
- Daily/hourly stats enable trend analysis and reporting