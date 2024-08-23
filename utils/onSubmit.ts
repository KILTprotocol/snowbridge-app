"use client";

import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress } from "@polkadot/keyring";

import { formatBalance } from "@/utils/formatting";
import { PendingTransferAction, Transfer } from "@/store/transferHistory";
import { Signer as DotSigner } from "@polkadot/api/types";
import {
  Context,
  assets,
  environment,
  history,
  toEthereum,
  toPolkadot,
} from "@snowbridge/api";
import { WalletAccount } from "@talismn/connect-wallets";
import { BrowserProvider } from "ethers";
import { Dispatch, SetStateAction } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { track } from "@vercel/analytics";
import { errorMessage } from "./errorMessage";
import { parseAmount } from "@/utils/balances";
import { AppRouter, FormData, ErrorInfo } from "@/utils/types";
import { validateOFAC } from "@/components/Transfer";
import { ISubmittableResult } from "@polkadot/types/types";
import { parachainConfigs } from "@/lib/snowbridge";

export function onSubmit({
  context,
  source,
  destination,
  setError,
  setBusyMessage,
  polkadotAccount,
  ethereumAccount,
  ethereumProvider,
  tokenMetadata,
  appRouter,
  form,
  refreshHistory,
  addPendingTransaction,
  snowbridgeEnvironment,
}: {
  context: Context | null;
  source: environment.TransferLocation;
  destination: environment.TransferLocation;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setBusyMessage: Dispatch<SetStateAction<string>>;
  polkadotAccount: WalletAccount | null;
  ethereumAccount: string | null;
  ethereumProvider: BrowserProvider | null;
  tokenMetadata: assets.ERC20Metadata | null;
  appRouter: AppRouter;
  form: UseFormReturn<FormData>;
  refreshHistory: () => void;
  addPendingTransaction: (_: PendingTransferAction) => void;
  snowbridgeEnvironment: environment.SnowbridgeEnvironment;
}): (data: FormData) => Promise<void> {
  return async (data) => {
    track("Validate Send", data);

    try {
      if (tokenMetadata == null) {
        throw Error(`No erc20 token metadata.`);
      }

      const amountInSmallestUnit = parseAmount(data.amount, tokenMetadata);
      if (amountInSmallestUnit === 0n) {
        const errorMessage = "Amount must be greater than 0.";
        form.setError("amount", { message: errorMessage });
        return;
      }

      const minimumTransferAmount =
        destination.erc20tokensReceivable.find(
          (t) => t.address.toLowerCase() === data.token.toLowerCase(),
        )?.minimumTransferAmount ?? 1n;
      if (amountInSmallestUnit < minimumTransferAmount) {
        const errorMessage = `Cannot send less than minimum value of ${formatBalance(
          {
            number: minimumTransferAmount,
            decimals: Number(tokenMetadata.decimals.toString()),
          },
        )} ${tokenMetadata.symbol}.`;
        form.setError(
          "amount",
          {
            message: errorMessage,
          },
          { shouldFocus: true },
        );
        track("Validate Failed", { ...data, errorMessage });
        return;
      }

      if (!(await validateOFAC(data, form))) {
        track("OFAC Validation.", data);
        return;
      }

      if (source.id !== data.source) {
        throw Error(
          `Invalid form state: source mismatch ${source.id} and ${data.source}.`,
        );
      }
      if (destination.id !== data.destination) {
        throw Error(
          `Invalid form state: destination mismatch ${destination.id} and ${data.destination}.`,
        );
      }
      if (context === null) {
        throw Error(`Context not configured.`);
      }

      setBusyMessage("Validating...");

      let transfer: Transfer;
      switch (decideCase(source, destination, snowbridgeEnvironment)) {
        case "assetHubToEthereum": {
          transfer = await submitAssetHubToEthereumTransfer({
            context,
            source,
            destination,
            polkadotAccount,
            data,
            amountInSmallestUnit,
            setError,
            setBusyMessage,
          });
          break;
        }
        case "ethereumToAssetHub": {
          transfer = await submitEthereumToAssetHubTransfer({
            context,
            destination,
            ethereumProvider,
            ethereumAccount,
            data,
            amountInSmallestUnit,
            setError,
            setBusyMessage,
          });
          break;
        }
        // case "assetHubToParachain": {
        //   transfer = await submitAssetHubToParachainTransfer({
        //     context,
        //     source,
        //     destination,
        //     polkadotAccount,
        //     data,
        //     amountInSmallestUnit,
        //     setError,
        //     setBusyMessage,
        //   });
        //   break;
        // }
        // case "parachainToAssetHub": {
        //   transfer = await submitParachainToAssetHubTransfer({
        //     context,
        //     source,
        //     destination,
        //     polkadotAccount,
        //     data,
        //     amountInSmallestUnit,
        //     setError,
        //     setBusyMessage,
        //   });
        //   break;
        // }
        default:
          throw Error(`Invalid form state: cannot infer source type.`);
      }

      let messageId: string = transfer.id;
      track("Send Success", {
        ...data,
        messageId,
      });
      form.reset();
      const transferUrl = `/history#${messageId}`;
      appRouter.prefetch(transferUrl);
      transfer.isWalletTransaction = true;
      addPendingTransaction({
        kind: "add",
        transfer,
      });
      refreshHistory();
      toast.info("Transfer Successful", {
        position: "bottom-center",
        closeButton: true,
        duration: 60000,
        id: "transfer_success",
        description: "Token transfer was successfully initiated.",
        important: true,
        action: {
          label: "View",
          onClick: () => {
            appRouter.push(transferUrl);
          },
        },
      });
      setBusyMessage("");
    } catch (err: any) {
      console.error(err);
      track("Send Failed", {
        ...data,
        message: errorMessage(err),
      });
      setBusyMessage("");
      setError({
        title: "Send Error",
        description: `Error occurred while trying to send transaction.`,
        errors: [],
      });
    }
  };
}

function decideCase(
  source: environment.TransferLocation,
  destination: environment.TransferLocation,
  snowbridgeEnvironment: environment.SnowbridgeEnvironment,
):
  | "ethereumToAssetHub"
  | "assetHubToEthereum"
  | "assetHubToParachain"
  | "parachainToAssetHub" {
  function isAssetHub(blockchain: environment.TransferLocation): boolean {
    return (
      blockchain.paraInfo?.paraId ===
      snowbridgeEnvironment.config.ASSET_HUB_PARAID
    );
  }

  if (source.type === "ethereum" && isAssetHub(destination)) {
    return "ethereumToAssetHub";
  }
  if (isAssetHub(source)) {
    if (destination.type === "ethereum") {
      return "assetHubToEthereum";
    }
    if (destination.type === "substrate" && !isAssetHub(destination)) {
      return "assetHubToParachain";
    }
  }
  if (
    source.type === "substrate" &&
    !isAssetHub(source) &&
    isAssetHub(destination)
  ) {
    return "parachainToAssetHub";
  }

  throw new Error(
    "Invalid combination of source and destination for transfer.",
  );
}

async function submitAssetHubToEthereumTransfer({
  context,
  source,
  destination,
  polkadotAccount,
  data,
  amountInSmallestUnit,
  setError,
  setBusyMessage,
}: {
  context: Context;
  source: environment.TransferLocation;
  destination: environment.TransferLocation;
  polkadotAccount: WalletAccount | null;
  amountInSmallestUnit: bigint;
  data: FormData;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setBusyMessage: Dispatch<SetStateAction<string>>;
}): Promise<Transfer> {
  if (destination.type !== "ethereum") {
    throw Error(`Invalid form state: destination type mismatch.`);
  }
  if (source.paraInfo === undefined) {
    throw Error(`Invalid form state: source does not have parachain info.`);
  }
  if (polkadotAccount === null) {
    throw Error(`Polkadot Wallet not connected.`);
  }
  if (polkadotAccount.address !== data.sourceAccount) {
    throw Error(`Source account mismatch.`);
  }

  const walletSigner = {
    address: polkadotAccount.address,
    signer: polkadotAccount.signer! as DotSigner,
  };
  const plan = await toEthereum.validateSend(
    context,
    walletSigner,
    source.paraInfo.paraId,
    data.beneficiary,
    data.token,
    amountInSmallestUnit,
  );
  console.log(plan);
  if (plan.failure) {
    track("Plan Failed", {
      ...data,
      errors: JSON.stringify(plan.failure.errors),
    });
    setBusyMessage("");
    setError({
      title: "Send Plan Failed",
      description: "Some preflight checks failed when planning the transfer.",
      errors: plan.failure.errors.map((e) => ({
        kind: "toEthereum",
        ...e,
      })),
    });
    throw Error("Plan validation failed");
  }

  setBusyMessage(
    "Waiting for transaction to be confirmed by wallet. After finalization transfers can take up to 4 hours.",
  );
  const result = await toEthereum.send(context, walletSigner, plan);
  const messageId = result.success?.messageId || "";
  return {
    id: messageId,
    status: history.TransferStatus.Pending,
    info: {
      amount: amountInSmallestUnit.toString(),
      sourceAddress: data.sourceAccount,
      beneficiaryAddress: data.beneficiary,
      tokenAddress: data.token,
      when: new Date(),
    },
    submitted: {
      block_hash:
        result.success?.sourceParachain?.blockHash ??
        result.success?.assetHub.blockHash ??
        "",
      block_num:
        result.success?.sourceParachain?.blockNumber ??
        result.success?.assetHub.blockNumber ??
        0,
      block_timestamp: 0,
      messageId: messageId,
      account_id: data.source,
      bridgeHubMessageId: "",
      extrinsic_hash:
        result.success?.sourceParachain?.txHash ??
        result.success?.assetHub.txHash ??
        "",
      extrinsic_index:
        result.success?.sourceParachain !== undefined
          ? result.success.sourceParachain.blockNumber.toString() +
            "-" +
            result.success.sourceParachain.txIndex.toString()
          : result.success?.assetHub !== undefined
            ? result.success?.assetHub?.blockNumber.toString() +
              "-" +
              result.success?.assetHub.txIndex.toString()
            : "unknown",

      relayChain: {
        block_hash: result.success?.relayChain.submittedAtHash ?? "",
        block_num: 0,
      },
      success: true,
    },
  };
}
async function submitEthereumToAssetHubTransfer({
  context,
  destination,
  ethereumAccount,
  ethereumProvider,
  data,
  amountInSmallestUnit,
  setError,
  setBusyMessage,
}: {
  context: Context;
  destination: environment.TransferLocation;
  ethereumAccount: string | null;
  ethereumProvider: BrowserProvider | null;
  amountInSmallestUnit: bigint;
  data: FormData;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setBusyMessage: Dispatch<SetStateAction<string>>;
}): Promise<Transfer> {
  if (destination.type !== "substrate") {
    throw Error(`Invalid form state: destination type mismatch.`);
  }
  if (destination.paraInfo === undefined) {
    throw Error(`Invalid form state: destination does not have parachain id.`);
  }
  if (ethereumProvider === null) {
    throw Error(`Ethereum Wallet not connected.`);
  }
  if (ethereumAccount === null) {
    throw Error(`Wallet account not selected.`);
  }
  if (ethereumAccount !== data.sourceAccount) {
    throw Error(`Selected account does not match source data.`);
  }
  const signer = await ethereumProvider.getSigner();
  if (signer.address.toLowerCase() !== data.sourceAccount.toLowerCase()) {
    throw Error(`Source account mismatch.`);
  }
  const plan = await toPolkadot.validateSend(
    context,
    signer,
    data.beneficiary,
    data.token,
    destination.paraInfo.paraId,
    amountInSmallestUnit,
    destination.paraInfo.destinationFeeDOT,
    {
      maxConsumers: destination.paraInfo.maxConsumers,
      ignoreExistentialDeposit:
        destination.paraInfo.skipExistentialDepositCheck,
    },
  );
  console.log(plan);
  if (plan.failure) {
    track("Plan Failed", {
      ...data,
      errors: JSON.stringify(plan.failure.errors),
    });
    setBusyMessage("");
    setError({
      title: "Send Plan Failed",
      description: "Some preflight checks failed when planning the transfer.",
      errors: plan.failure.errors.map((e) => ({
        kind: "toPolkadot",
        ...e,
      })),
    });
    throw Error("Plan verification failed");
  }

  setBusyMessage(
    "Waiting for transaction to be confirmed by wallet. After finalization transfers can take up to 15-20 minutes.",
  );
  const result = await toPolkadot.send(context, signer, plan);

  const messageId = result.success?.messageId || "";
  return {
    id: messageId,
    status: history.TransferStatus.Pending,
    info: {
      amount: amountInSmallestUnit.toString(),
      sourceAddress: data.sourceAccount,
      beneficiaryAddress: data.beneficiary,
      tokenAddress: data.token,
      when: new Date(),
      destinationParachain: destination.paraInfo.paraId,
      destinationFee: destination.paraInfo.destinationFeeDOT.toString(),
    },
    submitted: {
      blockHash: result.success?.ethereum.blockHash ?? "",
      blockNumber: result.success?.ethereum.blockNumber ?? 0,
      channelId: "",
      messageId: messageId,
      logIndex: 0,
      transactionIndex: 0,
      transactionHash: result.success?.ethereum.transactionHash ?? "",
      nonce: 0,
      parentBeaconSlot: 0,
    },
  };
}

export async function submitParachainToAssetHubTransfer({
  context,
  polkadotAccount,
  source,
  destination,
  data,
  amountInSmallestUnit,
  setError,
  setBusyMessage,
}: {
  context: Context;
  polkadotAccount: WalletAccount | null;
  source: environment.TransferLocation;
  destination: environment.TransferLocation;
  data: FormData;
  amountInSmallestUnit: bigint;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setBusyMessage: Dispatch<SetStateAction<string>>;
}): Promise<any> {
  const { pallet } = parachainConfigs[source.name];
  if (source.type !== "substrate") {
    throw Error(`Invalid form state: source type mismatch.`);
  }
  if (!source.paraInfo) {
    throw Error(`Invalid form state: source does not have parachain id.`);
  }
  if (destination.type !== "substrate") {
    throw Error(`Invalid form state: destination type mismatch.`);
  }
  if (destination.paraInfo === undefined) {
    throw Error(`Invalid form state: destination does not have parachain id.`);
  }
  const parachainApi = context.polkadot.api.parachains[source.paraInfo?.paraId];

  const pathToBeneficiary = {
    V3: {
      parents: 0,
      interior: { X1: { AccountId32: { id: data.beneficiary } } },
    },
  };

  const tx = parachainApi.tx[pallet].switch(
    amountInSmallestUnit,
    pathToBeneficiary,
  );

  if (polkadotAccount === null) {
    setError({
      title: "Polkadot account not found",
      description: "The account used to sign the transaction was not provided.",
      errors: [],
    });
    throw Error(`Polkadot account not connected.`);
  }
  let result: ISubmittableResult | Transfer | PromiseLike<Transfer>;
  setBusyMessage("Waiting for transaction to be confirmed by wallet.");
  const signer = polkadotAccount.signer as DotSigner;
  result = await new Promise((resolve, reject) => {
    tx.signAndSend(polkadotAccount.address, { signer }, (x) => {
      resolve(x);
    }).catch(reject);
  });

  return result;
  // const signer = polkadotAccount.signer as DotSigner;
  // setBusyMessage("Waiting for transaction to be confirmed by wallet.");

  // const txSigned = await tx.signAsync(polkadotAccount.address, { signer });
  // const transactionResult = await new Promise<{
  //   blockNumber: number;
  //   blockHash: string;
  //   txIndex: number;
  //   txHash: string;
  //   success: boolean;
  //   events: EventRecord[];
  //   dispatchError?: any;
  //   messageId?: string;
  // }>(async (resolve, reject) => {
  //   try {
  //     txSigned.send(async (result: ISubmittableResult) => {
  //       if (result.isError) {
  //         console.error(result);
  //         throw new Error(
  //           result.internalError || result.dispatchError || result,
  //         );
  //       }

  //       if (result.isFinalized) {
  //         const finalizedData = {
  //           txHash: u8aToHex(result.txHash),
  //           txIndex: result.txIndex || 0,
  //           blockNumber: Number(result.blockNumber),
  //           blockHash: "",
  //           events: result.events,
  //         };

  //         let successResolved = false;

  //         result.events.forEach((eventRecord) => {
  //           if (
  //             assetHubApi.events.system.ExtrinsicFailed.is(eventRecord.event)
  //           ) {
  //             successResolved = true;
  //             throw new Error(
  //               eventRecord.event.data.toHuman(true)?.dispatchError,
  //             );
  //           }

  //           if (assetHubApi.events.polkadotXcm.Sent.is(eventRecord.event)) {
  //             successResolved = true;
  //             resolve({
  //               ...finalizedData,
  //               success: true,
  //               messageId: eventRecord.event.data.toPrimitive()[3],
  //             });
  //           }
  //         });

  //         if (!successResolved) {
  //           resolve({
  //             ...finalizedData,
  //             success: false,
  //           });
  //         }
  //       }
  //     });
  //   } catch (error) {
  //     reject(error);
  //   }
  // });
  // const messageId = transactionResult.messageId || "";
  // return {
  //   id: messageId,
  //   status: history.TransferStatus.Pending,
  //   info: {
  //     amount: amountInSmallestUnit.toString(),
  //     sourceAddress: data.sourceAccount,
  //     beneficiaryAddress: data.beneficiary,
  //     tokenAddress: data.token,
  //     when: new Date(),
  //   },
  //   submitted: {
  //     block_hash:
  //       transactionResult.success?.sourceParachain?.blockHash ??
  //       transactionResult.success?.assetHub.blockHash ??
  //       "",
  //     block_num:
  //       transactionResult.success?.sourceParachain?.blockNumber ??
  //       transactionResult.success?.assetHub.blockNumber ??
  //       0,
  //     block_timestamp: 0,
  //     messageId: messageId,
  //     account_id: data.source,
  //     bridgeHubMessageId: "",
  //     extrinsic_hash:
  //       transactionResult.success?.sourceParachain?.txHash ??
  //       transactionResult.success?.assetHub.txHash ??
  //       "",
  //     extrinsic_index:
  //       transactionResult.success?.sourceParachain !== undefined
  //         ? transactionResult.success.sourceParachain.blockNumber.toString() +
  //           "-" +
  //           transactionResult.success.sourceParachain.txIndex.toString()
  //         : transactionResult.success?.assetHub !== undefined
  //           ? transactionResult.success?.assetHub?.blockNumber.toString() +
  //             "-" +
  //             transactionResult.success?.assetHub.txIndex.toString()
  //           : "unknown",

  //     relayChain: {
  //       block_hash: transactionResult.success?.relayChain.submittedAtHash ?? "",
  //       block_num: 0,
  //     },
  //     success: true,
  //   },
  // };
}

export async function submitAssetHubToParachainTransfer({
  context,
  polkadotAccount,
  source,
  destination,
  data,
  amountInSmallestUnit,
  setError,
  setBusyMessage,
}: {
  context: Context;
  polkadotAccount: WalletAccount | null;
  source: environment.TransferLocation;
  destination: environment.TransferLocation;
  data: FormData;
  amountInSmallestUnit: bigint;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setBusyMessage: Dispatch<SetStateAction<string>>;
}): Promise<ISubmittableResult | Transfer> {
  // }): Promise<Transfer> {
  const { pallet, parachainId } = parachainConfigs[source.name];
  if (source.type !== "substrate") {
    throw Error(`Invalid form state: source type mismatch.`);
  }
  if (!source.paraInfo) {
    throw Error(`Invalid form state: source does not have parachain id.`);
  }
  if (destination.type !== "substrate") {
    throw Error(`Invalid form state: destination type mismatch.`);
  }
  if (destination.paraInfo === undefined) {
    throw Error(`Invalid form state: destination does not have parachain id.`);
  }

  const assetHubApi = context.polkadot.api.assetHub;

  source.paraInfo?.decimals;
  source.paraInfo?.addressType;
  source.paraInfo?.destinationFeeDOT;
  source.destinationIds;

  const switchPair = await assetHubApi.query[pallet].switchPair();
  const remoteAssetId = (switchPair as any).unwrap().remoteAssetId.toJSON().v3;
  const pathToBeneficiary = {
    parents: 0,
    interior: { X1: { AccountId32: { id: decodeAddress(data.beneficiary) } } },
  };
  const pathToParachain = {
    parents: 1,
    interior: {
      X1: {
        Parachain: parachainId,
      },
    },
  };

  const tx = assetHubApi.tx.polkadotXcm.transferAssetsUsingTypeAndThen(
    // this should actually be a multilocation of the destination of the parachain
    {
      V3: pathToParachain,
    },
    { V3: [{ id: remoteAssetId, fun: { Fungible: amountInSmallestUnit } }] },
    "LocalReserve",
    { V3: remoteAssetId },
    "LocalReserve",
    {
      V3: [
        {
          DepositAsset: {
            assets: { Wild: "All" },
            beneficiary: pathToBeneficiary,
          },
        },
      ],
    },
    "Unlimited",
  );

  if (polkadotAccount === null) {
    setError({
      title: "Polkadot account not found",
      description: "The account used to sign the transaction wasn'",
      errors: [],
    });
    throw Error(`Polkadot account not connected.`);
  }

  const signer = polkadotAccount.signer as DotSigner;
  let result: ISubmittableResult | Transfer | PromiseLike<Transfer>;
  setBusyMessage("Waiting for transaction to be confirmed by wallet.");

  result = await new Promise((resolve, reject) => {
    tx.signAndSend(polkadotAccount.address, { signer }, (x) => {
      resolve(x);
    }).catch(reject);
  });

  return result;
  // return result;
  // const txSigned = await tx.signAsync(polkadotAccount.address, { signer });
  // const transactionResult = await new Promise<{
  //   blockNumber: number;
  //   blockHash: string;
  //   txIndex: number;
  //   txHash: string;
  //   success: boolean;
  //   events: EventRecord[];
  //   dispatchError?: any;
  //   messageId?: string;
  // }>(async (resolve, reject) => {
  //   try {
  //     txSigned.send(async (result: ISubmittableResult) => {
  //       if (result.isError) {
  //         console.error(result);
  //         throw new Error(
  //           result.internalError || result.dispatchError || result,
  //         );
  //       }

  //       if (result.isFinalized) {
  //         const finalizedData = {
  //           txHash: u8aToHex(result.txHash),
  //           txIndex: result.txIndex || 0,
  //           blockNumber: Number(result.blockNumber),
  //           blockHash: "",
  //           events: result.events,
  //         };

  //         let successResolved = false;

  //         result.events.forEach((eventRecord) => {
  //           if (
  //             assetHubApi.events.system.ExtrinsicFailed.is(eventRecord.event)
  //           ) {
  //             successResolved = true;
  //             throw new Error(
  //               eventRecord.event.data.toHuman(true)?.dispatchError,
  //             );
  //           }

  //           if (assetHubApi.events.polkadotXcm.Sent.is(eventRecord.event)) {
  //             successResolved = true;
  //             resolve({
  //               ...finalizedData,
  //               success: true,
  //               messageId: eventRecord.event.data.toPrimitive()[3],
  //             });
  //           }
  //         });

  //         if (!successResolved) {
  //           resolve({
  //             ...finalizedData,
  //             success: false,
  //           });
  //         }
  //       }
  //     });
  //   } catch (error) {
  //     reject(error);
  //   }
  // });
  // const messageId = transactionResult.messageId || "";
  // return {
  //   id: messageId,
  //   status: history.TransferStatus.Pending,
  //   info: {
  //     amount: amountInSmallestUnit.toString(),
  //     sourceAddress: data.sourceAccount,
  //     beneficiaryAddress: data.beneficiary,
  //     tokenAddress: data.token,
  //     when: new Date(),
  //   },
  //   submitted: {
  //     block_hash:
  //       transactionResult.success?.sourceParachain?.blockHash ??
  //       transactionResult.success?.assetHub.blockHash ??
  //       "",
  //     block_num:
  //       transactionResult.success?.sourceParachain?.blockNumber ??
  //       transactionResult.success?.assetHub.blockNumber ??
  //       0,
  //     block_timestamp: 0,
  //     messageId: messageId,
  //     account_id: data.source,
  //     bridgeHubMessageId: "",
  //     extrinsic_hash:
  //       transactionResult.success?.sourceParachain?.txHash ??
  //       transactionResult.success?.assetHub.txHash ??
  //       "",
  //     extrinsic_index:
  //       transactionResult.success?.sourceParachain !== undefined
  //         ? transactionResult.success.sourceParachain.blockNumber.toString() +
  //           "-" +
  //           transactionResult.success.sourceParachain.txIndex.toString()
  //         : transactionResult.success?.assetHub !== undefined
  //           ? transactionResult.success?.assetHub?.blockNumber.toString() +
  //             "-" +
  //             transactionResult.success?.assetHub.txIndex.toString()
  //           : "unknown",

  //     relayChain: {
  //       block_hash: transactionResult.success?.relayChain.submittedAtHash ?? "",
  //       block_num: 0,
  //     },
  //     success: true,
  //   },
  // };
}
