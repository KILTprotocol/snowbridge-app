import { addParachainConnection } from "@snowbridge/api";
import { parachainNativeAsset } from "@snowbridge/api/dist/assets";
import {
  SnowbridgeEnvironment,
  TransferLocation,
  SNOWBRIDGE_ENV,
} from "@snowbridge/api/dist/environment";
import { ApiPromise, WsProvider } from "@polkadot/api";
import {
  getApi,
  relaysOnChain,
  getSnowEnvBasedOnRelayChain,
} from "./relaysOnChain";
// import { PolkadotPrimitivesV5PersistedValidationData } from '@kiltprotocol/augment-api/index';

// const snowbridgeEnvironmentNames = Object.keys(SNOWBRIDGE_ENV) as Array<string>;
// type SnowbridgeEnvironmentNames = (typeof snowbridgeEnvironmentNames)[number];

type SnowbridgeEnvironmentNames =
  | "local_e2e"
  | "rococo_sepolia"
  | "polkadot_mainnet"
  | "unsupported_relaychain";

interface ParaConfig {
  name: string;
  snowEnv: SnowbridgeEnvironmentNames;
  endpoint: string;
  pallet: string;
  parachainId: number;
  location: TransferLocation;
}

interface RegisterOfParaConfigs {
  [name: string]: ParaConfig;
}

export const parachainConfigs: RegisterOfParaConfigs = {
  // Kilt on Polkadot
  Kilt: {
    name: "Kilt",
    snowEnv: "polkadot_mainnet",
    endpoint: "wss://kilt.dotters.network",
    pallet: "assetSwitchPool1",
    parachainId: 2086,
    location: {
      id: "kilt",
      name: "KILT",
      type: "substrate",
      destinationIds: ["assethub"],
      paraInfo: {
        paraId: 2086,
        destinationFeeDOT: 0n,
        skipExistentialDepositCheck: false,
        addressType: "32byte",
        decimals: 15,
        maxConsumers: 16,
      },
      erc20tokensReceivable: [
        {
          id: "KILT",
          address: "0xadd76ee7fb5b3d2d774b5fed4ac20b87f830db91", // not existent yet
          minimumTransferAmount: 1n,
        },
      ],
    },
  },
  // Kilt on Rococo
  Rilt: {
    name: "Rilt",
    snowEnv: "rococo_sepolia",
    endpoint: "wss://rilt.kilt.io",
    pallet: "assetSwitchPool1",
    parachainId: 4504,
    location: {
      id: "rilt",
      name: "RILT",
      type: "substrate",
      destinationIds: ["assethub"],
      paraInfo: {
        paraId: 4504,
        destinationFeeDOT: 0n,
        skipExistentialDepositCheck: false,
        addressType: "32byte",
        decimals: 15,
        maxConsumers: 16,
      },
      erc20tokensReceivable: [
        {
          id: "RILT",
          address: "0xadd76ee7fb5b3d2d774b5fed4ac20b87f830db91",
          minimumTransferAmount: 1n,
        },
      ],
    },
  },
};

export async function buildParachainConfig(
  endpoint: string,
): Promise<ParaConfig> {
  const { paraId, api: paraApi } = await addParachainConnection(endpoint);

  // Get information about the token on it's native parachain
  const chainName = (await paraApi.rpc.system.chain()).toString();
  const snowBridgeEnvName = (await getSnowEnvBasedOnRelayChain(
    paraApi,
    SNOWBRIDGE_ENV,
  )) as SnowbridgeEnvironmentNames;

  /** The Snowbridge team decided to set the amount of the existential deposit as the minimal transfer amount. */
  const minimumTransferAmount = BigInt(
    paraApi.consts.balances.existentialDeposit.toString(),
  );
  // const properties = await api.rpc.system.properties();
  const { tokenDecimal, tokenSymbol } = await parachainNativeAsset(paraApi);

  // Get information about the wrapped erc20 token
  const { api: assetHubApi } = await addParachainConnection(
    SNOWBRIDGE_ENV[snowBridgeEnvName].config.ASSET_HUB_URL,
  );

  const switchPalletName = "assetSwitchPool1"; // assumes that first pool is between native token and its erc20 wrapped counterpart
  const switchPair = await assetHubApi.query[switchPalletName].switchPair();
  const remoteAssetId = (switchPair as any).unwrap().remoteAssetId.toJSON().v3;

  return {
    name: chainName,
    snowEnv: snowBridgeEnvName,
    endpoint: endpoint,
    pallet: switchPalletName,
    parachainId: paraId,
    location: {
      id: chainName.toLowerCase().replaceAll(/\s/, ""),
      name: chainName,
      type: "substrate",
      destinationIds: ["assethub"],
      paraInfo: {
        paraId: paraId,
        destinationFeeDOT: 0n,
        skipExistentialDepositCheck: false,
        addressType: "32byte",
        decimals: tokenDecimal,
        maxConsumers: 16,
      },
      erc20tokensReceivable: [
        {
          id: "w" + tokenSymbol,
          address: remoteAssetId,
          minimumTransferAmount,
        },
      ],
    },
  };
}

// async function relaysOn(paraApi: ApiPromise) {
//   const validationData = await paraApi.query.parachainSystem?.validationData();

//   if (!validationData?.isEmpty) {
//     throw new Error("This is not a parachain");
//   }
//   const { relayParentNumber, relayParentNumber } = validationData.unwrap();
// }
