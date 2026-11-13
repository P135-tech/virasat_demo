import type { LoaderFunctionArgs } from "react-router";
import { refreshAllStores } from "../lib/reels.server";

/**
 * Optional: a free scheduler (e.g. cron-job.org) can open
 * https://<app>/cron/sync?key=<CRON_SECRET> every 2 hours. This renews every store's Instagram video links
 * (and keeps a sleeping free server awake). Off unless CRON_SECRET is set.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const key = new URL(request.url).searchParams.get("key");
  if (!secret || key !== secret) return new Response("Not found", { status: 404 });
  void refreshAllStores();
  return new Response("ok");
};
