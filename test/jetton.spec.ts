import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, beginCell, toNano } from "ton";
import { internalMessage, randomAddress } from "./helpers";
import { parseJettonDetails, parseJettonWalletDetails } from "./lib/jetton-utils";
import { JettonMinter } from "./lib/jetton-minter";
import { actionToMessage } from "./lib/utils";
import { JettonWallet } from "./lib/jetton-wallet";
import {
  JETTON_WALLET_CODE,
  JETTON_MINTER_CODE,
  JETTON_PLATFORM_CODE,
  jettonMinterInitData,
} from "../build/jetton-minter.deploy";

const OWNER_ADDRESS = randomAddress("owner");
const PARTICIPANT_ADDRESS_1 = randomAddress("participant_1");
const PARTICIPANT_ADDRESS_2 = randomAddress("participant_2");

describe("Jetton", () => {
  let minterContract: JettonMinter;

  const getJWalletContract = async (
    walletOwnerAddress: Address,
    jettonMasterAddress: Address
  ): Promise<JettonWallet> =>
    await JettonWallet.create(
      JETTON_PLATFORM_CODE,
      beginCell()
        .storeCoins(0)
        .storeAddress(walletOwnerAddress)
        .storeAddress(jettonMasterAddress)
        .storeRef(beginCell().endCell())
        .storeRef(JETTON_PLATFORM_CODE)
        .storeUint(0, 32)
        .endCell()
    );

  beforeEach(async () => {
    const dataCell = jettonMinterInitData(OWNER_ADDRESS, {
      name: "jUSDT",
      symbol: "USDT",
    });
    minterContract = (await JettonMinter.create(JETTON_MINTER_CODE, dataCell)) as JettonMinter; // TODO: 🤮;
  });

  it("should get minter initialization data correctly", async () => {
    const call = await minterContract.contract.invokeGetMethod("get_jetton_data", []);
    const {
      totalSupply,
      address,
      metadata,
    } = parseJettonDetails(call);

    expect(totalSupply).to.be.bignumber.equal(new BN(0));
    expect(address.toFriendly()).to.equal(OWNER_ADDRESS.toFriendly());
    expect(metadata.name).to.equal("jUSDT");
    expect(metadata.symbol).to.equal("USDT");
    expect(metadata.image).to.equal("https://ton-tokens-api.bf.works/image/0:a55c87b496f90f7fb4fa10e31eb4f96e63899979b7c073a2b2f7c4f9b40b3bdb.svg");
    expect(metadata.decimals).to.equal("9");
  });

  it("offchain and onchain jwallet should return the same address", async () => {
    const jwallet = await getJWalletContract(PARTICIPANT_ADDRESS_1, minterContract.address);
    const participantJwalletAddress = await minterContract.getWalletAddress(PARTICIPANT_ADDRESS_1);
    expect(jwallet.address.toFriendly()).to.equal(participantJwalletAddress.toFriendly());
  });

  it("should get jwallet initialization data correctly", async () => {
    const jwallet = await getJWalletContract(PARTICIPANT_ADDRESS_1, minterContract.address);

    jwallet.contract.setCodeCell(JETTON_WALLET_CODE);

    const jwalletDetails = parseJettonWalletDetails(
      await jwallet.contract.invokeGetMethod("get_wallet_data", [])
    );

    expect(jwalletDetails.balance).to.bignumber.equal(new BN(0));
    expect(jwalletDetails.owner.toFriendly()).to.equal(PARTICIPANT_ADDRESS_1.toFriendly());
    expect(jwalletDetails.jettonMasterContract.toFriendly()).to.equal(
      minterContract.address.toFriendly()
    );
  });

  it("should mint jettons and transfer to 2 new wallets", async () => {
    // Produce mint message
    const { actionList: actionList1 } = await minterContract.contract.sendInternalMessage(
      internalMessage({
        from: OWNER_ADDRESS,
        body: JettonMinter.mintBody(PARTICIPANT_ADDRESS_1, toNano(0.01)),
      })
    );

    const jwallet1 = await getJWalletContract(PARTICIPANT_ADDRESS_1, minterContract.address);

    jwallet1.contract.setCodeCell(JETTON_WALLET_CODE);

    const { balance: balanceInitial } = parseJettonWalletDetails(
      await jwallet1.contract.invokeGetMethod("get_wallet_data", [])
    );
    expect(balanceInitial).to.bignumber.equal(new BN(0), "jwallet1 initial balance should be 0");

    // Send mint message to jwallet1
    await jwallet1.contract.sendInternalMessage(
      actionToMessage(minterContract.address, actionList1[0])
    );

    const { balance: balanceAfter } = parseJettonWalletDetails(
      await jwallet1.contract.invokeGetMethod("get_wallet_data", [])
    );
    expect(balanceAfter).to.bignumber.equal(
      toNano(0.01),
      "jwallet1 should reflact its balance after mint"
    );

    let { totalSupply } = parseJettonDetails(
      await minterContract.contract.invokeGetMethod("get_jetton_data", [])
    );
    expect(totalSupply).to.bignumber.equal(
      toNano(0.01),
      "total supply should increase after first mint"
    );

    // Mint and transfer to jwallet2
    const { actionList: actionList2 } = await minterContract.contract.sendInternalMessage(
      internalMessage({
        from: OWNER_ADDRESS,
        body: JettonMinter.mintBody(PARTICIPANT_ADDRESS_2, toNano(0.02)),
      })
    );

    const jwallet2 = await getJWalletContract(PARTICIPANT_ADDRESS_2, minterContract.address);
    await jwallet2.contract.sendInternalMessage(
      actionToMessage(minterContract.address, actionList2[0])
    );

    const { balance: balanceAfter2 } = parseJettonWalletDetails(
      await jwallet2.contract.invokeGetMethod("get_wallet_data", [])
    );
    expect(balanceAfter2).to.bignumber.equal(
      toNano(0.02),
      "jwallet2 should reflact its balance after mint"
    );

    totalSupply = parseJettonDetails(
      await minterContract.contract.invokeGetMethod("get_jetton_data", [])
    ).totalSupply;
    expect(totalSupply).to.bignumber.equal(
      toNano(0.03),
      "total supply should amount to both mints"
    );
  });

  it("should mint jettons and transfer from wallet1 to wallet2", async () => {
    // Produce mint message
    const { actionList: actionList1 } = await minterContract.contract.sendInternalMessage(
      internalMessage({
        from: OWNER_ADDRESS,
        body: JettonMinter.mintBody(PARTICIPANT_ADDRESS_1, toNano(0.01)),
      })
    );

    const jwallet1 = await getJWalletContract(PARTICIPANT_ADDRESS_1, minterContract.address);

    // Send mint message to jwallet1
    await jwallet1.contract.sendInternalMessage(
      actionToMessage(minterContract.address, actionList1[0])
    );

    // Transfer jwallet1-->jwallet2
    const res = await jwallet1.contract.sendInternalMessage(
      internalMessage({
        from: PARTICIPANT_ADDRESS_1, // TODO what is this from..? Prolly should be jwallet p1 address. is this a testutil that signs the msg?
        body: JettonWallet.transferBody(PARTICIPANT_ADDRESS_2, toNano(0.004)),
        value: toNano(0.031),
      })
    );

    const jwallet2 = await getJWalletContract(PARTICIPANT_ADDRESS_2, minterContract.address);
    await jwallet2.contract.sendInternalMessage(
      actionToMessage(jwallet1.address, res.actionList[0])
    );

    const { balance: balanceAfter2 } = parseJettonWalletDetails(
      await jwallet2.contract.invokeGetMethod("get_wallet_data", [])
    );
    expect(balanceAfter2).to.bignumber.equal(
      toNano(0.004),
      "jwallet2 balance should reflect amount sent from jwallet1"
    );

    const { balance: balanceAfter1 } = parseJettonWalletDetails(
      await jwallet1.contract.invokeGetMethod("get_wallet_data", [])
    );
    expect(balanceAfter1).to.bignumber.equal(
      toNano(0.01).sub(toNano(0.004)),
      "jwallet1 balance should subtract amount sent to jwallet2"
    );

    const totalSupply = parseJettonDetails(
      await minterContract.contract.invokeGetMethod("get_jetton_data", [])
    ).totalSupply;
    expect(totalSupply).to.bignumber.equal(toNano(0.01), "total supply should not change");
  });

  /*
  Further tests:
  - burn
  - mint
  - transfer from wallet
  - change owner
  - change content / immutable vs nonimmutable
  */
});
