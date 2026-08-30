window.__ModuleLoader__.load({
  id: "meow-cachebilling",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  startPanelBridge: () => startPanelBridge
});
module.exports = __toCommonJS(client_exports);
var React2 = __toESM(require("react"), 1);

// src/settings.ts
var React = __toESM(require("react"), 1);
var SETTINGS_NS = "meow-cachebilling";
var LOCALE_NS = "meow-cachebilling-settings";
var CSS_ID = "meow-cachebilling-settings-css";
var CSS = `
.meowcb_set_card{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:8px}
.meowcb_set_intro{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.6;margin:0}
.meowcb_set_row{align-items:center;background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;cursor:pointer;display:flex;gap:8px;padding:8px 10px}
.meowcb_set_row:hover{border-color:var(--dsw-alias-border-l2)}
.meowcb_set_badge{border-radius:999px;font-size:11px;line-height:16px;padding:0 8px}
.meowcb_set_badge_prefill{background:color-mix(in srgb,#60a5fa 18%,transparent);color:#60a5fa}
.meowcb_set_badge_override{background:color-mix(in srgb,#f59e0b 18%,transparent);color:#f59e0b}
.meowcb_set_badge_custom{background:color-mix(in srgb,#34d399 18%,transparent);color:#34d399}
.meowcb_set_editor{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;flex-direction:column;gap:8px;padding:12px}
.meowcb_set_line{align-items:center;display:flex;gap:8px;flex-wrap:wrap}
.meowcb_set_label{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:72px}
.meowcb_set_input{background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:inherit;font-size:13px;padding:4px 8px}
.meowcb_set_input_num{width:96px}
.meowcb_set_input_time{flex:1;min-width:240px;font-family:ui-monospace,monospace}
.meowcb_set_input_err{border-color:#f43f5e}
.meowcb_set_err{color:#f43f5e;font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap}
.meowcb_set_actions{display:flex;gap:8px;margin-top:2px}
.meowcb_set_muted{color:var(--dsw-alias-label-caption);font-size:12px}
.meowcb_set_section{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-top:4px}
.meowcb_set_tier{font-weight:600}
`;
var PROVIDER_TIMEZONE = {
  "deepseek-official": "Asia/Shanghai",
  deepseek: "Asia/Shanghai",
  zhipu: "Asia/Shanghai",
  bigmodel: "Asia/Shanghai",
  siliconflow: "Asia/Shanghai",
  moonshot: "Asia/Shanghai",
  alibaba: "Asia/Shanghai",
  openrouter: "UTC",
  openai: "UTC",
  anthropic: "UTC"
};
var DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
var RANGE_PATTERN = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
function parseWhenText(text) {
  const out = [];
  for (const g of text.split("+")) {
    const m = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*$/.exec(g);
    if (!m) throw new Error(`每组应为 [天数][时段列表]，收到 "${g.trim() || "（空）"}"`);
    const days = [];
    for (const part of m[1].split(/[,，]/)) {
      const p = part.trim().toLowerCase();
      if (!p) continue;
      const span = /^([a-z]{3})-([a-z]{3})$/.exec(p);
      if (span) {
        const a = DAY_ORDER.indexOf(span[1]);
        const b = DAY_ORDER.indexOf(span[2]);
        if (a < 0 || b < 0) throw new Error(`未知星期 "${p}"（可用 mon tue wed thu fri sat sun）`);
        for (let i = a; ; i = (i + 1) % 7) {
          days.push(DAY_ORDER[i]);
          if (i === b) break;
        }
      } else {
        if (DAY_ORDER.indexOf(p) < 0) throw new Error(`未知星期 "${p}"`);
        days.push(p);
      }
    }
    const ranges = m[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (days.length === 0) throw new Error("天数为空");
    for (const r of ranges) {
      if (!RANGE_PATTERN.test(r)) throw new Error(`时段格式应为 "HH:MM-HH:MM"，收到 "${r}"`);
    }
    if (ranges.length === 0) throw new Error("时段为空");
    out.push({ days, ranges });
  }
  if (out.length === 0) throw new Error("峰时段为空");
  return out;
}
function serializeWhen(groups) {
  return groups.map((g) => `[${g.days.join(",")}][${g.ranges.join(", ")}]`).join(" + ");
}
var entryKey = (e) => `${(e.provider ?? "*").toLowerCase()}/${e.model.trim().toLowerCase()}`;
var toNum = (v) => Number(v.trim());
var NUM = "0";
function draftFromEntry(e) {
  return {
    provider: e.provider ?? "",
    model: e.model ?? "",
    timezone: e.timezone ?? "",
    isPeak: Boolean(e.peak),
    flatHit: e.const ? String(e.const.hit) : NUM,
    flatMiss: e.const ? String(e.const.miss) : NUM,
    flatOutput: e.const ? String(e.const.output) : NUM,
    peakHit: e.peak ? String(e.peak.hit) : NUM,
    peakMiss: e.peak ? String(e.peak.miss) : NUM,
    peakOutput: e.peak ? String(e.peak.output) : NUM,
    whenText: e.peak ? serializeWhen(e.peak.when) : "[mon-fri][09:00-12:00, 14:00-18:00]",
    valleyHit: e.valley ? String(e.valley.hit) : NUM,
    valleyMiss: e.valley ? String(e.valley.miss) : NUM,
    valleyOutput: e.valley ? String(e.valley.output) : NUM,
    cacheSaving: e.cacheSaving == null ? "" : String(e.cacheSaving)
  };
}
var emptyDraft = () => ({
  provider: "",
  model: "",
  timezone: "",
  isPeak: false,
  flatHit: NUM,
  flatMiss: NUM,
  flatOutput: NUM,
  peakHit: NUM,
  peakMiss: NUM,
  peakOutput: NUM,
  whenText: "[mon-fri][09:00-12:00, 14:00-18:00]",
  valleyHit: NUM,
  valleyMiss: NUM,
  valleyOutput: NUM,
  cacheSaving: ""
});
function validateDraft(d) {
  if (!d.model.trim()) return "model 不能为空";
  if (!d.timezone.trim()) return "timezone 不能为空（选一个 provider 自动带出，或手动填 IANA 名）";
  const numOk = (v) => v.trim() !== "" && Number.isFinite(toNum(v)) && toNum(v) >= 0;
  const partOk = (hit, miss, output) => {
    if (!numOk(hit) || !numOk(miss) || !numOk(output)) return "价格必须是非负数字（元 / 百万 token）";
    return null;
  };
  if (d.isPeak) {
    try {
      parseWhenText(d.whenText);
    } catch (e) {
      return `峰时段：${e instanceof Error ? e.message : String(e)}`;
    }
    return partOk(d.peakHit, d.peakMiss, d.peakOutput) ?? partOk(d.valleyHit, d.valleyMiss, d.valleyOutput);
  }
  return partOk(d.flatHit, d.flatMiss, d.flatOutput);
}
function buildEntry(d) {
  const e = { model: d.model.trim() };
  const provider = d.provider.trim().toLowerCase();
  if (provider) e.provider = provider;
  e.timezone = d.timezone.trim();
  const part = (hit, miss, output) => {
    const p = { hit: toNum(hit), miss: toNum(miss), output: toNum(output) };
    return p;
  };
  if (d.isPeak) {
    e.peak = { ...part(d.peakHit, d.peakMiss, d.peakOutput), when: parseWhenText(d.whenText) };
    e.valley = part(d.valleyHit, d.valleyMiss, d.valleyOutput);
  } else {
    e.const = part(d.flatHit, d.flatMiss, d.flatOutput);
  }
  if (d.cacheSaving.trim()) e.cacheSaving = d.cacheSaving.trim();
  return e;
}
var el = React.createElement;
function Field(props) {
  return el(
    "div",
    { className: "meowcb_set_line" },
    el("span", { className: "meowcb_set_label" }, props.label),
    props.children
  );
}
function PriceInputs(props) {
  const key = (k) => k;
  const hit = mode === "flat" ? key("flatHit") : mode === "peak" ? key("peakHit") : key("valleyHit");
  const miss = mode === "flat" ? key("flatMiss") : mode === "peak" ? key("peakMiss") : key("valleyMiss");
  const output = mode === "flat" ? key("flatOutput") : mode === "peak" ? key("peakOutput") : key("valleyOutput");
  return el(
    "div",
    { className: "meowcb_set_line" },
    el("span", { className: "meowcb_set_label" }, "缓存命中"),
    el("input", {
      className: "meowcb_set_input meowcb_set_input_num",
      value: props.d[hit],
      onChange: (e) => props.set({ [hit]: e.target.value }),
      inputMode: "decimal",
      placeholder: "元/百万"
    }),
    el("span", { className: "meowcb_set_label" }, "缓存未命中"),
    el("input", {
      className: "meowcb_set_input meowcb_set_input_num",
      value: props.d[miss],
      onChange: (e) => props.set({ [miss]: e.target.value }),
      inputMode: "decimal",
      placeholder: "元/百万"
    }),
    el("span", { className: "meowcb_set_label" }, "输出"),
    el("input", {
      className: "meowcb_set_input meowcb_set_input_num",
      value: props.d[output],
      onChange: (e) => props.set({ [output]: e.target.value }),
      inputMode: "decimal",
      placeholder: "元/百万"
    })
  );
}
function BillingCard(props) {
  const scope = props.scope;
  const subscribe = React.useCallback((cb) => scope.subscribe(cb), [scope]);
  const getSnapshot = React.useCallback(() => scope.getSnapshot(), [scope]);
  const snap = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [expanded, setExpanded] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const base = snap.base ?? {};
  const user = snap.user ?? {};
  const keys = Array.from(/* @__PURE__ */ new Set([...Object.keys(base), ...Object.keys(user)]));
  const set = (patch) => {
    setError(null);
    setDraft((prev) => prev ? { ...prev, ...patch } : prev);
  };
  const open = (key) => {
    setError(null);
    if (key === null) {
      setExpanded(null);
      setDraft(null);
      return;
    }
    const entry = key === "__new__" ? void 0 : user[key] ?? base[key];
    setDraft(entry ? draftFromEntry(entry) : emptyDraft());
    setExpanded(key);
  };
  const save = async () => {
    if (!draft || !expanded) return;
    const err = validateDraft(draft);
    if (err) {
      setError(err);
      return;
    }
    const entry = buildEntry(draft);
    const key = expanded === "__new__" ? entryKey(entry) : expanded;
    setBusy(true);
    try {
      const r = await scope.set(key, entry);
      const bad = r && r.result && r.result.ok === false ? r.result.error?.message : null;
      if (bad) {
        setError(`保存被拒绝：${bad}`);
        return;
      }
      setExpanded(null);
      setDraft(null);
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (key) => {
    setBusy(true);
    try {
      await scope.unset(key);
      setExpanded(null);
      setDraft(null);
    } catch (e) {
      setError(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  if (snap.status === "loading") {
    return el("div", { className: "meowcb_set_card" }, el("span", { className: "meowcb_set_muted" }, "价目表加载中…"));
  }
  if (snap.status === "unavailable") {
    return el(
      "div",
      { className: "meowcb_set_card" },
      el("span", { className: "meowcb_set_muted" }, "当前连接不支持设置写入（仅本机回环连接可编辑）。")
    );
  }
  const tzFor = (provider) => {
    const p = provider.trim().toLowerCase();
    if (p && PROVIDER_TIMEZONE[p]) return { auto: true, tz: PROVIDER_TIMEZONE[p] };
    return { auto: false, tz: draft?.timezone ?? "UTC" };
  };
  const editor = draft === null ? null : el(
    "div",
    { className: "meowcb_set_editor" },
    el(
      Field,
      { label: "provider" },
      el("input", {
        className: "meowcb_set_input",
        value: draft.provider,
        onChange: (e) => {
          const provider = e.target.value;
          const known = PROVIDER_TIMEZONE[provider.trim().toLowerCase()];
          set(known ? { provider, timezone: known } : { provider });
        },
        placeholder: "如 deepseek-official / openrouter（留空 = 通配）"
      }),
      el("span", { className: "meowcb_set_muted" }, "留空 = 对该模型所有路由生效")
    ),
    el(
      Field,
      { label: "model" },
      el("input", {
        className: "meowcb_set_input",
        value: draft.model,
        onChange: (e) => set({ model: e.target.value }),
        placeholder: "与 API 返回写法一致，如 glm-5.3-flash"
      })
    ),
    el(
      Field,
      { label: "时区" },
      tzFor(draft.provider).auto ? el("span", { className: "meowcb_set_muted" }, `自动（计费方账单时区）：${tzFor(draft.provider).tz}`) : el("input", {
        className: "meowcb_set_input" + (draft.timezone.trim() ? "" : " meowcb_set_input_err"),
        value: draft.timezone,
        onChange: (e) => set({ timezone: e.target.value }),
        placeholder: "IANA 名，如 Asia/Shanghai / America/New_York"
      })
    ),
    el(
      "label",
      { className: "meowcb_set_line", style: { cursor: "pointer" } },
      el("input", {
        type: "checkbox",
        checked: draft.isPeak,
        onChange: (e) => set({ isPeak: e.target.checked })
      }),
      el("span", null, "是峰谷价（不勾 = 24 小时一口价）")
    ),
    draft.isPeak ? el(
      "div",
      { className: "meowcb_set_editor" },
      el("div", { className: "meowcb_set_section" }, "峰价"),
      el(
        Field,
        { label: "时间" },
        el("input", {
          className: "meowcb_set_input meowcb_set_input_time" + (draft.whenText.trim() ? "" : " meowcb_set_input_err"),
          value: draft.whenText,
          onChange: (e) => set({ whenText: e.target.value }),
          placeholder: "[mon-fri][09:00-12:00, 14:00-18:00]，多组用 + 连接"
        })
      ),
      el(PriceInputs, { d: draft, set, mode: "peak" }),
      el("div", { className: "meowcb_set_section" }, "谷价（时段自动取峰的补集，含周末全天谷）"),
      el(PriceInputs, { d: draft, set, mode: "valley" })
    ) : el(
      "div",
      { className: "meowcb_set_editor" },
      el(PriceInputs, { d: draft, set, mode: "flat" })
    ),
    el(
      Field,
      { label: "cacheSaving" },
      el("input", {
        className: "meowcb_set_input",
        value: draft.cacheSaving,
        onChange: (e) => set({ cacheSaving: e.target.value }),
        placeholder: "服务器缓存保留时长（实测后回填，现在没有逻辑）"
      })
    ),
    error ? el("div", { className: "meowcb_set_err" }, error) : null,
    el(
      "div",
      { className: "meowcb_set_actions" },
      el(
        "button",
        { className: "meowcb_set_input", disabled: busy, onClick: () => void save() },
        busy ? "保存中…" : "保存"
      ),
      el(
        "button",
        { className: "meowcb_set_input", disabled: busy, onClick: () => open(null) },
        "取消"
      )
    )
  );
  const rows = keys.map((key) => {
    const entry = user[key] ?? base[key];
    if (!entry) return null;
    const inBase = key in base;
    const inUser = key in user;
    const overridden = inBase && inUser;
    const custom = inUser && !inBase;
    const isExpanded = expanded === key;
    const badge = overridden ? el("span", { className: "meowcb_set_badge meowcb_set_badge_override" }, "已覆盖") : custom ? el("span", { className: "meowcb_set_badge meowcb_set_badge_custom" }, "自定义") : el("span", { className: "meowcb_set_badge meowcb_set_badge_prefill" }, "预填");
    const tier = entry.peak ? "（峰谷）" : "";
    return isExpanded ? editor : el(
      "div",
      {
        key,
        className: "meowcb_set_row",
        onClick: () => open(key)
      },
      el("span", null, `${entry.provider ?? "*"} / ${entry.model}${tier}`),
      badge
    );
  });
  const expandedIsNew = expanded === "__new__";
  return el(
    "div",
    { className: "meowcb_set_card" },
    el(
      "p",
      { className: "meowcb_set_intro" },
      "价目表分两层：插件自带的预填（跟随版本更新）+ 你在下面的修改（保存在 DSH 设置里，改完即时生效）。点击任意一行展开编辑；编辑预填条目会生成覆盖，可随时恢复预填。"
    ),
    !snap.writable ? el("span", { className: "meowcb_set_muted" }, "当前连接为只读（设置写入仅限本机回环连接）。") : null,
    expandedIsNew ? editor : null,
    el(
      "div",
      { className: "meowcb_set_actions" },
      el(
        "button",
        { className: "meowcb_set_input", onClick: () => open("__new__"), disabled: expandedIsNew },
        "添加条目"
      )
    ),
    ...rows
  );
}
function applySettings(ctx) {
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "meow-cachebilling-settings";
    tag.dataset.pluginCss = CSS_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  try {
    ctx.locale?.register?.(LOCALE_NS, {
      zh: { card: "喵缓存账单" },
      en: { card: "Meow Cache Billing" }
    });
  } catch {
  }
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
  ctx.slots.inject(
    "settings.plugin.item",
    () => ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: SETTINGS_NS,
        locale: `${LOCALE_NS}.card`,
        inject: () => ({ scope })
      },
      BillingCard
    )
  );
}

// src/client.ts
var CSS_ID2 = "meow-cachebilling-css";
var CSS2 = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_billhead{align-items:center;gap:6px;display:flex;color:var(--dsw-alias-label-secondary)}
.meowcb_billtotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.meowcb_bilrows{margin:4px 0 0;padding:0}
.meowcb_bilrow{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}
.meowcb_bilrow dt{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin:0}
.meowcb_bilrow dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0;font-weight:500;text-align:right}
.meowcb_tok{color:var(--dsw-alias-label-caption);font-weight:400;margin-left:4px}
.meowcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.meowcb_srows{margin:2px 0 0;padding:0 0 0 16px}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
`;
function isBillableProvider(provider) {
  return typeof provider === "string" && provider !== "";
}
function formatAmount(amount, digits) {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return amount.toFixed(digits);
}
function formatTokens(n) {
  const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1e3) return String(Math.round(n));
  if (n < 1e6) return `${scaled(n / 1e3)}K`;
  return `${scaled(n / 1e6)}M`;
}
var TIER_LABEL = {
  peak: "梁文峰",
  offPeak: "梁文谷"
};
var TIER_LABEL_GENERIC = {
  peak: "峰价",
  offPeak: "谷价"
};
function isOfficialDeepSeek(provider) {
  if (typeof provider !== "string" || provider === "") return false;
  return provider.toLowerCase().includes("deepseek");
}
var latestView;
function isContextPanel(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.getAttribute("role") !== "dialog") return false;
  const label = node.getAttribute("aria-label") ?? "";
  return /of context used|上下文已用/i.test(label);
}
function buildRow(doc, o) {
  const row = doc.createElement("div");
  row.className = "meowcb_bilrow";
  const dt = doc.createElement("dt");
  const swatch = doc.createElement("span");
  swatch.className = "meowcb_swatch";
  swatch.style.background = o.color;
  dt.appendChild(swatch);
  dt.appendChild(doc.createTextNode(o.label));
  if (o.tokens >= 0) {
    const tok = doc.createElement("span");
    tok.className = "meowcb_tok";
    tok.textContent = `${formatTokens(o.tokens)} tok`;
    dt.appendChild(tok);
  }
  const dd = doc.createElement("dd");
  dd.textContent = o.amountText;
  row.appendChild(dt);
  row.appendChild(dd);
  return row;
}
function renderBill(bill) {
  const doc = bill.ownerDocument;
  if (!doc) return;
  bill.textContent = "";
  const view = latestView;
  const put = (el2) => {
    bill.appendChild(el2);
  };
  if (!view || !isBillableProvider(view.provider)) {
    return;
  }
  if (view.available !== true) {
    const empty = doc.createElement("div");
    empty.className = "meowcb_foot";
    empty.textContent = "缓存账单：本会话暂无 Token 用量";
    put(empty);
    return;
  }
  const cost = Number.isFinite(view.cost) ? view.cost : 0;
  const missCost = Number.isFinite(view.missCost) ? view.missCost : 0;
  const outputCost = Number.isFinite(view.outputCost) ? view.outputCost : 0;
  const total = cost + missCost + outputCost;
  const symbol = view.currency === "USD" ? "$" : "¥";
  const official = isOfficialDeepSeek(view.provider);
  const modelSuffix = typeof view.model === "string" && view.model !== "" ? ` · ${view.model}` : "";
  const labels = official ? TIER_LABEL : TIER_LABEL_GENERIC;
  const tierLabel = view.priceMatched === false ? `${typeof view.tier === "string" && view.tier in labels ? labels[view.tier] : "估算"}（估算）` : typeof view.tier === "string" && view.tier in labels ? labels[view.tier] : "一口价";
  const tierText = `${tierLabel}${modelSuffix}`;
  const detailRows = (o) => {
    const rows = doc.createElement("div");
    rows.className = "meowcb_srows";
    rows.appendChild(
      buildRow(doc, {
        color: "#34d399",
        label: "缓存命中",
        tokens: o.hitTok,
        amountText: `${symbol}${formatAmount(o.hit, o.digits)}`
      })
    );
    rows.appendChild(
      buildRow(doc, {
        color: "#f59e0b",
        label: "缓存未命中",
        tokens: o.missTok,
        amountText: `${symbol}${formatAmount(o.miss, o.digits)}`
      })
    );
    rows.appendChild(
      buildRow(doc, {
        color: "#60a5fa",
        label: "输出",
        tokens: o.outTok,
        amountText: `${symbol}${formatAmount(o.out, o.digits)}`
      })
    );
    return rows;
  };
  const stepIn = Number(view.totalInputTokens ?? 0);
  const stepHitTok = Number(view.cacheReadTokens ?? 0);
  const stepMissTok = Math.max(0, stepIn - stepHitTok);
  const stepOutTok = Number(view.outputTokens ?? 0);
  put(
    buildRow(doc, {
      color: "#a78bfa",
      label: "当前每次API请求",
      tokens: stepIn + stepOutTok,
      amountText: `${symbol}${formatAmount(total, 4)}`
    })
  );
  put(detailRows({
    hitTok: stepHitTok,
    missTok: stepMissTok,
    outTok: stepOutTok,
    hit: cost,
    miss: missCost,
    out: outputCost,
    digits: 4
  }));
  const turnCost = Number.isFinite(view.turnCost) ? view.turnCost : 0;
  const turnHit = Number.isFinite(view.turnHitCost) ? view.turnHitCost : 0;
  const turnMiss = Number.isFinite(view.turnMissCost) ? view.turnMissCost : 0;
  const turnOut = Number.isFinite(view.turnOutputCost) ? view.turnOutputCost : 0;
  const turnIn = Number(view.turnInputTokens ?? 0);
  const turnHitTok = Number(view.turnCacheReadTokens ?? 0);
  const turnOutTok = Number(view.turnOutputTokens ?? 0);
  put(
    buildRow(doc, {
      color: "#22d3ee",
      label: "当前轮",
      tokens: turnIn + turnOutTok,
      amountText: `${symbol}${formatAmount(turnCost, 3)}`
    })
  );
  put(detailRows({
    hitTok: turnHitTok,
    missTok: Math.max(0, turnIn - turnHitTok),
    outTok: turnOutTok,
    hit: turnHit,
    miss: turnMiss,
    out: turnOut,
    digits: 3
  }));
  const sessionHit = Number.isFinite(view.sessionCacheHitCost) ? view.sessionCacheHitCost : 0;
  const sessionMiss = Number.isFinite(view.sessionMissCost) ? view.sessionMissCost : 0;
  const sessionOut = Number.isFinite(view.sessionOutputCost) ? view.sessionOutputCost : 0;
  const sessionRounds = Number.isFinite(view.sessionRounds) ? view.sessionRounds : 0;
  const sessionIn = Number(view.sessionInputTokens ?? 0);
  const sessionHitTok = Number(view.sessionCacheReadTokens ?? 0);
  const sessionOutTok = Number(view.sessionOutputTokens ?? 0);
  put(
    buildRow(doc, {
      color: "#f472b6",
      label: sessionRounds > 0 ? `会话累计 · ${sessionRounds} 次` : "会话累计",
      tokens: sessionIn + sessionOutTok,
      amountText: `${symbol}${formatAmount(sessionHit + sessionMiss + sessionOut, 2)}`
    })
  );
  const srows = detailRows({
    hitTok: sessionHitTok,
    missTok: Math.max(0, sessionIn - sessionHitTok),
    outTok: sessionOutTok,
    hit: sessionHit,
    miss: sessionMiss,
    out: sessionOut,
    digits: 2
  });
  const missSteps = Number.isFinite(view.sessionMissSteps) ? view.sessionMissSteps : 0;
  const writeTokens = Number.isFinite(view.sessionWriteTokens) ? view.sessionWriteTokens : 0;
  const fullMissSteps = Number.isFinite(view.sessionFullMissSteps) ? view.sessionFullMissSteps : 0;
  if (missSteps > 0) {
    srows.appendChild(
      buildRow(doc, {
        color: "#fb7185",
        label: `缓存失效 ${missSteps} 次`,
        tokens: writeTokens > 0 ? writeTokens : -1,
        amountText: ""
      })
    );
  }
  if (fullMissSteps > 0) {
    srows.appendChild(
      buildRow(doc, {
        color: "#f43f5e",
        label: `完全失效 ${fullMissSteps} 次`,
        tokens: -1,
        amountText: ""
      })
    );
  }
  put(srows);
  const foot = doc.createElement("div");
  foot.className = "meowcb_foot";
  foot.textContent = tierText;
  put(foot);
}
function ensureBill(panel) {
  let bill = panel.querySelector(":scope > .meowcb_bill");
  if (bill === null) {
    bill = panel.ownerDocument.createElement("div");
    bill.className = "meowcb_bill";
    panel.appendChild(bill);
  }
  renderBill(bill);
}
function refreshOpenPanels() {
  if (typeof document === "undefined") return;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dlg of dialogs) {
    if (isContextPanel(dlg)) ensureBill(dlg);
  }
}
function startPanelBridge() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {
    };
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isContextPanel(node)) {
          ensureBill(node);
          return;
        }
        if (node instanceof HTMLElement) {
          const dialogs = node.querySelectorAll('[role="dialog"]');
          for (const dlg of dialogs) {
            if (isContextPanel(dlg)) {
              ensureBill(dlg);
              return;
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
function CacheDataHook(props) {
  const data = typeof props.useProjection === "function" ? props.useProjection("cacheBilling") : void 0;
  (0, React2.useEffect)(() => {
    latestView = data ?? void 0;
    refreshOpenPanels();
  }, [data]);
  return React2.createElement("span", {
    "data-meow-cachebilling": "hook",
    "data-meowcb-version": "settings-ui-1",
    style: { display: "none" }
  });
}
var inject = ["slots", "connection", "remote", "settingsScope", "settingsSchema"];
function apply(ctx) {
  console.log("[meow-cachebilling] client bundle: settings-ui-1");
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID2}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "meow-cachebilling";
    tag.dataset.pluginCss = CSS_ID2;
    tag.textContent = CSS2;
    document.head.appendChild(tag);
  }
  if (typeof document !== "undefined") {
    startPanelBridge();
  }
  ctx.slots.inject("conversation.input.right", () => {
    const dispose = ctx.slots.register(
      {
        name: "conversation.input.right",
        id: "meow-cachebilling-data-hook",
        order: 1
      },
      CacheDataHook
    );
    return () => {
      dispose();
    };
  });
  try {
    applySettings(ctx);
  } catch (e) {
    console.warn("[meow-cachebilling] 设置页注册失败（不影响账单）：", e);
  }
}
    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
