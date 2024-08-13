import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress } from "@polkadot/keyring";
// import { type InjectedWindow } from "@polkadot/extension-inject/types";
import { Signer } from "@polkadot/api/types";
import { WalletAccount } from "@talismn/connect-wallets";
import { parachainConfig } from "./parachainConfig";

function numberToChain(input: string, decimals: number) {
  const [integer, decimal = ""] = input.split(".");
  const second = decimal.substring(0, decimals).padEnd(decimals, "0");
  return BigInt(`${integer}${second}`);
}

const ASSET_HUB_ENDPOINT = "ws://127.0.0.1:9003";

const assetHubApiPromise = ApiPromise.create({
  provider: new WsProvider(ASSET_HUB_ENDPOINT),
});

const parachainName = "Kilt";

const settingsPromise = (async (parachainName) => {
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
})(parachainName);

// const polkaDotEnabledWalletPromise = (async () => {
//   return (window as Window & InjectedWindow).injectedWeb3["polkadot-js"]
//     .enable!("Polar Path");
// })();

export async function submitParaChainToAssetHub(
  event: SubmitEvent,
  polkadotAccount: WalletAccount | null,
) {
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

  // polkadotAccount from useEffect on Transfer.tsx

  // import { Signer } from "@polkadot/api/types";

  if (polkadotAccount === null) throw Error(`Polkadot Wallet not connected.`);
  // if (polkadotAccount.address !== data.sourceAccount)
  //   throw Error(`Source account mismatch.`);
  // const walletSigner = {
  //   address: polkadotAccount.address,
  //   signer: polkadotAccount.signer! as Signer,
  // };

  const signer = polkadotAccount.signer as Signer;
  await tx.signAndSend(sender, { signer });
}

export async function submitAssetHubToParaChain(
  event: SubmitEvent,
  polkadotAccount: WalletAccount | null,
) {
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

  if (polkadotAccount === null) throw Error(`Polkadot Wallet not connected.`);

  const signer = polkadotAccount.signer as Signer;

  // const { signer } = await polkaDotEnabledWalletPromise;
  await tx.signAndSend(sender, { signer });
}
