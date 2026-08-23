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
var React = __toESM(require("react"), 1);
var CSS_ID = "meow-cachebilling-css";
var CSS = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_billhead{align-items:center;gap:6px;display:flex;color:var(--dsw-alias-label-secondary)}
.meowcb_billtotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.meowcb_bilrows{margin:4px 0 0;padding:0}
.meowcb_bilrow{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}
.meowcb_bilrow dt{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin:0}
.meowcb_bilrow dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0;font-weight:500;text-align:right}
.meowcb_tok{color:var(--dsw-alias-label-caption);font-weight:400;margin-left:4px}
.meowcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
`;
function isOfficialDeepSeek(provider) {
  if (typeof provider !== "string" || provider === "") return false;
  return provider.toLowerCase().includes("deepseek");
}
function formatAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (amount < 0.01) {
    const magnitude = Math.floor(Math.log10(amount));
    const rounded = Math.round(amount * Math.pow(10, -magnitude)) / Math.pow(10, -magnitude);
    return rounded.toFixed(Math.max(0, -magnitude)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return amount.toFixed(2);
}
function formatTokens(n) {
  const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1e3) return String(Math.round(n));
  if (n < 1e6) return `${scaled(n / 1e3)}K`;
  return `${scaled(n / 1e6)}M`;
}
var TIER_LABEL = {
  peak: "\u5CF0\u65F6\u4EF7",
  offPeak: "\u8C37\u65F6\u4EF7",
  flat: "\u5E73\u4EF7"
};
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
  const put = (el) => {
    bill.appendChild(el);
  };
  if (!view || !isOfficialDeepSeek(view.provider)) {
    return;
  }
  if (view.available !== true) {
    const empty = doc.createElement("div");
    empty.className = "meowcb_foot";
    empty.textContent = "\u55B5\u8D26\u5355\uFF1A\u672C\u4F1A\u8BDD\u6682\u65E0 Token \u7528\u91CF";
    put(empty);
    return;
  }
  const cost = Number.isFinite(view.cost) ? view.cost : 0;
  const missCost = Number.isFinite(view.missCost) ? view.missCost : 0;
  const outputCost = Number.isFinite(view.outputCost) ? view.outputCost : 0;
  const total = cost + missCost + outputCost;
  const symbol = view.currency === "USD" ? "$" : "\xA5";
  const tierText = typeof view.tier === "string" && view.tier in TIER_LABEL ? TIER_LABEL[view.tier] : "\u4F30\u7B97";
  const hitRateText = view.hitRate !== null && view.hitRate !== void 0 ? `${view.hitRate}%` : "\u2014";
  const head = doc.createElement("div");
  head.className = "meowcb_billhead";
  const title = doc.createElement("span");
  title.textContent = "\u672C\u8F6E API";
  const amount = doc.createElement("span");
  amount.className = "meowcb_billtotal";
  amount.textContent = `${symbol}${formatAmount(total)}`;
  head.appendChild(title);
  head.appendChild(amount);
  put(head);
  const rows = doc.createElement("div");
  rows.className = "meowcb_bilrows";
  rows.appendChild(
    buildRow(doc, {
      color: "#34d399",
      label: "\u7F13\u5B58\u547D\u4E2D",
      tokens: Number(view.cacheReadTokens ?? 0),
      amountText: `${symbol}${formatAmount(cost)}`
    })
  );
  rows.appendChild(
    buildRow(doc, {
      color: "#f59e0b",
      label: "\u7F13\u5B58\u672A\u547D\u4E2D",
      tokens: Math.max(0, Number(view.totalInputTokens ?? 0) - Number(view.cacheReadTokens ?? 0)),
      amountText: `${symbol}${formatAmount(missCost)}`
    })
  );
  rows.appendChild(
    buildRow(doc, {
      color: "#60a5fa",
      label: "\u8F93\u51FA",
      tokens: -1,
      amountText: `${symbol}${formatAmount(outputCost)}`
    })
  );
  put(rows);
  const foot = doc.createElement("div");
  foot.className = "meowcb_foot";
  foot.textContent = [
    `\u7B2C ${view.turn ?? "?"} \u8F6E`,
    String(view.model ?? "\u672A\u77E5\u6A21\u578B"),
    tierText,
    `\u547D\u4E2D\u7387 ${hitRateText}`
  ].join(" \xB7 ");
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
  (0, React.useEffect)(() => {
    latestView = data ?? void 0;
    refreshOpenPanels();
  }, [data]);
  return React.createElement("span", {
    "data-meow-cachebilling": "hook",
    style: { display: "none" }
  });
}
var inject = ["slots"];
function apply(ctx) {
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "meow-cachebilling";
    tag.dataset.pluginCss = CSS_ID;
    tag.textContent = CSS;
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
}
    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
