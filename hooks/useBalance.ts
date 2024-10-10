import { ApiPromise } from "@polkadot/api";
import {
  AccountInfo,
  AssetBalance,
  AssetMetadata,
} from "@polkadot/types/interfaces";
import { useEffect, useMemo, useState } from "react";
import { Option } from "@polkadot/types";

type TokenMeta = {
  decimals?: number;
  symbol?: string;
};

export type BalanceWithTokenInfo = TokenMeta & { balance?: bigint };

export const usePolkadotNativeBalance = (
  account?: string,
  api?: ApiPromise,
  refreshInterval: number = 10000,
): BalanceWithTokenInfo => {
  const [tokenInfo, setTokenInfo] = useState<TokenMeta>({});
  const [balance, setBalance] = useState<bigint>();

  useEffect(() => {
    if (!api) {
      return;
    }
    const getMeta = async () => {
      const { tokenDecimals, tokenSymbol } = await api.rpc.system.properties();
      setTokenInfo({
        decimals: tokenDecimals.unwrapOrDefault().at(0)?.toNumber(),
        symbol: tokenSymbol.unwrapOrDefault().at(0)?.toString(),
      });
    };
    getMeta();
  }, [api]);

  useEffect(() => {
    if (!api || !account) {
      return;
    }
    const transform = ({ data }: AccountInfo) =>
      data.free.toBigInt() - (data as any).frozen.toBigInt();

    if (api.hasSubscriptions) {
      let unsub;
      api.query.system
        .account(account, (data: AccountInfo) => {
          setBalance(transform(data));
        })
        .then((cb: any) => {
          unsub = cb;
        });
      return unsub;
    }
    const pollBalance = async () =>
      setBalance(
        transform(await api.query.system.account<AccountInfo>(account)),
      );
    pollBalance();
    const ref = setInterval(pollBalance, refreshInterval);
    return clearInterval(ref);
  }, [api, api?.hasSubscriptions, account, refreshInterval]);

  return useMemo(() => ({ ...tokenInfo, balance }), [balance, tokenInfo]);
};

export const usePolkadotAssetsBalance = (
  account?: string,
  assetId?: unknown,
  palletName?: string,
  api?: ApiPromise,
  refreshInterval: number = 10000,
): BalanceWithTokenInfo => {
  const [tokenInfo, setTokenInfo] = useState<TokenMeta>({});
  const [balance, setBalance] = useState<bigint>();

  useEffect(() => {
    if (!api || !palletName) {
      return;
    }
    const getMeta = async () => {
      const { symbol, decimals } =
        await api.query[palletName].metadata<AssetMetadata>(assetId);
      setTokenInfo({
        decimals: decimals.toNumber(),
        symbol: symbol.toUtf8(),
      });
    };
    getMeta();
  }, [api, assetId, palletName]);

  useEffect(() => {
    if (!api || !palletName || !account) {
      return;
    }
    const transform = (data: Option<AssetBalance>) =>
      data.unwrapOrDefault().balance.toBigInt();

    if (api.hasSubscriptions) {
      let unsub;
      api.query[palletName]
        .account(assetId, account, (data: Option<AssetBalance>) =>
          setBalance(transform(data)),
        )
        .then((cb: any) => {
          unsub = cb;
        });
      return unsub;
    }
    const pollBalance = async () =>
      setBalance(
        transform(
          await api.query[palletName].account<Option<AssetBalance>>(
            assetId,
            account,
          ),
        ),
      );

    pollBalance();
    const ref = setInterval(pollBalance, refreshInterval);
    return clearInterval(ref);
  }, [
    api,
    api?.hasSubscriptions,
    account,
    refreshInterval,
    palletName,
    assetId,
  ]);

  return useMemo(() => ({ ...tokenInfo, balance }), [balance, tokenInfo]);
};
