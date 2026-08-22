window.__ModuleLoader__.load({ id: "meow-cachebilling", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);
var CSS_ID = "meow-cachebilling-css";
var CSS = `
.meowcb_root{display:flex;align-items:center;justify-content:flex-end;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin:0 auto;font-size:12px;line-height:20px}
.meowcb_amount{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
`;
function isOfficialDeepSeek(provider) {
  if (typeof provider !== "string" || provider === "") return false;
  return provider.toLowerCase().includes("deepseek");
}
function formatAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (amount < 0.01) {
    return amount.toFixed(9).replace(/(\.\d{2}\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return amount.toFixed(2);
}
function formatCost(amount, currency) {
  const symbol = currency === "USD" ? "$" : "\xA5";
  return `${symbol}${formatAmount(amount)}`;
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
function CacheReadout(props) {
  const data = typeof props.useProjection === "function" ? props.useProjection("cacheBilling") : void 0;
  if (data === void 0 || data === null) {
    return React.createElement(
      "div",
      { className: "meowcb_root", title: 'useProjection("cacheBilling") \u4E3A\u7A7A\u2014\u2014host \u6295\u5F71\u672A\u6CE8\u518C' },
      React.createElement("span", { key: "text" }, "\u55B5\u8D26\u5355\uFF1A\u65E0\u6295\u5F71\u6570\u636E")
    );
  }
  if (!isOfficialDeepSeek(data.provider)) {
    return null;
  }
  const cost = Number.isFinite(data.cost) ? data.cost : 0;
  const missCost = Number.isFinite(data.missCost) ? data.missCost : 0;
  const outputCost = Number.isFinite(data.outputCost) ? data.outputCost : 0;
  const tierText = typeof data.tier === "string" && data.tier in TIER_LABEL ? TIER_LABEL[data.tier] : "\u4F30\u7B97";
  const unit = typeof data.unitPricePerM === "number" ? `\xA5${data.unitPricePerM}/M` : "\u5355\u4EF7\u672A\u77E5";
  const cur = data.currency ?? "CNY";
  const detail = [
    `\u5F53\u524D\u8F6E\uFF08turn ${data.turn ?? "?"} / step ${data.step ?? "?"}\uFF09`,
    `\u7F13\u5B58 ${formatTokens(data.cacheReadTokens ?? 0)} tok \xD7 ${unit}\uFF08${tierText}\uFF09`,
    `\u6A21\u578B ${data.model ?? "\u672A\u77E5"}`,
    `\u547D\u4E2D\u7387 ${data.hitRate !== null && data.hitRate !== void 0 ? `${data.hitRate}%` : "\u2014"}`,
    `\u539F\u59CB\u6295\u5F71 ${JSON.stringify(data).slice(0, 220)}`
  ].join(" \xB7 ");
  const total = cost + missCost + outputCost;
  const text = data.available === true ? `\u672C\u8F6E ${formatCost(total, cur)}\uFF5C\u7F13\u5B58 ${formatAmount(cost)} \xB7 \u672A\u547D\u4E2D ${formatAmount(missCost)} \xB7 \u8F93\u51FA ${formatAmount(outputCost)}` : "\u55B5\u8D26\u5355\uFF1A\u672C\u4F1A\u8BDD\u6682\u65E0 Token \u7528\u91CF";
  return React.createElement(
    "div",
    { className: "meowcb_root", title: detail },
    React.createElement("span", { key: "text" }, text)
  );
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
  ctx.slots.inject("conversation.composer.dock", () => {
    const dispose = ctx.slots.register(
      {
        name: "conversation.composer.dock",
        id: "meow-cachebilling",
        order: 1
      },
      CacheReadout
    );
    return () => {
      dispose();
    };
  });
}
//# sourceMappingURL=client.raw.js.map

return module.exports; } });
