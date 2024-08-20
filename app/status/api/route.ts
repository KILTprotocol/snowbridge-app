// Next.js serverless options
export const fetchCache = "default-no-store"; // Don't cache fetches unless asked.
export const dynamic = "force-dynamic"; // Always run dynamically
export const revalidate = 120; // Keep cache for 2 minutes
export const maxDuration = 90; // Timeout after

import {
  createContext,
  getBridgeStatus,
  getEnvironment,
  getErrorMessage,
} from "@/lib/snowbridge";
import { Context } from "@snowbridge/api";
import { AlchemyProvider } from "ethers";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

const CACHE_REVALIDATE_IN_SECONDS = 60; // 1 minutes

let context: Context | null = null;
async function getContext() {
  if (context) {
    return context;
  }
  const env = getEnvironment();

  // TODO: handle case of local chains!
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!alchemyKey) {
    throw Error("Missing Alchemy Key");
  }

  const ethereumProvider = new AlchemyProvider(env.ethChainId, alchemyKey);
  context = await createContext(ethereumProvider, env);
  return context;
}

const getCachedBridgeStatus = unstable_cache(
  async () => {
    const env = getEnvironment();
    try {
      const context = await getContext();
      const status = await getBridgeStatus(context, env);
      return status;
    } catch (err) {
      if (typeof reportError == "function") {
        reportError(err);
      } else {
        console.error(err);
      }
      return Promise.resolve(null);
    }
  },
  ["bridge-status"],
  {
    tags: ["status"],
    revalidate: CACHE_REVALIDATE_IN_SECONDS,
  },
);

export async function GET() {
  try {
    const status = await getCachedBridgeStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
