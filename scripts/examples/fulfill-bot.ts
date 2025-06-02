import hre, { ethers } from "hardhat";
import { ContractReceipt, utils } from "ethers";
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

const convertSignatureLocal = (signature: utils.BytesLike) => {
  const truncatedNumber = ethers.BigNumber.from(signature)
    .toHexString()
    .slice(0, 66);
  return ethers.BigNumber.from(truncatedNumber);
};

const calculateRandomInput = async (
  signer: SignerWithAddress,
  nativeVRF: NativeVRF,
  requestId: string,
  maxAttempts: number = 10000
) => {
  const difficulty = await nativeVRF.difficulty();

  for (let input = 0; input < maxAttempts; input++) {
    // Use the contract's getMessageHash method for correct hash calculation
    const messageHash = await nativeVRF
      .connect(signer)
      .getMessageHash(Number(requestId), input);
    const signature = await signer.signMessage(
      ethers.utils.arrayify(messageHash)
    );
    const value = convertSignatureLocal(signature);

    if (value.mod(difficulty).eq(0)) {
      return { input, signature };
    }
  }

  throw new Error(
    `Could not find valid input after ${maxAttempts} attempts. Consider lowering difficulty.`
  );
};

const decodeOutputs = (receipt: ContractReceipt) => {
  const events = receipt.events;
  if (!events) return [];
  return events.filter((e) => e.event).map((e) => [e.event, e.args]);
};

async function main() {
  const addressList = await addressUtils.getAddressList(hre.network.name);

  const [signer] = await ethers.getSigners();
  const nativeVRF = await NativeVRF__factory.connect(
    addressList.NativeVRF,
    signer
  );

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

      const tx = await nativeVRF.fullfillRandomness(
        [requestId],
        [input],
        [signature]
      );

      console.log("Submit fulfill transaction");

      const receipt = await tx.wait();

      console.log("Fulfill randomness successfully");
      console.log("Data: ", decodeOutputs(receipt));
    } catch (e) {
      console.error("Error fulfill randomness", e);
    }
  }, delayMs);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
