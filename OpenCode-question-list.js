// ==UserScript==
// @name         OpenCode-question-list
// @namespace    https://github.com/firesahc/webai-question-list
// @version      1.8.0
// @description  在 OpenCode 页面顶部工具栏添加"问题列表"按钮，提取所有用户提问并支持点击跳转到对应位置
// @author       firesahc
// @match        http://127.0.0.1:4096/*
// @match        http://localhost:4096/*
// @match        http://127.0.0.1:4069/*
// @match        http://localhost:4069/*
// @match        file:///*OpenCode*.html
// @match        file:///*opencode*/*.html
// @license      MIT
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════
  // 日志工具
  // ════════════════════════════════════════════════════════════

  var TAG = "[问题列表]";
  var DEBUG = true;

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("%c" + TAG, "color:#6366f1;font-weight:bold");
    console.log.apply(console, args);
  }
  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("%c" + TAG, "color:#f59e0b;font-weight:bold");
    console.warn.apply(console, args);
  }
  function err() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("%c" + TAG, "color:#ef4444;font-weight:bold");
    console.error.apply(console, args);
  }

  /**
   * 在页面角上插入可见标记，确证脚本已加载
   */
  function showLoadMarker() {
    var m = document.createElement("div");
    m.id = "__qlist_loaded_marker";
    m.style.cssText =
      "position:fixed;bottom:4px;left:4px;z-index:999999;" +
      "width:8px;height:8px;border-radius:50%;" +
      "background:#6366f1;box-shadow:0 0 4px #6366f1;opacity:0.5;";
    m.title = TAG + " v1.8 已加载";
    document.body.appendChild(m);
    log("🔵 脚本已加载 (v1.8)，标记已插入页面底部");
  }

  // ════════════════════════════════════════════════════════════
  // 工具函数
  // ════════════════════════════════════════════════════════════

  function truncate(text, maxLen) {
    if (!text) return "";
    return text.length > maxLen ? text.slice(0, maxLen) + "\u2026" : text;
  }

  function getCleanText(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * 滚动到目标元素的最上方，避开顶部工具栏和 sticky session-title
   */
  function scrollAndHighlight(targetEl, textEl) {
    if (!targetEl) { warn("scrollAndHighlight: targetEl 为空"); return; }

    // 解除 SingleFile 惰性渲染
    targetEl.style.contentVisibility = "visible";
    targetEl.style.containIntrinsicSize = "auto none";

    // 动态计算顶部偏移量
    //  header(h-10) = 40px + session-title sticky(pb-4 + padding) ≈ 100~130px
    var headerEl = document.querySelector("header");
    var sessionTitleEl = document.querySelector('[data-session-title]');
    var offset = 40; // header 基础高度
    if (headerEl) { offset = headerEl.getBoundingClientRect().height || 40; }
    if (sessionTitleEl) {
      var stRect = sessionTitleEl.getBoundingClientRect();
      offset += stRect.height || 80;
    } else {
      offset += 80; // 兜底估算
    }
    offset += 12; // 额外留白
    log("scrollAndHighlight: 计算偏移量=" + offset + "px");

    // 使用 scroll-margin-top 让 scrollIntoView 自动扣除偏移
    var prevMargin = targetEl.style.scrollMarginTop;
    targetEl.style.scrollMarginTop = offset + "px";
    targetEl.scrollIntoView({ behavior: "smooth", block: "start" });

    // 高亮
    var hl = textEl || targetEl;
    var origBg = hl.style.backgroundColor;
    var origTrans = hl.style.transition;
    hl.style.transition = "background-color 0.2s ease";
    hl.style.backgroundColor = "rgba(99,102,241,0.12)";
    setTimeout(function () {
      hl.style.backgroundColor = origBg;
      hl.style.transition = origTrans;
    }, 2500);

    // 还原 scroll-margin
    setTimeout(function () {
      targetEl.style.scrollMarginTop = prevMargin;
    }, 800);
    log("✅ 已滚动到消息位置并高亮");
  }

  // ════════════════════════════════════════════════════════════
  // 配置
  // ════════════════════════════════════════════════════════════

  var CFG = {
    panelId: "question-list-panel",
    listId: "question-list-items",
    msgSelector: '[data-slot="user-message-text"]',
    itemClass: "qlist-item",
    btnAriaLabel: "问题列表",
    maxRetries: 30,
    retryInterval: 500, // ms
  };

  // ════════════════════════════════════════════════════════════
  // 问题提取
  // ════════════════════════════════════════════════════════════

  function extractQuestions() {
    var els = document.querySelectorAll(CFG.msgSelector);
    log("extractQuestions: 找到 " + els.length + " 条用户消息");
    var questions = [];

    for (var i = 0; i < els.length; i++) {
      var textEl = els[i];
      var text = getCleanText(textEl);
      if (!text) continue;

      var container =
        textEl.closest('[data-message-id]') ||
        textEl.closest('[id^="message-"]') ||
        textEl.closest('[data-component="user-message"]') ||
        textEl;

      questions.push({
        id: container.getAttribute("id") || "",
        index: questions.length + 1,
        text: text,
        containerEl: container,
        textEl: textEl,
      });
    }
    log("extractQuestions: 解析出 " + questions.length + " 条有效提问");
    return questions;
  }

  // ════════════════════════════════════════════════════════════
  // 面板 DOM 构建
  // ════════════════════════════════════════════════════════════

  /**
   * 创建面板内部 DOM（不含外框样式，由调用方设置）
   */
  function createPanelInner(p) {
    // 标题栏 — 风格对齐审查面板的 tab 标题区域
    var head = document.createElement("div");
    head.style.cssText =
      "display:flex;align-items:center;height:36px;" +
      "padding:0 12px;" +
      "border-bottom:1px solid var(--border-weaker-base);";

    var title = document.createElement("span");
    title.textContent = "\u95EE\u9898\u5217\u8868"; // 问题列表
    title.style.cssText =
      "font-size:12px;font-weight:600;color:var(--text-base, #333);" +
      "letter-spacing:0.01em;";

    head.appendChild(title);

    // 列表区
    var list = document.createElement("div");
    list.id = CFG.listId;
    list.style.cssText =
      "display:flex;flex-direction:column;gap:2px;" +
      "padding:8px 8px;";

    p.appendChild(head);
    p.appendChild(list);
  }

  /**
   * 确保问题列表面板存在。
   * 优先级：
   *   1. 已存在 → 直接返回
   *   2. review-panel 可用 → 嵌入其中（左侧 260px）
   *   3. review-panel 不可用 → 独立浮动面板（position:fixed 贴右侧）
   *
   * 并开启 MutationObserver：一旦 review-panel 出现，自动将独立面板迁移进去。
   */
  function ensurePanelDOM() {
    log("ensurePanelDOM: 开始检查面板 DOM...");

    // ── 已存在？直接返回 ──
    var panel = document.getElementById(CFG.panelId);
    if (panel) {
      log("ensurePanelDOM: ✅ 面板已存在, id=" + CFG.panelId +
          ", standalone=" + panel.hasAttribute("data-standalone"));
      return panel;
    }

    var reviewPanel = document.getElementById("review-panel");
    var flexContainer = null;

    if (reviewPanel) {
      flexContainer =
        reviewPanel.querySelector(".size-full.flex") ||
        reviewPanel.querySelector('[class*="size-full"][class*="flex"]') ||
        reviewPanel.querySelector(":scope > div");
    }

    // ── 方式1: 嵌入 review-panel ──
    if (reviewPanel && flexContainer) {
      log("ensurePanelDOM: 找到 review-panel + 内部容器，嵌入其中");

      panel = document.createElement("div");
      panel.id = CFG.panelId;
      panel.setAttribute("aria-hidden", "false");
      panel.classList.add("hidden");
      panel.style.cssText =
        "width:260px;flex-shrink:0;" +
        "border-right:1px solid var(--border-weaker-base);" +
        "overflow-y:auto;overflow-x:hidden;" +
        "background:var(--background-base);" +
        "font-family:var(--font-family-sans, ui-sans-serif, system-ui);";
      createPanelInner(panel);
      flexContainer.insertBefore(panel, flexContainer.firstChild);
      log("ensurePanelDOM: ✅ 面板已嵌入 review-panel (260px)");
      return panel;
    }

    // ── 方式2: review-panel 不可用 → 独立浮动面板 ──
    log("ensurePanelDOM: review-panel 或内部容器不可用，使用独立浮动面板");
    log("  review-panel 存在: " + !!reviewPanel + ", flexContainer: " + !!flexContainer);
    if (!reviewPanel) {
      log("  └─ 当前页面 ID 列表:", Array.from(document.querySelectorAll("[id]")).map(function(e){return e.id}).slice(0, 20).join(", "));
    }

    panel = document.createElement("div");
    panel.id = CFG.panelId;
    panel.setAttribute("aria-hidden", "false");
    panel.setAttribute("data-standalone", "true");
    panel.classList.add("hidden");
    panel.style.cssText =
      "position:fixed;top:40px;right:0;bottom:0;z-index:9000;" +
      "width:280px;" +
      "background:var(--background-base, #fff);" +
      "border-left:1px solid var(--border-weaker-base, #e5e5e5);" +
      "box-shadow:var(--shadow-md, -4px 0 14px rgba(0,0,0,0.08));" +
      "font-family:var(--font-family-sans, ui-sans-serif, system-ui);" +
      "overflow-y:auto;overflow-x:hidden;";
    createPanelInner(panel);
    document.body.appendChild(panel);
    log("ensurePanelDOM: ✅ 已创建独立浮动面板 (fixed, right:0, top:40px)");

    // 监听 review-panel 出现 → 自动迁移面板到其中
    var migObs = new MutationObserver(function () {
      var rp = document.getElementById("review-panel");
      if (!rp || !panel.hasAttribute("data-standalone")) return;
      var fc =
        rp.querySelector(".size-full.flex") ||
        rp.querySelector('[class*="size-full"][class*="flex"]') ||
        rp.querySelector(":scope > div");
      if (!fc) return;

      log("ensurePanelDOM: 🔄 检测到 review-panel 出现，迁移面板");
      panel.removeAttribute("data-standalone");
      panel.style.cssText =
        "width:260px;flex-shrink:0;" +
        "border-right:1px solid var(--border-weaker-base);" +
        "overflow-y:auto;overflow-x:hidden;" +
        "background:var(--background-base);" +
        "font-family:var(--font-family-sans, ui-sans-serif, system-ui);";
      fc.insertBefore(panel, fc.firstChild);
      migObs.disconnect();
      log("ensurePanelDOM: ✅ 面板已迁移到 review-panel 内");
    });
    migObs.observe(document.body, { childList: true, subtree: true });

    return panel;
  }

  // ════════════════════════════════════════════════════════════
  // 工具栏按钮（多策略查找容器）
  // ════════════════════════════════════════════════════════════

  /**
   * 多种方式查找适合放置按钮的容器
   * 策略优先级：
   *   0. 目标容器: .hidden.md\:flex（用户指定的精确位置）
   *   1. 精确 class 选择器
   *   2. 属性包含匹配（兼容 class 被框架修改的情况）
   *   3. 遍历 header 的直接子元素
   *   4. 全页面查找 toolbar/titlebar 相关元素
   */
  function findButtonContainer() {
    log("findButtonContainer: 开始查找容器...");

    // ═══ 策略0: 用户指定目标容器 ═══
    // <div class="hidden md:flex items-center gap-1 shrink-0">
    // 注意: ":" 在 class 选择器中需转义，同时用属性选择器兜底
    var targetSelectors = [
      '.hidden.md\\:flex.items-center.gap-1.shrink-0',
      '.hidden.md\\:flex',
      '[class*="hidden"][class*="md:flex"][class*="items-center"][class*="gap-1"]',
      '[class*="md:flex"][class*="shrink-0"]',
    ];
    for (var ts = 0; ts < targetSelectors.length; ts++) {
      try {
        var s0 = document.querySelectorAll(targetSelectors[ts]);
        if (s0.length > 0) {
          log("  ✅ 策略0命中: \"" + targetSelectors[ts] + "\" → " + s0.length + " 个匹配");
          log("    └─ class=" + s0[0].className);
          return s0[0];
        }
      } catch (e) {
        // 选择器语法错误则跳过
        log("  策略0尝试[" + ts + "] 选择器无效: " + e.message);
      }
    }
    log("  策略0: 未命中目标容器");

    // 策略1: 精确 class 组合
    var s1 = document.querySelectorAll(".flex.items-center.gap-1.shrink-0");
    log("  策略1 (class组合): " + s1.length + " 个匹配");
    for (var i = 0; i < s1.length; i++) {
      // 查找包含已知按钮的容器
      var knownBtns = s1[i].querySelectorAll("button[aria-label]");
      var labels = [];
      for (var j = 0; j < knownBtns.length; j++) {
        labels.push(knownBtns[j].getAttribute("aria-label"));
      }
      log("    [" + i + "] 内含按钮: " + (labels.length ? labels.join(", ") : "(空)"));
      if (
        labels.indexOf("切换侧边栏") >= 0 ||
        labels.indexOf("新对话") >= 0 ||
        labels.indexOf("New Session") >= 0 ||
        labels.length >= 2
      ) {
        log("  ✅ 策略1命中: 索引 " + i);
        return s1[i];
      }
    }

    // 策略2: 宽泛属性匹配
    var s2 = document.querySelectorAll(
      '[class*="flex"]' +
      '[class*="items-center"]' +
      '[class*="gap-1"]'
    );
    log("  策略2 (属性包含): " + s2.length + " 个匹配");
    for (var k = 0; k < s2.length; k++) {
      var btns2 = s2[k].querySelectorAll("button[aria-label]");
      if (btns2.length >= 2) {
        log("  ✅ 策略2命中: 索引 " + k + " (含 " + btns2.length + " 个按钮)");
        return s2[k];
      }
    }

    // 策略3: 通过 header 查找
    var header = document.querySelector("header");
    if (header) {
      log("  策略3: 找到 header, 搜索子元素...");
      var headerFlexes = header.querySelectorAll('[class*="flex"][class*="items-center"]');
      for (var m = 0; m < headerFlexes.length; m++) {
        var ariaBtns = headerFlexes[m].querySelectorAll("button[aria-label]");
        if (ariaBtns.length >= 1) {
          log("  ✅ 策略3命中: header 内索引 " + m + " (含 " + ariaBtns.length + " 个按钮)");
          return headerFlexes[m];
        }
      }
    } else {
      log("  策略3: 未找到 header 元素");
    }

    // 策略4: 找任意含多个 icon-button 的工具栏
    var s4 = document.querySelectorAll('[class*="titlebar"], [class*="toolbar"], [class*="header"] [class*="flex"]');
    log("  策略4 (titlebar/toolbar): " + s4.length + " 个匹配");
    for (var n = 0; n < s4.length; n++) {
      var childBtns = s4[n].querySelectorAll("button");
      if (childBtns.length >= 2) {
        log("  ✅ 策略4命中: 索引 " + n + " (含 " + childBtns.length + " 个按钮)");
        return s4[n];
      }
    }

    // 策略5: 兜底 - 如果有 s1 的结果就用第一个
    if (s1.length > 0) {
      log("  ⚠️ 策略5兜底: 使用精确匹配的第一个结果");
      return s1[0];
    }

    warn("findButtonContainer: ❌ 所有策略均未找到合适的容器");
    log("  └─ 页面 button[aria-label] 列表:",
      Array.from(document.querySelectorAll("button[aria-label]"), function(b){
        return b.getAttribute("aria-label");
      }));
    return null;
  }

  var ACTIVE_BTN_STYLE =
    "background:var(--surface-interactive-hover, rgba(0,0,0,0.08));" +
    "box-shadow:var(--shadow-xs-border, 0 0 0 1px rgba(0,0,0,0.1));";
  var IDLE_BTN_STYLE =
    "background:transparent;box-shadow:none;";

  function createButtonDOM() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", CFG.btnAriaLabel);
    btn.className = "qlist-btn"; // 便于查找和维护
    btn.style.cssText =
      IDLE_BTN_STYLE +
      "border:0;cursor:pointer;" +
      "color:var(--text-weak, #999);width:32px;height:24px;padding:0;" +
      "display:flex;align-items:center;justify-content:center;" +
      "flex-shrink:0;border-radius:6px;" +
      "transition:background-color 0.15s ease, box-shadow 0.15s ease;";
    btn.innerHTML =
      '<svg fill="none" viewBox="0 0 20 20" width="16" height="16">' +
      '<rect x="2.5" y="3.5" width="15" height="3" rx="1" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="2.5" y="8.5" width="15" height="3" rx="1" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="2.5" y="13.5" width="15" height="3" rx="1" stroke="currentColor" stroke-width="1.5"/>' +
      "</svg>";
    return btn;
  }

  /** 为按钮挂载 hover 样式（幂等：先清除旧监听器） */
  function bindBtnHover(btn) {
    // 使用命名函数引用以便清除
    if (!bindBtnHover._onEnter) {
      bindBtnHover._onEnter = function () {
        var p = document.getElementById(CFG.panelId);
        if (!p || p.classList.contains("hidden")) {
          this.style.background = "var(--surface-interactive-hover, rgba(0,0,0,0.05))";
        }
      };
      bindBtnHover._onLeave = function () {
        var p = document.getElementById(CFG.panelId);
        if (!p || p.classList.contains("hidden")) {
          this.style.background = "transparent";
        }
      };
    }
    btn.removeEventListener("mouseenter", bindBtnHover._onEnter);
    btn.removeEventListener("mouseleave", bindBtnHover._onLeave);
    btn.addEventListener("mouseenter", bindBtnHover._onEnter);
    btn.addEventListener("mouseleave", bindBtnHover._onLeave);
  }
  function syncBtnActive(isOpen) {
    var btn = document.querySelector(
      '[aria-label="' + CFG.btnAriaLabel + '"]'
    );
    if (!btn) return;
    btn.style.cssText = (isOpen ? ACTIVE_BTN_STYLE : IDLE_BTN_STYLE) +
      "border:0;cursor:pointer;" +
      "color:" + (isOpen ? "var(--text-base, #333)" : "var(--text-weak, #999)") + ";" +
      "width:32px;height:24px;padding:0;" +
      "display:flex;align-items:center;justify-content:center;" +
      "flex-shrink:0;border-radius:6px;" +
      "transition:background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;";
  }

  function ensureButton() {
    log("ensureButton: 开始检查按钮...");

    // 已有按钮？
    var existing = document.querySelector(
      '[aria-label="' + CFG.btnAriaLabel + '"]'
    );
    if (existing) {
      log("ensureButton: ✅ 按钮已存在，重新绑定事件和样式");
      existing.classList.add("qlist-btn");
      existing.onclick = null;
      existing.onclick = function (e) {
        e.stopPropagation();
        togglePanel();
      };
      existing.style.transition = "background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease";
      bindBtnHover(existing);
      return existing;
    }

    // 找容器
    var container = findButtonContainer();
    if (!container) {
      warn("ensureButton: ❌ 未找到按钮容器，无法创建按钮");
      return null;
    }

    // 创建按钮
    var btn = createButtonDOM();
    btn.onclick = function (e) {
      e.stopPropagation();
      togglePanel();
    };
    bindBtnHover(btn);

    // 轻包装（与容器内其它按钮格式对齐）
    var wrapper = document.createElement("div");
    wrapper.setAttribute("data-closed", "");
    wrapper.style.cssText = "flex-shrink:0;display:flex;";
    wrapper.appendChild(btn);

    // 插入到最左侧
    container.insertBefore(wrapper, container.firstChild);
    log("ensureButton: ✅ 按钮已创建并插入到容器最左侧");
    log("  └─ 容器 classes:", container.className);
    return btn;
  }

  function togglePanel() {
    var p = document.getElementById(CFG.panelId);
    if (!p) {
      warn("togglePanel: 面板不存在，尝试重建");
      p = ensurePanelDOM();
      if (!p) return;
    }
    var wasHidden = p.classList.contains("hidden");
    if (wasHidden) {
      p.classList.remove("hidden");
      _panelWasOpen = true;
      log("面板已打开，刷新列表");
      var qs = extractQuestions();
      renderQuestionList(qs);
      _lastMsgCount = qs.length;
      syncBtnActive(true);
    } else {
      p.classList.add("hidden");
      _panelWasOpen = false;
      log("面板已关闭");
      syncBtnActive(false);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 列表渲染
  // ════════════════════════════════════════════════════════════

  function renderQuestionList(questions) {
    log("renderQuestionList: 渲染 " + (questions ? questions.length : 0) + " 条...");

    var listEl = document.getElementById(CFG.listId);
    if (!listEl) {
      var p = document.getElementById(CFG.panelId);
      if (p) listEl = p.querySelector("#" + CFG.listId);
    }
    if (!listEl) {
      warn("renderQuestionList: ❌ 列表容器 #" + CFG.listId + " 未找到");
      return;
    }

    listEl.innerHTML = "";

    if (!questions || questions.length === 0) {
      var empty = document.createElement("div");
      empty.style.cssText =
        "padding:6px 8px;font-size:12px;color:var(--text-weak, #999);text-align:center;";
      empty.textContent = "暂无提问";
      listEl.appendChild(empty);
      log("renderQuestionList: 问题数为 0，显示占位文本");
      return;
    }

    var panel = document.getElementById(CFG.panelId);

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var item = document.createElement("div");
      item.className = CFG.itemClass;
      item.style.cssText =
        "padding:6px 8px;cursor:pointer;border-radius:5px;" +
        "font-size:12px;line-height:1.45;color:var(--text-base, #333);" +
        "transition:background-color 0.12s ease;word-break:break-word;" +
        "user-select:none;font-family:var(--font-family-sans, ui-sans-serif, system-ui);";

      var idx = document.createElement("span");
      idx.style.cssText =
        "display:inline-block;min-width:20px;color:var(--text-weak, #999);font-size:11px;margin-right:4px;";
      idx.textContent = q.index + ".";

      var txt = document.createElement("span");
      txt.textContent = truncate(q.text, 100);

      item.appendChild(idx);
      item.appendChild(txt);

      // 悬停
      item.addEventListener("mouseenter", function (el) {
        return function () { el.style.backgroundColor = "rgba(0,0,0,0.05)"; };
      }(item));
      item.addEventListener("mouseleave", function (el) {
        return function () { el.style.backgroundColor = ""; };
      }(item));

      // 点击：带 DOM 过期检测，自动降级为重新提取
      item.addEventListener("click", (function (question, selfEl, pnl) {
        return function () {
          log("点击问题 #" + question.index + ": " + truncate(question.text, 40));

          // ── 校验 DOM 引用是否过期（会话切换后旧节点已被销毁） ──
          var targetEl = question.containerEl;
          var textEl = question.textEl;
          if (!targetEl || !document.body.contains(targetEl)) {
            log("   ⚠️ DOM 引用已过期，重新提取问题...");
            var fresh = extractQuestions();
            // 按文本匹配（序号可能变化，文本更稳定）
            var found = null;
            for (var k = 0; k < fresh.length; k++) {
              if (fresh[k].text === question.text) { found = fresh[k]; break; }
            }
            if (!found && fresh[question.index - 1]) {
              found = fresh[question.index - 1]; // 降级：按序号
            }
            if (found) {
              targetEl = found.containerEl;
              textEl = found.textEl;
              // 刷新当前列表为最新数据
              renderQuestionList(fresh);
              _lastMsgCount = fresh.length;
              // 重新获取当前项（旧 selfEl 已被 renderQuestionList 清空）
              var newItems = document.querySelectorAll("." + CFG.itemClass);
              var matchIdx = fresh.indexOf(found);
              if (matchIdx >= 0 && matchIdx < newItems.length) {
                selfEl = newItems[matchIdx];
              }
              log("   ✅ DOM 引用已更新");
            } else {
              warn("   ❌ 无法定位问题，DOM 中已不存在匹配项");
              return;
            }
          }

          if (pnl && pnl.classList.contains("hidden")) {
            pnl.classList.remove("hidden");
          }
          // 清除高亮
          var all = document.querySelectorAll("." + CFG.itemClass);
          for (var j = 0; j < all.length; j++) {
            all[j].style.fontWeight = "";
            all[j].style.backgroundColor = "";
          }
          selfEl.style.fontWeight = "600";
          selfEl.style.backgroundColor = "rgba(99,102,241,0.08)";
          scrollAndHighlight(targetEl, textEl);
        };
      })(q, item, panel));

      listEl.appendChild(item);
    }
    log("renderQuestionList: ✅ 已渲染 " + questions.length + " 条问题");
  }

  // ════════════════════════════════════════════════════════════
  // SPA 持久化：监听 DOM 变化，会话切换后自动恢复按钮和面板
  // ════════════════════════════════════════════════════════════

  var _panelWasOpen = false;       // 跨 DOM 重建追踪面板开合状态
  var _btnRestorePending = false;  // 按钮即时恢复防重入
  var _panelRestoreTimer = null;   // 面板重建 debounce 定时器
  var _contentRefreshTimer = null; // 列表内容刷新 debounce 定时器
  var _lastMsgCount = -1;          // 上次检查时的消息数量（变化时触发刷新）
  var _persistInterval = null;     // 周期性兜底定时器

  /**
   * 持久化策略（四项协同）：
   *  a) 按钮丢失 → requestAnimationFrame 帧内恢复（无闪烁）
   *  b) 面板丢失 → 80ms debounce 重建面板
   *  c) 消息变化 → 50ms debounce 刷新问题列表内容
   *  d) 每 3 秒周期性兜底检查
   */
  function startPersistenceWatch() {
    log("startPersistenceWatch: 启动持久化监听...");

    // ── 策略A: MutationObserver ──
    var obs = new MutationObserver(function () {
      var btn = document.querySelector('[aria-label="' + CFG.btnAriaLabel + '"]');
      var panel = document.getElementById(CFG.panelId);

      // 按钮
      if (!btn || btn.offsetParent === null) {
        scheduleBtnRestore();
      }

      // 面板
      if (!panel || !document.body.contains(panel)) {
        schedulePanelRestore();
        return; // 面板丢失时跳过内容检查，panel 重建自然会刷新列表
      }

      // 面板存在 → 检查消息是否变化（轻量：只比数量）
      var curCount = document.querySelectorAll(CFG.msgSelector).length;
      if (curCount !== _lastMsgCount) {
        scheduleContentRefresh();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // ── 策略B: 周期性兜底 ──
    _persistInterval = setInterval(function () {
      var btn = document.querySelector('[aria-label="' + CFG.btnAriaLabel + '"]');
      var panel = document.getElementById(CFG.panelId);
      if (!btn || btn.offsetParent === null) scheduleBtnRestore();
      if (!panel || !document.body.contains(panel)) {
        schedulePanelRestore();
      } else {
        var curCount = document.querySelectorAll(CFG.msgSelector).length;
        if (curCount !== _lastMsgCount) scheduleContentRefresh();
      }
    }, 3000);

    // ── 策略C: URL 变化监听 ──
    wrapHistoryMethods();

    log("startPersistenceWatch: ✅ 已启动 (按钮=帧内恢复, 面板=80ms, 内容=50ms, 周期=3s)");
  }

  /** 按钮即时恢复——请求下一帧执行，防重入 */
  function scheduleBtnRestore() {
    if (_btnRestorePending) return;
    _btnRestorePending = true;
    requestAnimationFrame(function () {
      _btnRestorePending = false;
      // 二次确认：真的丢失了？
      var btn = document.querySelector('[aria-label="' + CFG.btnAriaLabel + '"]');
      if (!btn || btn.offsetParent === null) {
        log("scheduleBtnRestore: ⚡ 帧内恢复按钮");
        ensureButton();
        if (_panelWasOpen) {
          syncBtnActive(true);
        }
      }
    });
  }

  /** 面板短 debounce 恢复 */
  function schedulePanelRestore() {
    if (_panelRestoreTimer) return;
    _panelRestoreTimer = setTimeout(function () {
      _panelRestoreTimer = null;
      doRestorePanel();
    }, 80);
  }

  /** 检查并恢复面板 + 刷新问题列表 */
  function doRestorePanel() {
    var panel = document.getElementById(CFG.panelId);
    var needRebuild = false;

    if (!panel) {
      log("doRestorePanel: ⚠️ 面板已丢失，重建...");
      panel = ensurePanelDOM();
      needRebuild = true;
    } else if (!document.body.contains(panel)) {
      log("doRestorePanel: ⚠️ 面板不在 DOM 树中，重建...");
      panel.removeAttribute("id");
      panel = ensurePanelDOM();
      needRebuild = true;
    }

    if (needRebuild && panel) {
      var questions = extractQuestions();
      renderQuestionList(questions);
      _lastMsgCount = questions.length;
      if (_panelWasOpen) {
        panel.classList.remove("hidden");
        syncBtnActive(true);
      }
      log("doRestorePanel: ✅ 面板已恢复，问题数=" + questions.length);
    }
  }

  /** 消息内容变化 → debounce 刷新问题列表（面板已存在，只刷新内容） */
  function scheduleContentRefresh() {
    if (_contentRefreshTimer) return;
    _contentRefreshTimer = setTimeout(function () {
      _contentRefreshTimer = null;
      doContentRefresh();
    }, 50);
  }

  function doContentRefresh() {
    var panel = document.getElementById(CFG.panelId);
    if (!panel || !document.body.contains(panel)) return;

    var questions = extractQuestions();
    if (questions.length === _lastMsgCount) {
      // 数量相同，但内容可能不同 → 做一次深度比对
      var listEl = document.getElementById(CFG.listId);
      if (listEl) {
        var oldTexts = [];
        var items = listEl.children;
        for (var i = 0; i < items.length; i++) {
          oldTexts.push((items[i].textContent || "").trim());
        }
        var newTexts = [];
        for (i = 0; i < questions.length; i++) {
          newTexts.push(questions[i].index + "." + truncate(questions[i].text, 100));
        }
        if (oldTexts.join("|") === newTexts.join("|")) {
          // 完全相同，无需刷新
          return;
        }
      }
    }

    log("doContentRefresh: 🔄 消息已变化，刷新问题列表 (旧=" + _lastMsgCount + " → 新=" + questions.length + ")");
    renderQuestionList(questions);
    _lastMsgCount = questions.length;
  }

  /** 劫持 history API，在路由变化时立即触发一次检查 */
  function wrapHistoryMethods() {
    var _pushState = history.pushState;
    var _replaceState = history.replaceState;

    history.pushState = function () {
      _pushState.apply(this, arguments);
      onHistoryChange();
    };
    history.replaceState = function () {
      _replaceState.apply(this, arguments);
      onHistoryChange();
    };
    window.addEventListener("popstate", onHistoryChange);
    window.addEventListener("hashchange", onHistoryChange);

    function onHistoryChange() {
      log("onHistoryChange: 🔄 URL 变化，触发即时恢复检查");
      // 会话切换时框架需要 2-3 帧完成消息渲染，用双 rAF 确保就绪
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          scheduleBtnRestore();
          schedulePanelRestore();
          scheduleContentRefresh();
        });
      });
    }
  }

  var retryCount = 0;

  function tryInit() {
    retryCount++;
    log("── tryInit 第 " + retryCount + " 次尝试 ──");

    // 检查页面基础状态
    log("页面状态: readyState=" + document.readyState +
        ", body=" + !!document.body +
        ", header=" + !!document.querySelector("header") +
        ", review-panel=" + !!document.getElementById("review-panel"));

    // 按钮需要重试（容器可能尚未渲染）
    var btn = ensureButton();
    if (!btn) {
      if (retryCount < CFG.maxRetries) {
        log("⏳ 按钮容器仍未就绪, " + CFG.retryInterval + "ms 后重试...");
        setTimeout(tryInit, CFG.retryInterval);
        return;
      }
      err("❌ 超过最大重试次数 (" + CFG.maxRetries + ")，按钮初始化失败");
      err("   请检查: 1)页面URL是否匹配 @match  2)页面是否正常加载  3)打开控制台查看以上日志");
      return;
    }

    log("✅ 按钮就绪，继续初始化");

    // 面板始终可以创建（嵌入 review-panel 或独立浮动）
    var panel = ensurePanelDOM();

    var questions = extractQuestions();
    renderQuestionList(questions);
    _lastMsgCount = questions.length;

    var standalone = panel.hasAttribute("data-standalone");
    log("🎉 初始化完成! 按钮=✅, 面板=" + (standalone ? "独立浮动" : "嵌入review-panel") + ", 问题数=" + questions.length);
    if (standalone) {
      log("   💡 review-panel 暂不可用，面板以独立浮动模式运行，待 review-panel 出现后会自动迁移");
    }

    // 启动 SPA 持久化监听（会话切换后自动恢复按钮和面板）
    startPersistenceWatch();
  }

  // ════════════════════════════════════════════════════════════
  // 入口
  // ════════════════════════════════════════════════════════════

  function entry() {
    log("══════════ 脚本启动 ══════════");
    log("URL: " + location.href);
    log("UserAgent: " + navigator.userAgent.substring(0, 80));

    // 可见标记（确认脚本已在此页面运行）
    showLoadMarker();

    // 延迟 800ms 给 SPA 框架留出首次渲染时间
    setTimeout(tryInit, 800);
  }

  // DOM 就绪后启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      log("DOMContentLoaded 触发");
      entry();
    });
  } else {
    log("DOM 已就绪 (readyState=" + document.readyState + ")");
    entry();
  }
})();
