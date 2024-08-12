import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress } from "@polkadot/keyring";
import { type InjectedWindow } from "@polkadot/extension-inject/types";

function numberToChain(input: string, decimals: number) {
  const [integer, decimal = ""] = input.split(".");
  const second = decimal.substring(0, decimals).padEnd(decimals, "0");
  return BigInt(`${integer}${second}`);
}

const ASSET_HUB_ENDPOINT = "ws://127.0.0.1:9003";

const assetHubApiPromise = ApiPromise.create({
  provider: new WsProvider(ASSET_HUB_ENDPOINT),
});

const paraChainSettings = {
  Kilt: {
    name: "Kilt",
    endpoint: "ws://127.0.0.1:9004",
    pallet: "assetSwitchPool1",
    destination: { parents: 1, interior: { X1: { Parachain: 2086 } } },
  },
};

const settingsPromise = (async () => {
  const settings = paraChainSettings.Kilt;

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
})();

const polkaDotEnabledWalletPromise = (async () => {
  return (window as Window & InjectedWindow).injectedWeb3["polkadot-js"]
    .enable!("Polar Path");
})();

export async function submitParaChainToAssetHub(event: SubmitEvent) {
  event.preventDefault();

  const { paraChainApi, pallet, decimals } = await settingsPromise;

  const form = event.target as HTMLFormElement;
  const data = new FormData(form);

  const sender = data.get("paraChainAccount") as string;

  const beneficiaryString = data.get("assetHubAccount") as string;
  const beneficiaryId = decodeAddress(beneficiaryString);

  const amountString = data.get("amount") as string;
  const amount = numberToChain(amountString, decimals);

  const X1 = { AccountId32: { id: beneficiaryId } };
  const beneficiary = { V3: { parents: 0, interior: { X1 } } };
  const tx = paraChainApi.tx[pallet].switch(amount, beneficiary);

  const { signer } = await polkaDotEnabledWalletPromise;
  await tx.signAndSend(sender, { signer });
}

export async function submitAssetHubToParaChain(event: SubmitEvent) {
  event.preventDefault();

  const { decimals, destination, remoteAssetId } = await settingsPromise;

  const form = event.target as HTMLFormElement;
  const data = new FormData(form);

  const sender = data.get("assetHubAccount") as string;

  const beneficiaryString = data.get("paraChainAccount") as string;
  const beneficiaryId = decodeAddress(beneficiaryString);
  const beneficiary = {
    parents: 0,
    interior: { X1: { AccountId32: { id: beneficiaryId } } },
  };

  const amountString = data.get("amount") as string;
  const amount = numberToChain(amountString, decimals);

  const assetHubApi = await assetHubApiPromise;
  const tx = assetHubApi.tx.polkadotXcm.transferAssetsUsingTypeAndThen(
    { V3: destination },
    { V3: [{ id: remoteAssetId, fun: { Fungible: amount } }] },
    "LocalReserve",
    { V3: remoteAssetId },
    "LocalReserve",
    { V3: [{ DepositAsset: { assets: { Wild: "All" }, beneficiary } }] },
    "Unlimited",
  );

  const { signer } = await polkaDotEnabledWalletPromise;
  await tx.signAndSend(sender, { signer });
}
