#!/bin/bash
# macOS 双击即可启动的入口文件
# .command 文件在 macOS 上双击会自动用 Terminal.app 打开并执行
# 自包含脚本，不依赖外部 .sh 文件

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8080

echo "============================================"
echo "  Fasudil-LLC Analyzer 启动"
echo "============================================"
echo ""
echo "  项目目录: $SCRIPT_DIR"
echo "  服务地址: http://localhost:${PORT}"
echo "  按 Ctrl+C 停止服务器"
echo ""

# 检查端口是否被占用
if lsof -i :${PORT} >/dev/null 2>&1; then
    echo "⚠️  端口 ${PORT} 已被占用，尝试关闭占用进程..."
    PID=$(lsof -t -i :${PORT})
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null
        sleep 1
        echo "  已关闭旧进程 (PID: $PID)"
    fi
fi

# 查找 Node.js（按优先级尝试）
NODE_BIN=""

# 1. 先尝试 WorkBuddy 管理的 Node.js
if [ -x "/Users/jimmywang/.workbuddy/binaries/node/versions/22.22.2/bin/node" ]; then
    NODE_BIN="/Users/jimmywang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
# 2. 再尝试系统 node 命令
elif command -v node &> /dev/null; then
    NODE_BIN="node"
# 3. 尝试常见安装路径
elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
    echo "❌ 未找到 Node.js"
    echo ""
    echo "请选择以下方案之一："
    echo ""
    echo "方案 1: 安装 Node.js（推荐）"
    echo "  访问 https://nodejs.org 下载安装"
    echo "  或使用 Homebrew: brew install node"
    echo ""
    echo "方案 2: 使用 Python 服务器（不支持 AI API 代理）"
    echo "  在终端运行以下命令："
    echo "  cd \"$SCRIPT_DIR\""
    echo "  python3 -m http.server $PORT"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

echo "✅ 使用 Node.js: $($NODE_BIN --version)"
echo "   路径: $NODE_BIN"
echo ""

# 3秒后自动打开浏览器
(sleep 3 && open "http://localhost:${PORT}") &

# 启动 Node.js 服务器（含 AI API 代理）
cd "$SCRIPT_DIR"
$NODE_BIN server.js