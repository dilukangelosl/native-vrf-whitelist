import hre, { ethers } from "hardhat";
import { BigNumberish, ContractReceipt, utils } from "ethers";
import { NativeVRF, NativeVRF__factory } from "../../typechain";
import addressUtils from "../../utils/addressUtils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const delay = (delayMs: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, delayMs);
  });
};

const runInterval = async (handler: Function, delayMs: number) => {
  await handler();
  await delay(delayMs);
  await runInterval(handler, delayMs);
};

const messageHashFromNumbers = (values: BigNumberish[]) => {
  // This function is now replaced by proper encoding in calculateRandomInput
  // Keep for backward compatibility but shouldn't be used
  const types = values.map(() => "uint256");
  return ethers.utils.solidityKeccak256(types, values);
};

const calculateMessageHash = (
  prevRandom: BigNumberish,
  randInput: BigNumberish,
  requestId: BigNumberish,
  sender: string,
  nonce: BigNumberish
) => {
  // Use the exact same encoding as the contract: abi.encodePacked
  return ethers.utils.solidityKeccak256(
    ["uint256", "uint256", "uint256", "address", "uint256"],
    [prevRandom, randInput, requestId, sender, nonce]
  );
};

const convertSignatureLocal = (signature: utils.BytesLike) => {
  const truncatedNumber = ethers.BigNumber.from(signature)
    .toHexString()
    .slice(0, 66);
  return ethers.BigNumber.from(truncatedNumber);
};

const calculateRandomInput = async (
  signer: SignerWithAddress,
  nativeVRF: NativeVRF,
  requestId: string
) => {
  let input = 0;
  let found = 0;

  const prevRandom = await nativeVRF.randomResults(Number(requestId) - 1);
  const difficulty = await nativeVRF.difficulty();
  const signerAddress = await signer.getAddress();
  const nonce = await nativeVRF.getNonce(signerAddress);

  console.log(`Calculating random input for request ${requestId}`);
  console.log(`Previous random: ${prevRandom.toString()}`);
  console.log(`Difficulty: ${difficulty.toString()}`);
  console.log(`Signer nonce: ${nonce.toString()}`);

  do {
    // Create message hash exactly as the contract does
    // abi.encodePacked(prevRand, _randInput, _requestId, msg.sender, addressNonces[msg.sender])
    const message = calculateMessageHash(
      prevRandom,
      input,
      requestId,
      signerAddress,
      nonce
    );

    const signature = await signer.signMessage(ethers.utils.arrayify(message));
    const value = convertSignatureLocal(signature);

    if (value.mod(difficulty).eq(0)) {
      found = input;
      console.log(
        `Found valid input: ${found}, signature value: ${value.toString()}`
      );
    }

    input++;

    // Add a reasonable limit to prevent infinite loops
    if (input > 1000000) {
      throw new Error("Could not find valid input within reasonable attempts");
    }
  } while (found === 0);

  // Generate the final signature with the found input
  const finalMessage = calculateMessageHash(
    prevRandom,
    found,
    requestId,
    signerAddress,
    nonce
  );

  const finalSignature = await signer.signMessage(
    ethers.utils.arrayify(finalMessage)
  );

  return { input: found, signature: finalSignature };
};

const decordOutputs = (receipt: ContractReceipt) => {
  const events = receipt.events;
  if (!events) return [];
  return events.filter((e) => e.event).map((e) => [e.event, e.args]);
};

const getRevertReason = async (
  provider: any,
  txHash: string,
  blockNumber: number
) => {
  try {
    // Try to get the revert reason by replaying the transaction
    const tx = await provider.getTransaction(txHash);
    const code = await provider.call(tx, blockNumber);
    return code;
  } catch (error: any) {
    if (error.reason) {
      return error.reason;
    }
    if (error.message) {
      return error.message;
    }
    return "Unknown revert reason";
  }
};

async function main() {
  const addressList = await addressUtils.getAddressList(hre.network.name);

  const [signer] = await ethers.getSigners();
  const nativeVRF = await NativeVRF__factory.connect(
    addressList["NativeVRF"],
    signer
  );

  const delayMs = 1000;

  console.log(
    `Starting VRF fulfillment bot with signer: ${await signer.getAddress()}`
  );
  console.log(`NativeVRF contract address: ${addressList["NativeVRF"]}`);

  runInterval(async () => {
    try {
      const curRequestId = await nativeVRF.currentRequestId();
      const latestFulfill = await nativeVRF.latestFulfillId();
      const requestId = latestFulfill.add(1);

      if (curRequestId.lte(requestId)) {
        console.log(
          "There is no new random request. Wait for the incoming requests..."
        );
        return;
      }

      console.log("Found new random request");
      console.log(
        "Current ID: ",
        curRequestId.toString(),
        "Last fulfill ID",
        latestFulfill.toString(),
        "Submitted Fulfill ID: ",
        requestId.toString()
      );

      // Add validation checks before submitting
      console.log("\n=== PRE-SUBMISSION VALIDATION ===");

      // Check if request exists
      const requestInitializer = await nativeVRF.requestInitializers(requestId);
      console.log(`Request ${requestId} initializer:`, requestInitializer);

      if (requestInitializer === ethers.constants.AddressZero) {
        console.error(`❌ Request ${requestId} has not been initialized!`);
        return;
      }

      // Check if already fulfilled
      const currentResult = await nativeVRF.randomResults(requestId);
      console.log(
        `Request ${requestId} current result:`,
        currentResult.toString()
      );

      if (!currentResult.eq(0)) {
        console.error(`❌ Request ${requestId} is already fulfilled!`);
        return;
      }

      // Check previous request is fulfilled
      if (requestId.gt(1)) {
        const prevResult = await nativeVRF.randomResults(requestId.sub(1));
        console.log(
          `Previous request ${requestId.sub(1)} result:`,
          prevResult.toString()
        );

        if (prevResult.eq(0)) {
          console.error(
            `❌ Previous request ${requestId.sub(1)} is not fulfilled yet!`
          );
          return;
        }
      }

      const { input, signature } = await calculateRandomInput(
        signer,
        nativeVRF,
        requestId.toString()
      );

      console.log(`\n=== SUBMITTING FULFILLMENT ===`);
      console.log(`Input: ${input}`);
      console.log(`Signature: ${signature}`);
      console.log(`Signature length: ${signature.length}`);

      // Validate our signature calculation matches contract expectation
      const contractMessageHash = await nativeVRF.getMessageHash(
        requestId,
        input
      );
      console.log(`Contract message hash: ${contractMessageHash}`);

      // Calculate what we think the message hash should be
      const signerAddress = await signer.getAddress();
      const nonce = await nativeVRF.getNonce(signerAddress);
      const prevRandom = requestId.gt(0)
        ? await nativeVRF.randomResults(requestId.sub(1))
        : ethers.BigNumber.from(0);

      console.log(`Debug values for message hash:`);
      console.log(`  prevRandom: ${prevRandom.toString()}`);
      console.log(`  input: ${input}`);
      console.log(`  requestId: ${requestId.toString()}`);
      console.log(`  sender: ${signerAddress}`);
      console.log(`  nonce: ${nonce.toString()}`);

      // The contract message hash calculation should match exactly
      // Let's use ethers.utils.solidityPack instead of solidityKeccak256 to see the packed data
      const packedData = ethers.utils.solidityPack(
        ["uint256", "uint256", "uint256", "address", "uint256"],
        [prevRandom, input, requestId, signerAddress, nonce]
      );
      console.log(`Packed data: ${packedData}`);

      const ourMessageHash = ethers.utils.keccak256(packedData);
      console.log(`Our calculated message hash: ${ourMessageHash}`);
      console.log(
        `Message hashes match: ${contractMessageHash === ourMessageHash}`
      );

      if (contractMessageHash !== ourMessageHash) {
        console.error(
          "❌ Message hash mismatch! This will cause the transaction to fail."
        );
        console.log(
          "The issue might be in how we're encoding the packed data."
        );
        console.log("Let's try different approaches to match the contract...");

        // Try with different encoding to debug the issue
        const altHash1 = ethers.utils.solidityKeccak256(
          ["uint256", "uint256", "uint256", "address", "uint256"],
          [prevRandom, input, requestId, signerAddress, nonce]
        );
        console.log(`Alternative hash 1 (solidityKeccak256): ${altHash1}`);

        if (contractMessageHash === altHash1) {
          console.log("✅ Found matching hash with solidityKeccak256!");
        } else {
          console.log("Still no match. The issue might be elsewhere.");
        }

        return;
      }

      // Validate signature value meets difficulty requirement
      const sigValue = convertSignatureLocal(signature);
      const difficulty = await nativeVRF.difficulty();
      console.log(`Signature value: ${sigValue.toString()}`);
      console.log(`Difficulty: ${difficulty.toString()}`);
      console.log(
        `Signature value % difficulty: ${sigValue.mod(difficulty).toString()}`
      );
      console.log(
        `Meets difficulty requirement: ${sigValue.mod(difficulty).eq(0)}`
      );

      if (!sigValue.mod(difficulty).eq(0)) {
        console.error(
          "❌ Signature value does not meet difficulty requirement!"
        );
        return;
      }

      console.log("✅ All validations passed. Submitting transaction...");

      const tx = await nativeVRF.fullfillRandomness(
        [requestId],
        [input],
        [signature],
        {
          gasLimit: 500000, // Add explicit gas limit to prevent out of gas errors
        }
      );

      console.log("Submit fulfill transaction, hash:", tx.hash);

      const receipt = await tx.wait();

      if (receipt.status === 0) {
        console.error("❌ Transaction failed!");
        console.log("Receipt:", JSON.stringify(receipt, null, 2));

        // Try to get revert reason
        try {
          const revertReason = await getRevertReason(
            signer.provider,
            tx.hash,
            receipt.blockNumber
          );
          console.error("Revert reason:", revertReason);
        } catch (e) {
          console.error("Could not get revert reason:", e);
        }
      } else {
        console.log("✅ Fulfill randomness successfully");
        console.log("Events: ", decordOutputs(receipt));
      }
    } catch (e: any) {
      console.error("Error fulfill randomness:", e.message);
      if (e.reason) {
        console.error("Reason:", e.reason);
      }
    }
  }, delayMs);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
