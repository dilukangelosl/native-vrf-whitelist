import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// Native VRF Contract ABI (minimal required functions)
const NATIVE_VRF_ABI = [
  "function currentRequestId() view returns (uint256)",
  "function latestFulfillId() view returns (uint256)",
  "function requestInitializers(uint256) view returns (address)",
  "function randomResults(uint256) view returns (uint256)",
  "function difficulty() view returns (uint256)",
  "function getNonce(address) view returns (uint256)",
  "function getMessageHash(uint256 _requestId, uint256 _randInput) view returns (bytes32)",
  "function fullfillRandomness(uint256[] _requestIds, uint256[] _randInputs, bytes[] _signatures)",
  "event RandomRequested(uint256 indexed requestId)",
  "event RandomFullfilled(uint256 indexed requestId, uint256 random)",
];

class VRFFulfiller {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.isRunning = false;
  }

  async initialize() {
    console.log("Initializing VRF Fulfiller...");

    // Setup provider
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);

    // Setup signer
    this.signer = new ethers.Wallet(this.config.privateKey, this.provider);

    // Setup contract
    this.contract = new ethers.Contract(
      this.config.contractAddress,
      NATIVE_VRF_ABI,
      this.signer
    );

    console.log(
      `✅ Initialized with signer: ${await this.signer.getAddress()}`
    );
    console.log(`✅ Connected to contract: ${this.config.contractAddress}`);
    console.log(`✅ Network: ${this.config.network}`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  convertSignatureLocal(signature) {
    const truncatedNumber = ethers.BigNumber.from(signature)
      .toHexString()
      .slice(0, 66);
    return ethers.BigNumber.from(truncatedNumber);
  }

  calculateMessageHash(prevRandom, randInput, requestId, sender, nonce) {
    return ethers.utils.solidityKeccak256(
      ["uint256", "uint256", "uint256", "address", "uint256"],
      [prevRandom, randInput, requestId, sender, nonce]
    );
  }

  async calculateRandomInput(requestId) {
    let input = 0;
    let found = 0;

    const prevRandom = await this.contract.randomResults(Number(requestId) - 1);
    const difficulty = await this.contract.difficulty();
    const signerAddress = await this.signer.getAddress();
    const nonce = await this.contract.getNonce(signerAddress);

    console.log(`🔄 Calculating random input for request ${requestId}`);
    console.log(`  Previous random: ${prevRandom.toString()}`);
    console.log(`  Difficulty: ${difficulty.toString()}`);
    console.log(`  Signer nonce: ${nonce.toString()}`);

    do {
      const message = this.calculateMessageHash(
        prevRandom,
        input,
        requestId,
        signerAddress,
        nonce
      );

      const signature = await this.signer.signMessage(
        ethers.utils.arrayify(message)
      );
      const value = this.convertSignatureLocal(signature);

      if (value.mod(difficulty).eq(0)) {
        found = input;
        console.log(
          `✅ Found valid input: ${found}, signature value: ${value.toString()}`
        );
      }

      input++;

      if (input > 1000000) {
        throw new Error(
          "Could not find valid input within reasonable attempts"
        );
      }
    } while (found === 0);

    // Generate the final signature with the found input
    const finalMessage = this.calculateMessageHash(
      prevRandom,
      found,
      requestId,
      signerAddress,
      nonce
    );

    const finalSignature = await this.signer.signMessage(
      ethers.utils.arrayify(finalMessage)
    );

    return { input: found, signature: finalSignature };
  }

  async validateFulfillment(requestId, input, signature) {
    console.log("\n🔍 PRE-SUBMISSION VALIDATION");

    // Check if request exists
    const requestInitializer = await this.contract.requestInitializers(
      requestId
    );
    console.log(`  Request ${requestId} initializer: ${requestInitializer}`);

    if (requestInitializer === ethers.constants.AddressZero) {
      console.error(`❌ Request ${requestId} has not been initialized!`);
      return false;
    }

    // Check if already fulfilled
    const currentResult = await this.contract.randomResults(requestId);
    console.log(
      `  Request ${requestId} current result: ${currentResult.toString()}`
    );

    if (!currentResult.eq(0)) {
      console.error(`❌ Request ${requestId} is already fulfilled!`);
      return false;
    }

    // Check previous request is fulfilled
    if (requestId.gt(1)) {
      const prevResult = await this.contract.randomResults(requestId.sub(1));
      console.log(
        `  Previous request ${requestId.sub(
          1
        )} result: ${prevResult.toString()}`
      );

      if (prevResult.eq(0)) {
        console.error(
          `❌ Previous request ${requestId.sub(1)} is not fulfilled yet!`
        );
        return false;
      }
    }

    // Validate message hash matches contract expectation
    const contractMessageHash = await this.contract.getMessageHash(
      requestId,
      input
    );
    const signerAddress = await this.signer.getAddress();
    const nonce = await this.contract.getNonce(signerAddress);
    const prevRandom = requestId.gt(0)
      ? await this.contract.randomResults(requestId.sub(1))
      : ethers.BigNumber.from(0);

    const ourMessageHash = this.calculateMessageHash(
      prevRandom,
      input,
      requestId,
      signerAddress,
      nonce
    );

    console.log(`  Contract message hash: ${contractMessageHash}`);
    console.log(`  Our message hash: ${ourMessageHash}`);
    console.log(
      `  Message hashes match: ${contractMessageHash === ourMessageHash}`
    );

    if (contractMessageHash !== ourMessageHash) {
      console.error(
        "❌ Message hash mismatch! This will cause the transaction to fail."
      );
      return false;
    }

    // Validate signature value meets difficulty requirement
    const sigValue = this.convertSignatureLocal(signature);
    const difficulty = await this.contract.difficulty();
    console.log(`  Signature value: ${sigValue.toString()}`);
    console.log(`  Difficulty: ${difficulty.toString()}`);
    console.log(
      `  Meets difficulty requirement: ${sigValue.mod(difficulty).eq(0)}`
    );

    if (!sigValue.mod(difficulty).eq(0)) {
      console.error("❌ Signature value does not meet difficulty requirement!");
      return false;
    }

    console.log("✅ All validations passed");
    return true;
  }

  async processNextRequest() {
    try {
      const curRequestId = await this.contract.currentRequestId();
      const latestFulfill = await this.contract.latestFulfillId();
      const requestId = latestFulfill.add(1);

      if (curRequestId.lte(requestId)) {
        console.log(
          "⏳ No new random requests. Waiting for incoming requests..."
        );
        return;
      }

      console.log("\n🔔 Found new random request!");
      console.log(`  Current ID: ${curRequestId.toString()}`);
      console.log(`  Last fulfill ID: ${latestFulfill.toString()}`);
      console.log(`  Processing request ID: ${requestId.toString()}`);

      const { input, signature } = await this.calculateRandomInput(
        requestId.toString()
      );

      const isValid = await this.validateFulfillment(
        requestId,
        input,
        signature
      );
      if (!isValid) {
        console.error("❌ Validation failed, skipping fulfillment");
        return;
      }

      console.log("\n📤 SUBMITTING FULFILLMENT");
      console.log(`  Input: ${input}`);
      console.log(`  Signature: ${signature}`);

      const tx = await this.contract.fullfillRandomness(
        [requestId],
        [input],
        [signature],
        {
          gasLimit: 500000,
        }
      );

      console.log(`⏳ Transaction submitted: ${tx.hash}`);

      const receipt = await tx.wait();

      if (receipt.status === 0) {
        console.error("❌ Transaction failed!");
        console.log("Receipt:", JSON.stringify(receipt, null, 2));
      } else {
        console.log("✅ Fulfillment successful!");
        console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`  Block number: ${receipt.blockNumber}`);
      }
    } catch (error) {
      console.error("❌ Error processing request:", error.message);
      if (error.reason) {
        console.error("  Reason:", error.reason);
      }
    }
  }

  async start() {
    console.log("🚀 Starting VRF Fulfiller Bot...");
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.processNextRequest();
      } catch (error) {
        console.error("❌ Error in main loop:", error.message);
      }

      await this.delay(this.config.intervalMs || 5000);
    }
  }

  stop() {
    console.log("⏹️ Stopping VRF Fulfiller Bot...");
    this.isRunning = false;
  }
}

// Configuration loader
function loadConfig() {
  const config = {
    network: process.env.NETWORK || "localhost",
    rpcUrl: process.env.RPC_URL || "http://localhost:8545",
    privateKey: process.env.PRIVATE_KEY,
    contractAddress: process.env.CONTRACT_ADDRESS,
    intervalMs: parseInt(process.env.INTERVAL_MS || "5000"),
  };

  // Try to load contract address from address list if not provided
  if (!config.contractAddress) {
    try {
      const addressListPath = path.join(
        process.cwd(),
        `../addressList/${config.network}.json`
      );
      if (fs.existsSync(addressListPath)) {
        const addressList = JSON.parse(
          fs.readFileSync(addressListPath, "utf8")
        );
        config.contractAddress = addressList.NativeVRF;
        console.log(
          `📁 Loaded contract address from address list: ${config.contractAddress}`
        );
      }
    } catch (error) {
      console.warn("⚠️ Could not load address list:", error.message);
    }
  }

  // Validate required config
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  if (!config.contractAddress) {
    throw new Error(
      "CONTRACT_ADDRESS environment variable or address list is required"
    );
  }

  return config;
}

// Main execution
async function main() {
  try {
    const config = loadConfig();
    console.log("🔧 Configuration:");
    console.log(`  Network: ${config.network}`);
    console.log(`  RPC URL: ${config.rpcUrl}`);
    console.log(`  Contract: ${config.contractAddress}`);
    console.log(`  Interval: ${config.intervalMs}ms`);

    const fulfiller = new VRFFulfiller(config);
    await fulfiller.initialize();

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n📡 Received SIGINT, shutting down gracefully...");
      fulfiller.stop();
    });

    process.on("SIGTERM", () => {
      console.log("\n📡 Received SIGTERM, shutting down gracefully...");
      fulfiller.stop();
    });

    await fulfiller.start();
  } catch (error) {
    console.error("💥 Fatal error:", error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  throw error;
});
