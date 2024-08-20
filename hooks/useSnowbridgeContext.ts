import {
  assetErc20MetaDataAtom,
  parachainsChainNativeAssetAtom,
  relayChainNativeAssetAtom,
  snowbridgeContextAtom,
  snowbridgeEnvironmentAtom,
} from "@/store/snowbridge";
import { Context, assets, environment } from "@snowbridge/api";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { AbstractProvider } from "ethers";
import { ethereumChainIdAtom, ethersProviderAtom } from "@/store/ethereum";
import { createContext } from "@/lib/snowbridge";

const connectSnowbridgeContext = async (
  env: environment.SnowbridgeEnvironment,
  ethereumProvider: AbstractProvider,
) => {
  const context = await createContext(ethereumProvider, env);

  const tokens = [
    ...new Set(
      env.locations
        .flatMap((l) => l.erc20tokensReceivable)
        .map((l) => l.address.toLowerCase()),
    ),
  ];
  const dummy = Object.keys(context.polkadot.api.parachains);
  const [
    network,
    relayChainNativeToken,
    assetMetadataList,
    parachainsNativeToken,
  ] = await Promise.all([
    context.ethereum.api.getNetwork(),
    assets.parachainNativeAsset(context.polkadot.api.relaychain),
    Promise.all(
      tokens.map(async (t) => {
        try {
          const metadata = await assets.assetErc20Metadata(context, t);
          return { token: t, metadata };
        } catch (error) {
          console.error(`Failed to fetch metadata for token: ${t}`, error);
          return null;
        }
      }),
    ),

    Promise.all(
      // The endpoints were added to the env.config and ergo to the context on createContext()
      Object.values(context.polkadot.api.parachains).map(
        assets.parachainNativeAsset,
      ),
      // await assets.parachainNativeAsset(context.polkadot.api.parachains[2086]),
      // await assets.parachainNativeAsset(context.polkadot.api.parachains[4504]),
    ),
  ]);

  // Kilt is not a ERC20 Token
  // const kiltMetada = {
  //   token: "kilt",
  //   metadata: {
  //     name: "kilt",
  //     symbol: parachainsNativeToken[0].tokenSymbol,
  //     decimals: BigInt(parachainsNativeToken[0].tokenDecimal),
  //   },
  // };
  // assetMetadataList.push(kiltMetada);

  const assetMetadata: { [tokenAddress: string]: assets.ERC20Metadata } = {};
  assetMetadataList
    .filter((am) => am !== null)
    .forEach((am) => (assetMetadata[am!.token] = am!.metadata));

  return {
    context,
    chainId: Number(network.chainId.toString()),
    relayChainNativeToken,
    parachainsNativeToken,
    assetMetadata,
  };
};

export const useSnowbridgeContext = (): [
  Context | null,
  boolean,
  string | null,
] => {
  const [context, setContext] = useAtom(snowbridgeContextAtom);
  const setRelayChainNativeAsset = useSetAtom(relayChainNativeAssetAtom);
  const setParchainsNativeAsset = useSetAtom(parachainsChainNativeAssetAtom);
  const setAssetErc20MetaData = useSetAtom(assetErc20MetaDataAtom);

  const ethereumProvider = useAtomValue(ethersProviderAtom);
  const chainId = useAtomValue(ethereumChainIdAtom);
  const env = useAtomValue(snowbridgeEnvironmentAtom);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (env.ethChainId !== chainId) {
      setContext(null);
      return;
    }
    if (ethereumProvider === null) {
      setContext(null);
      return;
    }
    setLoading(true);
    connectSnowbridgeContext(env, ethereumProvider)
      .then((result) => {
        setLoading(false);
        setContext(result.context);
        setRelayChainNativeAsset(result.relayChainNativeToken);
        setParchainsNativeAsset(result.parachainsNativeToken);
        setAssetErc20MetaData(result.assetMetadata);
      })
      .catch((error) => {
        let message = "Unknown Error";
        if (error instanceof Error) {
          message = error.message;
        }
        setLoading(false);
        setError(message);
      });
  }, [
    env,
    chainId,
    setRelayChainNativeAsset,
    setAssetErc20MetaData,
    setParchainsNativeAsset,
    setContext,
    setError,
    setLoading,
    ethereumProvider,
  ]);

  return [context, loading, error];
};
