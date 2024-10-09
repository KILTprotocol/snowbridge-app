import { snowbridgeContextAtom } from "@/store/snowbridge";
import { fetchForeignAssetsBalances } from "@/utils/balances";
import { formatBalance } from "@/utils/formatting";
import { parachainConfigs, ParaConfig } from "@/utils/parachainConfigs";
import { ErrorInfo } from "@/utils/types";
import { ApiPromise } from "@polkadot/api";
import { Option } from "@polkadot/types";
import { AccountInfo, AssetBalance } from "@polkadot/types/interfaces";
import { assets } from "@snowbridge/api";
import { useAtomValue } from "jotai";
import React, { useState, useEffect, useCallback, FC } from "react";

interface Props {
  sourceAccount: string;
  sourceId: string;
  destinationId: string;
  beneficiary: string;
  parachainInfo: ParaConfig[];
  handleSufficientTokens: (
    assetHubSufficient: boolean,
    parachainSufficient: boolean,
  ) => void;
  handleTopUpCheck: (
    xcmFee: bigint,
    xcmBalance: bigint,
    xcmBalanceDestination: bigint,
  ) => void;
}

// Utility function to query balances
const getBalanceData = async (
  api: ApiPromise,
  account: string,
  decimals: number,
) => {
  const balance = await api.query.system.account<AccountInfo>(account);

  return formatBalance({
    number: balance.data.free.toBigInt(),
    decimals,
    displayDecimals: 3,
  });
};

const PolkadotBalance: FC<Props> = ({
  sourceAccount,
  sourceId,
  destinationId,
  beneficiary,
  parachainInfo,
  handleSufficientTokens,
  handleTopUpCheck,
}) => {
  const context = useAtomValue(snowbridgeContextAtom);
  const [balanceData, setBalanceData] = useState({
    destinationBalance: "0",
    destinationSymbol: "",
    destinationName: "",
    sourceBalance: "0",
    sourceSymbol: "",
    sourceName: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const checkXcmFee = useCallback(async () => {
    if (!context) return;
    if (sourceId === destinationId) return;

    try {
      const parachainId =
        destinationId === "assethub" ? sourceId : destinationId;
      const parachain = parachainInfo.find((val) => val.id === parachainId);

      if (!parachain) return;
      const api = context.polkadot.api.parachains[parachain.parachainId];
      const { xcmFee } = parachain.switchPair[0];

      const fungibleBalanceDestination =
        await context.polkadot.api.assetHub.query.system.account<AccountInfo>(
          sourceAccount,
        );

      const fungibleBalance = await api.query.fungibles.account<
        Option<AssetBalance>
      >(parachain.switchPair[0].xcmFee.remoteXcmFee.V4.id, sourceAccount);

      setError(null);

      handleTopUpCheck(
        BigInt(xcmFee.amount),
        fungibleBalance.unwrapOrDefault().balance.toBigInt(),
        fungibleBalanceDestination.data.free.toBigInt(),
      );
    } catch (error) {
      console.error(error);
      setError({
        title: "Unable to retrieve XCM fee balance",
        description:
          "Unable to get the accounts data and see if there are any tokens for the XCM balance",
        errors: [],
      });
    }
  }, [
    context,
    destinationId,
    handleTopUpCheck,
    parachainInfo,
    sourceAccount,
    sourceId,
  ]);

  const checkSufficientTokens = useCallback(async () => {
    if (!context) return;
    try {
      const parachainId =
        destinationId === "assethub" ? sourceId : destinationId;

      const assetHubApi = context.polkadot.api.assetHub;
      const finder = parachainInfo.find((val) => val.id === parachainId);
      if (!finder) return;
      const parachainApi = context.polkadot.api.parachains[finder.parachainId];

      const checkAssetHubBalanceED =
        await assetHubApi.query.system.account<AccountInfo>(beneficiary);

      const assetHubSufficient =
        checkAssetHubBalanceED.sufficients.gtn(0) ||
        checkAssetHubBalanceED.providers.gtn(0);

      const checkParachainBalanceED =
        await parachainApi.query.system.account<AccountInfo>(beneficiary);

      const parachainSufficient =
        checkParachainBalanceED.sufficients.gtn(0) ||
        checkParachainBalanceED.providers.gtn(0);

      handleSufficientTokens(assetHubSufficient, parachainSufficient);
      setError(null);
    } catch (e) {
      console.error(e);
      setError({
        title: "Unable to retrieve sufficients",
        description:
          "Unable to get the accounts data and see if there are any tokens",
        errors: [],
      });
    }
  }, [
    beneficiary,
    context,
    destinationId,
    handleSufficientTokens,
    parachainInfo,
    sourceId,
  ]);

  const fetchBalanceData = useCallback(async () => {
    if (!context) return;
    if (sourceId === destinationId) return;

    try {
      const parachain =
        sourceId === "assethub"
          ? parachainInfo.find((val) => val.id === destinationId)
          : parachainInfo.find((val) => val.id === sourceId);

      if (!parachain) {
        return;
      }
      const sourceApi =
        sourceId === "assethub"
          ? context.polkadot.api.assetHub
          : context.polkadot.api.parachains[parachain.parachainId!];

      const destinationApi =
        destinationId === "assethub"
          ? context.polkadot.api.assetHub
          : context.polkadot.api.parachains[parachain.parachainId!];

      if (sourceId === "assethub") {
        const sourceBalance = await fetchForeignAssetsBalances(
          sourceApi,
          parachain.switchPair[0].remoteAssetId,
          sourceAccount,
          parachain.switchPair[0].tokenMetadata.decimals,
        );

        const destinationBalance = await getBalanceData(
          destinationApi,
          sourceAccount,
          parachain.switchPair[0].tokenMetadata.decimals,
        );

        setBalanceData({
          destinationBalance,
          destinationSymbol: parachain.switchPair[0].tokenMetadata.symbol,
          destinationName: parachain.name,
          sourceBalance,
          sourceSymbol: parachain.switchPair[0].tokenMetadata.symbol,
          sourceName: "Asset Hub",
        });
      } else {
        const { tokenDecimal, tokenSymbol } =
          await assets.parachainNativeAsset(sourceApi);
        const sourceBalance = await getBalanceData(
          sourceApi,
          sourceAccount,
          tokenDecimal,
        );

        const destinationBalance = await fetchForeignAssetsBalances(
          destinationApi,
          parachain.switchPair[0].remoteAssetId,
          sourceAccount,
          parachain.switchPair[0].tokenMetadata.decimals,
        );

        setBalanceData({
          destinationBalance,
          destinationSymbol: parachain.switchPair[0].tokenMetadata.symbol,
          destinationName: "Asset Hub",
          sourceBalance,
          sourceSymbol: tokenSymbol,
          sourceName: parachain.name,
        });
      }

      setError(null);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError({
        title: "Error",
        description: "Could not fetch balance.",
        errors: [],
      });
      setLoading(false);
    }
  }, [context, destinationId, parachainInfo, sourceAccount, sourceId]);

  useEffect(() => {
    checkXcmFee();
  }, [checkXcmFee]);

  useEffect(() => {
    fetchBalanceData();
  }, [fetchBalanceData]);

  useEffect(() => {
    checkSufficientTokens();
  }, [checkSufficientTokens]);

  if (loading) {
    return (
      <div className="text-sm text-right text-muted-foreground px-1">
        Fetching...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-right text-muted-foreground px-1">
        {error.description}
      </div>
    );
  }
  const {
    destinationBalance,
    destinationSymbol,
    destinationName,
    sourceBalance,
    sourceSymbol,
    sourceName,
  } = balanceData;

  return (
    <>
      <div className="text-sm text-right text-muted-foreground px-1">
        {sourceName} Balance: {sourceBalance} {sourceSymbol}
      </div>
      <div className="text-sm text-right text-muted-foreground px-1">
        {destinationName} Balance: {destinationBalance} {destinationSymbol}
      </div>
    </>
  );
};

export default PolkadotBalance;
