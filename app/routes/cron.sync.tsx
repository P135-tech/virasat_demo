import type { LoaderFunctionArgs } from "react-router";
import { syncAllStores } from "../lib/reels.server";

/**
 * Optional: a free scheduler (e.g. cron-job.org) can open
 * https://<app>/cron/sync?key=<CRON_SECRET> every few hours so new reels reach stores
 * even while nobody opens the app. Off unless CRON_SECRET is set in Render.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const key = new URL(request.url).searchParams.get("key");
  if (!secret || key !== secret) return new Response("Not found", { status: 404 });
  void syncAllStores();
  return new Response("ok");
};
