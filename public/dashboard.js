// Alpha Media Hub — dashboard
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => !d || isNaN(new Date(d)) ? "Short" : new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));

const KIND_LABEL = { facebook: "فيسبوك", instagram: "إنستاجرام", tiktok: "تيك توك", linkedin: "لينكد إن", x: "X", youtube: "يوتيوب", custom: "منصة أخرى" };
const ROUTES = [["zapier", "Zapier"], ["n8n", "n8n"], ["make", "Make"], ["webhook", "Webhook / API"]];

const state = { key: "", cfg: null, videos: [], log: [], file: null, mode: "file", pubVideo: null };

/* ---------- storage (per device) ---------- */
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", "x-admin-key": state.key, ...(opts.headers || {}) },
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { signOut(); throw new Error(data.error || "انتهت الجلسة."); }
  if (!res.ok) throw new Error(data.error || `خطأ ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3800);
}

/* ---------- Auth ---------- */
async function signIn(key) {
  state.key = key;
  await api("/api/login", { method: "POST" });
  store.set("amh_key", key);
  $("#gate").hidden = true;
  $("#app").hidden = false;
  await boot();
}
function signOut() {
  store.set("amh_key", "");
  state.key = "";
  $("#app").hidden = true;
  $("#gate").hidden = false;
}
$("#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#gateError").textContent = "";
  try { await signIn($("#gateKey").value.trim()); }
  catch (err) { $("#gateError").textContent = err.message; }
});
$("#logout").addEventListener("click", signOut);

/* ---------- Navigation ---------- */
function show(view) {
  $$(".side-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
  if (view === "log") loadLog();
  store.set("amh_view", view);
  window.scrollTo({ top: 0 });
}
$$(".side-nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

/* ---------- Boot ---------- */
async function boot() {
  state.cfg = await api("/api/settings");
  renderSettings();
  renderMatrix();
  renderTargets();
  renderGuide();
  show(store.get("amh_view") || "videos");
  await Promise.all([loadVideos(), loadLog()]);
}

/* ---------- Videos ---------- */
function statusFor(videoId) {
  const entries = state.log.filter((e) => e.video.id === videoId);
  if (!entries.length) return `<span class="badge">لم يُنشر بعد</span>`;
  const ok = new Set(entries.flatMap((e) => e.results.filter((r) => r.ok).map((r) => r.platformId)));
  const fail = entries[0].results.filter((r) => !r.ok).length;
  return `<span class="badge ok">أُرسل إلى ${ok.size} منصة</span>${fail ? `<span class="badge fail">${fail} فشل</span>` : ""}`;
}

function renderVideos() {
  const box = $("#videoRows");
  if (!state.videos.length) {
    box.innerHTML = `<div class="empty"><strong>لا توجد فيديوهات بعد</strong>ارفع أول فيديو من قسم «رفع فيديو»، أو تأكد من معرّف القناة في الإعدادات.</div>`;
    return;
  }
  const dayAgo = Date.now() - 86400000;
  box.innerHTML = state.videos.map((v, i) => `
    <article class="vrow">
      <img src="${esc(v.thumbnail)}" alt="" loading="lazy" />
      <div>
        <h3><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a></h3>
        <div class="vmeta">
          ${v.publishedAt && new Date(v.publishedAt).getTime() > dayAgo ? `<span class="badge new">جديد</span>` : ""}
          <span>${fmtDate(v.publishedAt)}</span>
          ${v.views != null ? `<span>${Number(v.views).toLocaleString("ar-EG")} مشاهدة</span>` : ""}
          ${statusFor(v.id)}
        </div>
      </div>
      <div class="vrow-actions">
        <button class="btn btn-tally btn-sm" data-pub="${i}" type="button">انشر على المنصات</button>
      </div>
    </article>`).join("");
  $$("[data-pub]", box).forEach((b) => b.addEventListener("click", () => openPublish(state.videos[+b.dataset.pub])));
}

async function loadVideos() {
  $("#videoRows").innerHTML = `<div class="skeleton" style="aspect-ratio:auto;height:110px"></div>`.repeat(3);
  const status = $("#sideStatus");
  try {
    const res = await fetch("/api/videos", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    state.videos = d.videos;
    $("#channelLine").textContent = `${d.channelTitle || "Alpha Media"} — ${d.handle} · آخر ${d.videos.length} فيديو من يوتيوب`;
    status.classList.remove("off");
    status.innerHTML = `<span class="tally"></span><span>القناة متصلة · ${state.cfg.autoPublish ? "النشر التلقائي يعمل" : "النشر التلقائي متوقف"}</span>`;
  } catch (e) {
    state.videos = [];
    $("#channelLine").textContent = `تعذر جلب الفيديوهات: ${e.message || "تحقق من معرّف القناة"}`;
    status.classList.add("off");
    status.innerHTML = `<span class="tally"></span><span>القناة غير متصلة</span>`;
  }
  renderVideos();
}
$("#refreshVideos").addEventListener("click", loadVideos);

$("#watchNow").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await api("/api/watch-now", { method: "POST" });
    if (r.initialised) toast(`بدأت المراقبة. سُجّل ${r.existing} فيديو موجود، وسيُنشر أي فيديو جديد بعد الآن.`);
    else if (!r.newVideos) toast("لا توجد فيديوهات جديدة على القناة.");
    else toast(`تم العثور على ${r.newVideos} فيديو جديد ونُشر ${r.published.length}.`);
    await loadLog();
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ---------- Publish dialog ---------- */
const checkList = (name, filter = () => true) =>
  state.cfg.platforms.filter((p) => p.enabled && filter(p)).map((p) => `
    <label><input type="checkbox" name="${name}" value="${esc(p.id)}" checked /> ${esc(p.name)}</label>`).join("")
  || `<span class="hint">لا توجد منصات مفعّلة. فعّلها من قسم «المنصات».</span>`;

function applyCaption(v) {
  return state.cfg.captionTemplate.replaceAll("{title}", v.title).replaceAll("{url}", v.url).replaceAll("{description}", v.description || "");
}

function openPublish(v) {
  state.pubVideo = v;
  $("#pubVideo").innerHTML = `<img src="${esc(v.thumbnail)}" alt="" /><strong>${esc(v.title)}</strong>`;
  $("#pubTargets").innerHTML = checkList("pub");
  $("#pubCaption").value = applyCaption(v);
  $("#pubError").textContent = "";
  $("#publishDialog").showModal();
}

$("#pubGo").addEventListener("click", async (e) => {
  e.preventDefault();
  const ids = $$('input[name="pub"]:checked').map((i) => i.value);
  if (!ids.length) { $("#pubError").textContent = "اختر منصة واحدة على الأقل."; return; }
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "جارٍ النشر…";
  try {
    const entry = await api("/api/publish", { method: "POST", body: JSON.stringify({ video: state.pubVideo, platformIds: ids, caption: $("#pubCaption").value }) });
    const ok = entry.results.filter((r) => r.ok).length;
    $("#publishDialog").close();
    toast(ok === entry.results.length ? `نُشر على ${ok} منصة.` : `نُشر على ${ok} من ${entry.results.length}. راجع سجل النشر.`);
    await loadLog();
  } catch (err) { $("#pubError").textContent = err.message; }
  btn.disabled = false;
  btn.textContent = "انشر الآن";
});

/* ---------- Log ---------- */
async function loadLog() {
  try {
    const d = await api("/api/log");
    state.log = d.log;
    $("#logLine").textContent = d.watching
      ? `المراقبة التلقائية تعمل · ${d.seenCount} فيديو مسجّل · آخر 200 عملية`
      : "المراقبة لم تبدأ بعد. اضغط «افحص القناة وانشر الجديد» في صفحة الفيديوهات لتشغيلها.";
  } catch { state.log = []; }
  renderLog();
  renderVideos();
}
function renderLog() {
  const box = $("#logRows");
  if (!state.log.length) {
    box.innerHTML = `<div class="empty"><strong>لا توجد عمليات نشر بعد</strong>انشر أي فيديو من صفحة الفيديوهات وسيظهر هنا مع نتيجة كل منصة.</div>`;
    return;
  }
  const trig = { auto: "تلقائي", manual: "يدوي", upload: "رفع جديد" };
  box.innerHTML = state.log.map((e) => `
    <article class="lrow">
      ${e.video.thumbnail ? `<img src="${esc(e.video.thumbnail)}" alt="" loading="lazy" />` : `<div></div>`}
      <div>
        <h3><a href="${esc(e.video.url)}" target="_blank" rel="noopener">${esc(e.video.title)}</a></h3>
        <div class="when">${fmtDate(e.at)} · ${trig[e.trigger] || e.trigger}</div>
        <div class="results">${e.results.map((r) => `<span class="badge ${r.ok ? "ok" : "fail"}" title="${esc(r.error || `HTTP ${r.status}`)}">${esc(r.platform)}${r.ok ? "" : ` — ${esc(r.error || r.status)}`}</span>`).join("") || `<span class="badge">لم تُحدد منصات</span>`}</div>
      </div>
    </article>`).join("");
}
$("#refreshLog").addEventListener("click", loadLog);

/* ---------- Platforms matrix ---------- */
function renderMatrix() {
  $("#masterWebhook").value = state.cfg.masterWebhook || "";
  $("#matrix").innerHTML = state.cfg.platforms.map((p, i) => `
    <div class="prow ${p.enabled ? "on" : ""}" data-i="${i}">
      <span class="led" aria-hidden="true"></span>
      <label class="field"><span>اسم المنصة</span><input data-k="name" value="${esc(p.name)}" /></label>
      <label class="field"><span>طريقة الربط</span>
        <select data-k="route">${ROUTES.map(([v, l]) => `<option value="${v}" ${p.route === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field"><span>رابط Webhook ${p.webhookUrl ? "" : "(يستخدم الرئيسي)"}</span><input type="url" data-k="webhookUrl" value="${esc(p.webhookUrl)}" placeholder="https://…" /></label>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-test="${i}" type="button">اختبار</button>
        <button class="btn btn-ghost btn-sm" data-del="${i}" type="button" aria-label="حذف ${esc(p.name)}">حذف</button>
      </div>
      <div class="more">
        <label class="field"><span>رابط الصفحة (للمرجع وللاستخدام داخل Zapier)</span><input type="url" data-k="pageUrl" value="${esc(p.pageUrl)}" placeholder="https://…" /></label>
        <label class="field"><span>توكن / مفتاح API (اختياري)</span><input type="password" data-k="token" value="${esc(p.token || "")}" autocomplete="off" dir="ltr" /></label>
      </div>
      <div class="toggles" style="grid-column: 2 / -1">
        <label class="switch"><input type="checkbox" data-k="enabled" ${p.enabled ? "checked" : ""} /> <span>مفعّلة</span></label>
        <label class="switch"><input type="checkbox" data-k="auto" ${p.auto ? "checked" : ""} /> <span>تستلم الفيديوهات الجديدة تلقائيًا</span></label>
        <span class="hint" style="margin:0">النوع: ${KIND_LABEL[p.kind] || p.kind} · <code>${esc(p.id)}</code></span>
      </div>
    </div>`).join("");

  $$("#matrix .prow").forEach((row) => {
    const p = state.cfg.platforms[+row.dataset.i];
    $$("[data-k]", row).forEach((inp) => inp.addEventListener("input", () => {
      p[inp.dataset.k] = inp.type === "checkbox" ? inp.checked : inp.value;
      if (inp.dataset.k === "enabled") row.classList.toggle("on", inp.checked);
    }));
  });
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const p = state.cfg.platforms[+b.dataset.del];
    if (!confirm(`حذف «${p.name}»؟ يجب الحفظ بعدها.`)) return;
    state.cfg.platforms.splice(+b.dataset.del, 1);
    renderMatrix();
  }));
  $$("[data-test]").forEach((b) => b.addEventListener("click", () => testPlatform(state.cfg.platforms[+b.dataset.test])));
}

$("#masterWebhook").addEventListener("input", (e) => (state.cfg.masterWebhook = e.target.value));

$$("[data-add]").forEach((b) => b.addEventListener("click", () => {
  const kind = b.dataset.add;
  let n = 1, id = kind;
  while (state.cfg.platforms.some((p) => p.id === id)) id = `${kind}-${++n}`;
  state.cfg.platforms.push({ id, name: kind === "custom" ? "منصة جديدة" : `${KIND_LABEL[kind]}${n > 1 ? ` ${n}` : ""}`, kind, route: kind === "custom" ? "webhook" : "zapier", webhookUrl: "", pageUrl: "", enabled: true, auto: true });
  renderMatrix();
  $("#matrix .prow:last-child input").focus();
}));

async function savePlatforms() {
  const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify({ platforms: state.cfg.platforms, masterWebhook: state.cfg.masterWebhook }) });
  state.cfg = saved;
  renderMatrix();
  renderTargets();
}
$("#savePlatforms").addEventListener("click", async () => {
  try { await savePlatforms(); toast("تم حفظ المنصات."); } catch (e) { toast(e.message); }
});

async function testPlatform(p) {
  try {
    await savePlatforms();
    const v = state.videos[0] || { id: "test", title: "اختبار من Alpha Media Hub", url: "https://youtube.com/@alphamedia-010", thumbnail: "", description: "رسالة اختبار" };
    const entry = await api("/api/publish", { method: "POST", body: JSON.stringify({ video: { ...v, id: `test-${Date.now()}`, title: `[اختبار] ${v.title}` }, platformIds: [p.id] }) });
    const r = entry.results[0];
    toast(r?.ok ? `وصل الاختبار إلى «${p.name}» (HTTP ${r.status}).` : `فشل الاختبار: ${r?.error || "المنصة غير مفعّلة"}`);
  } catch (e) { toast(e.message); }
}

/* ---------- Settings ---------- */
function renderSettings() {
  const c = state.cfg;
  $("#sHandle").value = c.channel.handle;
  $("#sChannelId").value = c.channel.channelId;
  $("#sAuto").checked = c.autoPublish;
  $("#sCaption").value = c.captionTemplate;
  $("#sGoogle").value = c.googleClientId;
  $("#googleNotice").hidden = !!c.googleClientId;
}
$("#saveSettings").addEventListener("click", async () => {
  try {
    state.cfg = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        channel: { handle: $("#sHandle").value, channelId: $("#sChannelId").value },
        autoPublish: $("#sAuto").checked,
        captionTemplate: $("#sCaption").value,
        googleClientId: $("#sGoogle").value,
      }),
    });
    renderSettings();
    toast("تم حفظ الإعدادات.");
    loadVideos();
  } catch (e) { toast(e.message); }
});

/* ---------- Guide ---------- */
function renderGuide() {
  $("#originHint").textContent = location.origin;
  $("#samplePayload").textContent = JSON.stringify({
    event: "video.publish",
    trigger: "auto",
    platform_kind: "facebook",
    page_url: "https://facebook.com/AlphaMedia",
    video_id: "abc123XYZ00",
    video_title: "عنوان الفيديو",
    video_url: "https://www.youtube.com/watch?v=abc123XYZ00",
    video_thumbnail: "https://i.ytimg.com/vi/abc123XYZ00/hqdefault.jpg",
    caption: "عنوان الفيديو\n\n▶️ شاهد الفيديو كاملًا: https://www.youtube.com/watch?v=abc123XYZ00",
    platform: { id: "facebook", name: "Facebook — Alpha Media", kind: "facebook", route: "zapier" },
  }, null, 2);
}

/* ---------- Upload ---------- */
function renderTargets() {
  $("#upTargets").innerHTML = checkList("up");
}

$$(".seg button").forEach((b) => b.addEventListener("click", () => {
  state.mode = b.dataset.mode;
  $$(".seg button").forEach((x) => x.setAttribute("aria-selected", x === b));
  $$(".mode-file").forEach((el) => (el.hidden = state.mode !== "file"));
  $$(".mode-link").forEach((el) => (el.hidden = state.mode !== "link"));
  $("#upSubmit").textContent = state.mode === "file" ? "ارفع وانشر" : "انشر الرابط";
}));

const drop = $("#drop");
function pickFile(f) {
  if (!f) return;
  if (!f.type.startsWith("video/")) { $("#upError").textContent = "الملف المختار ليس فيديو."; return; }
  state.file = f;
  $("#dropTitle").textContent = f.name;
  $("#dropMeta").textContent = `${(f.size / 1048576).toFixed(1)} ميجابايت`;
  if (!$("#upTitle").value) $("#upTitle").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  $("#upError").textContent = "";
}
$("#fileInput").addEventListener("change", (e) => pickFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => pickFile(e.dataTransfer.files[0]));

function setProgress(pct, label) {
  const p = $("#upProgress");
  p.hidden = false;
  $("div", p).style.width = `${pct}%`;
  $("span", p).textContent = label;
}

function googleToken() {
  return new Promise((resolve, reject) => {
    if (!state.cfg.googleClientId) return reject(new Error("أضف Google OAuth Client ID من الإعدادات أولًا."));
    if (!window.google?.accounts?.oauth2) return reject(new Error("لم تُحمّل مكتبة Google بعد. حدّث الصفحة وحاول مرة أخرى."));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: state.cfg.googleClientId,
      scope: "https://www.googleapis.com/auth/youtube.upload",
      callback: (r) => (r.error ? reject(new Error(`رفض Google الإذن: ${r.error}`)) : resolve(r.access_token)),
      error_callback: (e) => reject(new Error(e.message || "أُغلقت نافذة تسجيل الدخول.")),
    });
    client.requestAccessToken();
  });
}

async function uploadToYouTube(file, meta) {
  const token = await googleToken();
  setProgress(0, "جارٍ تجهيز الرفع…");
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": file.type,
      "x-upload-content-length": String(file.size),
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: "22" },
      status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) {
    const err = await init.json().catch(() => ({}));
    throw new Error(err.error?.message || `رفض يوتيوب الطلب (${init.status}).`);
  }
  const location = init.headers.get("location");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", location);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100), `جارٍ الرفع إلى يوتيوب… ${Math.round((e.loaded / e.total) * 100)}%`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`فشل الرفع (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع."));
    xhr.send(file);
  });
}

$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#upError");
  err.textContent = "";
  const title = $("#upTitle").value.trim();
  const description = $("#upDesc").value.trim();
  const targets = $$('input[name="up"]:checked').map((i) => i.value);
  const btn = $("#upSubmit");
  btn.disabled = true;

  try {
    let video;
    if (state.mode === "file") {
      if (!state.file) throw new Error("اختر ملف فيديو أولًا.");
      const tags = $("#upTags").value.split(",").map((t) => t.trim()).filter(Boolean);
      const privacy = $("#upPrivacy").value;
      const yt = await uploadToYouTube(state.file, { title, description, tags, privacy });
      setProgress(100, "تم الرفع إلى يوتيوب");
      video = { id: yt.id, title, description, url: `https://www.youtube.com/watch?v=${yt.id}`, thumbnail: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`, source: "upload" };
      if (privacy === "private" && targets.length) {
        toast("الفيديو خاص على يوتيوب، لذلك لن يُرسل إلى المنصات.");
        targets.length = 0;
      }
    } else {
      const url = $("#linkUrl").value.trim();
      if (!/^https?:\/\//.test(url)) throw new Error("أدخل رابط فيديو صحيح يبدأ بـ https://");
      const yt = url.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/);
      video = { id: yt ? yt[1] : undefined, title, description, url, thumbnail: yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : "", source: "link" };
    }

    if (targets.length) {
      const entry = await api("/api/publish", { method: "POST", body: JSON.stringify({ video, platformIds: targets, trigger: "upload" }) });
      const ok = entry.results.filter((r) => r.ok).length;
      toast(`${state.mode === "file" ? "رُفع على يوتيوب و" : ""}أُرسل إلى ${ok} من ${entry.results.length} منصة.`);
    } else {
      toast(state.mode === "file" ? "رُفع الفيديو على يوتيوب." : "لم تُحدد منصات للنشر.");
    }
    e.target.reset();
    state.file = null;
    $("#dropTitle").textContent = "اسحب الفيديو هنا أو اضغط للاختيار";
    $("#dropMeta").textContent = "MP4 أو MOV — يُرفع مباشرة من متصفحك إلى يوتيوب";
    renderTargets();
    loadLog();
    setTimeout(loadVideos, 4000);
  } catch (ex) {
    err.textContent = ex.message;
  }
  btn.disabled = false;
});

/* ---------- Start ---------- */
const saved = store.get("amh_key");
if (saved) signIn(saved).catch(() => signOut());
else signOut();
