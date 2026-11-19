#!/usr/bin/env bash
# 服务器抓取环境：Node 22 + 无头 Chrome（适配国内网络）。
# 背景：baslerweb.cn 有瑞数动态 JS 挑战，curl 只拿到 403 挑战页（6076 字节含 _jsc_ch_conf），
#   必须真浏览器内核执行 JS 才能过，所以装 Chrome 而不是用 requests/curl。
# 走 dl.google.com + npmmirror（本机实测两者都 200）。
set -u
LOG=/root/vs-setup.log
say() { echo "[$(date +%H:%M:%S)] $*"; }

say "== 系统 =="; . /etc/os-release; say "$PRETTY_NAME $(uname -m)"

# ---- Node 22：优先 npmmirror 二进制，失败退 NodeSource ----
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  say "== 安装 Node 22 =="
  VER=$(curl -fsSL -m 20 https://registry.npmmirror.com/-/binary/node/latest-v22.x/ 2>/dev/null \
        | grep -o 'node-v22\.[0-9.]*-linux-x64\.tar\.xz' | head -1)
  if [ -n "${VER:-}" ]; then
    say "下载 $VER"
    curl -fsSL -m 300 -o /tmp/node.tar.xz "https://registry.npmmirror.com/-/binary/node/latest-v22.x/$VER" \
      && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
      && ln -sf /usr/local/bin/node /usr/bin/node \
      && ln -sf /usr/local/bin/npm /usr/bin/npm || say "二进制安装失败"
  fi
  if ! command -v node >/dev/null 2>&1; then
    say "退 NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1
  fi
fi
say "node: $(node -v 2>/dev/null || echo 缺失)"

# ---- Chrome ----
if ! command -v google-chrome >/dev/null 2>&1; then
  say "== 安装 Chrome =="
  cd /tmp || exit 1
  curl -fsSL -m 600 -o gc.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && say "deb 已下载 $(du -h gc.deb | cut -f1)"
  apt-get update -qq >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/gc.deb >/tmp/apt-chrome.log 2>&1 || {
    say "直接装失败，补依赖后重试"
    apt-get -f install -y >>/tmp/apt-chrome.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/gc.deb >>/tmp/apt-chrome.log 2>&1
  }
fi
BIN=$(command -v google-chrome || command -v google-chrome-stable || true)
say "chrome: ${BIN:-缺失} $($BIN --version 2>/dev/null | head -1)"

# ---- 冒烟测试：真浏览器能否过瑞数挑战 ----
if [ -n "${BIN:-}" ]; then
  say "== 冒烟测试 =="
  OUT=$("$BIN" --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
        --virtual-time-budget=15000 --dump-dom https://www.baslerweb.cn/zh-cn/cameras/ 2>/dev/null)
  echo "$OUT" | grep -q "适用于机器视觉的相机" && say "挑战已通过（页面标题正常）" || {
    say "未拿到正文，长度=${#OUT}"; echo "$OUT" | head -c 300; echo; }
fi
say "== 完成 =="
