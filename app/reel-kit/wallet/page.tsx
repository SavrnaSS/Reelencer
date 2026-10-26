import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/site";
import { parseDemoWallet } from "@/lib/reelKit";
import DemoWalletStudio from "./DemoWalletStudio";

export const metadata: Metadata = privatePageMetadata("Demo wallet");

// Request time, read once on the server so the demo payout dates match between the server render and hydration.
const requestTime = () => Date.now();

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DemoWalletStudio wallet={parseDemoWallet(await searchParams)} now={requestTime()} />;
}
