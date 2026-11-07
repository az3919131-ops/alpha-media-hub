import type { Config } from "@netlify/functions";
import { checkAdmin, json } from "../lib/core.mts";

export default async (req: Request) => checkAdmin(req) ?? json({ ok: true });

export const config: Config = { path: "/api/login", method: "POST" };
