# RaffleOnApe Subgraph - Example Queries

This document contains example GraphQL queries for the RaffleOnApe subgraph.

## Basic Queries

### Get All Raffles with Tickets

```graphql
query GetAllRafflesWithTickets {
  raffles {
    id
    raffleId
    creator {
      id
      totalRafflesCreated
    }
    prizeContract
    paymentToken
    winner {
      id
      totalPrizesWon
    }
    prizeAmount
    ticketPrice
    prizeTokenId
    maxTicketsPerUser
    totalMaxTickets
    currentTickets
    endTime
    minTicketsNeededToDraw
    prizeType
    status
    vrfRequestId
    createdAt
    blockNumber
    transactionHash
    tickets {
      id
      buyer {
        id
      }
      quantity
      timestamp
      transactionHash
    }
  }
}
```

### Get Raffles by Creator Address

```graphql
query GetRafflesByCreator($creatorAddress: Bytes!) {
  raffles(where: { creator: $creatorAddress }) {
    id
    raffleId
    creator {
      id
      totalRafflesCreated
    }
    prizeContract
    prizeAmount
    ticketPrice
    currentTickets
    endTime
    prizeType
    status
    createdAt
    tickets {
      id
      buyer {
        id
      }
      quantity
      timestamp
    }
  }
}
```

Variables:
```json
{
  "creatorAddress": "0x1234567890123456789012345678901234567890"
}
```

## Advanced Queries

### Get Active Raffles Only

```graphql
query GetActiveRaffles {
  raffles(where: { status: 0 }) {
    id
    raffleId
    creator {
      id
    }
    prizeContract
    prizeAmount
    ticketPrice
    currentTickets
    totalMaxTickets
    endTime
    minTicketsNeededToDraw
    prizeType
    createdAt
    tickets {
      buyer {
        id
      }
      quantity
    }
  }
}
```

### Get Raffles with Winners

```graphql
query GetRafflesWithWinners {
  raffles(where: { winner_not: null }) {
    id
    raffleId
    creator {
      id
    }
    winner {
      id
      totalPrizesWon
    }
    prizeContract
    prizeAmount
    prizeType
    status
    createdAt
  }
}
```

### Get User's Activity (Created Raffles, Purchased Tickets, Won Prizes)

```graphql
query GetUserActivity($userAddress: Bytes!) {
  user(id: $userAddress) {
    id
    totalRafflesCreated
    totalTicketsPurchased
    totalRefundsClaimed
    totalPrizesWon
    createdAt
    rafflesCreated {
      id
      raffleId
      prizeAmount
      currentTickets
      status
      createdAt
    }
    tickets {
      id
      raffle {
        id
        raffleId
        prizeAmount
        status
      }
      quantity
      timestamp
    }
    rafflesWon {
      id
      raffleId
      prizeAmount
      prizeType
      createdAt
    }
    refunds {
      id
      raffle {
        id
        raffleId
      }
      amount
      timestamp
    }
  }
}
```

Variables:
```json
{
  "userAddress": "0x1234567890123456789012345678901234567890"
}
```

### Get Raffle Details with All Related Data

```graphql
query GetRaffleDetails($raffleId: BigInt!) {
  raffles(where: { raffleId: $raffleId }) {
    id
    raffleId
    creator {
      id
      totalRafflesCreated
    }
    prizeContract
    paymentToken
    winner {
      id
      totalPrizesWon
    }
    prizeAmount
    ticketPrice
    prizeTokenId
    maxTicketsPerUser
    totalMaxTickets
    currentTickets
    endTime
    minTicketsNeededToDraw
    prizeType
    status
    vrfRequestId
    createdAt
    blockNumber
    transactionHash
    tickets {
      id
      buyer {
        id
      }
      quantity
      timestamp
      blockNumber
      transactionHash
    }
    refunds {
      id
      user {
        id
      }
      amount
      timestamp
      blockNumber
      transactionHash
    }
  }
}
```

Variables:
```json
{
  "raffleId": "1"
}
```

### Get Recent Raffles (Ordered by Creation Time)

```graphql
query GetRecentRaffles($limit: Int = 10) {
  raffles(
    first: $limit
    orderBy: createdAt
    orderDirection: desc
  ) {
    id
    raffleId
    creator {
      id
    }
    prizeContract
    prizeAmount
    ticketPrice
    currentTickets
    totalMaxTickets
    endTime
    prizeType
    status
    createdAt
  }
}
```

### Get Raffles by Prize Type

```graphql
query GetRafflesByPrizeType($prizeType: Int!) {
  raffles(where: { prizeType: $prizeType }) {
    id
    raffleId
    creator {
      id
    }
    prizeContract
    prizeAmount
    prizeTokenId
    ticketPrice
    currentTickets
    status
    createdAt
  }
}
```

Variables for ERC20 prizes:
```json
{
  "prizeType": 0
}
```

Variables for ERC721 prizes:
```json
{
  "prizeType": 1
}
```

Variables for ERC1155 prizes:
```json
{
  "prizeType": 2
}
```

### Get Global Statistics

```graphql
query GetGlobalStats {
  globalStats(id: "0x01") {
    id
    totalRaffles
    totalTicketsSold
    totalValueLocked
    totalRefunds
    totalPrizesClaimed
    totalVolume
    totalFeesGenerated
    totalCreatorEarnings
  }
}
```

### Get Volume and Fee Analytics

```graphql
query GetVolumeAnalytics {
  globalStats(id: "0x01") {
    totalVolume
    totalFeesGenerated
    totalCreatorEarnings
  }
  
  # Recent volume snapshots
  volumeSnapshots(
    first: 10
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    timestamp
    totalVolume
    totalFees
    totalTicketsSold
    totalRaffles
    blockNumber
  }
}
```

### Get Daily/Weekly/Monthly Volume Data

```graphql
query GetDailyVolume($days: Int = 30) {
  dailyVolumes(
    first: $days
    orderBy: date
    orderDirection: desc
  ) {
    id
    date
    volume
    fees
    ticketsSold
    rafflesCreated
    uniqueParticipants
  }
}
```

```graphql
query GetWeeklyVolume($weeks: Int = 12) {
  weeklyVolumes(
    first: $weeks
    orderBy: weekStart
    orderDirection: desc
  ) {
    id
    weekStart
    volume
    fees
    ticketsSold
    rafflesCreated
    uniqueParticipants
  }
}
```

```graphql
query GetMonthlyVolume($months: Int = 12) {
  monthlyVolumes(
    first: $months
    orderBy: monthStart
    orderDirection: desc
  ) {
    id
    monthStart
    volume
    fees
    ticketsSold
    rafflesCreated
    uniqueParticipants
  }
}
```

### Get Top Users by Activity

```graphql
query GetTopUsersByRafflesCreated($limit: Int = 10) {
  users(
    first: $limit
    orderBy: totalRafflesCreated
    orderDirection: desc
  ) {
    id
    totalRafflesCreated
    totalTicketsPurchased
    totalPrizesWon
    createdAt
  }
}
```

```graphql
query GetTopUsersByTicketsPurchased($limit: Int = 10) {
  users(
    first: $limit
    orderBy: totalTicketsPurchased
    orderDirection: desc
  ) {
    id
    totalRafflesCreated
    totalTicketsPurchased
    totalPrizesWon
    createdAt
  }
}
```

### Get Event History

```graphql
query GetRaffleCreatedEvents($limit: Int = 20) {
  raffleCreatedEvents(
    first: $limit
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    raffleId
    creator
    prizeContract
    prizeAmount
    timestamp
    blockNumber
    transactionHash
  }
}
```

```graphql
query GetRaffleDrawnEvents($limit: Int = 20) {
  raffleDrawnEvents(
    first: $limit
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    raffleId
    winner
    vrfRequestId
    timestamp
    blockNumber
    transactionHash
  }
}
```

## Filter Examples

### Get Raffles with Minimum Prize Amount

```graphql
query GetHighValueRaffles($minPrizeAmount: BigInt!) {
  raffles(where: { prizeAmount_gte: $minPrizeAmount }) {
    id
    raffleId
    creator {
      id
    }
    prizeContract
    prizeAmount
    ticketPrice
    currentTickets
    status
    createdAt
  }
}
```

### Get Raffles Ending Soon

```graphql
query GetRafflesEndingSoon($currentTime: BigInt!, $timeLimit: BigInt!) {
  raffles(
    where: { 
      status: 0,
      endTime_lte: $timeLimit,
      endTime_gte: $currentTime
    }
  ) {
    id
    raffleId
    creator {
      id
    }
    prizeAmount
    currentTickets
    endTime
    minTicketsNeededToDraw
  }
}
```

## Pagination Example

```graphql
query GetRafflesPaginated($skip: Int!, $first: Int!) {
  raffles(
    skip: $skip
    first: $first
    orderBy: createdAt
    orderDirection: desc
  ) {
    id
    raffleId
    creator {
      id
    }
    prizeAmount
    currentTickets
    status
    createdAt
  }
}
```

Variables for page 1 (first 10 items):
```json
{
  "skip": 0,
  "first": 10
}
```

Variables for page 2 (next 10 items):
```json
{
  "skip": 10,
  "first": 10
}
```

## Notes

- All timestamps are in Unix timestamp format (seconds since epoch)
- Prize types: 0 = ERC20, 1 = ERC721, 2 = ERC1155
- Raffle statuses: 0 = ACTIVE, 1 = DRAWN, 2 = CANCELLED, 3 = REFUND_AVAILABLE
- Addresses are represented as `Bytes` type in lowercase hex format
- BigInt values should be passed as strings in variables
- The subgraph endpoint will be available after deployment on The Graph Network or local Graph Node
## Leaderboard Queries

### Get Top Participants (by tickets purchased)

```graphql
query GetTopParticipants($limit: Int = 10) {
  topParticipants(
    first: $limit
    orderBy: totalTicketsPurchased
    orderDirection: desc
  ) {
    id
    user {
      id
      totalTicketsPurchased
      totalVolumeSpent
      totalPrizesWon
      createdAt
    }
    totalTicketsPurchased
    totalVolumeSpent
    rank
    lastUpdated
  }
}
```

### Get Top Winners (by prizes won)

```graphql
query GetTopWinners($limit: Int = 10) {
  topWinners(
    first: $limit
    orderBy: totalPrizesWon
    orderDirection: desc
  ) {
    id
    user {
      id
      totalPrizesWon
      totalTicketsPurchased
      createdAt
    }
    totalPrizesWon
    totalPrizeValue
    rank
    lastUpdated
  }
}
```

### Get Top Creators (by raffles created and volume generated)

```graphql
query GetTopCreators($limit: Int = 10) {
  topCreators(
    first: $limit
    orderBy: totalVolumeGenerated
    orderDirection: desc
  ) {
    id
    user {
      id
      totalRafflesCreated
      totalVolumeEarned
      totalFeesGenerated
      createdAt
    }
    totalRafflesCreated
    totalVolumeGenerated
    totalFeesGenerated
    rank
    lastUpdated
  }
}
```

### Get User Volume and Fee Statistics

```graphql
query GetUserVolumeStats($userAddress: Bytes!) {
  user(id: $userAddress) {
    id
    totalRafflesCreated
    totalTicketsPurchased
    totalRefundsClaimed
    totalPrizesWon
    totalVolumeSpent
    totalVolumeEarned
    totalFeesGenerated
    createdAt
  }
}
```

### Get Fee History

```graphql
query GetFeeHistory($limit: Int = 20) {
  feeUpdatedEvents(
    first: $limit
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    newFeePercentage
    timestamp
    blockNumber
    transactionHash
  }
}
```

### Combined Leaderboard Dashboard Query

```graphql
query GetLeaderboardDashboard {
  # Global stats
  globalStats(id: "0x01") {
    totalRaffles
    totalTicketsSold
    totalVolume
    totalFeesGenerated
    totalCreatorEarnings
  }
  
  # Top participants
  topParticipants(first: 5, orderBy: totalVolumeSpent, orderDirection: desc) {
    user {
      id
    }
    totalTicketsPurchased
    totalVolumeSpent
  }
  
  # Top winners
  topWinners(first: 5, orderBy: totalPrizesWon, orderDirection: desc) {
    user {
      id
    }
    totalPrizesWon
    totalPrizeValue
  }
  
  # Top creators
  topCreators(first: 5, orderBy: totalVolumeGenerated, orderDirection: desc) {
    user {
      id
    }
    totalRafflesCreated
    totalVolumeGenerated
    totalFeesGenerated
  }
  
  # Recent volume data
  dailyVolumes(first: 7, orderBy: date, orderDirection: desc) {
    date
    volume
    fees
    ticketsSold
  }
}
```

## Analytics Queries

### Get Volume Trends

```graphql
query GetVolumeTrends($fromDate: BigInt!, $toDate: BigInt!) {
  dailyVolumes(
    where: { 
      date_gte: $fromDate,
      date_lte: $toDate
    }
    orderBy: date
    orderDirection: asc
  ) {
    date
    volume
    fees
    ticketsSold
    rafflesCreated
    uniqueParticipants
  }
}
```

### Get User Performance Over Time

```graphql
query GetUserPerformance($userAddress: Bytes!) {
  user(id: $userAddress) {
    id
    totalVolumeSpent
    totalVolumeEarned
    totalFeesGenerated
    
    # Recent tickets purchased
    tickets(
      first: 10
      orderBy: timestamp
      orderDirection: desc
    ) {
      quantity
      timestamp
      raffle {
        raffleId
        ticketPrice
        status
      }
    }
    
    # Recent raffles created
    rafflesCreated(
      first: 10
      orderBy: createdAt
      orderDirection: desc
    ) {
      raffleId
      prizeAmount
      currentTickets
      status
      createdAt
    }
    
    # Prizes won
    rafflesWon {
      raffleId
      prizeAmount
      prizeType
      createdAt
    }
  }
}
```