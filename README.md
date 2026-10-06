<div align="center">
  <img src="https://raw.githubusercontent.com/cshaizhihao/OU-YAML/main/public/brand/ou-yaml-logo.png" alt="OU-YAML Logo" width="180" />
  <h1>OU-YAML</h1>
  <p><strong>温柔、清晰、可视化的代理节点与订阅生成工作台</strong></p>
  <p>
    <a href="https://github.com/cshaizhihao/OU-YAML">GitHub</a> ·
    <a href="https://github.com/cshaizhihao/OU-YAML/releases">Releases</a> ·
    作者：<code>nodeseek@cshaizhihao</code>
  </p>
  <p>
    <img src="https://img.shields.io/badge/version-1.2.0-2E4E3F?style=flat-square" alt="version" />
    <img src="https://img.shields.io/badge/Mihomo-Clash%20Meta-C85A3E?style=flat-square" alt="Mihomo" />
    <img src="https://img.shields.io/badge/sing--box-supported-73629B?style=flat-square" alt="sing-box" />
  </p>
</div>

## ✨ 项目介绍

OU-YAML 是一个面向普通用户的代理节点、远程订阅、策略组、规则和配置订阅生成平台。

它将复杂的 YAML / JSON 配置转换为清晰的可视化操作：导入节点，整理节点池，拖拽代理分组，选择规则和模板，最后生成可以直接使用的 Mihomo / Clash Meta 或 sing-box 配置订阅。

OU-YAML 采用温暖的奶油色、鼠尾草绿和珊瑚色视觉体系，尽量让专业配置工具保持清晰、舒适和易于长期使用。🌿

## 🚀 一键安装

推荐在全新的 Debian / Ubuntu VPS 上使用 root 权限安装：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/OU-YAML/main/install.sh | sudo bash
```

安装脚本会依次完成：

1. 显示并确认 OU-YAML 使用协议。
2. 展示带有作者信息的 OU-YAML 主菜单。
3. 选择 IP + 端口或域名访问方式。
4. 域名模式下选择 Cloudflare 灰色云朵或橙色云朵模式。
5. 检测 Nginx、Apache、Caddy、Traefik、HAProxy 以及 80/443 端口冲突。
6. 安装 Docker、拉取项目、生成管理员配置并启动服务。

> 域名安装前，请先在 Cloudflare 或其他 DNS 服务商完成域名解析。使用 Cloudflare 橙色云朵时，请将 SSL/TLS 模式设置为“完全（严格）”。域名模式需要服务器开放 TCP 80 和 443 端口。

### 安装方式

#### IP + 端口

适用于没有域名、内网测试或首次体验：

```text
http://服务器IP:8787
```

#### 域名 + HTTPS

安装脚本会使用 Caddy 自动申请和续期 HTTPS 证书。

- 灰色云朵：Cloudflare DNS only，客户端直接访问服务器，Caddy 负责 HTTPS。
- 橙色云朵：Cloudflare Proxied，Cloudflare 负责边缘代理，源站 Caddy 仍负责 HTTPS。

安装前请确认：

- 域名 A / AAAA 记录已经解析到服务器。
- 服务器安全组和防火墙开放 TCP 80、443。
- 没有其他反向代理占用 80、443。

### 更新与备份

管理员登录后，可以在「基础设置 → 网页更新」中检查 GitHub 最新版本，并一键完成备份、拉取、重建和重启。安装脚本会自动注册轻量级 systemd 更新代理；网页容器本身不接触 Docker Socket，更新任务由主机代理执行。

如果需要手动更新，也可以运行：

```bash
sudo /opt/ou-yaml/update.sh
sudo /opt/ou-yaml/backup.sh
```

数据默认保存在：

```text
/opt/ou-yaml/data
```

## 🧭 主要功能

### 🔗 订阅链接

- 展示已发布的配置订阅。
- 复制公开订阅地址。
- 查看目标客户端、版本、节点数量和发布时间。
- 支持订阅撤销和过期检查。
- 支持公开访问限流。

### 📥 订阅来源管理

- 导入远程订阅 URL。
- 上传 Mihomo YAML 或 sing-box JSON。
- 导入 Base64 节点订阅。
- 导入多行分享链接。
- 自动识别订阅格式。
- 支持手动刷新和定时刷新。
- 记录导入警告和失败状态。

### 🧩 节点管理

- 节点池统一管理。
- 支持 SS、SSR、VMess、VLESS、Trojan、Hysteria2、TUIC、Snell、SOCKS5、HTTP、WireGuard 等协议。
- 添加、编辑、复制、删除节点。
- 按来源、协议、名称和标签筛选。
- 批量删除和启用状态管理。
- 保留规范化配置和原始配置。

### 🎯 生成订阅

- 分步生成向导。
- 选择节点来源和节点集合。
- 选择输出格式和规则模板。
- 预览生成后的 YAML / JSON。
- 调用 Mihomo 或 sing-box 内核进行校验。
- 保存 Generation Profile。
- 发布公开订阅链接。

### 🧱 代理分组

- `select`
- `url-test`
- `fallback`
- `load-balance`
- `relay`
- 节点池拖拽。
- 组内排序和跨组移动。
- 链式代理和中转组。
- 组成员使用稳定 ID 管理。
- 支持代理组资源 API。

### 📚 规则与模板

- 内置规则模板。
- 自定义规则模板。
- 规则集资源管理。
- 规则启用、禁用和排序。
- 模板复制和复用。
- Mihomo / sing-box 双格式适配。

### 🕘 历史与安全

- 项目配置快照。
- 历史版本恢复。
- 用户级 JSON 备份和恢复。
- 多用户数据隔离。
- 管理员账号和权限管理。
- 登录限速。
- SSRF 防护。
- 公开订阅访问限流。
- 操作任务和审计日志。

## 🎨 品牌界面

OU-YAML 使用以下设计方向：

- 奶油色和象牙白背景。
- 鼠尾草绿作为主要操作色。
- 柔和珊瑚色和琥珀色作为状态色。
- 深色代码预览区域。
- 低干扰、流畅的过渡动画。
- 桌面端侧边栏和移动端抽屉导航。
- 支持深色模式和 `prefers-reduced-motion`。

Logo 资源位于：

```text
public/brand/ou-yaml-logo.png
```

## 🛠️ 本地开发

环境要求：

- Node.js 20+
- npm
- better-sqlite3 编译环境
- 可选：Mihomo 和 sing-box 内核

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD='change-this-password' npm run dev
```

开发地址：

- 前端：`http://localhost:5173`
- API：`http://localhost:8787`

### 本地验证

```bash
npm run typecheck
npm test
npm run build
```

## 🐳 Docker 部署

```bash
cp .env.example .env
printf '%s' 'change-this-password' | base64 -w0
# 将输出写入 ADMIN_PASSWORD_B64
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f ou-yaml
```

## ⚙️ 配置项

| 配置项 | 说明 |
| --- | --- |
| `OU_YAML_PORT` | IP + 端口模式下的监听端口，默认 `8787` |
| `ADMIN_USERNAME` | 首次启动创建的管理员账号 |
| `ADMIN_PASSWORD_B64` | Base64 编码后的管理员密码 |
| `DOMAIN` | 域名模式下的访问域名 |
| `TRUST_PROXY` | 是否信任反向代理，域名模式为 `1` |
| `COOKIE_SECURE` | 是否启用 Secure Cookie，HTTPS 模式为 `true` |
| `DATA_DIR` | SQLite 数据目录，容器内默认为 `/app/data` |

## 🔐 安全建议

- 首次登录后立即确认管理员密码安全性。
- 不要在公开渠道分享管理员密码和订阅地址。
- 公开订阅地址泄露后及时撤销并重新发布。
- 公网部署优先使用域名 HTTPS。
- Cloudflare 橙色云朵模式使用“完全（严格）”。
- 定期执行数据库备份。
- 不要导入来源不明的配置文件或规则。

## 🔗 项目地址

https://github.com/cshaizhihao/OU-YAML
