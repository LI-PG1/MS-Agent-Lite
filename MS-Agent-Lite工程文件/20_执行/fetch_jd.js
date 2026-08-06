// fetch_jd.js — JD URL 读取（本地插件，小任务）
// 机制：Node 内置 fetch（Node ≥18），自定义 UA、15s 超时、失败重试 1 次
// 读取失败降级：返回 { ok:false, error:'信息读取失败' }，前端提示"请直接粘贴 JD 文本"
const DEFAULT_TIMEOUT = 15000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 基础 SSRF 防护（P2-3）：拒绝本机/内网/链路本地地址——本地工具只应读取公网用户提供的网址
function isBlockedHost(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h.startsWith("::ffff:")) {
    const v4 = h.startsWith("::ffff:") ? h.slice(7) : null;
    return v4 ? isBlockedHost(v4) : true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
    if (a === 0 || a === 127 || a >= 224) return true;   // 0.x / loopback / multicast / reserved
    if (a === 10) return true;                            // 10/8
    if (a === 169 && b === 254) return true;              // 169.254/16（含云 metadata）
    if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16/12
    if (a === 192 && b === 168) return true;              // 192.168/16
    return false;
  }
  return false; // 公网域名放行（最终跳转 IP 无法在纯 Node 层完全防御，见评估报告备注）
}

async function fetchOnce(url, timeout, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  // 合并外部取消信号（P1-3）：任务取消时立即中断本次抓取
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                 "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    // 非文本类型拒绝（P2-2）：只读网页文本，图片/压缩包/二进制一律判失败，避免把二进制当文本提取
    if (!ct.includes("text/") && !ct.includes("html") && !ct.includes("json")) {
      throw new Error("页面类型不是文本（Content-Type: " + (ct || "未知") + "）");
    }
    // 响应体大小上限（2MB）：防超大页面拖垮内存（P2-1）
    if (Number(res.headers.get("content-length") || 0) > 2 * 1024 * 1024) throw new Error("页面过大（>2MB）");
    // 响应体收集用 Buffer 数组，读取完成后统一解码：直接 raw += chunk 会在分块传输把多字节汉字切成两块时产生 U+FFFD 乱码（R5-乱码修复）
    const bufs = [];
    let total = 0;
    for await (const chunk of res.body || []) {
      bufs.push(chunk);
      total += chunk.length;
      if (total > 2 * 1024 * 1024) { ctrl.abort(); throw new Error("页面过大（>2MB），已中断读取"); }
    }
    const raw = Buffer.concat(bufs).toString("utf8");
    // 提取正文文本：优先按常见标记粗筛，去标签去空白
    let text = raw;
    if (ct.includes("html")) {
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#\d+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (!text || text.length < 20) throw new Error("页面无有效文本（网站可能限制程序读取）");
    return { ok: true, text, from: res.url || url };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// fetchJD(url, signal?) → Promise<{ ok, text?, error?, from? }>
async function fetchJD(url, signal) {
  let u;
  try { u = new URL(url); } catch (e) { return { ok: false, error: "URL 格式非法" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "仅支持 http/https 链接" };
  // SSRF 防护（P2-3）：拒绝本机/内网/链路本地地址（本地工具只读公网用户提供的网址）
  if (isBlockedHost(u.hostname)) return { ok: false, error: "该链接指向本机/内网地址，已拒绝读取（仅支持公网网址）" };
  if (signal && signal.aborted) return { ok: false, error: "已取消" };
  try {
    const r = await fetchOnce(u.href, DEFAULT_TIMEOUT, signal);
    return r;
  } catch (e) {
    if (signal && signal.aborted) return { ok: false, error: "已取消" };
    // 重试 1 次（网络抖动）
    try {
      return await fetchOnce(u.href, DEFAULT_TIMEOUT, signal);
    } catch (e2) {
      if (signal && signal.aborted) return { ok: false, error: "已取消" };
      const msg = e2 && e2.name === "AbortError" ? "读取超时（15s）" : (e2 && e2.message || String(e2));
      return { ok: false, error: "信息读取失败：网站可能限制程序读取或链接不可达（" + msg + "）。建议直接粘贴 JD 文本（更准确）。" };
    }
  }
}

module.exports = { fetchJD };
