const chat = document.getElementById("chat");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const installBtn = document.getElementById("installBtn");
const applyBtn = document.getElementById("applyBtn");

const baseUrlEl = document.getElementById("baseUrl");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const requireConfirmEl = document.getElementById("requireConfirm");
const voiceEnabledEl = document.getElementById("voiceEnabled");

const DEFAULT_STATE = {
  profile: {
    language: "ru",
    answerStyle: "normal", // short | normal | detailed
  },
  skills: {
    webSearch: true,
    memory: true,
    tasks: true,
    voice: false
  },
  preferences: {
    sourcePriority: ["wikipedia", "duckduckgo", "youtube"],
    requireConfirm: true
  },
  memory: [],
  tasks: [],
  pendingChanges: null,
  ai: {
    baseUrl: "",
    apiKey: "",
    model: ""
  },
  history: []
};

let state = loadState();

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("assistant_state_v2"));
    return s ? { ...DEFAULT_STATE, ...s } : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem("assistant_state_v2", JSON.stringify(state));
}

function bindSettingsUI() {
  baseUrlEl.value = state.ai.baseUrl || "";
  apiKeyEl.value = state.ai.apiKey || "";
  modelEl.value = state.ai.model || "";
  requireConfirmEl.checked = state.preferences.requireConfirm;
  voiceEnabledEl.checked = state.skills.voice;

  baseUrlEl.addEventListener("change", () => { state.ai.baseUrl = baseUrlEl.value.trim(); saveState(); });
  apiKeyEl.addEventListener("change", () => { state.ai.apiKey = apiKeyEl.value.trim(); saveState(); });
  modelEl.addEventListener("change", () => { state.ai.model = modelEl.value.trim(); saveState(); });
  requireConfirmEl.addEventListener("change", () => { state.preferences.requireConfirm = requireConfirmEl.checked; saveState(); });
  voiceEnabledEl.addEventListener("change", () => { state.skills.voice = voiceEnabledEl.checked; saveState(); });
}

function addMsg(text, cls = "bot") {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function speak(text) {
  if (!state.skills.voice || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ru-RU";
  speechSynthesis.speak(utter);
}

function storeUserMemory(text) {
  if (!state.skills.memory) return;
  if (/запомни[:\s]/i.test(text)) {
    const m = text.replace(/запомни[:\s]*/i, "").trim();
    if (m) {
      state.memory.push(m);
      state.memory = state.memory.slice(-50);
      saveState();
    }
  }
}

function parseSelfChangeRequest(text) {
  const t = text.toLowerCase();
  const changes = [];

  const trigger = t.includes("измени себя") || t.includes("настрой себя") || t.includes("перестройся")
    || t.includes("сделай так чтобы") || t.includes("теперь ты");

  if (!trigger) return null;

  if (t.includes("короче") || t.includes("кратко")) {
    changes.push({ path: "profile.answerStyle", value: "short", reason: "Пользователь просит краткие ответы" });
  }
  if (t.includes("подробнее") || t.includes("детально")) {
    changes.push({ path: "profile.answerStyle", value: "detailed", reason: "Пользователь просит подробные ответы" });
  }
  if (t.includes("добавь голос") || t.includes("озвучивай") || t.includes("говори голосом")) {
    changes.push({ path: "skills.voice", value: true, reason: "Включить голосовые ответы" });
  }
  if (t.includes("выключи голос")) {
    changes.push({ path: "skills.voice", value: false, reason: "Выключить голосовые ответы" });
  }
  if ((t.includes("приоритет") && (t.includes("youtube") || t.includes("ютуб"))) || t.includes("сначала youtube")) {
    changes.push({ path: "preferences.sourcePriority", value: ["youtube", "wikipedia", "duckduckgo"], reason: "Поменять приоритет источников" });
  }
  if (t.includes("сохраняй задачи") || t.includes("веди задачи")) {
    changes.push({ path: "skills.tasks", value: true, reason: "Включить задачи" });
  }
  if (t.includes("не сохраняй задачи") || t.includes("выключи задачи")) {
    changes.push({ path: "skills.tasks", value: false, reason: "Выключить задачи" });
  }
  if (t.includes("выключи поиск")) {
    changes.push({ path: "skills.webSearch", value: false, reason: "Выключить поиск" });
  }
  if (t.includes("включи поиск")) {
    changes.push({ path: "skills.webSearch", value: true, reason: "Включить поиск" });
  }

  return changes.length ? changes : [{ path: null, value: null, reason: "Я понял запрос на перестройку, но не распознал конкретные параметры." }];
}

function applyChanges(changes) {
  for (const ch of changes) {
    if (!ch.path) continue;
    const [a, b] = ch.path.split(".");
    if (state[a]) state[a][b] = ch.value;
  }
  saveState();
  syncSettingsToUI();
}

function syncSettingsToUI() {
  requireConfirmEl.checked = state.preferences.requireConfirm;
  voiceEnabledEl.checked = state.skills.voice;
}

function addTaskIfAsked(text) {
  const t = text.toLowerCase();
  if (!state.skills.tasks) return;
  if (t.startsWith("задача:") || t.startsWith("todo:")) {
    const task = text.split(":").slice(1).join(":").trim();
    if (task) {
      state.tasks.push({ text: task, done: false, at: new Date().toISOString() });
      state.tasks = state.tasks.slice(-100);
      saveState();
      addMsg(`Добавил задачу: ${task}`);
    }
  }
}

async function searchWikipedia(query) {
  try {
    const url = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    return (data?.query?.search || []).slice(0, 3).map(x => {
      const title = x.title;
      const snippet = (x.snippet || "").replace(/<[^>]+>/g, "");
      const link = `https://ru.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      return { title, snippet, link, source: "wikipedia" };
    });
  } catch {
    return [];
  }
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;
    const res = await fetch(url);
    const data = await res.json();
    let out = [];
    if (data.AbstractURL) out.push({
      title: data.Heading || "DuckDuckGo",
      snippet: data.AbstractText || "",
      link: data.AbstractURL,
      source: "duckduckgo"
    });
    const rel = data.RelatedTopics || [];
    for (const r of rel) {
      if (out.length >= 3) break;
      if (r.Text && r.FirstURL) out.push({
        title: r.Text.slice(0, 60),
        snippet: r.Text,
        link: r.FirstURL,
        source: "duckduckgo"
      });
    }
    return out;
  } catch {
    return [];
  }
}

function youtubeSearchLink(query) {
  return {
    title: "YouTube поиск",
    snippet: "Результаты по запросу на YouTube",
    link: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    source: "youtube"
  };
}

async function buildWebContext(query) {
  if (!state.skills.webSearch) return [];
  const result = [];
  for (const src of state.preferences.sourcePriority) {
    if (src === "wikipedia") result.push(...await searchWikipedia(query));
    if (src === "duckduckgo") result.push(...await searchDuckDuckGo(query));
    if (src === "youtube") result.push(youtubeSearchLink(query));
  }
  return result.slice(0, 8);
}

function formatContext(items) {
  if (!items.length) return "Нет внешнего контекста.";
  return items.map((x, i) => `${i + 1}) [${x.source}] ${x.title}\n${x.snippet}\n${x.link}`).join("\n\n");
}

function fallbackAnswer(userText, webItems) {
  let style = state.profile.answerStyle;
  let prefix = style === "short" ? "Кратко: " : style === "detailed" ? "Подробно: " : "";
  let text = `${prefix}Я работаю без AI API-ключа. Могу: искать источники, хранить память, менять настройки по твоим просьбам.`;
  if (webItems.length) {
    text += `\n\nЧто нашёл по запросу:\n` + webItems.map(x => `• ${x.link}`).join("\n");
  }
  return text;
}

async function callOpenAICompatible(userText, webItems) {
  const { baseUrl, apiKey, model } = state.ai;
  if (!baseUrl || !apiKey || !model) return fallbackAnswer(userText, webItems);

  const system = `Ты персональный ассистент пользователя. Язык: русский.
Стиль ответа: ${state.profile.answerStyle}.
Учитывай память пользователя: ${state.memory.slice(-10).join(" | ") || "пока пусто"}.
Если есть источники, добавляй ссылки в конце.`;

  const context = formatContext(webItems);

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Запрос: ${userText}\n\nКонтекст из интернета:\n${context}` }
    ],
    temperature: 0.4
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI API error: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "Не удалось получить ответ от модели.";
}

sendBtn.addEventListener("click", async () => {
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";

  addMsg(text, "user");
  storeUserMemory(text);
  addTaskIfAsked(text);

  // Самоизменение по просьбе пользователя
  const proposed = parseSelfChangeRequest(text);
  if (proposed) {
    state.pendingChanges = proposed;
    saveState();
    const plan = proposed.map((c, i) => `${i + 1}. ${c.reason}`).join("\n");
    addMsg(`Понял запрос на перестройку.\nПлан изменений:\n${plan}`);
    if (state.preferences.requireConfirm) {
      applyBtn.hidden = false;
      return;
    } else {
      applyChanges(proposed);
      state.pendingChanges = null;
      saveState();
      addMsg("Изменения применены автоматически.");
    }
  }

  addMsg("Думаю и ищу источники...");
  const typing = chat.lastChild;

  try {
    const webItems = await buildWebContext(text);
    let answer = await callOpenAICompatible(text, webItems);
    if (webItems.length) {
      answer += "\n\nИсточники:\n" + webItems.map(x => `• ${x.link}`).join("\n");
    }
    typing.remove();
    addMsg(answer, "bot");
    speak(answer);
  } catch (e) {
    typing.remove();
    addMsg(`Ошибка: ${e.message}`, "bot");
  }
});

applyBtn.addEventListener("click", () => {
  if (!state.pendingChanges) return;
  applyChanges(state.pendingChanges);
  addMsg("✅ Изменения ассистента применены.");
  state.pendingChanges = null;
  saveState();
  applyBtn.hidden = true;
});

// PWA install
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  installBtn.hidden = true;
});

// service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

bindSettingsUI();
addMsg("Привет! Я адаптивный ассистент. Напиши: «Измени себя: отвечай короче и добавь голос».");  apiKeyEl.addEventListener("change", () => { state.ai.apiKey = apiKeyEl.value.trim(); saveState(); });
  modelEl.addEventListener("change", () => { state.ai.model = modelEl.value.trim(); saveState(); });
  requireConfirmEl.addEventListener("change", () => { state.preferences.requireConfirm = requireConfirmEl.checked; saveState(); });
  voiceEnabledEl.addEventListener("change", () => { state.skills.voice = voiceEnabledEl.checked; saveState(); });
}

function addMsg(text, cls = "bot") {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function speak(text) {
  if (!state.skills.voice || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ru-RU";
  speechSynthesis.speak(utter);
}

function storeUserMemory(text) {
  if (!state.skills.memory) return;
  if (/запомни[:\s]/i.test(text)) {
    const m = text.replace(/запомни[:\s]*/i, "").trim();
    if (m) {
      state.memory.push(m);
      state.memory = state.memory.slice(-50);
      saveState();
    }
  }
}

function parseSelfChangeRequest(text) {
  const t = text.toLowerCase();
  const changes = [];

  const trigger = t.includes("измени себя") || t.includes("настрой себя") || t.includes("перестройся")
    || t.includes("сделай так чтобы") || t.includes("теперь ты");

  if (!trigger) return null;

  if (t.includes("короче") || t.includes("кратко")) {
    changes.push({ path: "profile.answerStyle", value: "short", reason: "Пользователь просит краткие ответы" });
  }
  if (t.includes("подробнее") || t.includes("детально")) {
    changes.push({ path: "profile.answerStyle", value: "detailed", reason: "Пользователь просит подробные ответы" });
  }
  if (t.includes("добавь голос") || t.includes("озвучивай") || t.includes("говори голосом")) {
    changes.push({ path: "skills.voice", value: true, reason: "Включить голосовые ответы" });
  }
  if (t.includes("выключи голос")) {
    changes.push({ path: "skills.voice", value: false, reason: "Выключить голосовые ответы" });
  }
  if ((t.includes("приоритет") && (t.includes("youtube") || t.includes("ютуб"))) || t.includes("сначала youtube")) {
    changes.push({ path: "preferences.sourcePriority", value: ["youtube", "wikipedia", "duckduckgo"], reason: "Поменять приоритет источников" });
  }
  if (t.includes("сохраняй задачи") || t.includes("веди задачи")) {
    changes.push({ path: "skills.tasks", value: true, reason: "Включить задачи" });
  }
  if (t.includes("не сохраняй задачи") || t.includes("выключи задачи")) {
    changes.push({ path: "skills.tasks", value: false, reason: "Выключить задачи" });
  }
  if (t.includes("выключи поиск")) {
    changes.push({ path: "skills.webSearch", value: false, reason: "Выключить поиск" });
  }
  if (t.includes("включи поиск")) {
    changes.push({ path: "skills.webSearch", value: true, reason: "Включить поиск" });
  }

  return changes.length ? changes : [{ path: null, value: null, reason: "Я понял запрос на перестройку, но не распознал конкретные параметры." }];
}

function applyChanges(changes) {
  for (const ch of changes) {
    if (!ch.path) continue;
    const [a, b] = ch.path.split(".");
    if (state[a]) state[a][b] = ch.value;
  }
  saveState();
  syncSettingsToUI();
}

function syncSettingsToUI() {
  requireConfirmEl.checked = state.preferences.requireConfirm;
  voiceEnabledEl.checked = state.skills.voice;
}

function addTaskIfAsked(text) {
  const t = text.toLowerCase();
  if (!state.skills.tasks) return;
  if (t.startsWith("задача:") || t.startsWith("todo:")) {
    const task = text.split(":").slice(1).join(":").trim();
    if (task) {
      state.tasks.push({ text: task, done: false, at: new Date().toISOString() });
      state.tasks = state.tasks.slice(-100);
      saveState();
      addMsg(`Добавил задачу: ${task}`);
    }
  }
}

async function searchWikipedia(query) {
  try {
    const url = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    return (data?.query?.search || []).slice(0, 3).map(x => {
      const title = x.title;
      const snippet = (x.snippet || "").replace(/<[^>]+>/g, "");
      const link = `https://ru.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      return { title, snippet, link, source: "wikipedia" };
    });
  } catch {
    return [];
  }
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;
    const res = await fetch(url);
    const data = await res.json();
    let out = [];
    if (data.AbstractURL) out.push({
      title: data.Heading || "DuckDuckGo",
      snippet: data.AbstractText || "",
      link: data.AbstractURL,
      source: "duckduckgo"
    });
    const rel = data.RelatedTopics || [];
    for (const r of rel) {
      if (out.length >= 3) break;
      if (r.Text && r.FirstURL) out.push({
        title: r.Text.slice(0, 60),
        snippet: r.Text,
        link: r.FirstURL,
        source: "duckduckgo"
      });
    }
    return out;
  } catch {
    return [];
  }
}

function youtubeSearchLink(query) {
  return {
    title: "YouTube поиск",
    snippet: "Результаты по запросу на YouTube",
    link: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    source: "youtube"
  };
}

async function buildWebContext(query) {
  if (!state.skills.webSearch) return [];
  const result = [];
  for (const src of state.preferences.sourcePriority) {
    if (src === "wikipedia") result.push(...await searchWikipedia(query));
    if (src === "duckduckgo") result.push(...await searchDuckDuckGo(query));
    if (src === "youtube") result.push(youtubeSearchLink(query));
  }
  return result.slice(0, 8);
}

function formatContext(items) {
  if (!items.length) return "Нет внешнего контекста.";
  return items.map((x, i) => `${i + 1}) [${x.source}] ${x.title}\n${x.snippet}\n${x.link}`).join("\n\n");
}

function fallbackAnswer(userText, webItems) {
  let style = state.profile.answerStyle;
  let prefix = style === "short" ? "Кратко: " : style === "detailed" ? "Подробно: " : "";
  let text = `${prefix}Я работаю без AI API-ключа. Могу: искать источники, хранить память, менять настройки по твоим просьбам.`;
  if (webItems.length) {
    text += `\n\nЧто нашёл по запросу:\n` + webItems.map(x => `• ${x.link}`).join("\n");
  }
  return text;
}

async function callOpenAICompatible(userText, webItems) {
  const { baseUrl, apiKey, model } = state.ai;
  if (!baseUrl || !apiKey || !model) return fallbackAnswer(userText, webItems);

  const system = `Ты персональный ассистент пользователя. Язык: русский.
Стиль ответа: ${state.profile.answerStyle}.
Учитывай память пользователя: ${state.memory.slice(-10).join(" | ") || "пока пусто"}.
Если есть источники, добавляй ссылки в конце.`;

  const context = formatContext(webItems);

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Запрос: ${userText}\n\nКонтекст из интернета:\n${context}` }
    ],
    temperature: 0.4
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI API error: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "Не удалось получить ответ от модели.";
}

sendBtn.addEventListener("click", async () => {
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";

  addMsg(text, "user");
  storeUserMemory(text);
  addTaskIfAsked(text);

  // Самоизменение по просьбе пользователя
  const proposed = parseSelfChangeRequest(text);
  if (proposed) {
    state.pendingChanges = proposed;
    saveState();
    const plan = proposed.map((c, i) => `${i + 1}. ${c.reason}`).join("\n");
    addMsg(`Понял запрос на перестройку.\nПлан изменений:\n${plan}`);
    if (state.preferences.requireConfirm) {
      applyBtn.hidden = false;
      return;
    } else {
      applyChanges(proposed);
      state.pendingChanges = null;
      saveState();
      addMsg("Изменения применены автоматически.");
    }
  }

  addMsg("Думаю и ищу источники...");
  const typing = chat.lastChild;

  try {
    const webItems = await buildWebContext(text);
    let answer = await callOpenAICompatible(text, webItems);
    if (webItems.length) {
      answer += "\n\nИсточники:\n" + webItems.map(x => `• ${x.link}`).join("\n");
    }
    typing.remove();
    addMsg(answer, "bot");
    speak(answer);
  } catch (e) {
    typing.remove();
    addMsg(`Ошибка: ${e.message}`, "bot");
  }
});

applyBtn.addEventListener("click", () => {
  if (!state.pendingChanges) return;
  applyChanges(state.pendingChanges);
  addMsg("✅ Изменения ассистента применены.");
  state.pendingChanges = null;
  saveState();
  applyBtn.hidden = true;
});

// PWA install
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  installBtn.hidden = true;
});

// service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

bindSettingsUI();
addMsg("Привет! Я адаптивный ассистент. Напиши: «Измени себя: отвечай короче и добавь голос».");
