<div align="center">
  <img src="https://raw.githubusercontent.com/cshaizhihao/OU-YAML/main/public/brand/ou-yaml-logo.png" alt="OU-YAML Logo" width="176" />
  <h1>OU-YAML</h1>
  <p><strong>把零散节点，整理成清晰、可靠、可持续更新的配置订阅</strong></p>
  <p>温暖而精致的可视化节点、策略组、规则与订阅发布工作台</p>
  <p>
    <a href="https://github.com/cshaizhihao/OU-YAML">项目主页</a> ·
    <a href="https://github.com/cshaizhihao/OU-YAML/releases">版本发布</a> ·
    <a href="./CHANGELOG.md">更新记录</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/version-1.4.0-A33D57?style=flat-square" alt="version" />
    <img src="https://img.shields.io/badge/Node.js-20%2B-247B78?style=flat-square" alt="Node.js" />
    <img src="https://img.shields.io/badge/Mihomo-supported-D5962A?style=flat-square" alt="Mihomo" />
    <img src="https://img.shields.io/badge/sing--box-supported-76547D?style=flat-square" alt="sing-box" />
    <img src="https://img.shields.io/badge/Docker-ready-3E7B58?style=flat-square" alt="Docker" />
  </p>
  <p>作者：<code>nodeseek@cshaizhihao</code></p>
</div>

## 🌿 项目介绍

OU-YAML 是一个自托管的代理配置工作台。它把订阅 URL、配置文件和节点分享链接汇总到统一节点库，再通过可视化策略组、规则模板和生成方案，发布为可直接使用的 Mihomo YAML 或 sing-box JSON 订阅。

项目围绕一条明确的工作流设计：

```text
订阅来源 → 节点库 → 代理分组 → 分流规则 → 预览校验 → 保存方案 → 发布链接
```

无需反复手写 YAML，也无需为每次节点变化重新更换客户端订阅地址。

## 🚀 一键安装

推荐使用一台全新的 Debian / Ubuntu 服务器，以具有 `sudo` 权限的 SSH 终端执行：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/OU-YAML/main/install.sh | sudo bash
```

安装程序会依次：

1. 展示 OU-YAML 使用协议，输入大写 `YES` 后继续。
2. 显示 OU-YAML 主菜单与作者信息。
3. 选择「IP + 端口」或「域名 + HTTPS」安装。
4. 检测 Docker、Docker Compose、系统架构与端口占用。
5. 检测 Nginx、Apache、Caddy、Traefik、HAProxy 等反向代理冲突。
6. 创建管理员账号、持久化数据目录并启动应用。
7. 注册网页一键更新代理，可选启用每日自动更新。

> 安装脚本需要交互式终端。如果命令没有显示界面，请确认当前 SSH 会话可访问 `/dev/tty`，或先执行 `curl -fLo install.sh ...` 后运行 `sudo bash install.sh`。

### 🌐 IP + 端口

适用于首次体验、内网或没有域名的服务器：

```text
http://服务器IP:8787
```

安装时可以自定义端口，脚本会提前检查端口是否已被占用。

### 🔒 域名 + HTTPS

域名模式使用 Caddy 自动申请并续期 HTTPS 证书。安装前请确认：

- 域名 `A` / `AAAA` 记录已经指向当前服务器。
- 防火墙与安全组已开放 TCP `80`、`443`。
- 服务器上的其他反向代理没有占用 `80`、`443`。
- Cloudflare 小黄云开启时，SSL/TLS 模式使用「完全（严格）」。

安装程序会分别提示：

- ☁️ **灰色云朵（DNS only）**：客户端直连源站，Caddy 提供 HTTPS。
- 🟠 **橙色云朵（Proxied）**：Cloudflare 提供边缘代理，源站仍由 Caddy 提供 HTTPS。

## ✨ 功能概览

### 🏠 清晰的项目首页

- 展示节点、策略组、规则与检查状态。
- 根据当前配置自动提示下一步操作。
- 一键进入来源、节点、分组、规则或发布环节。
- 展示 Mihomo / sing-box 内核可用状态。

### 🔗 订阅来源

- 导入远程订阅 URL、Mihomo YAML、sing-box JSON 和文本文件。
- 直接粘贴 `vless://`、`vmess://`、`trojan://`、`ss://` 等分享链接。
- 支持多行分享链接与 Base64 订阅内容。
- 自动识别格式，并在保存前预览节点数量和解析警告。
- 支持手动同步与 30 分钟至每天的定时同步。
- 支持自定义 User-Agent 与可信来源的 TLS 证书校验跳过。
- 自动尝试 `clash-meta`、Mihomo、Clash、sing-box、v2rayN、浏览器等兼容请求头。
- 远程刷新保留节点 ID、项目关系、排序、标签和备注。

### 📦 统一节点库

- 支持 SS、SSR、VMess、VLESS、Trojan、Hysteria2、TUIC、Snell、WireGuard、SOCKS5、HTTP。
- 添加、编辑、复制、启用、停用和删除节点。
- 按来源、名称、服务器、协议、标签和备注筛选。
- 节点长名称自动换行，不再挤压协议和操作区域。
- 拖拽排序并持久化，刷新、重启和重新登录后顺序保持不变。
- 批量启停、添加或移除标签、添加前缀、查找替换名称。
- 明确显示节点是否已经加入当前项目。
- 节点库与项目通过稳定引用关联，同时支持项目专属别名和字段覆写。

### 🎨 代理分组

- 支持 `select`、`url-test`、`fallback`、`load-balance`、`relay`。
- 节点拖入分组、组内排序、跨组移动与分组整体排序。
- 策略组可以拖入另一个策略组，构建链式代理。
- 提供显式「加入策略组」面板，不依赖精准拖拽也能完成组嵌套。
- 自动阻止策略组自引用和循环引用。
- 手机和平板提供上下移动按钮，作为触摸拖拽的可靠替代。

### 📚 分流规则与模板

- 支持常见 Domain、IP、Geo、进程、Rule Set 和 MATCH 规则。
- 可视化编辑匹配值、目标策略、附加参数和备注。
- 规则搜索、复制、排序、批量启用、停用与删除。
- 内置局域网直连、广告拦截、国内直连、开发服务和基础分流模板。
- 支持创建、复制、编辑和删除个人规则模板。
- 自动提示是否缺少 `MATCH` 兜底规则。

### 🎯 生成订阅

- 按来源、标签或关键词筛选生成节点。
- 选择当前规则、内置模板或个人模板。
- 自动整理未选择节点和分组成员关系。
- 实时预览最终 YAML / JSON 与结构校验结果。
- 保存可复用 Generation Profile，支持编辑、复制和删除。
- 为公开订阅设置可选过期时间。
- 创建新订阅，或更新已有订阅内容并保持公开地址不变。
- 每次原地址更新自动递增内容版本。

### 📡 发布链接

- 展示生成方案、目标格式、版本、节点数量、过期时间和更新时间。
- 撤销或永久删除公开订阅。
- 数据库只保存 Token 哈希，不保存可直接使用的明文公开地址。
- 重置并复制地址时，旧地址立即失效。
- 公开订阅接口带访问限流、过期和撤销检查。

### 🕘 历史、备份与恢复

- 自动保存项目并保留最近历史快照。
- 手动创建版本，恢复前自动再做一次保护快照。
- 用户备份覆盖项目、历史、旧订阅、来源、节点库、标签、模板、生成方案和发布记录。
- 支持合并恢复与替换恢复。
- 恢复后的发布记录默认撤销，避免无法恢复的明文 Token 造成误判。

### 🔄 网页一键更新

管理员可以在「系统管理 → 系统设置 → 网页更新」完成更新，无需再次登录服务器执行命令：

1. 检查 GitHub `main` 分支版本与构建提交。
2. 检查磁盘空间、Docker Compose、Git 工作区和安装环境。
3. 自动备份完整数据。
4. 拉取代码并重建容器。
5. 等待 Docker 健康检查。
6. 新版失败时自动回滚到更新前提交并重建旧版。

网页可实时查看进度与主机更新日志。日志文件位于：

```text
/var/log/ou-yaml/web-update.log
```

## 🎭 界面设计

OU-YAML v1.4 使用暖象牙白、深李子色、石榴红、孔雀青、琥珀金与柔紫构成视觉系统：

- 不是冷淡风，也不是赛博风。
- 卡片层次清晰，重要状态使用丰富但克制的色彩。
- 页面进入、抽屉、拖拽、悬停和进度反馈使用统一丝滑缓动。
- 支持 `prefers-reduced-motion`，系统减少动态效果时自动关闭非必要动画。
- 桌面、平板与手机独立布局；针对 `390px` 屏幕避免横向滚动和操作拥挤。

Logo 位于 `public/brand/ou-yaml-logo.png`。

## 🧭 推荐使用顺序

1. 在「订阅来源」添加远程 URL、配置文件或分享链接。
2. 在「节点库」筛选节点，整理标签并加入当前项目。
3. 在「配置工作台 → 代理分组」组织选择组、测速组和链式代理。
4. 在「配置工作台 → 分流规则」应用模板或自定义规则。
5. 在「预览校验」检查结构，并可调用真实内核验证。
6. 在「发布中心 → 生成方案」保存方案并创建公开订阅。
7. 后续节点变化时选择原发布记录，更新内容但保持客户端地址不变。

## 🛡️ 安全设计

- 多用户资源隔离与管理员权限控制。
- 密码使用 bcrypt 哈希保存。
- Session Cookie 使用 `HttpOnly`、`SameSite=Strict`，HTTPS 模式启用 `Secure`。
- 修改请求执行 Origin / Fetch Metadata 校验。
- 登录、公开订阅与敏感接口使用速率限制。
- 远程订阅抓取执行 DNS 与 IP 校验，阻止本机、局域网和云元数据地址。
- 重定向目标重新执行 SSRF 检查。
- 容器移除 Linux capabilities，并启用 `no-new-privileges`。
- 网页容器不挂载 Docker Socket；更新由受限的主机 systemd 代理完成。

## 💾 数据与维护

默认安装目录：

```text
/opt/ou-yaml
```

默认数据目录：

```text
/opt/ou-yaml/data
```

手动备份与更新：

```bash
sudo /opt/ou-yaml/backup.sh
sudo /opt/ou-yaml/update.sh
```

查看服务：

```bash
cd /opt/ou-yaml
docker compose ps
docker compose logs -f ou-yaml
```

## 🐳 手动 Docker 部署

```bash
git clone https://github.com/cshaizhihao/OU-YAML.git
cd OU-YAML
cp .env.example .env
printf '%s' 'change-this-password' | base64 -w0
```

将输出写入 `.env` 的 `ADMIN_PASSWORD_B64`，然后选择一种模式：

```bash
# IP + 端口
docker compose -f docker-compose.yml -f docker-compose.ip.yml up -d --build

# 域名 + Caddy HTTPS
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

## 🧑‍💻 本地开发

环境要求：Node.js 20+、npm，以及 better-sqlite3 所需的本地编译环境。

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD='change-this-password' npm run dev
```

- 前端开发服务：`http://localhost:5173`
- API：`http://localhost:8787`

完整验证：

```bash
npm run typecheck
npm test
npm run build
npm audit
```

## ⚙️ 环境变量

| 变量 | 说明 |
| --- | --- |
| `OU_YAML_PORT` | IP 模式宿主机端口，默认 `8787` |
| `ADMIN_USERNAME` | 首次启动创建的管理员账号 |
| `ADMIN_PASSWORD_B64` | Base64 编码后的管理员密码 |
| `DOMAIN` | 域名模式访问域名 |
| `APP_ORIGIN` | 允许执行修改请求的网页来源 |
| `TRUST_PROXY` | 是否信任反向代理，域名模式为 `1` |
| `COOKIE_SECURE` | 是否启用 Secure Cookie |
| `DATA_DIR` | SQLite 数据目录，容器内默认 `/app/data` |
| `UPDATE_GITHUB_REPO` | 网页更新检查的 GitHub 仓库 |

## 📄 说明

OU-YAML 用于管理用户本人有权使用的节点、订阅和规则。请遵守所在地法律法规与上游服务协议，并妥善保管管理员密码和公开订阅地址。
