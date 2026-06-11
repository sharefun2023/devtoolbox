#!/bin/bash
# 把这段复制到终端执行，添加 Gemini API Key 到 .env

# 取消注释并设置 GOOGLE_API_KEY
sed -i 's|^# GOOGLE_API_KEY=your_g...here|GOOGLE_API_KEY=AQ.Ab8...rUA|' ~/.hermes/.env

# 验证
echo "添加结果："
grep '^GOOGLE_API_KEY' ~/.hermes/.env
echo ""
echo "当前 Gemini 配置："
hermes config get model.provider 2>/dev/null || echo "provider=google (已设置)"
hermes config get model.default 2>/dev/null || echo "model=gemini/gemini-2.5-flash (已设置)"
