import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { getReel } from "../lib/instagram.server";

/**
 * Public address for reels played straight from Instagram (when Shopify Files won't take the video).
 * Instagram's own video addresses expire, so this looks up the current one and sends the browser there.
 * Only reels a store has chosen are served. ?poster=1 gives the preview image instead of the video.
 */
const cache = new Map<string, { video: string | null; poster: string | null; until: number }>();

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const shop = params.shop || "";
  const mediaId = params.mediaId || "";
  const wantPoster = new URL(request.url).searchParams.has("poster");
  const key = `${shop}/${mediaId}`;

  let hit = cache.get(key);
  if (!hit || hit.until < Date.now()) {
    const row = await db.selectedReel.findUnique({ where: { shop_mediaId: { shop, mediaId } } });
    if (!row) return new Response("Not found", { status: 404 });
    try {
      const r = await getReel(shop, mediaId);
      hit = { video: r.mediaUrl, poster: r.thumbnail, until: Date.now() + 40 * 60 * 1000 };
      cache.set(key, hit);
      if (!row.fileId) {
        await db.selectedReel.update({
          where: { id: row.id },
          data: { videoUrl: r.mediaUrl ?? row.videoUrl, posterUrl: r.thumbnail ?? row.posterUrl },
        });
      }
    } catch {
      return new Response("Not available", { status: 404 });
    }
  }

  const target = wantPoster ? hit.poster : hit.video;
  if (!target) return new Response("Not available", { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "public, max-age=1800", "Access-Control-Allow-Origin": "*" },
  });
};
