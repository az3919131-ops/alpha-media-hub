import type { Config } from "@netlify/functions";
import { distribute, fetchChannelVideos, loadConfig, loadSeen, saveSeen } from "../lib/core.mts";

// Every 10 minutes: look for new videos on the YouTube channel and
// push them to every enabled platform marked "auto".
export default async () => {
  const cfg = await loadConfig();
  const { videos } = await fetchChannelVideos(cfg);
  const seen = await loadSeen();

  // First run: remember what's already on the channel, publish nothing.
  if (seen === null) {
    await saveSeen(videos.map((v) => v.id));
    console.log(`watcher initialised with ${videos.length} existing videos`);
    return;
  }

  const fresh = videos.filter((v) => !seen.includes(v.id)).reverse(); // oldest first
  if (fresh.length === 0) return;
  await saveSeen([...fresh.map((v) => v.id), ...seen]);

  if (!cfg.autoPublish) {
    console.log(`${fresh.length} new video(s), auto-publish is off`);
    return;
  }
  const targets = cfg.platforms.filter((p) => p.enabled && p.auto).map((p) => p.id);
  for (const v of fresh) {
    const entry = await distribute(cfg, v, targets, "auto");
    console.log(`auto-published ${v.id}:`, entry.results.map((r) => `${r.platformId}=${r.status}`).join(" "));
  }
};

export const config: Config = { schedule: "*/10 * * * *" };
