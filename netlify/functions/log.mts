import type { Config } from "@netlify/functions";
import { checkAdmin, json, loadLog, loadSeen } from "../lib/core.mts";

export default async (req: Request) => {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const [log, seen] = await Promise.all([loadLog(), loadSeen()]);
  return json({ log, watching: seen !== null, seenCount: seen?.length ?? 0 });
};

export const config: Config = { path: "/api/log", method: "GET" };
