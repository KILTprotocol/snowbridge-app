import { parachainNativeAsset } from '@snowbridge/api/dist/assets';
import {
  SNOWBRIDGE_ENV,
  TransferLocation,
} from '@snowbridge/api/dist/environment';
// eslint-disable-next-line import/no-extraneous-dependencies
import { IERC20Metadata__factory } from '@snowbridge/contract-types';

import { getEtherApi, getSubstApi } from './getApi';
import { getAddressType, getSnowEnvBasedOnRelayChain } from './paraUtils';

/** Mock up from:
 *
 *  const snowbridgeEnvironmentNames = Object.keys(SNOWBRIDGE_ENV) as Array<string>;
 *
 *  type SnowbridgeEnvironmentNames = (typeof snowbridgeEnvironmentNames)[number]; */
type SnowbridgeEnvironmentNames =
  | 'local_e2e'
  | 'rococo_sepolia'
  | 'polkadot_mainnet'
  | 'unsupported_relaychain';

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
export async function buildParachainConfig(
  paraEndpoint: string,
  etherApiKey: string,
): Promise<ParaConfig | void> {
  const paraApi = await getSubstApi(paraEndpoint);

  if (!paraApi) {
    console.log(`Could not connect to parachain API under "${paraEndpoint}"`);
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
  console.log('snowBridgeEnvName: ', snowBridgeEnvName);

  /** The Snowbridge team decided to set the amount of the existential deposit as the minimal transfer amount. */
  const minimumTransferAmount = BigInt(
    paraApi.consts.balances.existentialDeposit.toString(),
  );

  const { tokenDecimal } = await parachainNativeAsset(paraApi);

  const addressType = await getAddressType(paraApi);

  console.log(`The address type used is: ${addressType}`);

  // Get information about the wrapped erc20 token from parachain
  const switchPalletName = 'assetSwitchPool1'; // assumes that first pool is between native token and its erc20 wrapped counterpart
  const switchPair = await paraApi.query[switchPalletName].switchPair();
  const contractAddress = (switchPair as any).unwrap().remoteAssetId.toJSON().v4
    .interior.x2[1].accountKey20.key;

  console.log('contractAddress: ', contractAddress);

  // Get information about the wrapped erc20 token from ethereum
  const etherEndpoint =
    SNOWBRIDGE_ENV[snowBridgeEnvName].config.ETHEREUM_API(etherApiKey);
  const etherApi = await getEtherApi(etherEndpoint);

  if (!etherApi) {
    console.log(`Could not connect to ethereum API under "${etherEndpoint}"`);
    return;
  }

  const ercTokenMetadata = IERC20Metadata__factory.connect(
    contractAddress,
    etherApi,
  );
  const ercSymbol = await ercTokenMetadata.symbol();

  paraApi.disconnect();
  etherApi.destroy();

  return {
    name: chainName,
    snowEnv: snowBridgeEnvName,
    endpoint: paraEndpoint,
    pallet: switchPalletName,
    parachainId: paraId,
    location: {
      id: chainName.toLowerCase().replaceAll(/\s/g, ''),
      name: chainName,
      type: 'substrate',
      destinationIds: ['assethub'],
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
          id: ercSymbol,
          address: contractAddress,
          minimumTransferAmount,
        },
      ],
    },
  };
}
