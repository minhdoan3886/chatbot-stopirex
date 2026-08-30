import { loadEnv } from "../src/config/env.js";

const env = loadEnv();
if (!env.metaPageId) throw new Error("META_PAGE_ID bắt buộc");
if (!env.metaPageAccessToken) throw new Error("META_PAGE_ACCESS_TOKEN bắt buộc");

const graphBase = `https://graph.facebook.com/${env.metaGraphVersion}`;
const profileUrl = new URL(`${graphBase}/me`);
profileUrl.searchParams.set("fields", "id,name");
profileUrl.searchParams.set("access_token", env.metaPageAccessToken);
const profileResponse = await fetch(profileUrl, {
  signal: AbortSignal.timeout(10_000),
});
const profile = (await profileResponse.json()) as {
  id?: string;
  name?: string;
  error?: { message?: string };
};
if (!profileResponse.ok || !profile.id) {
  throw new Error(profile.error?.message ?? "Không xác minh được Page Access Token");
}
if (profile.id !== env.metaPageId) {
  throw new Error(
    `Page Access Token thuộc Page ${profile.id}, không khớp META_PAGE_ID ${env.metaPageId}`,
  );
}

const subscribeUrl = new URL(`${graphBase}/${env.metaPageId}/subscribed_apps`);
subscribeUrl.searchParams.set(
  "subscribed_fields",
  "messages,messaging_postbacks,messaging_referrals,message_deliveries,message_reads,message_echoes",
);
subscribeUrl.searchParams.set("access_token", env.metaPageAccessToken);
const response = await fetch(subscribeUrl, {
  method: "POST",
  signal: AbortSignal.timeout(10_000),
});
const payload = (await response.json()) as {
  success?: boolean;
  error?: { message?: string };
};
if (!response.ok || payload.success !== true) {
  throw new Error(payload.error?.message ?? "Meta từ chối đăng ký webhook cho Page");
}
console.log(
  JSON.stringify({
    event: "meta_page_subscribed",
    activePage: env.metaActivePage,
    pageId: profile.id,
    pageName: profile.name ?? "unknown",
    fields: [
      "messages",
      "messaging_postbacks",
      "messaging_referrals",
      "message_deliveries",
      "message_reads",
      "message_echoes",
    ],
  }),
);
