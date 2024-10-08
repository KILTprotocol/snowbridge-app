// // SourceDestinationSelector.tsx
// import { FC, useEffect, useMemo } from "react";
// import {
//   Select,
//   SelectContent,
//   SelectGroup,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "./ui/select";
// import {
//   FormControl,
//   FormField,
//   FormItem,
//   FormLabel,
//   FormMessage,
// } from "./ui/form";
// import { UseFormReturn } from "react-hook-form";
// import { z } from "zod";
// import { environment } from "@snowbridge/api";
// import { formSchemaSwitch } from "@/utils/formSchema";
// import { snowbridgeContextAtom } from "@/store/snowbridge";
// import { parachainConfigs } from "@/utils/parachainConfigs";
// import { useAtomValue } from "jotai";

// interface Props {
//   form: UseFormReturn<z.infer<typeof formSchemaSwitch>>;
//   filteredLocations: environment.TransferLocation[];
//   source: environment.TransferLocation;
//   setFeeDisplay: (value: string) => void;
//   setTokenSymbol: (value: string) => void;
// }

// export const LocationSelector: FC<Props> = ({
//   form,
//   filteredLocations,
//   setFeeDisplay,
//   setTokenSymbol,
// }) => {
//   const context = useAtomValue(snowbridgeContextAtom);

//   // const newDestinationId = useMemo(() => {
//   //   return filteredLocations.find((x) => x !== "ethereum");
//   // }, [source.destinationIds]);
//   // const selectedDestination = useMemo(() => {
//   //   return filteredLocations.find((v) => v.id === newDestinationId);
//   // }, [filteredLocations, newDestinationId]);

//   // useEffect(() => {
//   //   if (!context || !source || source.destinationIds.length === 0) return;

//   //   const currentDestination = form.getValues("destination");

//   //   if (currentDestination?.id !== newDestinationId && selectedDestination) {
//   //     form.setValue("destination", selectedDestination);

//   //     const newToken =
//   //       selectedDestination.erc20tokensReceivable[0]?.address || "";
//   //     if (form.getValues("token") !== newToken) {
//   //       form.setValue("token", newToken);
//   //       form.resetField("amount");
//   //       setFeeDisplay("");
//   //     }
//   //   }

//   //   if (source.id === "assethub" && selectedDestination?.id === "assethub") {
//   //     const nonAssetHubDestination = filteredLocations.find(
//   //       (v) => v.id !== "assethub",
//   //     );
//   //     if (nonAssetHubDestination) {
//   //       form.setValue("destination", nonAssetHubDestination);
//   //     }
//   //   }

//   //   if (source.id === "assethub") {
//   //     const { nativeTokenMetadata } =
//   //       parachainConfigs[selectedDestination?.name || ""];
//   //     setTokenSymbol(nativeTokenMetadata.symbol);
//   //   }
//   // }, [
//   //   context,
//   //   filteredLocations,
//   //   form,
//   //   newDestinationId,
//   //   selectedDestination,
//   //   setFeeDisplay,
//   //   setTokenSymbol,
//   //   source,
//   // ]);

//   return (
//     // <div className="grid grid-cols-2 space-x-2">
//     //   <FormField
//     //     control={form.control}
//     //     name="source"
//     //     render={({ field }) => (
//     //       <FormItem {...field}>
//     //         <FormLabel>Source</FormLabel>
//     //         <FormControl>
//     //           <Select onValueChange={field.onChange} value={field.value.id}>
//     //             <SelectTrigger>
//     //               <SelectValue placeholder="Select a source" />
//     //             </SelectTrigger>
//     //             <SelectContent>
//     //               <SelectGroup>
//     //                 {filteredLocations
//     //                   .filter((s) => s.destinationIds.length > 0)
//     //                   .map((s) => (
//     //                     <SelectItem key={s.id} value={s.id}>
//     //                       {s.name}
//     //                     </SelectItem>
//     //                   ))}
//     //               </SelectGroup>
//     //             </SelectContent>
//     //           </Select>
//     //         </FormControl>
//     //         <FormMessage />
//     //       </FormItem>
//     //     )}
//     //   />
//     //   <FormField
//     //     control={form.control}
//     //     name="destination"
//     //     render={({ field }) => (
//     //       <FormItem>
//     //         <FormLabel>Destination</FormLabel>
//     //         <FormControl>
//     //           <Select onValueChange={field.onChange} value={field.value.id}>
//     //             <SelectTrigger>
//     //               <SelectValue placeholder="Select a destination" />
//     //             </SelectTrigger>
//     //             <SelectContent>
//     //               <SelectGroup>
//     //                 {source.destinationIds.map((destinationId) => {
//     //                   const availableDestination = filteredLocations.find(
//     //                     (v) => v.id === destinationId,
//     //                   );

//     //                   if (!availableDestination) {
//     //                     return null;
//     //                   }

//     //                   return (
//     //                     <SelectItem
//     //                       key={availableDestination.id}
//     //                       value={availableDestination.id}
//     //                     >
//     //                       {availableDestination.name}
//     //                     </SelectItem>
//     //                   );
//     //                 })}
//     //               </SelectGroup>
//     //             </SelectContent>
//     //           </Select>
//     //         </FormControl>
//     //         <FormMessage />
//     //       </FormItem>
//     //     )}
//     //   />
//     // </div>
//   );
// };
