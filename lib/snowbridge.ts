import {
  RegisterOfParaConfigs,
  buildParachainConfig,
} from "@/utils/parachainConfigs";
import { u8aToHex } from "@polkadot/util";
import { blake2AsU8a, encodeAddress } from "@polkadot/util-crypto";
import {
  environment,
  subscan,
  history,
  status,
  contextFactory,
  Context,
  utils,
  addParachainConnection,
  assets,
} from "@snowbridge/api";
import { SnowbridgeEnvironment } from "@snowbridge/api/dist/environment";
import {
  BeefyClient__factory,
  IGateway__factory,
} from "@snowbridge/contract-types";
import { AbstractProvider, AlchemyProvider } from "ethers";

export const parachainConfigs: RegisterOfParaConfigs = {};

export async function populateParachainConfigs() {
  const paraNodes = process.env.PARACHAIN_ENDPOINTS?.split(";");

  paraNodes?.forEach(async (endpoint) => {
    const newConfig = await buildParachainConfig(endpoint);

    // debugger:
    console.log(
      "newConfig: ",
      JSON.stringify(
        newConfig,
        (_, v) => (typeof v === "bigint" ? v.toString() : v), // replacer of bigInts
        2,
      ),
    );

    if (!newConfig) {
      return;
    }
    if (newConfig.name in parachainConfigs) {
      // don't overwrite
    } else {
      parachainConfigs[newConfig.name] = newConfig;
    }
  });
}

function addParachains(env: environment.SnowbridgeEnvironment) {
  const assetHubLocation = env.locations.find(({ id }) => id === "assethub");
  if (!assetHubLocation) {
    throw new Error(
      `Could not find the asset hub configuration object inside of the chosen environment "${env.name}."`,
    );
  }
  const pertinentParaConfigs = Object.values(parachainConfigs).filter(
    ({ snowEnv, location }) =>
      snowEnv === env.name &&
      !assetHubLocation.destinationIds.includes(location.id),
  );

  if (pertinentParaConfigs.length == 0) {
    console.log(
      `No suitable parachains to add to the given snowbridge environment "${env.name}".`,
    );
    return;
  }

  // await addParachainConnection(parachainConfig.Kilt.endpoint);

  // this is already called on the context factory
  // const { paraId, api } = await addParachainConnection(
  //   parachainConfigs.Rilt.endpoint,
  // );

  // add the parachains as destinations on the assetHub location
  // and the corresponding tokens as receivable

  pertinentParaConfigs.forEach((paraConfig) => {
    assetHubLocation.destinationIds.push(paraConfig.location.id);
    assetHubLocation.erc20tokensReceivable.push(
      ...paraConfig.location.erc20tokensReceivable,
    );
  });

  // const { tokenSymbol, tokenDecimal } = await assets.parachainNativeAsset(api);
  // console.log("tokenSymbol: ", tokenSymbol);
  // console.log("tokenDecimal: ", tokenDecimal);
  // destinationIds.push("rilt");

  // erc20tokensReceivable.push({
  //   id: tokenSymbol,
  //   address: "0xb150865f2fcc768a30c7cd7505bc5652766f7bcc",
  //   minimumTransferAmount: 15000000000000n,
  // });

  env.locations.push(...pertinentParaConfigs.map((para) => para.location));
  env.config.PARACHAINS.push(
    ...pertinentParaConfigs.map((para) => para.endpoint),
  );

  // TODO: delete this log later
  // during developing only:
  console.log(
    "SnowbridgeEnvironment after adding parachains: ",
    JSON.stringify(
      env,
      (_, v) => (typeof v === "bigint" ? v.toString() : v), // replacer of bigInts
      2,
    ),
  );
}

export const SKIP_LIGHT_CLIENT_UPDATES = true;
export const HISTORY_IN_SECONDS = 60 * 60 * 24 * 7 * 2; // 2 Weeks
export const ETHEREUM_BLOCK_TIME_SECONDS = 12;
export const ACCEPTABLE_BRIDGE_LATENCY = 28800; // 8 hours

export function getEnvironmentName() {
  const name = process.env.NEXT_PUBLIC_SNOWBRIDGE_ENV;
  if (!name) {
    throw new Error("NEXT_PUBLIC_SNOWBRIDGE_ENV var not configured.");
  }
  return name;
}

export function getEnvironment() {
  const envName = getEnvironmentName();
  const env = environment.SNOWBRIDGE_ENV[envName];
  if (env === undefined) {
    throw new Error(
      `NEXT_PUBLIC_SNOWBRIDGE_ENV configured for unknown environment '${envName}'`,
    );
  }
  addParachains(env);
  return env;
}

export async function getTransferHistory(
  env: environment.SnowbridgeEnvironment,
  skipLightClientUpdates: boolean,
  historyInSeconds: number,
) {
  console.log("Fetching transfer history.");
  if (!env.config.SUBSCAN_API) {
    console.warn(`No subscan api urls configured for ${env.name}`);
    return [];
  }
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!alchemyKey) {
    throw Error("Missing Alchemy Key");
  }

  const subscanKey = process.env.NEXT_PUBLIC_SUBSCAN_KEY;
  if (!subscanKey) {
    throw Error("Missing Subscan Key");
  }

  const ethereumProvider = new AlchemyProvider(env.ethChainId, alchemyKey);

  const assetHubScan = subscan.createApi(
    env.config.SUBSCAN_API.ASSET_HUB_URL,
    subscanKey,
  );
  const bridgeHubScan = subscan.createApi(
    env.config.SUBSCAN_API.BRIDGE_HUB_URL,
    subscanKey,
  );
  const relaychainScan = subscan.createApi(
    env.config.SUBSCAN_API.RELAY_CHAIN_URL,
    subscanKey,
  );

  const bridgeHubParaId = env.config.BRIDGE_HUB_PARAID;
  const assetHubParaId = env.config.ASSET_HUB_PARAID;
  const beacon_url = env.config.BEACON_HTTP_API;

  const beefyClient = BeefyClient__factory.connect(
    env.config.BEEFY_CONTRACT,
    ethereumProvider,
  );
  const gateway = IGateway__factory.connect(
    env.config.GATEWAY_CONTRACT,
    ethereumProvider,
  );
  const ethereumSearchPeriodBlocks =
    historyInSeconds / ETHEREUM_BLOCK_TIME_SECONDS;

  const ethNowBlock = await ethereumProvider.getBlock("latest", false);
  const now = new Date();
  const utcNowTimestamp = Math.floor(now.getTime() / 1000);

  const toAssetHubBlock = await subscan.fetchBlockNearTimestamp(
    assetHubScan,
    utcNowTimestamp,
  );
  const fromAssetHubBlock = await subscan.fetchBlockNearTimestamp(
    assetHubScan,
    utcNowTimestamp - historyInSeconds,
  );

  const toBridgeHubBlock = await subscan.fetchBlockNearTimestamp(
    bridgeHubScan,
    utcNowTimestamp,
  );
  const fromBridgeHubBlock = await subscan.fetchBlockNearTimestamp(
    bridgeHubScan,
    utcNowTimestamp - historyInSeconds,
  );

  if (ethNowBlock === null) {
    throw Error("Could not fetch latest Ethereum block.");
  }

  const searchRange = {
    assetHub: {
      fromBlock: fromAssetHubBlock.block_num,
      toBlock: toAssetHubBlock.block_num,
    },
    bridgeHub: {
      fromBlock: fromBridgeHubBlock.block_num,
      toBlock: toBridgeHubBlock.block_num,
    },
    ethereum: {
      fromBlock: ethNowBlock.number - ethereumSearchPeriodBlocks,
      toBlock: ethNowBlock.number,
    },
  };
  console.log("Search ranges:", searchRange);

  const toEthereum = await history.toEthereumHistory(
    assetHubScan,
    bridgeHubScan,
    relaychainScan,
    searchRange,
    skipLightClientUpdates,
    env.ethChainId,
    assetHubParaId,
    beefyClient,
    gateway,
  );
  console.log("To Ethereum transfers:", toEthereum.length);

  const toPolkadot = await history.toPolkadotHistory(
    assetHubScan,
    bridgeHubScan,
    searchRange,
    skipLightClientUpdates,
    bridgeHubParaId,
    gateway,
    ethereumProvider,
    beacon_url,
  );
  console.log("To Polkadot transfers:", toPolkadot.length);

  const transfers = [...toEthereum, ...toPolkadot];
  transfers.sort((a, b) => b.info.when.getTime() - a.info.when.getTime());
  return transfers;
}

export interface AccountInfo {
  name: string;
  type: "ethereum" | "substrate";
  account: string;
  balance: string;
}

type StatusValue = "Normal" | "Halted" | "Delayed";
export type BridgeStatus = {
  statusInfo: status.BridgeStatusInfo;
  channelStatusInfos: { name: string; status: status.ChannelStatusInfo }[];
  assetHubChannel: status.ChannelStatusInfo;
  relayers: AccountInfo[];
  accounts: AccountInfo[];
  summary: {
    toPolkadot: {
      lightClientLatencyIsAcceptable: boolean;
      bridgeOperational: boolean;
      channelOperational: boolean;
    };
    toPolkadotOperatingMode: StatusValue;
    toEthereum: {
      bridgeOperational: boolean;
      lightClientLatencyIsAcceptable: boolean;
    };
    toEthereumOperatingMode: StatusValue;
    overallStatus: StatusValue;
  };
};

export async function createContext(
  ethereumProvider: AbstractProvider,
  { config }: SnowbridgeEnvironment,
) {
  return contextFactory({
    ethereum: {
      execution_url: ethereumProvider,
      beacon_url: config.BEACON_HTTP_API,
    },
    polkadot: {
      url: {
        bridgeHub:
          process.env.NEXT_PUBLIC_BRIDGE_HUB_URL ?? config.BRIDGE_HUB_URL,
        assetHub: process.env.NEXT_PUBLIC_ASSET_HUB_URL ?? config.ASSET_HUB_URL,
        relaychain:
          process.env.NEXT_PUBLIC_RELAY_CHAIN_URL ?? config.RELAY_CHAIN_URL,
        parachains: [
          ...config.PARACHAINS,
          // TODO: add the endpoints to the env.config instead
          // parachainConfigs.Kilt.endpoint,
          // parachainConfigs.Rilt.endpoint,
        ],
      },
    },
    appContracts: {
      gateway: config.GATEWAY_CONTRACT,
      beefy: config.BEEFY_CONTRACT,
    },
  });
}

export async function getBridgeStatus(
  context: Context,
  { config }: SnowbridgeEnvironment,
): Promise<BridgeStatus> {
  console.log("Refreshing bridge status.");
  const assetHubSovereignAddress = utils.paraIdToSovereignAccount(
    "sibl",
    config.ASSET_HUB_PARAID,
  );
  const bridgeHubAgentId = u8aToHex(blake2AsU8a("0x00", 256));

  const [
    bridgeStatusInfo,
    assethub,
    primaryGov,
    secondaryGov,
    assetHubSovereignAccountCodec,
    assetHubAgentAddress,
    bridgeHubAgentAddress,
  ] = await Promise.all([
    status.bridgeStatusInfo(context),
    status.channelStatusInfo(
      context,
      utils.paraIdToChannelId(config.ASSET_HUB_PARAID),
    ),
    status.channelStatusInfo(context, config.PRIMARY_GOVERNANCE_CHANNEL_ID),
    status.channelStatusInfo(context, config.SECONDARY_GOVERNANCE_CHANNEL_ID),
    context.polkadot.api.bridgeHub.query.system.account(
      assetHubSovereignAddress,
    ),
    context.ethereum.contracts.gateway.agentOf(
      utils.paraIdToAgentId(
        context.polkadot.api.bridgeHub.registry,
        config.ASSET_HUB_PARAID,
      ),
    ),
    context.ethereum.contracts.gateway.agentOf(bridgeHubAgentId),
  ]);

  const accounts: AccountInfo[] = [];
  const assetHubSovereignBalance = BigInt(
    (assetHubSovereignAccountCodec.toPrimitive() as any).data.free,
  );
  accounts.push({
    name: "Asset Hub Sovereign",
    type: "substrate",
    account: encodeAddress(assetHubSovereignAddress),
    balance: assetHubSovereignBalance.toString(),
  });

  const [assetHubAgentBalance, bridgeHubAgentBalance, relayers] =
    await Promise.all([
      context.ethereum.api.getBalance(assetHubAgentAddress),
      context.ethereum.api.getBalance(bridgeHubAgentAddress),
      Promise.all(
        config.RELAYERS.map(async (r) => {
          let balance = "0";
          switch (r.type) {
            case "ethereum":
              balance = (
                await context.ethereum.api.getBalance(r.account)
              ).toString();
              break;
            case "substrate":
              balance = BigInt(
                (
                  (
                    await context.polkadot.api.bridgeHub.query.system.account(
                      r.account,
                    )
                  ).toPrimitive() as any
                ).data.free,
              ).toString();
              break;
          }
          return {
            name: r.name,
            account: r.account,
            balance: balance,
            type: r.type,
          };
        }),
      ),
    ]);

  accounts.push({
    name: "Asset Hub Agent",
    type: "ethereum",
    account: assetHubAgentAddress,
    balance: assetHubAgentBalance.toString(),
  });
  accounts.push({
    name: "Bridge Hub Agent",
    type: "ethereum",
    account: bridgeHubAgentAddress,
    balance: bridgeHubAgentBalance.toString(),
  });

  const toPolkadot = {
    lightClientLatencyIsAcceptable:
      bridgeStatusInfo.toPolkadot.latencySeconds < ACCEPTABLE_BRIDGE_LATENCY,
    bridgeOperational:
      bridgeStatusInfo.toPolkadot.operatingMode.outbound === "Normal" &&
      bridgeStatusInfo.toPolkadot.operatingMode.beacon === "Normal",
    channelOperational: assethub.toPolkadot.operatingMode.outbound === "Normal",
  };
  const toPolkadotOperatingMode =
    !toPolkadot.bridgeOperational || !toPolkadot.channelOperational
      ? "Halted"
      : !toPolkadot.lightClientLatencyIsAcceptable
        ? "Delayed"
        : "Normal";

  const toEthereum = {
    bridgeOperational:
      bridgeStatusInfo.toEthereum.operatingMode.outbound === "Normal",
    lightClientLatencyIsAcceptable:
      bridgeStatusInfo.toEthereum.latencySeconds < ACCEPTABLE_BRIDGE_LATENCY,
  };
  const toEthereumOperatingMode = !toEthereum.bridgeOperational
    ? "Halted"
    : !toEthereum.lightClientLatencyIsAcceptable
      ? "Delayed"
      : "Normal";

  let overallStatus: StatusValue = toEthereumOperatingMode;
  if (toEthereumOperatingMode === "Normal") {
    overallStatus = toPolkadotOperatingMode;
  }

  return {
    summary: {
      toPolkadot,
      toPolkadotOperatingMode,
      toEthereum,
      toEthereumOperatingMode,
      overallStatus,
    },
    statusInfo: bridgeStatusInfo,
    assetHubChannel: assethub,
    channelStatusInfos: [
      { name: "Asset Hub", status: assethub },
      { name: "Primary Governance", status: primaryGov },
      { name: "Secondary Governance", status: secondaryGov },
    ],
    relayers,
    accounts,
  };
}

export function getErrorMessage(err: any) {
  let message = "Unknown error";
  if (err instanceof Error) {
    message = err.message;
  }
  console.error(message, err);
  return message;
}
