const $ = (id) => document.getElementById(id);
let currentImageDataUrl = null;

const STORE_KEY = "canji_records_v1";
const MAX_RECORDS = 200;
const THUMB_MAX = 240;

/* ================= 小工具 ================= */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeStr(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = "日一二三四五六"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日 周${wd}`;
}
function dayLabel(dateStr) {
  const p = dateStr.split("-");
  return `${Number(p[1])}/${Number(p[2])}`;
}

/* ================= 本地存储 ================= */
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
function persist(arr) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(arr));
    return true;
  } catch (e) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(0, Math.max(1, Math.floor(arr.length / 2)))));
      return true;
    } catch (e2) {
      return false;
    }
  }
}
function addRecord(rec) {
  const arr = loadRecords();
  arr.unshift(rec);
  if (arr.length > MAX_RECORDS) arr.length = MAX_RECORDS;
  return persist(arr);
}
function sumTotals(recs) {
  const t = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  for (const r of recs) {
    for (const k in t) t[k] += Number(r.total && r.total[k] ? r.total[k] : 0);
  }
  for (const k in t) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}
function foodNames(r) {
  const names = (r.foods || []).map((f) => f.name).filter(Boolean);
  return names.length ? names.join("、") : "（未识别）";
}
function makeThumbnail(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

/* ================= Toast ================= */
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ================= 健康检查 ================= */
async function loadHealth() {
  const badge = $("modelBadge");
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    if (d.has_key) {
      badge.textContent = `当前模型：${d.provider}${d.model ? " · " + d.model : ""}`;
    } else {
      badge.textContent = `当前模型：${d.provider} · 未配置 API Key`;
      badge.classList.add("warn");
    }
  } catch (e) {
    badge.textContent = "无法连接服务，请确认已启动";
    badge.classList.add("warn");
  }
}

/* ================= 图片处理 ================= */
function fileToDataUrl(file, maxSize = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("图片读取失败"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

/* ================= 拍照流程 ================= */
function showPreview(dataUrl) {
  currentImageDataUrl = dataUrl;
  $("previewImg").src = dataUrl;
  $("uploadCard").classList.add("hidden");
  $("previewCard").classList.remove("hidden");
  $("resultCard").classList.add("hidden");
  $("errorBox").classList.add("hidden");
}
function setLoading(on) {
  $("loading").classList.toggle("hidden", !on);
}
function showError(msg) {
  const box = $("errorBox");
  box.textContent = msg;
  box.classList.remove("hidden");
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function analyze() {
  if (!currentImageDataUrl) return;
  setLoading(true);
  $("errorBox").classList.add("hidden");
  $("resultCard").classList.add("hidden");
  try {
    const r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: currentImageDataUrl }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || "分析失败，请重试");
    render(d);
    saveRecord(d);
  } catch (e) {
    showError("出错了：" + e.message);
  } finally {
    setLoading(false);
  }
}

async function saveRecord(d) {
  let thumb = "";
  try {
    thumb = await makeThumbnail(currentImageDataUrl);
  } catch (e) {
    thumb = "";
  }
  const now = new Date();
  const ok = addRecord({
    id: now.getTime() + "-" + Math.floor(Math.random() * 1000),
    ts: now.getTime(),
    dateStr: ymd(now),
    foods: d.foods || [],
    total: d.total || {},
    good: d.good || [],
    bad: d.bad || [],
    advice: d.advice || "",
    thumb,
  });
  toast(ok ? "已保存到历史" : "历史存不下了，请清理旧记录");
}

function render(d) {
  $("tCal").textContent = d.total.calories;
  $("tPro").textContent = d.total.protein;
  $("tFat").textContent = d.total.fat;
  $("tCarb").textContent = d.total.carbs;

  const table = $("foodTable");
  if (d.foods && d.foods.length) {
    const rows = d.foods.map((f) => `
      <div class="trow">
        <span class="fname">${esc(f.name)}</span>
        <span>${esc(f.amount)}</span>
        <span>${f.calories}</span>
        <span>${f.protein}</span>
        <span>${f.fat}</span>
        <span>${f.carbs}</span>
      </div>`).join("");
    table.innerHTML = `
      <div class="thead">
        <span>食物</span><span>份量</span><span>热量</span>
        <span>蛋白</span><span>脂肪</span><span>碳水</span>
      </div>${rows}`;
  } else {
    table.innerHTML = '<p class="muted">没有识别到具体食物。</p>';
  }

  $("goodList").innerHTML = (d.good || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>";
  $("badList").innerHTML = (d.bad || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>";
  $("adviceText").textContent = d.raw || d.advice || "—";

  $("resultCard").classList.remove("hidden");
  $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function reset() {
  currentImageDataUrl = null;
  $("previewCard").classList.add("hidden");
  $("resultCard").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("uploadCard").classList.remove("hidden");
}

/* ================= 历史 ================= */
function renderHistory() {
  const box = $("historyList");
  const arr = loadRecords();
  if (!arr.length) {
    box.innerHTML = '<p class="muted">还没有记录，去「📷 拍照」拍第一张吧～</p>';
    return;
  }
  const groups = {};
  for (const r of arr) {
    (groups[r.dateStr] = groups[r.dateStr] || []).push(r);
  }
  const dates = Object.keys(groups).sort().reverse();
  box.innerHTML = dates.map((date) => {
    const items = groups[date];
    const dayCal = Math.round(items.reduce((s, r) => s + Number(r.total && r.total.calories ? r.total.calories : 0), 0));
    const rows = items.map((r) => {
      const t = r.total || {};
      return `
      <div class="hitem">
        <div class="hrow">
          ${r.thumb ? `<img class="hthumb" src="${r.thumb}" alt="">` : '<div class="hthumb ph">🍽</div>'}
          <div class="hmain">
            <div class="htop"><span class="htime">${timeStr(r.ts)}</span><span class="hcal">${Math.round(t.calories || 0)} 千卡</span></div>
            <div class="hfoods">${esc(foodNames(r))}</div>
          </div>
          <span class="hchev">›</span>
        </div>
        <div class="hdetail">
          <div class="hnums">蛋白质 ${t.protein || 0}g · 脂肪 ${t.fat || 0}g · 碳水 ${t.carbs || 0}g</div>
          ${r.good && r.good.length ? `<div class="hgood">👍 ${esc(r.good.join("；"))}</div>` : ""}
          ${r.bad && r.bad.length ? `<div class="hbad">⚠️ ${esc(r.bad.join("；"))}</div>` : ""}
          ${r.advice ? `<div class="hadvice">💡 ${esc(r.advice)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    return `<div class="hgroup"><div class="hdate">${dateLabel(date)} · 共 ${dayCal} 千卡</div>${rows}</div>`;
  }).join("");
}

/* ================= 总结 ================= */
function renderSummary() {
  const box = $("summaryBox");
  const arr = loadRecords();
  if (!arr.length) {
    box.innerHTML = '<p class="muted">还没有数据，先去拍几张饭吧～</p>';
    return;
  }

  const todayStr = ymd(new Date());
  const todayRecs = arr.filter((r) => r.dateStr === todayStr);
  const t = sumTotals(todayRecs);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = ymd(d);
    const recs = arr.filter((r) => r.dateStr === ds);
    days.push({ ds, cal: Math.round(sumTotals(recs).calories), count: recs.length });
  }
  const maxCal = Math.max(1, ...days.map((x) => x.cal));
  const weekCal = days.reduce((s, x) => s + x.cal, 0);

  box.innerHTML = `
    <div class="sum-card">
      <h3>🍚 今天</h3>
      <div class="totals">
        <div class="total"><div class="num">${t.calories}</div><div class="unit">千卡</div></div>
        <div class="total"><div class="num">${t.protein}</div><div class="unit">蛋白质 g</div></div>
        <div class="total"><div class="num">${t.fat}</div><div class="unit">脂肪 g</div></div>
        <div class="total"><div class="num">${t.carbs}</div><div class="unit">碳水 g</div></div>
      </div>
      <p class="muted">今天记录了 ${todayRecs.length} 次</p>
    </div>
    <div class="sum-card">
      <h3>📈 近 7 天热量</h3>
      <div class="bars">
        ${days.map((x) => `
          <div class="bar-col">
            <div class="bar-wrap"><div class="bar" style="height:${x.cal > 0 ? Math.max(6, Math.round((x.cal / maxCal) * 100)) : 2}%"></div></div>
            <div class="bar-val">${x.cal || ""}</div>
            <div class="bar-lab">${dayLabel(x.ds)}</div>
          </div>`).join("")}
      </div>
      <p class="muted">7 天合计 ${weekCal} 千卡 · 平均 ${Math.round(weekCal / 7)} 千卡/天</p>
    </div>`;
}

/* ================= 标签切换 ================= */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "history") renderHistory();
  if (name === "summary") renderSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================= 事件绑定 ================= */
document.querySelectorAll(".tab").forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

$("historyList").addEventListener("click", (e) => {
  const item = e.target.closest(".hitem");
  if (item) item.classList.toggle("open");
});

$("btnClearHistory").onclick = () => {
  if (confirm("确定清空全部历史记录吗？此操作不可恢复。")) {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    renderHistory();
    toast("已清空");
  }
};

$("btnCamera").onclick = () => $("cameraInput").click();
$("btnGallery").onclick = () => $("galleryInput").click();

async function handleFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    showPreview(await fileToDataUrl(f));
  } catch (err) {
    showError(err.message);
  }
  e.target.value = "";
}

$("cameraInput").onchange = handleFile;
$("galleryInput").onchange = handleFile;
$("btnAnalyze").onclick = analyze;
$("btnReset").onclick = reset;
$("btnAgain").onclick = reset;

loadHealth();
