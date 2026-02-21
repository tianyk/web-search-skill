---
name: web-search
description: 使用 Puppeteer 单次启动浏览器执行无服务 Google 网页搜索。适用于需要超出知识截止时间的最新信息。
---

# Web Search

## 目的

当任务需要最新网页信息，而本地知识不足以回答时，使用此技能。

典型场景：

- 最新文档/API 变更
- 最近的事件/新闻
- 当前产品/版本状态
- 需要新鲜网页证据的问题或讨论

## 输入约定

- 必填：搜索关键词字符串。
- 可选：`max-results`（默认 `10`，最大 `20`）。

## 执行流程（Agent）

1. 确保依赖已安装：

```bash
cd "$SKILLS_ROOT/web-search-google-lite"
```

2. 直接执行搜索（无需包装脚本）：

```bash
node "$SKILLS_ROOT/web-search-google-lite/scripts/search.js" --keyword "your query" --max-results 10
```

3. 将 stdout 的 Markdown 作为标准结果读取。
4. 基于提取出的 `title + url + content` 条目组织最终回答。

## 输出约定

脚本输出 Markdown，包含：

- 搜索元信息（`Query`、`Engine`、`URLs Crawled`、`Results`、`Time`）
- 重复的结果块：
  - `title`
  - `url`
  - `content`（可读正文文本提取）

向用户回复时，优先保证：

- 基于提取内容给出事实性总结
- 明确提供来自 `url` 的来源链接
- 当提取失败或内容不完整时清晰说明

## 失败处理

- 如果 Google 返回 `/sorry` 或反爬验证页：明确报告被阻断状态，并建议稍后重试。
- 如果部分目标页加载/解析失败：保留成功结果，并标记失败条目。
- 如果结果过少：用更宽泛关键词或更大的 `--max-results` 重新执行。

## 运行说明

- 搜索引擎仅支持 Google。
- 不需要后台服务。
- 依赖：`puppeteer-core`。
- 浏览器 profile 复用路径：
  - `"$SKILLS_ROOT/web-search-google-lite/.runtime/chrome-profile"`
- 默认使用非无头模式，除非显式设置 `WEB_SEARCH_HEADLESS`。
