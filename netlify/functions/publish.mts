import type { Config } from "@netlify/functions";
import { checkAdmin, distribute, json, loadConfig, loadSeen, saveSeen, type Video } from "../lib/core.mts";

// Fan a video out to the selected platforms through their webhooks.
export default async (req: Request) => {
  const denied = checkAdmin(req);
  if (denied) return denied;

  let body: { video?: Partial<Video>; platformIds?: string[]; caption?: string; trigger?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة." }, 400);
  }
  const v = body.video ?? {};
  if (!v.url || !/^https?:\/\//.test(v.url)) return json({ error: "رابط الفيديو مطلوب." }, 400);
  if (!Array.isArray(body.platformIds) || body.platformIds.length === 0) return json({ error: "اختر منصة واحدة على الأقل." }, 400);

  const video: Video = {
    id: String(v.id ?? crypto.randomUUID()).slice(0, 64),
    title: String(v.title ?? "فيديو جديد من Alpha Media").slice(0, 300),
    url: v.url,
    thumbnail: String(v.thumbnail ?? ""),
    description: String(v.description ?? "").slice(0, 5000),
    publishedAt: String(v.publishedAt ?? new Date().toISOString()),
    source: v.source === "upload" || v.source === "link" ? v.source : "youtube",
  };

  // A video uploaded from the dashboard is published here; tell the
  // channel watcher it has been handled so it isn't sent out twice.
  if (video.source === "upload" && /^[\w-]{11}$/.test(video.id)) {
    const seen = await loadSeen();
    if (seen && !seen.includes(video.id)) await saveSeen([video.id, ...seen]);
  }

  const cfg = await loadConfig();
  const entry = await distribute(cfg, video, body.platformIds, body.trigger === "upload" ? "upload" : "manual", body.caption);
  return json(entry);
};

export const config: Config = { path: "/api/publish", method: "POST" };
