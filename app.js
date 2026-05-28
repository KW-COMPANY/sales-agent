const WORKER_URL = "https://sales-agent.gmo-k-watanabe.workers.dev";

const $ = (id) => document.getElementById(id);

const STEP_LABELS = [
  "①クライアント側PII検知＆マスキング",
  "②サーバー側で再サニタイズ",
  "③Workers AIで入力分類",
  "④KVから営業ナレッジ取得",
  "⑤Geminiでタスク分解＆スケジュール提案",
  "⑥出力もPIIスキャンしてから返却",
];

// =====================================================
// ★ タスク定義（BtoB法人営業向けルーティン）
// =====================================================
const TASK_DEFS = [
  { id: "visit",    icon: "🏢", label: "訪問・商談",   unit: "件", default: 1 },
  { id: "estimate", icon: "📄", label: "見積作成",     unit: "件", default: 1 },
  { id: "invoice",  icon: "🧾", label: "請求書発行",   unit: "件", default: 1 },
  { id: "followup", icon: "📞", label: "フォロー連絡", unit: "件", default: 2 },
  { id: "mail",     icon: "✉️", label: "メール対応",   unit: "件", default: 5 },
  { id: "proposal", icon: "📊", label: "提案資料作成", unit: "件", default: 1 },
  { id: "mtg",      icon: "👥", label: "社内MTG",      unit: "回", default: 1 },
  { id: "report",   icon: "📝", label: "日報・報告書", unit: "件", default: 1 },
  { id: "pipeline", icon: "🔄", label: "パイプライン整理", unit: "回", default: 1 },
  { id: "contract", icon: "🖊️", label: "契約手続き",  unit: "件", default: 1 },
  { id: "newlead",  icon: "🔍", label: "新規リード",   unit: "件", default: 3 },
  { id: "approval", icon: "✅", label: "社内承認依頼", unit: "件", default: 1 },
];

const URGENCY_LABELS = { low: "低（通常運用）", mid: "中（一部急ぎあり）", high: "高（今日中に要完了）" };

// 選択状態管理
let selectedTasks = {}; // { taskId: count }
let urgencyLevel = "low";

// =====================================================
// PII検知パターン（クライアント側・第一防衛線）
// =====================================================
const PII_PATTERNS = [
  { name: "メールアドレス", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: "[EMAIL]" },
  { name: "電話番号", regex: /(?:\+?81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, mask: "[PHONE]" },
  { name: "郵便番号", regex: /〒?\s?\d{3}-\d{4}/g, mask: "[POSTAL]" },
  { name: "URL", regex: /https?:\/\/[^\s　]+/g, mask: "[URL]" },
  { name: "クレジットカード番号", regex: /\b(?:\d[ -]*?){13,16}\b/g, mask: "[CARD]" },
  { name: "マイナンバー風", regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: "[ID]" },
  { name: "企業名", regex: /(?:株式会社|（株）|\(株\))\s?[一-龯ァ-ヶーA-Za-z0-9]+/g, mask: "[COMPANY]" },
  { name: "企業名(後置)", regex: /[一-龯ァ-ヶーA-Za-z0-9]+(?:株式会社|（株）|\(株\)|有限会社|合同会社)/g, mask: "[COMPANY]" },
  { name: "英文社名", regex: /\b[A-Z][A-Za-z0-9&]+\s+(?:Inc|Ltd|Corp|Co|LLC|GmbH)\.?\b/g, mask: "[COMPANY]" },
  { name: "住所", regex: /(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)[^\s　、。]+/g, mask: "[ADDRESS]" },
  { name: "カタカナ氏名", regex: /[ァ-ヶー]{2,}[\s　][ァ-ヶー]{2,}/g, mask: "[NAME]" },
  { name: "氏名敬称", regex: /[一-龯]{2,4}\s?(?:様|さん|氏|殿|君|ちゃん)/g, mask: "[NAME]" },
];

function detectAndMask(text) {
  let masked = text;
  const detected = [];
  for (const p of PII_PATTERNS) {
    const matches = masked.match(p.regex);
    if (matches && matches.length > 0) {
      detected.push({ type: p.name, count: matches.length });
      masked = masked.replace(p.regex, p.mask);
    }
  }
  return { masked, detected };
}

// =====================================================
// ★ タスクグリッド描画
// =====================================================
function renderTaskGrid() {
  const grid = $("taskGrid");
  grid.innerHTML = "";
  TASK_DEFS.forEach((task) => {
    const card = document.createElement("div");
    card.className = "task-card" + (selectedTasks[task.id] ? " selected" : "");
    card.dataset.id = task.id;

    const count = selectedTasks[task.id] || task.default;

    card.innerHTML = `
      <div class="task-card-inner" data-id="${task.id}">
        <span class="task-icon">${task.icon}</span>
        <span class="task-label">${task.label}</span>
      </div>
      <div class="task-counter ${selectedTasks[task.id] ? "" : "hidden"}" id="counter-${task.id}">
        <button class="counter-btn minus" data-id="${task.id}">－</button>
        <span class="counter-val" id="val-${task.id}">${count}${task.unit}</span>
        <button class="counter-btn plus" data-id="${task.id}">＋</button>
      </div>
    `;
    grid.appendChild(card);
  });

  // タスクカード本体クリック → 選択トグル
  grid.querySelectorAll(".task-card-inner").forEach((el) => {
    el.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      toggleTask(id);
    });
  });

  // ±ボタン
  grid.querySelectorAll(".counter-btn.plus").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      changeCount(e.currentTarget.dataset.id, 1);
    });
  });
  grid.querySelectorAll(".counter-btn.minus").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      changeCount(e.currentTarget.dataset.id, -1);
    });
  });
}

function toggleTask(id) {
  const taskDef = TASK_DEFS.find((t) => t.id === id);
  if (selectedTasks[id]) {
    delete selectedTasks[id];
  } else {
    selectedTasks[id] = taskDef.default;
  }
  renderTaskGrid();
  updateSendPreview();
  updateRunBtn();
}

function changeCount(id, delta) {
  if (!selectedTasks[id]) return;
  const taskDef = TASK_DEFS.find((t) => t.id === id);
  const newVal = Math.max(1, (selectedTasks[id] || taskDef.default) + delta);
  selectedTasks[id] = newVal;
  const valEl = $(`val-${id}`);
  if (valEl) valEl.textContent = newVal + taskDef.unit;
  updateSendPreview();
}

// =====================================================
// ★ 緊急度ボタン
// =====================================================
$("urgencyButtons").addEventListener("click", (e) => {
  const btn = e.target.closest(".urgency-btn");
  if (!btn) return;
  urgencyLevel = btn.dataset.level;
  document.querySelectorAll(".urgency-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  updateSendPreview();
});

// =====================================================
// ★ 補足メモ トグル
// =====================================================
$("toggleOptional").addEventListener("click", () => {
  const area = $("optionalArea");
  const isHidden = area.style.display === "none";
  area.style.display = isHidden ? "block" : "none";
  $("toggleOptional").textContent = isHidden ? "－ 補足メモを閉じる" : "＋ 補足メモを追加（任意）";
});

// =====================================================
// 補足テキスト リアルタイムPII検知
// =====================================================
$("userInput").addEventListener("input", () => {
  const text = $("userInput").value;
  if (!text.trim()) {
    $("piiAlert").style.display = "none";
    $("maskedPreview").style.display = "none";
    updateSendPreview();
    return;
  }
  const { masked, detected } = detectAndMask(text);
  if (detected.length > 0) {
    const msg = "⚠️ 個人情報・企業情報の可能性を検知しました：\n" +
      detected.map((d) => `・${d.type}（${d.count}件）`).join("\n") +
      "\n→ 自動マスキングして送信します。";
    $("piiAlert").textContent = msg;
    $("piiAlert").style.display = "block";
    $("maskedText").textContent = masked;
    $("maskedPreview").style.display = "block";
  } else {
    $("piiAlert").style.display = "none";
    $("maskedPreview").style.display = "none";
  }
  updateSendPreview();
});

// =====================================================
// ★ 送信テキスト生成（選択タスク → 文字列に変換）
// =====================================================
function buildInputText() {
  const taskLines = Object.entries(selectedTasks).map(([id, count]) => {
    const def = TASK_DEFS.find((t) => t.id === id);
    return `${def.label}：${count}${def.unit}`;
  });

  const urgencyText = `緊急度：${URGENCY_LABELS[urgencyLevel]}`;
  const optional = $("userInput").value.trim();
  const { masked: maskedOptional } = optional ? detectAndMask(optional) : { masked: "" };

  const lines = [...taskLines, urgencyText];
  if (maskedOptional) lines.push(`補足：${maskedOptional}`);

  return lines.join("、");
}

// =====================================================
// ★ 送信プレビュー更新
// =====================================================
function updateSendPreview() {
  const hasSelection = Object.keys(selectedTasks).length > 0;
  const preview = $("sendPreview");
  if (hasSelection) {
    $("sendPreviewText").textContent = buildInputText();
    preview.style.display = "block";
  } else {
    preview.style.display = "none";
  }
}

// =====================================================
// ★ 実行ボタン活性制御
// =====================================================
function updateRunBtn() {
  const btn = $("runBtn");
  const hasSelection = Object.keys(selectedTasks).length > 0;
  btn.disabled = !hasSelection;
  btn.classList.toggle("run-btn-active", hasSelection);
}

// =====================================================
// ステップ可視化
// =====================================================
function renderSteps(activeIdx) {
  const ol = $("steps");
  ol.innerHTML = "";
  STEP_LABELS.forEach((label, i) => {
    const li = document.createElement("li");
    li.textContent = label;
    if (i < activeIdx) li.classList.add("done");
    if (i === activeIdx) li.classList.add("active");
    ol.appendChild(li);
  });
}

// =====================================================
// エージェント実行
// =====================================================
async function runAgent() {
  const hasSelection = Object.keys(selectedTasks).length > 0;
  if (!hasSelection) {
    alert("タスクを1つ以上選択してください");
    return;
  }

  const mode = $("mode").value;
  const strict = $("strictMode").checked;
  const inputText = buildInputText();
  const { masked, detected } = detectAndMask(inputText);

  if (detected.length > 0 && strict) {
    const ok = confirm(
      `個人情報・企業情報が${detected.length}種類検知されました。\n` +
      `自動マスキング後の内容で送信しますか？\n\n（送信内容）\n${masked}`
    );
    if (!ok) return;
  }

  $("output").textContent = "実行中…";
  renderSteps(0);

  try {
    const res = await fetch(`${WORKER_URL}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: masked, mode, client_masked: true }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error || errMsg;
      } catch (_) {
        errMsg = errText || errMsg;
      }
      throw new Error(errMsg);
    }

    for (let i = 1; i <= STEP_LABELS.length; i++) {
      await new Promise((r) => setTimeout(r, 350));
      renderSteps(i);
    }

    const data = await res.json();
    let output = data.result || "結果が空でした";
    if (data.server_detected && data.server_detected.length > 0) {
      output = "🛡 サーバー側で追加検知された項目: " +
        data.server_detected.map((d) => d.type).join(", ") +
        "\n\n" + output;
    }
    $("output").textContent = output;
  } catch (e) {
    $("output").textContent = "エラー：" + e.message;
  }
}

// =====================================================
// 保存タスク一覧
// =====================================================
async function loadTasks() {
  try {
    const res = await fetch(`${WORKER_URL}/tasks`);
    const data = await res.json();
    const ul = $("taskList");
    ul.innerHTML = "";
    (data.tasks || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = `[${t.date}] (${t.category}/${t.mode}) ${t.summary}`;
      ul.appendChild(li);
    });
    if (!data.tasks?.length) ul.innerHTML = "<li>保存タスクはまだありません</li>";
  } catch (e) {
    alert("読み込み失敗：" + e.message);
  }
}

// =====================================================
// 全削除
// =====================================================
async function clearTasks() {
  if (!confirm("保存済みタスクをすべて削除します。よろしいですか？")) return;
  try {
    const res = await fetch(`${WORKER_URL}/tasks`, { method: "DELETE" });
    const data = await res.json();
    alert(`${data.deleted || 0}件削除しました`);
    loadTasks();
  } catch (e) {
    alert("削除失敗：" + e.message);
  }
}

$("runBtn").addEventListener("click", runAgent);
$("loadBtn").addEventListener("click", loadTasks);
$("clearBtn").addEventListener("click", clearTasks);

// 初期描画
renderTaskGrid();
renderSteps(-1);
