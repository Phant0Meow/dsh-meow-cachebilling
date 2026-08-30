window.__ModuleLoader__.load({
  id: "dsh-cache-billing",
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
var CSS_ID = "dsh-cache-billing-css";
var CSS = `
.dshcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.dshcb_billhead{align-items:center;gap:6px;display:flex;color:var(--dsw-alias-label-secondary)}
.dshcb_billtotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.dshcb_bilrows{margin:4px 0 0;padding:0}
.dshcb_bilrow{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}
.dshcb_bilrow dt{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin:0}
.dshcb_bilrow dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0;font-weight:500;text-align:right}
.dshcb_tok{color:var(--dsw-alias-label-caption);font-weight:400;margin-left:4px}
.dshcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.dshcb_srows{margin:2px 0 0;padding:0 0 0 16px}
.dshcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
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
var latestView;
function isContextPanel(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.getAttribute("role") !== "dialog") return false;
  const label = node.getAttribute("aria-label") ?? "";
  return /of context used|上下文已用/i.test(label);
}
function buildRow(doc, o) {
  const row = doc.createElement("div");
  row.className = "dshcb_bilrow";
  const dt = doc.createElement("dt");
  const swatch = doc.createElement("span");
  swatch.className = "dshcb_swatch";
  swatch.style.background = o.color;
  dt.appendChild(swatch);
  dt.appendChild(doc.createTextNode(o.label));
  if (o.tokens >= 0) {
    const tok = doc.createElement("span");
    tok.className = "dshcb_tok";
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
  if (!view || !isBillableProvider(view.provider)) {
    return;
  }
  if (view.available !== true) {
    const empty = doc.createElement("div");
    empty.className = "dshcb_foot";
    empty.textContent = "缓存账单：本会话暂无 Token 用量";
    put(empty);
    return;
  }
  const cost = Number.isFinite(view.cost) ? view.cost : 0;
  const missCost = Number.isFinite(view.missCost) ? view.missCost : 0;
  const outputCost = Number.isFinite(view.outputCost) ? view.outputCost : 0;
  const total = cost + missCost + outputCost;
  const symbol = view.currency === "USD" ? "$" : "¥";
  const tierLabel = typeof view.tier === "string" && view.tier in TIER_LABEL ? TIER_LABEL[view.tier] : "估算";
  const tierText = typeof view.model === "string" && view.model !== "" ? `${tierLabel} · ${view.model}` : tierLabel;
  const detailRows = (o) => {
    const rows = doc.createElement("div");
    rows.className = "dshcb_srows";
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
      label: "当前步",
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
      label: sessionRounds > 0 ? `会话累计 · ${sessionRounds} 步` : "会话累计",
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
  foot.className = "dshcb_foot";
  foot.textContent = tierText;
  put(foot);
}
function ensureBill(panel) {
  let bill = panel.querySelector(":scope > .dshcb_bill");
  if (bill === null) {
    bill = panel.ownerDocument.createElement("div");
    bill.className = "dshcb_bill";
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
    "data-dsh-cache-billing": "hook",
    style: { display: "none" }
  });
}
var inject = ["slots"];
function apply(ctx) {
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-cache-billing";
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
        id: "dsh-cache-billing-data-hook",
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
