// import { configDotenv } from "dotenv";

import {
  buildParachainConfig,
  RegisterOfParaConfigs,
} from "./buildParachainConfig";

export const parachainConfigs: RegisterOfParaConfigs = {};

export async function populateParachainConfigs() {
  // configDotenv();
  const paraNodes = process.env.PARACHAIN_ENDPOINTS?.split(";");
  const etherApiKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

  console.log("paraNodes: ", paraNodes);

  if (!paraNodes || !etherApiKey) {
    return;
  }

  for await (const endpoint of paraNodes) {
    const newConfig = await buildParachainConfig(endpoint, etherApiKey);

    if (!newConfig) {
      return;
    }
    if (newConfig.name in parachainConfigs) {
      // don't overwrite
    } else {
      parachainConfigs[newConfig.name] = newConfig;
    }
  }
}

populateParachainConfigs()
  .then(() =>
    console.log(
      "parachainConfigs: ",
      JSON.stringify(
        parachainConfigs,
        (_, v) => (typeof v === "bigint" ? v.toString() : v), // replacer of bigInts
        2,
      ),
    ),
  )
  .catch(console.error);
