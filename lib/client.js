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
.meowcb_set_label{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}
.meowcb_set_input{background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:inherit;font-size:13px;padding:4px 8px}
.meowcb_set_input_num{width:64px}
.meowcb_set_input_time{flex:1;min-width:200px;font-family:ui-monospace,monospace}
.meowcb_set_input_grow{flex:1;min-width:80px}
.meowcb_set_input_save{width:112px}
.meowcb_set_price{align-items:center;display:flex;gap:4px;flex:none}
.meowcb_set_check{align-items:center;cursor:pointer;display:flex;gap:4px;flex:none}
.meowcb_set_input_err{border-color:#f43f5e}
.meowcb_set_err{color:#f43f5e;font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap}
.meowcb_set_actions{display:flex;gap:8px;margin-top:2px}
.meowcb_set_muted{color:var(--dsw-alias-label-caption);font-size:12px}
.meowcb_set_section{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-top:4px}
.meowcb_set_tier{font-weight:600}
.meowcb_set_title{font-size:16px;font-weight:600;margin:0}
.meowcb_set_subtitle{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.6;margin:0}
.meowcb_set_page{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:10px;max-width:760px;padding:4px 0}
`;
var PROVIDER_TIMEZONE = {
  "deepseek-official": "Asia/Shanghai",
  deepseek: "Asia/Shanghai",
  zhipu: "Asia/Shanghai",
  "zai-coding-cn": "Asia/Shanghai",
  zai: "Asia/Shanghai",
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
  if (!d.model.trim()) return "模型不能为空";
  const numOk = (v) => v.trim() !== "" && Number.isFinite(toNum(v)) && toNum(v) >= 0;
  const partOk = (hit, miss, output) => {
    if (!numOk(hit) || !numOk(miss) || !numOk(output)) return "价格必须是非负数字（元 / 百万 token）";
    return null;
  };
  if (d.isPeak) {
    if (!d.timezone.trim()) return "时区不能为空（内置供应商会自动带出，其余填 IANA 名）";
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
  if (d.isPeak) e.timezone = d.timezone.trim();
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
function PriceInputs(props) {
  const { d, set, mode } = props;
  const key = (k) => k;
  const hit = mode === "flat" ? key("flatHit") : mode === "peak" ? key("peakHit") : key("valleyHit");
  const miss = mode === "flat" ? key("flatMiss") : mode === "peak" ? key("peakMiss") : key("valleyMiss");
  const output = mode === "flat" ? key("flatOutput") : mode === "peak" ? key("peakOutput") : key("valleyOutput");
  const cell = (labelText, k) => el(
    "span",
    { className: "meowcb_set_price" },
    el("span", { className: "meowcb_set_label" }, labelText),
    el("input", {
      className: "meowcb_set_input meowcb_set_input_num",
      value: d[k],
      onChange: (e) => set({ [k]: e.target.value }),
      inputMode: "decimal",
      placeholder: "元/百万"
    })
  );
  return el(
    "div",
    { className: "meowcb_set_line" },
    cell("缓存命中", hit),
    cell("缓存未命中", miss),
    cell("输出", output)
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
    // 第一行：供应商 + 模型 + 峰谷开关
    el(
      "div",
      { className: "meowcb_set_line" },
      el("span", { className: "meowcb_set_label" }, "供应商"),
      el("input", {
        className: "meowcb_set_input meowcb_set_input_grow",
        value: draft.provider,
        onChange: (e) => {
          const provider = e.target.value;
          const known = PROVIDER_TIMEZONE[provider.trim().toLowerCase()];
          set(known ? { provider, timezone: known } : { provider });
        },
        placeholder: "deepseek-official / openrouter，留空=通配"
      }),
      el("span", { className: "meowcb_set_label" }, "模型"),
      el("input", {
        className: "meowcb_set_input meowcb_set_input_grow",
        value: draft.model,
        onChange: (e) => set({ model: e.target.value }),
        placeholder: "glm-5.3-flash"
      }),
      el(
        "label",
        { className: "meowcb_set_check" },
        el("input", {
          type: "checkbox",
          checked: draft.isPeak,
          onChange: (e) => set({ isPeak: e.target.checked })
        }),
        el("span", null, "是峰谷价")
      )
    ),
    draft.isPeak ? el(
      "div",
      { className: "meowcb_set_editor" },
      // 峰价 + 时间同行；时区仅供应商不在内置表时出现
      el(
        "div",
        { className: "meowcb_set_line" },
        el("span", { className: "meowcb_set_label" }, "峰价"),
        el("input", {
          className: "meowcb_set_input meowcb_set_input_time" + (draft.whenText.trim() ? "" : " meowcb_set_input_err"),
          value: draft.whenText,
          onChange: (e) => set({ whenText: e.target.value }),
          placeholder: "[mon-fri][09:00-12:00, 14:00-18:00]，多组用 + 连接"
        }),
        tzFor(draft.provider).auto ? null : el(
          "span",
          { className: "meowcb_set_price" },
          el("span", { className: "meowcb_set_label" }, "时区"),
          el("input", {
            className: "meowcb_set_input meowcb_set_input_save" + (draft.timezone.trim() ? "" : " meowcb_set_input_err"),
            value: draft.timezone,
            onChange: (e) => set({ timezone: e.target.value }),
            placeholder: "Asia/Shanghai"
          })
        )
      ),
      el(PriceInputs, { d: draft, set, mode: "peak" }),
      el("div", { className: "meowcb_set_section" }, "谷价"),
      el(PriceInputs, { d: draft, set, mode: "valley" })
    ) : el(PriceInputs, { d: draft, set, mode: "flat" }),
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
      el("span", null, `${entry.provider ?? "全部路由"} / ${entry.model}${tier}`),
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
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: SETTINGS_NS,
        order: 30,
        label: () => "喵缓存账单",
        inject: () => ({ scope })
      },
      BillingSection
    )
  );
}
function BillingSection(props) {
  return el(
    "div",
    { className: "meowcb_set_page" },
    el("h2", { className: "meowcb_set_title" }, "喵缓存账单"),
    el(
      "p",
      { className: "meowcb_set_subtitle" },
      "上下文缓存到底花了多少钱，这里能改价、能补价。改完即时生效，无需重启。"
    ),
    el(BillingCard, { scope: props.scope })
  );
}

// src/client.ts
var CSS_ID2 = "meow-cachebilling-css";
var CSS2 = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_grid{display:grid;grid-template-columns:max-content 1fr 1fr 1fr;column-gap:10px;row-gap:2px;margin-top:4px;align-items:baseline}
.meowcb_lab{color:var(--dsw-alias-label-secondary);font-weight:400;white-space:nowrap}
.meowcb_t{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}
.meowcb_h{color:var(--dsw-alias-label-secondary);font-weight:400;text-align:right;white-space:nowrap}
.meowcb_v{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500;text-align:right}
.meowcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.meowcb_stat{display:flex;align-items:center;margin-top:4px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_notice{color:#f59e0b;font-size:11px;line-height:16px}
.meowcb_chart{margin-top:8px}
.meowcb_charthead{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.meowcb_svg{display:block;width:100%;height:auto}
.meowcb_axis{stroke:var(--dsw-alias-border-l3);stroke-width:1}
.meowcb_avg{stroke:#60a5fa;stroke-width:1.5;fill:none}
.meowcb_cur{stroke:#f59e0b;stroke-width:1.5;fill:none}
.meowcb_dotavg{fill:#60a5fa}
.meowcb_dotcur{fill:#f59e0b}
.meowcb_axlabel{fill:var(--dsw-alias-label-caption);font-size:9px}
.meowcb_legend{display:flex;gap:12px;align-items:center;margin-top:2px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_sw{display:inline-block;width:10px;height:2px;margin-right:4px;vertical-align:middle}
.meowcb_sw-avg{background:#60a5fa}
.meowcb_sw-cur{background:#f59e0b}
`;
function isBillableProvider(provider) {
  return typeof provider === "string" && provider !== "";
}
function formatAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (amount >= 0.01) return amount.toFixed(2);
  let exp = Math.floor(Math.log10(amount));
  let sig = Math.round(amount / Math.pow(10, exp));
  if (sig >= 10) {
    exp += 1;
    sig = 1;
  }
  const value = sig * Math.pow(10, exp);
  return value >= 0.01 ? value.toFixed(2) : value.toFixed(-exp);
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
  const symbol = view.currency === "USD" ? "$" : "¥";
  const official = isOfficialDeepSeek(view.provider);
  const modelSuffix = typeof view.model === "string" && view.model !== "" ? ` · ${view.model}` : "";
  const labels = official ? TIER_LABEL : TIER_LABEL_GENERIC;
  const tierLabel = typeof view.tier === "string" && view.tier in labels ? labels[view.tier] : "一口价";
  const tierText = `${tierLabel}${modelSuffix}`;
  if (view.priceMatched === false) {
    const notice = doc.createElement("div");
    notice.className = "meowcb_notice";
    notice.textContent = "［喵缓存账单］当前模型无价格数据，请去设置界面添加。以下为Deepseek价格，仅供参考：";
    put(notice);
  }
  const grid = doc.createElement("div");
  grid.className = "meowcb_grid";
  const cell = (className, text) => {
    const el2 = doc.createElement("div");
    el2.className = className;
    el2.textContent = text;
    grid.appendChild(el2);
  };
  cell("meowcb_lab", `当前 总价(${symbol})`);
  cell("meowcb_h", "缓存命中");
  cell("meowcb_h", "缓存未命中");
  cell("meowcb_h", "输出");
  const tableRow = (label, hit, miss, out) => {
    const lab = doc.createElement("div");
    lab.className = "meowcb_lab";
    lab.appendChild(doc.createTextNode(label));
    lab.appendChild(doc.createTextNode(" "));
    const t = doc.createElement("span");
    t.className = "meowcb_t";
    t.textContent = formatAmount(hit + miss + out);
    lab.appendChild(t);
    grid.appendChild(lab);
    cell("meowcb_v", formatAmount(hit));
    cell("meowcb_v", formatAmount(miss));
    cell("meowcb_v", formatAmount(out));
  };
  tableRow("一步", cost, missCost, outputCost);
  const turnHit = Number.isFinite(view.turnHitCost) ? view.turnHitCost : 0;
  const turnMiss = Number.isFinite(view.turnMissCost) ? view.turnMissCost : 0;
  const turnOut = Number.isFinite(view.turnOutputCost) ? view.turnOutputCost : 0;
  tableRow("一轮", turnHit, turnMiss, turnOut);
  const sessionHit = Number.isFinite(view.sessionCacheHitCost) ? view.sessionCacheHitCost : 0;
  const sessionMiss = Number.isFinite(view.sessionMissCost) ? view.sessionMissCost : 0;
  const sessionOut = Number.isFinite(view.sessionOutputCost) ? view.sessionOutputCost : 0;
  tableRow("会话", sessionHit, sessionMiss, sessionOut);
  put(grid);
  const missSteps = Number.isFinite(view.sessionMissSteps) ? view.sessionMissSteps : 0;
  const fullMissSteps = Number.isFinite(view.sessionFullMissSteps) ? view.sessionFullMissSteps : 0;
  const statRow = (color, text) => {
    const el2 = doc.createElement("div");
    el2.className = "meowcb_stat";
    const swatch = doc.createElement("span");
    swatch.className = "meowcb_swatch";
    swatch.style.background = color;
    el2.appendChild(swatch);
    el2.appendChild(doc.createTextNode(text));
    put(el2);
  };
  if (missSteps > 0) statRow("#fb7185", `缓存失效 ${missSteps} 次`);
  if (fullMissSteps > 0) statRow("#f43f5e", `完全失效 ${fullMissSteps} 次`);
  const foot = doc.createElement("div");
  foot.className = "meowcb_foot";
  foot.textContent = tierText;
  put(foot);
  renderCurve(doc, put, view);
}
function renderCurve(doc, put, view) {
  const curve = view.curve;
  if (!curve) return;
  const tierLabel = view.tier === "peak" ? "峰价" : view.tier === "offPeak" ? "谷价" : "一口价";
  const heading = doc.createElement("div");
  heading.className = "meowcb_charthead";
  heading.textContent = `对于 ${view.model ?? "当前模型"}（${tierLabel}）：`;
  put(heading);
  const W = 280;
  const H = 110;
  const L = 40;
  const R = 10;
  const T = 10;
  const B = 18;
  const lastCurN = curve.cur.length > 0 ? curve.cur[curve.cur.length - 1][0] : 0;
  const xmax = Math.max(curve.avg.length, lastCurN, 1);
  let ymax = 0;
  for (const v of curve.avg) if (v > ymax) ymax = v;
  for (const [, v] of curve.cur) if (v > ymax) ymax = v;
  if (ymax <= 0) ymax = 1;
  const x = (n) => L + (n - 1) / Math.max(xmax - 1, 1) * (W - L - R);
  const y = (v) => H - B - v / ymax * (H - B - T);
  const NS = "http://www.w3.org/2000/svg";
  const el2 = (tag, cls) => {
    const node = doc.createElementNS(NS, tag);
    node.setAttribute("class", cls);
    return node;
  };
  const svg = el2("svg", "meowcb_svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const axisY = el2("line", "meowcb_axis");
  axisY.setAttribute("x1", String(L));
  axisY.setAttribute("y1", String(T));
  axisY.setAttribute("x2", String(L));
  axisY.setAttribute("y2", String(H - B));
  const axisX = el2("line", "meowcb_axis");
  axisX.setAttribute("x1", String(L));
  axisX.setAttribute("y1", String(H - B));
  axisX.setAttribute("x2", String(W - R));
  axisX.setAttribute("y2", String(H - B));
  svg.appendChild(axisY);
  svg.appendChild(axisX);
  if (curve.avg.length > 0) {
    const line = el2("polyline", "meowcb_avg");
    line.setAttribute("points", curve.avg.map((v, i) => `${x(i + 1)},${y(v)}`).join(" "));
    svg.appendChild(line);
    const dot = el2("circle", "meowcb_dotavg");
    dot.setAttribute("cx", String(x(curve.avg.length)));
    dot.setAttribute("cy", String(y(curve.avg[curve.avg.length - 1])));
    dot.setAttribute("r", "2");
    svg.appendChild(dot);
  }
  if (curve.cur.length > 0) {
    const line = el2("polyline", "meowcb_cur");
    line.setAttribute("points", curve.cur.map(([n, v]) => `${x(n)},${y(v)}`).join(" "));
    svg.appendChild(line);
    const dot = el2("circle", "meowcb_dotcur");
    dot.setAttribute("cx", String(x(curve.cur[curve.cur.length - 1][0])));
    dot.setAttribute("cy", String(y(curve.cur[curve.cur.length - 1][1])));
    dot.setAttribute("r", "2");
    svg.appendChild(dot);
  }
  const yLabel = el2("text", "meowcb_axlabel");
  yLabel.setAttribute("x", String(L + 4));
  yLabel.setAttribute("y", String(T + 2));
  yLabel.textContent = `¥${formatAmount(ymax)}`;
  const xLabel = el2("text", "meowcb_axlabel");
  xLabel.setAttribute("x", String(W - R));
  xLabel.setAttribute("y", String(H - 4));
  xLabel.setAttribute("text-anchor", "end");
  xLabel.textContent = `${xmax} 步`;
  svg.appendChild(yLabel);
  svg.appendChild(xLabel);
  put(svg);
  const legend = doc.createElement("div");
  legend.className = "meowcb_legend";
  const items = [
    ["meowcb_sw-avg", curve.sessions > 0 ? `平均 · ${curve.sessions} 个会话` : "平均 · 暂无样本"],
    ["meowcb_sw-cur", "本会话"]
  ];
  for (const [cls, text] of items) {
    const item = doc.createElement("span");
    const sw = doc.createElement("span");
    sw.className = `meowcb_sw ${cls}`;
    item.appendChild(sw);
    item.appendChild(doc.createTextNode(text));
    legend.appendChild(item);
  }
  put(legend);
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
    "data-meowcb-version": "curve-1",
    style: { display: "none" }
  });
}
var inject = ["slots", "connection", "remote", "settingsScope", "settingsSchema"];
function apply(ctx) {
  console.log("[meow-cachebilling] client bundle: curve-1");
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
