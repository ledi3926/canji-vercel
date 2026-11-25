const $ = (id) => document.getElementById(id);
let currentImageDataUrl = null;

// 读取当前模型信息（顺便提示是否已配置密钥）
async function loadHealth() {
  const badge = $("modelBadge");
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    if (d.has_key) {
      badge.textContent = `当前模型：${d.provider} · ${d.model}`;
    } else {
      badge.textContent = `当前模型：${d.provider} · 未配置 API Key`;
      badge.classList.add("warn");
    }
  } catch (e) {
    badge.textContent = "无法连接服务，请确认已启动 app.py";
    badge.classList.add("warn");
  }
}

// 读取图片 → 压缩到合适大小 → 转成 base64（减少上传体积、加快识别）
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
  } catch (e) {
    showError("出错了：" + e.message);
  } finally {
    setLoading(false);
  }
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

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function reset() {
  currentImageDataUrl = null;
  $("previewCard").classList.add("hidden");
  $("resultCard").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("uploadCard").classList.remove("hidden");
}

// 事件绑定
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
