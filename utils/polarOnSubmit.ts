import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress } from "@polkadot/keyring";
// import { type InjectedWindow } from "@polkadot/extension-inject/types";
import { Signer as DotSigner } from "@polkadot/api/types";
import { WalletAccount } from "@talismn/connect-wallets";
import { parachainConfig } from "./parachainConfig";

const ASSET_HUB_ENDPOINT = "ws://127.0.0.1:9003";

const assetHubApiPromise = ApiPromise.create({
  provider: new WsProvider(ASSET_HUB_ENDPOINT),
});

async function getParachainConfig(parachainName: string) {
  const settings = parachainConfig[parachainName];

  const provider = new WsProvider(settings.endpoint);
  const paraChainApi = await ApiPromise.create({ provider });

  const decimals = paraChainApi.registry.chainDecimals[0];
  const formatOptions = {
    decimals,
    withUnit: paraChainApi.registry.chainTokens[0],
  };

  const switchPair = await paraChainApi.query[settings.pallet].switchPair();
  const remoteAssetId = (switchPair as any).unwrap().remoteAssetId.toJSON().v3;

  return {
    ...settings,
    paraChainApi,
    decimals,
    formatOptions,
    remoteAssetId,
  };
}

export async function submitParaChainToAssetHub({
  polkadotAccount,
  beneficiaryString,
  amount,
}: {
  polkadotAccount: WalletAccount | null;
  beneficiaryString: string;
  amount: bigint;
}) {
  const { paraChainApi, pallet } = await getParachainConfig("Kilt");

  const beneficiary = {
    V3: {
      parents: 0,
      interior: { X1: { AccountId32: { id: beneficiaryString } } },
    },
  };
  const tx = paraChainApi.tx[pallet].switch(amount, beneficiary);

  if (polkadotAccount === null) throw Error(`Polkadot Wallet not connected.`);

  const signer = polkadotAccount.signer as DotSigner;
  await tx.signAndSend(polkadotAccount.address, { signer });
}

export async function submitAssetHubToParaChain({
  polkadotAccount,
  beneficiaryString,
  amount,
}: {
  polkadotAccount: WalletAccount | null;
  beneficiaryString: string;
  amount: bigint;
}) {
  const { destination, remoteAssetId } = await getParachainConfig("Kilt");

  const beneficiaryId = decodeAddress(beneficiaryString);
  const beneficiary = {
    parents: 0,
    interior: { X1: { AccountId32: { id: beneficiaryId } } },
  };

  const assetHubApi = await assetHubApiPromise;
  const tx = assetHubApi.tx.polkadotXcm.transferAssetsUsingTypeAndThen(
    // this should actually be a multilocation of the destination of the parachain
    { V3: destination },
    { V3: [{ id: remoteAssetId, fun: { Fungible: amount } }] },
    "LocalReserve",
    { V3: remoteAssetId },
    "LocalReserve",
    { V3: [{ DepositAsset: { assets: { Wild: "All" }, beneficiary } }] },
    "Unlimited",
  );

  if (polkadotAccount === null) throw Error(`Polkadot Wallet not connected.`);

  const signer = polkadotAccount.signer as DotSigner;

  await tx.signAndSend(polkadotAccount.address, { signer });
}
