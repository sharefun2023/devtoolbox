# 每日一工具：devtoolbox 工具矩阵扩充计划

**创建日期**：2026-06-09  
**状态**：按天自动执行  
**目标**：每天新增一个开发者工具，9天完整矩阵

---

## 工具清单（按优先级排序）

| 天数 | 工具 | 文件名 | 难度 | 预计工时 |
|:---:|------|--------|:---:|:---:|
| 1 | **CIDR/IPv6 子网计算器** | `cidr-calculator.html` | ⭐ | 1h |
| 2 | **文本 Diff/对比** | `text-diff.html` | ⭐⭐ | 1.5h |
| 3 | **UUID/哈希生成器** | `hash-generator.html` | ⭐ | 30m |
| 4 | **JWT 解码器** | `jwt-decoder.html` | ⭐ | 30m |
| 5 | **QR 码生成/解析** | `qrcode-tools.html` | ⭐ | 1h |
| 6 | **颜色工具** | `color-tools.html` | ⭐ | 45m |
| 7 | **CSS/JS 压缩** | `minifier.html` | ⭐ | 45m |
| 8 | **图片压缩** | `image-compressor.html` | ⭐⭐ | 1.5h |
| 9 | **Markdown 预览** | `markdown-preview.html` | ⭐⭐ | 1.5h |

---

## 架构约束

- **纯前端单文件**：一个工具一个 `.html`，零外部依赖、零后端
- **暗色主题**：与 devtoolbox 现有风格统一
- **隐私优先**：所有数据处理在浏览器本地完成，不上传服务器
- **干净 URL**：Cloudflare Pages 自动去 `.html` 后缀
- **文件路径**：`~/devtoolbox/public/tools/<name>.html`

---

## 执行流程（每天自动）

### Step 1：检查进度
```
ls ~/devtoolbox/public/tools/cidr-calculator.html  # 第1天
ls ~/devtoolbox/public/tools/text-diff.html        # 第2天
...
```
如果当日工具已存在 → 跳过，记录已存在。

### Step 2：构建工具
- 参考竞品（如 ipaddressguide.com/cidr, diffchecker.com）取精华
- 生成单文件 HTML：内联 CSS + JS
- 暗色主题，响应式布局
- 加 `<title>` 和 `<meta description>` 为 SEO 准备

### Step 3：更新导航
- 修改 `~/devtoolbox/public/index.html`：在工具列表中加入新工具链接
- 修改 `~/devtoolbox/public/categories/dev-tools.html`：加入新工具

### Step 4：更新 sitemap
- 在 `~/devtoolbox/public/sitemap.xml` 中添加新 URL（无 .html 后缀）
- 更新所有 `<lastmod>` 为当天日期

### Step 5：Git 提交推送
```bash
cd ~/devtoolbox
git add public/
git commit -m "feat: add <工具名> — 每日一工具 Day N"
git push origin master
```

---

## 输出报告格式

```
🔧 devtoolbox 每日一工具 — Day N

✅ 今日新增：<工具名>
📁 文件：/tools/<name>.html
🔗 链接：https://devtoolbox.pages.dev/tools/<name>
📊 进度：N/9

⏳ 明天：<下一个工具>
```

---

## 注意事项

- 每个工具独立成页，但可互相内链（如 Diff 结果区加「→ 压缩这段文本」）
- 所有内链使用无 `.html` 后缀格式
- 构建时自动检查 Cloudflare Pages URL 规范
