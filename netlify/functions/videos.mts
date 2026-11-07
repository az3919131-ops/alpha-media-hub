import type { Config } from "@netlify/functions";
import { fetchChannelVideos, json, loadConfig } from "../lib/core.mts";

// Public: latest videos from the Alpha Media YouTube channel (RSS feed).
export default async () => {
  try {
    const cfg = await loadConfig();
    const data = await fetchChannelVideos(cfg);
    return new Response(JSON.stringify({ ...data, handle: cfg.channel.handle }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  } catch (e) {
    return json({ error: (e as Error).message, videos: [] }, 502);
  }
};

export const config: Config = { path: "/api/videos", method: "GET" };
