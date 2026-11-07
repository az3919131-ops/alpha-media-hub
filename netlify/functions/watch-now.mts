import type { Config } from "@netlify/functions";
import { checkAdmin, distribute, fetchChannelVideos, json, loadConfig, loadSeen, saveSeen } from "../lib/core.mts";

// Same as the scheduled watcher, but triggered from the dashboard button.
export default async (req: Request) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  try {
    const cfg = await loadConfig();
    const { videos } = await fetchChannelVideos(cfg);
    const seen = await loadSeen();
    if (seen === null) {
      await saveSeen(videos.map((v) => v.id));
      return json({ initialised: true, existing: videos.length, published: [] });
    }
    const fresh = videos.filter((v) => !seen.includes(v.id)).reverse();
    if (fresh.length) await saveSeen([...fresh.map((v) => v.id), ...seen]);
    const published = [];
    if (cfg.autoPublish) {
      const targets = cfg.platforms.filter((p) => p.enabled && p.auto).map((p) => p.id);
      for (const v of fresh) published.push(await distribute(cfg, v, targets, "auto"));
    }
    return json({ initialised: false, newVideos: fresh.length, published });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
};

export const config: Config = { path: "/api/watch-now", method: "POST" };
