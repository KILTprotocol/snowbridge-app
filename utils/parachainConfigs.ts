import { addParachainConnection } from "@snowbridge/api";
import { parachainNativeAsset } from "@snowbridge/api/dist/assets";
import {
  SnowbridgeEnvironment,
  TransferLocation,
  SNOWBRIDGE_ENV,
  AddressType,
} from "@snowbridge/api/dist/environment";
import { ApiPromise, WsProvider } from "@polkadot/api";
import {
  getApi,
  relaysOnChain,
  getSnowEnvBasedOnRelayChain,
} from "./relaysOnChain";
import { TypeDefInfo } from "@polkadot/types";
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

export interface RegisterOfParaConfigs {
  [name: string]: ParaConfig;
}

// export const parachainConfigs: RegisterOfParaConfigs = {
//   // Kilt on Polkadot
//   Kilt: {
//     name: "Kilt",
//     snowEnv: "polkadot_mainnet",
//     endpoint: "wss://kilt.dotters.network",
//     pallet: "assetSwitchPool1",
//     parachainId: 2086,
//     location: {
//       id: "kilt",
//       name: "KILT",
//       type: "substrate",
//       destinationIds: ["assethub"],
//       paraInfo: {
//         paraId: 2086,
//         destinationFeeDOT: 0n,
//         skipExistentialDepositCheck: false,
//         addressType: "32byte",
//         decimals: 15,
//         maxConsumers: 16,
//       },
//       erc20tokensReceivable: [
//         {
//           id: "KILT",
//           address: "0xadd76ee7fb5b3d2d774b5fed4ac20b87f830db91", // not existent yet
//           minimumTransferAmount: 1n,
//         },
//       ],
//     },
//   },
//   // Kilt on Rococo
//   Rilt: {
//     name: "Rilt",
//     snowEnv: "rococo_sepolia",
//     endpoint: "wss://rilt.kilt.io",
//     pallet: "assetSwitchPool1",
//     parachainId: 4504,
//     location: {
//       id: "rilt",
//       name: "RILT",
//       type: "substrate",
//       destinationIds: ["assethub"],
//       paraInfo: {
//         paraId: 4504,
//         destinationFeeDOT: 0n,
//         skipExistentialDepositCheck: false,
//         addressType: "32byte",
//         decimals: 15,
//         maxConsumers: 16,
//       },
//       erc20tokensReceivable: [
//         {
//           id: "RILT",
//           address: "0xadd76ee7fb5b3d2d774b5fed4ac20b87f830db91",
//           minimumTransferAmount: 1n,
//         },
//       ],
//     },
//   },
// };

export async function buildParachainConfig(
  endpoint: string,
): Promise<ParaConfig | void> {
  const paraApi = await getApi(endpoint);

  if (!paraApi) {
    console.log(`Could not connect to parachain API under "${endpoint}"`);
    return;
  }

  const paraId = (
    await paraApi.query.parachainInfo.parachainId()
  ).toPrimitive() as number;

  // Get information about the token on it's native parachain
  const chainName = (await paraApi.rpc.system.chain()).toString();
  const snowBridgeEnvName = (await getSnowEnvBasedOnRelayChain(
    paraApi,
    SNOWBRIDGE_ENV,
  )) as SnowbridgeEnvironmentNames;

  //debugger:
  console.log("snowBridgeEnvName: ", snowBridgeEnvName);

  /** The Snowbridge team decided to set the amount of the existential deposit as the minimal transfer amount. */
  const minimumTransferAmount = BigInt(
    paraApi.consts.balances.existentialDeposit.toString(),
  );
  // const properties = await api.rpc.system.properties();
  const { tokenDecimal, tokenSymbol } = await parachainNativeAsset(paraApi);

  const addressType = await getAddressType(paraApi);

  // Get information about the wrapped erc20 token
  const switchPalletName = "assetSwitchPool1"; // assumes that first pool is between native token and its erc20 wrapped counterpart
  const switchPair = await paraApi.query[switchPalletName].switchPair();
  const contractAddress = (switchPair as any).unwrap().remoteAssetId.toJSON().v4
    .interior.x2[1].accountKey20.key;

  paraApi.disconnect();

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
        addressType: addressType,
        decimals: tokenDecimal,
        maxConsumers: 16,
      },
      erc20tokensReceivable: [
        {
          // TODO: find a way to fetch
          id: "w" + tokenSymbol,
          address: contractAddress,
          minimumTransferAmount,
        },
      ],
    },
  };
}
async function getAddressType(api: ApiPromise): Promise<AddressType> {
  // Assume that the first type defined in the runtime is the AccountId
  const lookedUpType = api.registry.lookup.getTypeDef(0);
  if (lookedUpType.type === "AccountId32") {
    return "32byte";
  }

  if (lookedUpType.type === "AccountId20") {
    return "20byte";
  }

  if (lookedUpType.info === TypeDefInfo.VecFixed) {
    const length = lookedUpType.length;
    if (length === 20) {
      return "20byte";
    }
    if (length === 32) {
      return "32byte";
    }
  }
  return "both";
}
