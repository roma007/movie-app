#!/bin/bash
cd "$(dirname "$0")"
bash scripts/launch-app.sh
echo ""
echo "按任意键退出..."
read -n 1
