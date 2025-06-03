# VRF Fulfiller Standalone

A standalone Node.js application for fulfilling VRF (Verifiable Random Function) requests on the NativeVRF contract.

## Features

- 🔄 Continuous monitoring for new VRF requests
- ✅ Automatic validation of fulfillment requirements
- 🛡️ Built-in security checks and replay attack prevention
- 📊 Detailed logging and error handling
- ⚙️ Configurable via environment variables
- 🚀 Easy deployment and operation

## Prerequisites

- Node.js (v16 or higher)
- pnpm package manager
- Access to an Ethereum-compatible RPC endpoint
- Private key of a wallet with ETH for gas fees

## Installation

1. Navigate to the fulfiller directory:
```bash
cd fullfiller-standalone
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy the environment template:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```bash
# Network configuration
NETWORK=localhost
RPC_URL=http://localhost:8545

# Wallet configuration
PRIVATE_KEY=your_private_key_here

# Contract configuration
CONTRACT_ADDRESS=your_contract_address_here

# Bot configuration (optional)
INTERVAL_MS=5000
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NETWORK` | Network name (used to load contract address from address list) | No | localhost |
| `RPC_URL` | RPC endpoint URL | No | http://localhost:8545 |
| `PRIVATE_KEY` | Private key of the fulfiller wallet | Yes | - |
| `CONTRACT_ADDRESS` | NativeVRF contract address | Yes* | - |
| `INTERVAL_MS` | Polling interval in milliseconds | No | 5000 |

*If `CONTRACT_ADDRESS` is not provided, the application will try to load it from `../addressList/{NETWORK}.json`

### Contract Address Loading

The application supports two ways to specify the contract address:

1. **Direct**: Set `CONTRACT_ADDRESS` in the environment
2. **Address List**: Place the address in `../addressList/{NETWORK}.json` under the key `"NativeVRF"`

## Usage

### Development Mode

Run with auto-restart on file changes:
```bash
pnpm dev
```

### Production Mode

Run the application:
```bash
pnpm start
```

### Docker (Optional)

You can also run this in a Docker container:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "start"]
```

## How It Works

1. **Monitoring**: The application continuously polls the NativeVRF contract for new requests
2. **Detection**: When a new request is found, it calculates the next request ID to fulfill
3. **Validation**: Before processing, it validates:
   - Request exists and is initialized
   - Request is not already fulfilled
   - Previous requests are properly fulfilled
   - Signature calculations match contract expectations
4. **Calculation**: Computes the required random input by:
   - Iterating through possible input values
   - Signing message hashes with the fulfiller's private key
   - Finding an input where signature value modulo difficulty equals zero
5. **Submission**: Submits the fulfillment transaction with the calculated input and signature
6. **Verification**: Confirms transaction success and logs results

## Security Features

- **Nonce Management**: Prevents replay attacks using address-based nonces
- **Message Hash Validation**: Ensures signature calculations match contract expectations
- **Difficulty Compliance**: Verifies signature values meet the required difficulty threshold
- **Input Validation**: Comprehensive pre-submission validation checks
- **Error Handling**: Graceful error handling with detailed logging

## Logging

The application provides detailed logging including:

- 🔄 Request processing status
- ✅ Validation results
- 📤 Transaction submissions
- ⚠️ Errors and warnings
- 📊 Performance metrics

## Troubleshooting

### Common Issues

1. **"Could not find valid input within reasonable attempts"**
   - The difficulty might be too high
   - Check network connectivity
   - Verify wallet has sufficient gas

2. **"Message hash mismatch"**
   - Contract address might be incorrect
   - Network configuration mismatch
   - ABI compatibility issues

3. **"Transaction failed"**
   - Insufficient gas limit
   - Request already fulfilled by another fulfiller
   - Network congestion

### Debug Mode

For additional debugging information, you can modify the code to include more verbose logging or add breakpoints for development.

## Gas Considerations

- Each fulfillment transaction consumes gas (default limit: 500,000)
- Ensure your wallet has sufficient ETH balance
- Monitor gas prices on the target network
- Consider implementing dynamic gas pricing for competitive fulfillment

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see the main project license for details.