const WORKER_URL = "https://sales-agent.gmo-k-watanabe.workers.dev";

const $ = (id) => document.getElementById(id);

const STEP_LABELS = [
  "①入力解析（Workers AIで分類）",
  "②ナレッジ検索（KVから営業ノウハウ取得）",
  "③タスク分解（Geminiで親→子タスク化）",
  "④優先度付け＆スケジュール配置",
  "⑤最終提案の整形",
];

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

async function runAgent() {
  const text = $("userInput").value.trim();
  const mode = $("mode").value;
  if (!text) {
    alert("入力を記入してください");
    return;
  }

  $("output").textContent = "実行中…";
  renderSteps(0);

  try {
    const res = await fetch(`${WORKER_URL}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // ステップを順番に視覚化（疑似プログレス）
    for (let i = 1; i <= STEP_LABELS.length; i++) {
      await new Promise((r) => setTimeout(r, 400));
      renderSteps(i);
    }

    const data = await res.json();
    $("output").textContent = data.result || "結果が空でした";
  } catch (e) {
    $("output").textContent = "エラー：" + e.message;
  }
}

async function loadTasks() {
  try {
    const res = await fetch(`${WORKER_URL}/tasks`);
    const data = await res.json();
    const ul = $("taskList");
    ul.innerHTML = "";
    (data.tasks || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = `[${t.date}] ${t.summary}`;
      ul.appendChild(li);
    });
    if (!data.tasks?.length) ul.innerHTML = "<li>保存タスクはまだありません</li>";
  } catch (e) {
    alert("読み込み失敗：" + e.message);
  }
}

$("runBtn").addEventListener("click", runAgent);
$("loadBtn").addEventListener("click", loadTasks);
renderSteps(-1);
