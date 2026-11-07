import type { Config } from "@netlify/functions";
import { checkAdmin, json, loadConfig, saveConfig, type HubConfig, type Platform } from "../lib/core.mts";

const ROUTES = ["zapier", "n8n", "make", "webhook"];
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isUrl = (v: string) => v === "" || /^https:\/\/[^\s]+$/i.test(v);

function clean(input: Partial<HubConfig>, current: HubConfig): HubConfig | string {
  const platforms: Platform[] = Array.isArray(input.platforms)
    ? input.platforms.slice(0, 40).map((p, i) => ({
        id: str(p.id, 40).replace(/[^\w-]/g, "") || `p${i}`,
        name: str(p.name, 80) || "منصة",
        kind: str(p.kind, 30) || "custom",
        route: (ROUTES.includes(p.route) ? p.route : "webhook") as Platform["route"],
        webhookUrl: str(p.webhookUrl),
        pageUrl: str(p.pageUrl),
        enabled: !!p.enabled,
        auto: !!p.auto,
        token: str(p.token, 500) || undefined,
      }))
    : current.platforms;
  for (const p of platforms) if (!isUrl(p.webhookUrl)) return `رابط Webhook غير صالح للمنصة «${p.name}». يجب أن يبدأ بـ https://`;
  const masterWebhook = input.masterWebhook !== undefined ? str(input.masterWebhook) : current.masterWebhook;
  if (!isUrl(masterWebhook)) return "رابط Zapier الرئيسي يجب أن يبدأ بـ https://";

  const handle = input.channel?.handle !== undefined ? str(input.channel.handle, 100) : current.channel.handle;
  let channelId = input.channel?.channelId !== undefined ? str(input.channel.channelId, 40) : current.channel.channelId;
  if (handle !== current.channel.handle && !input.channel?.channelId) channelId = ""; // re-resolve
  if (channelId && !/^UC[\w-]{22}$/.test(channelId)) return "Channel ID يجب أن يبدأ بـ UC ويتكون من 24 حرفًا.";

  return {
    channel: { handle, channelId },
    autoPublish: input.autoPublish !== undefined ? !!input.autoPublish : current.autoPublish,
    captionTemplate: input.captionTemplate !== undefined ? str(input.captionTemplate, 2000) : current.captionTemplate,
    masterWebhook,
    googleClientId: input.googleClientId !== undefined ? str(input.googleClientId, 200) : current.googleClientId,
    platforms,
  };
}

export default async (req: Request) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const current = await loadConfig();
  if (req.method === "GET") return json(current);

  let body: Partial<HubConfig>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة." }, 400);
  }
  const next = clean(body, current);
  if (typeof next === "string") return json({ error: next }, 400);
  return json(await saveConfig(next));
};

export const config: Config = { path: "/api/settings", method: ["GET", "PUT"] };
