"use client";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import {
  submitAssetHubToParachainTransfer,
  submitParachainToAssetHubTransfer,
} from "@/utils/onSwitch";
import { polkadotAccountAtom, polkadotAccountsAtom } from "@/store/polkadot";
import {
  snowbridgeEnvironmentAtom,
  snowbridgeContextAtom,
} from "@/store/snowbridge";
import { useAtomValue } from "jotai";
import { formSchemaSwitch } from "@/utils/formSchema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { AccountInfo, ErrorInfo, FormDataSwitch } from "@/utils/types";
import { SelectedPolkadotAccount } from "./SelectedPolkadotAccount";
import { SelectAccount } from "./SelectAccount";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { BusyDialog } from "./BusyDialog";
import { SendErrorDialog } from "./SendErrorDialog";
import { SubmittableExtrinsic } from "@polkadot/api/types";
import { ISubmittableResult } from "@polkadot/types/types";
import PolkadotBalance from "./Balances";
import { parseUnits } from "ethers";
import { toast } from "sonner";
import { parachainConfigs } from "@/utils/parachainConfigs";

import { useRouter } from "next/navigation";
import { TopUpXcmFee } from "./TopUpXcmFee";
import { toPolkadot } from "@snowbridge/api";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { TransferLocation } from "@snowbridge/api/dist/environment";

export const SwitchComponent: FC = () => {
  const snowbridgeEnvironment = useAtomValue(snowbridgeEnvironmentAtom);
  const context = useAtomValue(snowbridgeContextAtom);
  const polkadotAccounts = useAtomValue(polkadotAccountsAtom);
  const polkadotAccount = useAtomValue(polkadotAccountAtom);
  const router = useRouter();
  const filteredLocations = useMemo(
    () =>
      snowbridgeEnvironment.locations
        .filter((x) => x.type !== "ethereum")
        .filter((x) => x.name !== "Muse"),
    [snowbridgeEnvironment],
  );
  const initialSource = useMemo(() => {
    return (
      filteredLocations.find((v) => v.id === "assethub") || filteredLocations[0]
    );
  }, [filteredLocations]);

  const initialDestination = useMemo(() => {
    return (
      filteredLocations.find((location) => {
        return parachainConfigs[location.id];
      }) || filteredLocations[0]
    );
  }, [filteredLocations]);
  const [source, setSource] = useState<TransferLocation>(initialSource);
  const [destination, setDestination] =
    useState<TransferLocation>(initialDestination);
  const [feeDisplay, setFeeDisplay] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [busyMessage, setBusyMessage] = useState("");
  const [sufficientTokenAvailable, setSufficientTokenAvailable] =
    useState(true);
  const [topUpCheck, setTopUpCheck] = useState({
    xcmFee: "",
    xcmBalance: "",
  });
  const [transaction, setTransaction] = useState<SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  > | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);

  const form: UseFormReturn<FormDataSwitch> = useForm<
    z.infer<typeof formSchemaSwitch>
  >({
    resolver: zodResolver(formSchemaSwitch),
    defaultValues: {
      sourceId: filteredLocations.find((v) => v.id === "assethub")!.id ?? "",
      destinationId: initialDestination.id ?? "",
      token: initialDestination?.erc20tokensReceivable[0].id,
      beneficiary: polkadotAccount?.address ?? "",
      sourceAccount: polkadotAccount?.address ?? "",
      amount: "0.0",
    },
  });

  const sourceId = form.watch("sourceId");
  const destinationId = form.watch("destinationId");
  const sourceAccount = form.watch("sourceAccount");
  const beneficiary = form.watch("beneficiary");
  const amount = form.watch("amount");
  const token = form.watch("token");

  // const newDestinationId = useMemo(() => {
  //   return filteredLocations.find((x) => x !== "ethereum");
  // }, [source.destinationIds]);
  // const selectedDestination = useMemo(() => {
  //   return filteredLocations.find((v) => v.id === newDestinationId);
  // }, [filteredLocations, newDestinationId]);

  // useEffect(() => {
  //   if (!context || !source || source.destinationIds.length === 0) return;

  //   const currentDestination = form.getValues("destinationId");

  //   if (currentDestination?.id !== newDestinationId && selectedDestination) {
  //     form.setValue("destinationId", selectedDestination);

  //     const newToken =
  //       selectedDestination.erc20tokensReceivable[0]?.address || "";
  //     if (form.getValues("token") !== newToken) {
  //       form.setValue("token", newToken);
  //       form.resetField("amount");
  //       setFeeDisplay("");
  //     }
  //   }

  //   if (source.id === "assethub" && selectedDestination?.id === "assethub") {
  //     const nonAssetHubDestination = filteredLocations.find(
  //       (v) => v.id !== "assethub",
  //     );
  //     if (nonAssetHubDestination) {
  //       form.setValue("destination", nonAssetHubDestination);
  //     }
  //   }

  //   if (source.id === "assethub") {
  //     const { nativeTokenMetadata } =
  //       parachainConfigs[selectedDestination?.name || ""];
  //     setTokenSymbol(nativeTokenMetadata.symbol);
  //   }
  // }, [
  //   context,
  //   filteredLocations,
  //   form,
  //   newDestinationId,
  //   selectedDestination,
  //   setFeeDisplay,
  //   setTokenSymbol,
  //   source,
  // ]);

  const beneficiaries: AccountInfo[] = useMemo(
    () =>
      polkadotAccounts?.map((x) => ({
        key: x.address,
        name: x.name || "",
        type: destination.type,
      })) || [],
    [polkadotAccounts, destination.type],
  );
  const amountInSmallestUnit = useMemo(() => {
    if (!amount) return null;
    return parseUnits(amount, source.paraInfo?.decimals);
  }, [amount, source.paraInfo?.decimals]);

  const handleTransaction = useCallback(async () => {
    if (
      !context ||
      !beneficiary ||
      !source ||
      !destination ||
      !sourceAccount ||
      !token
    ) {
      return;
    }

    if (!amountInSmallestUnit) {
      return;
    }
    const createTransaction = async (
      transaction: SubmittableExtrinsic<"promise", ISubmittableResult>,
      transactionFee: string,
    ) => {
      setTransaction(transaction);
      setFeeDisplay(transactionFee);
    };

    if (sourceId === "assethub") {
      if (destinationId === "assethub") {
        return;
      }
      await submitAssetHubToParachainTransfer({
        context,
        beneficiary,
        source,
        destination: destination,
        amount: amountInSmallestUnit,
        sourceAccount,
        setError,
        setBusyMessage,
        createTransaction,
      });
    } else {
      const { pallet } = parachainConfigs[source.name];

      submitParachainToAssetHubTransfer({
        context,
        beneficiary,
        source,
        amount: amountInSmallestUnit,
        pallet,
        sourceAccount,
        setError,
        setBusyMessage,
        createTransaction,
      });
    }
  }, [
    context,
    beneficiary,
    source,
    destination,
    sourceAccount,
    token,
    amountInSmallestUnit,
    sourceId,
    destinationId,
  ]);

  useEffect(() => {
    const timeout = setTimeout(handleTransaction, 1000);
    return () => clearTimeout(timeout);
  }, [handleTransaction]);

  const handleSufficientTokens = (result: boolean) => {
    setSufficientTokenAvailable(result);
  };
  const handleTopUpCheck = (xcmFee: string, xcmBalance: string) => {
    setTopUpCheck({ xcmFee, xcmBalance });
  };

  const onSubmit = useCallback(async () => {
    if (!transaction || !context) {
      return;
    }

    // to do: better error information for the user.
    try {
      if (destinationId === "assethub" && !sufficientTokenAvailable) {
        setError({
          title: "Insufficient Tokens.",
          description:
            "Your account on Asset Hub does not have the required tokens. Please ensure you meet the sufficient or existential deposit requirements.",
          errors: [
            {
              kind: "toPolkadot",
              code: toPolkadot.SendValidationCode.BeneficiaryAccountMissing,
              message:
                "To complete the transaction, your Asset Hub account must hold specific tokens. Without these, the account cannot be activated or used.",
            },
          ],
        });
        return;
      } else if (!sufficientTokenAvailable) {
        setError({
          title: "Insufficient Tokens.",
          description:
            "The beneficiary's account does not meet the sufficient or existential deposit requirements. Please ensure they have enough funds on the destination account to complete the transaction.",
          errors: [],
        });
        return;
      }

      const { signer, address } = polkadotAccounts?.find(
        (val) => val.address === sourceAccount,
      )!;
      if (!signer) {
        throw new Error("Signer is not available");
      }
      setBusyMessage("Waiting for transaction to be confirmed by wallet.");
      await transaction.signAndSend(address, { signer }, (result) => {
        setBusyMessage("Currently in flight");

        if (result.isFinalized) {
          setBusyMessage("");
          toast.info("Transfer Successful", {
            position: "bottom-center",
            closeButton: true,
            duration: 60000,
            id: "transfer_success",
            description: "Token transfer was succesfully initiated.",
            important: true,
            action: {
              label: "View",
              onClick: () =>
                router.push(
                  `https://spiritnet.subscan.io/extrinsic/${result.txHash}`,
                ),
            },
          });
        } else if (result.isError) {
          setBusyMessage("");
          toast.info("Transfer unsuccessful", {
            position: "bottom-center",
            closeButton: true,
            duration: 60000,
            id: "transfer_success",
            description: "Token transfer was unsuccesfully.",
            important: true,
            action: {
              label: "View",
              onClick: () =>
                router.push(
                  `https://spiritnet.subscan.io/extrinsic/${result.txHash}`,
                ),
            },
          });
        }
      });

      setBusyMessage("");
      form.reset();
    } catch (err) {
      setBusyMessage("");
      setError({
        title: "Transaction Failed",
        description: `Error occured while trying to send transaction.`,
        errors: [],
      });
      form.reset();
    }
  }, [
    transaction,
    context,
    destinationId,
    sufficientTokenAvailable,
    polkadotAccounts,
    form,
    sourceAccount,
    router,
  ]);

  return (
    <>
      <Card className="w-auto md:w-2/3">
        <CardHeader>
          <CardTitle>Switch</CardTitle>
          <CardDescription className="hidden md:flex">
            Switch Parachain tokens for ERC20 Parachain tokens via Asset Hub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(() => onSubmit())}
              className="space-y-2"
            >
              <div className="grid grid-cols-2 space-x-2">
                <FormField
                  control={form.control}
                  name="sourceId"
                  render={({ field }) => (
                    <FormItem {...field}>
                      <FormLabel>Source</FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {filteredLocations
                                .filter((s) => s.destinationIds.length > 0)
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="destinationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination</FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a destination" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {source.destinationIds.map((destinationId) => {
                                const availableDestination =
                                  filteredLocations.find(
                                    (v) => v.id === destinationId,
                                  );

                                if (!availableDestination) {
                                  return null;
                                }

                                return (
                                  <SelectItem
                                    key={availableDestination.id}
                                    value={availableDestination.id}
                                  >
                                    {availableDestination.name}
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="sourceAccount"
                render={({ field }) => (
                  <FormItem {...field}>
                    <FormLabel>Source Account</FormLabel>
                    <FormDescription className="hidden md:flex">
                      Account on the source.
                    </FormDescription>
                    <FormControl>
                      <>
                        <SelectedPolkadotAccount />
                        <PolkadotBalance
                          sourceAccount={sourceAccount}
                          source={source}
                          destination={destination}
                          beneficiary={beneficiary}
                          handleSufficientTokens={handleSufficientTokens}
                          handleTopUpCheck={handleTopUpCheck}
                        />
                      </>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {destination.name !== "assethub" ? (
                <>Beneficiary Account: {sourceAccount}</>
              ) : (
                <FormField
                  control={form.control}
                  name="beneficiary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Beneficiary</FormLabel>
                      <FormDescription className="hidden md:flex">
                        Receiver account on the destination.
                      </FormDescription>
                      <FormControl>
                        <SelectAccount
                          accounts={beneficiaries}
                          field={field}
                          allowManualInput={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <div className="flex space-x-2">
                <div className="w-2/3">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input type="string" placeholder="0.0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="w-1/3">
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <div className="flex h-10 w-full rounded-md bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                      {tokenSymbol}
                    </div>
                  </FormItem>
                </div>
              </div>
              <div className="text-sm text-right text-muted-foreground px-1">
                Transfer Fee: {feeDisplay}
              </div>
              <div className="text-sm text-right text-muted-foreground px-1">
                XCM Fee: {topUpCheck.xcmFee}
              </div>
              {topUpCheck.xcmFee <= topUpCheck.xcmBalance &&
              source.id !== "assethub" ? (
                <TopUpXcmFee
                  sourceAccount={sourceAccount}
                  source={source}
                  beneficiary={beneficiary}
                  destination={destination}
                  sufficientTokenAvailable={sufficientTokenAvailable}
                  polkadotAccounts={polkadotAccounts!}
                  xcmBalance={topUpCheck.xcmBalance}
                  formDataSwitch={form.getValues()}
                />
              ) : (
                <Button
                  disabled={!context || !token || !amount || !sourceAccount}
                  className="w-full my-8"
                  type="submit"
                >
                  Submit
                </Button>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
      <BusyDialog open={busyMessage !== ""} description={busyMessage} />
      <SendErrorDialog
        info={error}
        formDataSwitch={form.getValues()}
        destination={destination}
        dismiss={() => setError(null)}
      />
    </>
  );
};
