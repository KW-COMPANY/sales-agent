const WORKER_URL = "https://sales-agent.gmo-k-watanabe.workers.dev;

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
// PII検知パターン（クライアント側・第一防衛線）
// =====================================================
const PII_PATTERNS = [
  { name: "メールアドレス", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: "[EMAIL]" },
  { name: "電話番号", regex: /(?:\+?81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, mask: "[PHONE]" },
  { name: "郵便番号", regex: /〒?\s?\d{3}-\d{4}/g, mask: "[POSTAL]" },
  { name: "URL", regex: /https?:\/\/[^\s　]+/g, mask: "[URL]" },
  { name: "クレジットカード番号", regex: /\b(?:\d[ -]*?){13,16}\b/g, mask: "[CARD]" },
  { name: "マイナンバー風", regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: "[ID]" },
  // 企業名（株式会社○○、○○株式会社、（株）、Inc./Ltd./Co./Corp.）
  { name: "企業名", regex: /(?:株式会社|（株）|\(株\))\s?[一-龯ァ-ヶーA-Za-z0-9]+/g, mask: "[COMPANY]" },
  { name: "企業名(後置)", regex: /[一-龯ァ-ヶーA-Za-z0-9]+(?:株式会社|（株）|\(株\)|有限会社|合同会社)/g, mask: "[COMPANY]" },
  { name: "英文社名", regex: /\b[A-Z][A-Za-z0-9&]+\s+(?:Inc|Ltd|Corp|Co|LLC|GmbH)\.?\b/g, mask: "[COMPANY]" },
  // 住所（都道府県＋市区町村パターン）
  { name: "住所", regex: /(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)[^\s　、。]+/g, mask: "[ADDRESS]" },
  // 氏名（カタカナフルネーム：姓名がスペース区切り or 連続4文字以上）
  { name: "カタカナ氏名", regex: /[ァ-ヶー]{2,}[\s　][ァ-ヶー]{2,}/g, mask: "[NAME]" },
  // 漢字氏名（2〜4文字＋様/さん/氏）
  { name: "氏名敬称", regex: /[一-龯]{2,4}\s?(?:様|さん|氏|殿|君|ちゃん)/g, mask: "[NAME]" },
];

// =====================================================
// マスキング処理
// =====================================================
function detectAndMask(text) {
  let masked = text;
  const detected = [];

  for (const p of PII_PATTERNS) {
    const matches = masked.match(p.regex);
    if (matches && matches.length > 0) {
      detected.push({ type: p.name, count: matches.length, samples: matches.slice(0, 2) });
      masked = masked.replace(p.regex, p.mask);
    }
  }
  return { masked, detected };
}

// =====================================================
// 入力リアルタイム検知
// =====================================================
$("userInput").addEventListener("input", () => {
  const text = $("userInput").value;
  if (!text.trim()) {
    $("piiAlert").style.display = "none";
    $("maskedPreview").style.display = "none";
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
});

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
  const rawText = $("userInput").value.trim();
  const mode = $("mode").value;
  const strict = $("strictMode").checked;

  if (!rawText) {
    alert("入力を記入してください");
    return;
  }

  // 第一段マスキング（クライアント）
  const { masked, detected } = detectAndMask(rawText);

  if (detected.length > 0 && strict) {
    const ok = confirm(
      `個人情報・企業情報が${detected.length}種類検知されました。\n` +
      `自動マスキング後の内容で送信しますか？\n\n` +
      `（送信される内容）\n${masked}`
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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
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
renderSteps(-1);
