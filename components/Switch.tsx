"use client";

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { assets } from "@snowbridge/api";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { SelectedPolkadotAccount } from "./SelectedPolkadotAccount";
import { SelectAccount } from "./SelectAccount";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { BusyDialog } from "./BusyDialog";
import { SendErrorDialog } from "./SendErrorDialog";
import { SubmittableExtrinsic } from "@polkadot/api/types";
import { ISubmittableResult } from "@polkadot/types/types";

import PolkadotBalance from "./Balances";

export const SwitchComponent: FC = () => {
  const snowbridgeEnvironment = useAtomValue(snowbridgeEnvironmentAtom);
  const context = useAtomValue(snowbridgeContextAtom);
  const polkadotAccounts = useAtomValue(polkadotAccountsAtom);
  const polkadotAccount = useAtomValue(polkadotAccountAtom);
  const [tokenMetadata, setTokenMetadata] = useState<assets.NativeAsset>({
    tokenSymbol: "",
    tokenDecimal: 0,
    ss58Format: 42,
  });
  const [feeDisplay, setFeeDisplay] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [busyMessage, setBusyMessage] = useState("");
  const [transaction, setTransaction] = useState<SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  > | null>(null);
  const filteredLocations = useMemo(
    () =>
      snowbridgeEnvironment.locations
        .filter((x) => x.type !== "ethereum")
        .filter((x) => x.name !== "Muse"),
    [snowbridgeEnvironment],
  );

  const initialDestination = useMemo(
    () => filteredLocations.find((v) => v.id === "rilt"),
    [filteredLocations],
  );

  const form: UseFormReturn<FormDataSwitch> = useForm<
    z.infer<typeof formSchemaSwitch>
  >({
    resolver: zodResolver(formSchemaSwitch),
    defaultValues: {
      source: filteredLocations.find((v) => v.id === "assethub"),
      destination: initialDestination,
      token: initialDestination?.erc20tokensReceivable[0].id,
      beneficiary: polkadotAccount?.address ?? "",
      sourceAccount: polkadotAccount?.address ?? "",
      amount: "0.0",
    },
  });

  const source = form.watch("source");
  const destination = form.watch("destination");
  const sourceAccount = form.watch("sourceAccount");
  const beneficiary = form.watch("beneficiary");
  const amount = form.watch("amount");

  const beneficiaries: AccountInfo[] = useMemo(
    () =>
      polkadotAccounts?.map((x) => ({
        key: x.address,
        name: x.name || "",
        type: destination.type,
      })) || [],
    [polkadotAccounts, destination.type],
  );

  useEffect(() => {
    const fetchTokenMetadata = async () => {
      if (!context || !source) return;

      let api =
        source.id === "assethub"
          ? context.polkadot.api.assetHub
          : context.polkadot.api.parachains[source.paraInfo?.paraId];

      if (source.id !== "assethub") {
        const tokenAsset = await assets.parachainNativeAsset(api);
        setTokenMetadata(tokenAsset);
      }
    };

    fetchTokenMetadata();
  }, [context, source]);

  useEffect(() => {
    if (!source || source.destinationIds.length === 0) return;

    const newDestinationId = source.destinationIds.filter(
      (x) => x !== "ethereum",
    )[0];
    const selectedDestination = filteredLocations.find(
      (v) => v.id === newDestinationId,
    );
    const currentDestination = form.getValues("destination");

    if (currentDestination?.id !== newDestinationId && selectedDestination) {
      form.setValue("destination", selectedDestination);
      const newToken =
        selectedDestination.erc20tokensReceivable[0]?.address || "";
      if (form.getValues("token") !== newToken) {
        form.setValue("token", newToken);
      }
    }
  }, [source, filteredLocations, form]);

  const handleTransaction = useCallback(async () => {
    if (!context || !sourceAccount) {
      throw new Error("No context");
      return;
    }

    const { token } = form.getValues();
    const tokenMetadata = await assets.assetErc20Metadata(context, token);

    const sendTransaction = async (
      transaction: SubmittableExtrinsic<"promise", ISubmittableResult>,
    ) => {
      const fee = await transaction.paymentInfo(sourceAccount);
      setTransaction(transaction);
      setFeeDisplay(fee.partialFee.toHuman());
    };

    if (source.id === "assethub") {
      await submitAssetHubToParachainTransfer({
        context,
        beneficiary,
        source,
        destination,
        amount,
        tokenMetadata,
        setError,
        setBusyMessage,
        sendTransaction,
      });
    } else {
      submitParachainToAssetHubTransfer({
        context,
        beneficiary,
        source,
        amount,
        tokenMetadata,
        setError,
        setBusyMessage,
        sendTransaction,
      });
    }
  }, [context, sourceAccount, form, source, beneficiary, destination, amount]);

  useEffect(() => {
    handleTransaction();
  }, [handleTransaction]);

  const onSubmit = useCallback(async () => {
    if (!transaction) {
      return;
    }
    try {
      const { signer, address } = polkadotAccounts?.find(
        (val) => val.address === sourceAccount,
      )!;
      if (!signer) {
        throw new Error("Signer is not available");
      }
      setBusyMessage("Waiting for transaction to be confirmed by wallet.");
      await transaction.signAndSend(address, { signer });
      setBusyMessage("");
      form.reset();
    } catch (err) {
      setBusyMessage("");
      setError({
        title: "Transaction Failed",
        description: `Error occured while trying to send transaction.`,
        errors: [],
      });
    }
  }, [polkadotAccounts, sourceAccount, transaction, form]);

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
              onSubmit={form.handleSubmit((data) => onSubmit())}
              className="space-y-2"
            >
              <div className="grid grid-cols-2 space-x-2">
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source</FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={(value) => {
                            const selectedSource = filteredLocations.find(
                              (location) => location.id === value,
                            );
                            if (selectedSource) {
                              field.onChange(selectedSource);
                            }
                          }}
                          value={field.value.id}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {filteredLocations.map((location) => (
                                <SelectItem
                                  key={location.id}
                                  value={location.id}
                                >
                                  {location.name}
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
                  name="destination"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination</FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={(value) => {
                            const selectedDestination = filteredLocations.find(
                              (location) => location.id === value,
                            );
                            if (selectedDestination) {
                              field.onChange(selectedDestination);
                            }
                          }}
                          value={field.value.id}
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
                                  )!;

                                if (!availableDestination) {
                                  return;
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
                          tokenMetadata={tokenMetadata}
                        />
                      </>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                    <FormLabel>Amount</FormLabel>
                    <div className="flex h-10 w-full rounded-md bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                      {tokenMetadata.tokenSymbol}
                    </div>
                  </FormItem>
                </div>
              </div>
              <div className="text-sm text-right text-muted-foreground px-1">
                Transfer Fee: {feeDisplay}
              </div>
              <br />
              <Button
                // disabled={context === null || token === null}
                className="w-full my-8"
                type="submit"
              >
                Submit
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <BusyDialog open={busyMessage !== ""} description={busyMessage} />
      <SendErrorDialog
        info={error}
        formData={form.getValues()}
        destination={destination}
        dismiss={() => setError(null)}
      />
    </>
  );
};