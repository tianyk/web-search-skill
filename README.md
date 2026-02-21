# web-search-skill

一个基于 `puppeteer-core` 的轻量 Google 网页搜索脚本，用于抓取搜索结果页并提取目标网页正文。

## 快速开始

### 1) 环境要求

- Node.js
- 本地可用的 Chromium 内核浏览器（Chrome / Chromium / Edge）

### 2) 安装依赖

```bash
npm install --registry=https://registry.npmmirror.com
```

### 3) 执行搜索

```bash
node scripts/search.js --keyword "TypeScript tutorial" --max-results 10
```

## 参数

- `--keyword`, `-k`：搜索关键词（必填）
- `--max-results`, `-n`：返回结果上限（可选，默认 `10`，最大 `20`）
- `--help`, `-h`：查看帮助

## 输出

命令输出为 Markdown，每条结果包含：`title`、`url`、`content`。

## 补充说明

- 默认非无头运行；可通过 `WEB_SEARCH_HEADLESS=1` 开启无头模式。
- 浏览器 profile 会持久化在 `.runtime/chrome-profile`，用于复用会话状态。
- 面向 Agent 的详细执行规范见 `SKILL.md`。
