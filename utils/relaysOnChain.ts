import { ApiPromise, HttpProvider, WsProvider } from "@polkadot/api";
import { Bytes, Option, Struct, u32 } from "@polkadot/types";
import { H256 } from "@polkadot/types/interfaces";
// import { PolkadotPrimitivesV5PersistedValidationData } from "@kiltprotocol/augment-api/index";

import {
  SnowbridgeEnvironment,
  TransferLocation,
  SNOWBRIDGE_ENV,
} from "@snowbridge/api/dist/environment";

// explicit Definition:
interface PolkadotPrimitivesV5PersistedValidationData extends Struct {
  readonly parentHead: Bytes;
  readonly relayParentNumber: u32;
  readonly relayParentStorageRoot: H256;
  readonly maxPovSize: u32;
}

export async function getApi(wsUrl: string): Promise<ApiPromise | undefined> {
  try {
    const api = await ApiPromise.create({
      provider: wsUrl.startsWith("http")
        ? new HttpProvider(wsUrl)
        : new WsProvider(wsUrl),
      throwOnConnect: true,
    });
    return api;
  } catch (error) {
    console.error(`Could not connect to api under ${wsUrl}`);
    return undefined;
  }
}

async function getRelaysChainLastParentBlockInfo(api: ApiPromise) {
  const validationData =
    await api.query.parachainSystem.validationData<
      Option<PolkadotPrimitivesV5PersistedValidationData>
    >();

  if (validationData.isNone) {
    throw new Error(
      "This is not a parachain or validation data is unavailable",
    );
  }
  const { relayParentNumber, relayParentStorageRoot } = validationData.unwrap();

  const lastRelayParentBlock = relayParentNumber.toNumber();
  const lastRelayParentBlockStorageRoot = relayParentStorageRoot.toHex();

  console.log("lastRelayParentBlock: ", lastRelayParentBlock);
  console.log(
    "lastRelayParentBlockStorageRoot: ",
    lastRelayParentBlockStorageRoot,
  );

  return {
    lastRelayParentBlock,
    lastRelayParentBlockStorageRoot,
  };
}

export async function relaysOnChain(
  paraApi: ApiPromise,
  relayApis: ApiPromise[],
): Promise<string> {
  const { lastRelayParentBlock, lastRelayParentBlockStorageRoot } =
    await getRelaysChainLastParentBlockInfo(paraApi);

  const parachainName = await paraApi.rpc.system.chain();

  for (const relayApi of relayApis) {
    if (!relayApi) {
      continue;
    }

    const examinedBlockHash =
      await relayApi.rpc.chain.getBlockHash(lastRelayParentBlock);

    const examinedBlock = await relayApi.rpc.chain.getBlock(examinedBlockHash);
    const relaychainName = await relayApi.rpc.system.chain();

    if (
      examinedBlock.block.header.stateRoot.toHex() ===
      lastRelayParentBlockStorageRoot
    ) {
      console.log(`"${parachainName}" relays on chain: ${relaychainName}`);
      return relaychainName.toString();
    }
    console.log(
      `"${parachainName}" does not relay on chain: ${relaychainName}`,
    );
  }
  const unknownRelayChain = "a blockchain whose API was not provided";
  console.log(`"${parachainName}" relays on ${unknownRelayChain}.`);

  return unknownRelayChain;
}

/** Returns to which `SnowbridgeEnvironment` the parachain under the give `paraApi` corresponds to. */
export async function getSnowEnvBasedOnRelayChain(
  paraApi: ApiPromise,
  snowEnvironments: { [id: string]: SnowbridgeEnvironment },
) {
  const { lastRelayParentBlock, lastRelayParentBlockStorageRoot } =
    await getRelaysChainLastParentBlockInfo(paraApi);

  const parachainName = await paraApi.rpc.system.chain();

  const coldEnvironments = Object.values(snowEnvironments);
  // .map(
  //   ({ config }) => config.RELAY_CHAIN_URL,
  // );

  for (const env of coldEnvironments) {
    const relayApi = await getApi(env.config.RELAY_CHAIN_URL);

    if (!relayApi) {
      continue;
    }

    const examinedBlockHash =
      await relayApi.rpc.chain.getBlockHash(lastRelayParentBlock);

    const examinedBlock = await relayApi.rpc.chain.getBlock(examinedBlockHash);
    const relaychainName = await relayApi.rpc.system.chain();

    if (
      examinedBlock.block.header.stateRoot.toHex() ===
      lastRelayParentBlockStorageRoot
    ) {
      console.log(`"${parachainName}" relays on chain: ${relaychainName}`);
      return env.name;
    }
    console.log(
      `"${parachainName}" does not relay on chain: ${relaychainName}`,
    );
  }

  console.log(
    `"${parachainName}" relays on a blockchain that is not part of the Snowbridge API.`,
  );

  return "unsupported_relaychain";
}
