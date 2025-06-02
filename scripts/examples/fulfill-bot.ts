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

// Use the contract's own getMessageHash function to ensure exact match
const getMessageHashFromContract = async (
  nativeVRF: NativeVRF,
  requestId: BigNumberish,
  randInput: BigNumberish
) => {
  return await nativeVRF.getMessageHash(requestId, randInput);
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
  const currentNonce = await nativeVRF.addressNonces(signer.address);

  console.log(`Calculating for request ${requestId}:`);
  console.log(`- Previous random: ${prevRandom.toString()}`);
  console.log(`- Current nonce: ${currentNonce.toString()}`);
  console.log(`- Difficulty: ${difficulty.toString()}`);

  do {
    // Use the contract's own getMessageHash function to ensure exact match
    const messageHash = await getMessageHashFromContract(
      nativeVRF,
      requestId,
      input
    );

    const signature = await signer.signMessage(
      ethers.utils.arrayify(messageHash)
    );
    const value = convertSignatureLocal(signature);

    if (value.mod(difficulty).eq(0)) {
      found = input;
      console.log(`Found valid input: ${found} after ${input + 1} attempts`);
    }
    input++;

    // Add some logging every 1000 attempts
    if (input % 1000 === 0) {
      console.log(`Attempted ${input} inputs so far...`);
    }
  } while (found === 0);

  // Generate final signature with the found input
  const messageHash = await getMessageHashFromContract(
    nativeVRF,
    requestId,
    found
  );
  const signature = await signer.signMessage(
    ethers.utils.arrayify(messageHash)
  );

  return { input: found, signature };
};

const decordOutputs = (receipt: ContractReceipt) => {
  const events = receipt.events;
  if (!events) return [];
  return events.filter((e) => e.event).map((e) => [e.event, e.args]);
};

async function main() {
  const addressList = await addressUtils.getAddressList(hre.network.name);
  const [signer] = await ethers.getSigners();
  const nativeVRF = await NativeVRF__factory.connect(
    addressList["NativeVRF"],
    signer
  );

  // Check if the signer is whitelisted (if needed for requesting)
  try {
    const isWhitelisted = await nativeVRF.isWhitelisted(signer.address);
    console.log(`Signer ${signer.address} whitelist status: ${isWhitelisted}`);
  } catch (e) {
    console.log("Could not check whitelist status");
  }

  const delayMs = 1000;

  runInterval(async () => {
    try {
      const curRequestId = await nativeVRF.currentRequestId();
      const latestFulfill = await nativeVRF.latestFulfillId();
      const requestId = latestFulfill.add(1);

      if (curRequestId.eq(requestId)) {
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

      const { input, signature } = await calculateRandomInput(
        signer,
        nativeVRF,
        requestId.toString()
      );

      console.log("Submitting fulfill transaction...");
      const tx = await nativeVRF.fullfillRandomness(
        [requestId],
        [input],
        [signature]
      );

      console.log("Submit fulfill transaction hash:", tx.hash);
      const receipt = await tx.wait();
      console.log("Fulfill randomness successfully");
      console.log("Data: ", decordOutputs(receipt));
    } catch (e) {
      console.error("Error fulfill randomness:", e);

      // Add more specific error handling
      if (e.message && e.message.includes("Invalid signature")) {
        console.error(
          "Signature validation failed - check message hash calculation"
        );
      } else if (e.message && e.message.includes("Invalid random input")) {
        console.error(
          "Random input validation failed - check difficulty calculation"
        );
      } else if (e.message && e.message.includes("Already fullfilled")) {
        console.error("Request already fulfilled by another fulfiller");
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
