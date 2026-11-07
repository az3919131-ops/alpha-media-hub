import { getStore } from "@netlify/blobs";

/* ---------- Types ---------- */

export type Route = "zapier" | "n8n" | "make" | "webhook";

export interface Platform {
  id: string;
  name: string;
  kind: string; // facebook | instagram | tiktok | linkedin | x | youtube | custom
  route: Route;
  webhookUrl: string; // empty = use masterWebhook
  pageUrl: string;
  enabled: boolean;
  auto: boolean; // receives new YouTube videos automatically
  token?: string; // optional bearer token sent as Authorization header
}

export interface HubConfig {
  channel: { handle: string; channelId: string };
  autoPublish: boolean;
  captionTemplate: string;
  masterWebhook: string;
  googleClientId: string;
  platforms: Platform[];
  updatedAt?: string;
}

export interface Video {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  description: string;
  publishedAt: string;
  views?: number;
  source: "youtube" | "upload" | "link";
}

export interface LogEntry {
  id: string;
  at: string;
  trigger: "manual" | "auto" | "upload";
  video: Pick<Video, "id" | "title" | "url" | "thumbnail">;
  results: { platformId: string; platform: string; ok: boolean; status: number; error?: string }[];
}

/* ---------- Defaults ---------- */

export const DEFAULT_CONFIG: HubConfig = {
  channel: { handle: "@alphamedia-010", channelId: "" },
  autoPublish: true,
  captionTemplate: "{title}\n\n▶️ شاهد الفيديو كاملًا: {url}\n\n#AlphaMedia #ألفا_ميديا",
  masterWebhook: "",
  googleClientId: "",
  platforms: [
    { id: "facebook", name: "Facebook — Alpha Media", kind: "facebook", route: "zapier", webhookUrl: "", pageUrl: "", enabled: true, auto: true },
    { id: "instagram", name: "Instagram", kind: "instagram", route: "zapier", webhookUrl: "", pageUrl: "", enabled: true, auto: true },
    { id: "tiktok", name: "TikTok", kind: "tiktok", route: "zapier", webhookUrl: "", pageUrl: "", enabled: true, auto: true },
    { id: "linkedin", name: "LinkedIn", kind: "linkedin", route: "zapier", webhookUrl: "", pageUrl: "", enabled: true, auto: true },
    { id: "x", name: "X (Twitter)", kind: "x", route: "zapier", webhookUrl: "", pageUrl: "", enabled: false, auto: false },
  ],
};

/* ---------- Storage ---------- */

const store = () => getStore({ name: "alpha-media-hub", consistency: "strong" });

export async function loadConfig(): Promise<HubConfig> {
  const saved = (await store().get("config", { type: "json" })) as HubConfig | null;
  if (!saved) return structuredClone(DEFAULT_CONFIG);
  return { ...structuredClone(DEFAULT_CONFIG), ...saved, channel: { ...DEFAULT_CONFIG.channel, ...saved.channel } };
}

export async function saveConfig(cfg: HubConfig) {
  cfg.updatedAt = new Date().toISOString();
  await store().setJSON("config", cfg);
  return cfg;
}

export async function loadLog(): Promise<LogEntry[]> {
  return ((await store().get("log", { type: "json" })) as LogEntry[] | null) ?? [];
}

export async function appendLog(entry: LogEntry) {
  const log = await loadLog();
  log.unshift(entry);
  await store().setJSON("log", log.slice(0, 200));
}

export async function loadSeen(): Promise<string[] | null> {
  return (await store().get("seen", { type: "json" })) as string[] | null;
}

export async function saveSeen(ids: string[]) {
  await store().setJSON("seen", ids.slice(0, 500));
}

/* ---------- Auth ---------- */

export function checkAdmin(req: Request): Response | null {
  const key = Netlify.env.get("ADMIN_KEY") || Netlify.env.get("ADMIN_PIN");
  if (!key) {
    return json({ error: "ADMIN_PIN (أو ADMIN_KEY) غير مضبوط في إعدادات Netlify. أضفه من Site configuration → Environment variables ثم أعد النشر." }, 503);
  }
  const sent = req.headers.get("x-admin-key") ?? "";
  if (sent !== key) return json({ error: "مفتاح الدخول غير صحيح." }, 401);
  return null;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/* ---------- YouTube ---------- */

const UA = "Mozilla/5.0 (compatible; AlphaMediaHub/1.0)";

export async function resolveChannelId(cfg: HubConfig): Promise<string> {
  if (cfg.channel.channelId) return cfg.channel.channelId;
  const handle = cfg.channel.handle.startsWith("@") ? cfg.channel.handle : `@${cfg.channel.handle}`;
  const res = await fetch(`https://www.youtube.com/${encodeURIComponent(handle)}`, {
    headers: { "user-agent": UA, "accept-language": "en", cookie: "CONSENT=YES+1" },
  });
  const html = await res.text();
  const m =
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error("تعذر التعرف على معرف القناة من الرابط. أدخل Channel ID يدويًا في الإعدادات.");
  cfg.channel.channelId = m[1];
  await saveConfig(cfg);
  return m[1];
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
};

export async function fetchChannelVideos(cfg: HubConfig): Promise<{ channelId: string; channelTitle: string; videos: Video[] }> {
  const channelId = await resolveChannelId(cfg);
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`YouTube feed returned ${res.status}`);
  const xml = await res.text();
  const head = xml.split("<entry>")[0];
  const channelTitle = tag(head, "title");
  const videos = xml
    .split("<entry>")
    .slice(1)
    .map((entry): Video => {
      const id = tag(entry, "yt:videoId");
      const thumb = entry.match(/<media:thumbnail url="([^"]+)"/);
      const views = entry.match(/<media:statistics views="(\d+)"/);
      return {
        id,
        title: tag(entry, "title"),
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail: thumb ? thumb[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        description: tag(entry, "media:description"),
        publishedAt: tag(entry, "published"),
        views: views ? Number(views[1]) : undefined,
        source: "youtube",
      };
    });
  return { channelId, channelTitle, videos };
}

/* ---------- Distribution ---------- */

export function caption(cfg: HubConfig, v: Pick<Video, "title" | "url" | "description">, custom?: string) {
  const tpl = custom && custom.trim() ? custom : cfg.captionTemplate;
  return tpl.replaceAll("{title}", v.title).replaceAll("{url}", v.url).replaceAll("{description}", v.description ?? "");
}

export async function distribute(
  cfg: HubConfig,
  video: Video,
  platformIds: string[],
  trigger: LogEntry["trigger"],
  customCaption?: string,
): Promise<LogEntry> {
  const targets = cfg.platforms.filter((p) => platformIds.includes(p.id) && p.enabled);
  const text = caption(cfg, video, customCaption);

  const results = await Promise.all(
    targets.map(async (p) => {
      const url = p.webhookUrl || cfg.masterWebhook;
      if (!url) return { platformId: p.id, platform: p.name, ok: false, status: 0, error: "لا يوجد رابط Webhook لهذه المنصة" };
      const payload = {
        event: "video.publish",
        trigger,
        sentAt: new Date().toISOString(),
        platform: { id: p.id, name: p.name, kind: p.kind, route: p.route, pageUrl: p.pageUrl },
        video: { ...video, caption: text },
        caption: text,
        // flat fields — easier to map inside Zapier / n8n / Make
        video_id: video.id,
        video_title: video.title,
        video_url: video.url,
        video_thumbnail: video.thumbnail,
        video_description: video.description,
        platform_kind: p.kind,
        page_url: p.pageUrl,
      };
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (p.token) headers.authorization = `Bearer ${p.token}`;
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
        return { platformId: p.id, platform: p.name, ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) };
      } catch (e) {
        return { platformId: p.id, platform: p.name, ok: false, status: 0, error: (e as Error).message };
      }
    }),
  );

  const entry: LogEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    trigger,
    video: { id: video.id, title: video.title, url: video.url, thumbnail: video.thumbnail },
    results,
  };
  await appendLog(entry);
  return entry;
}
