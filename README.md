# OU-YAML

OU-YAML 是面向非技术用户的 Mihomo / Clash Meta 与 sing-box 配置可视化编辑器，包含节点、策略组、规则、订阅、版本历史、多用户账号、SQLite 持久化和 VPS 部署支持。

## 功能

- 导入、解析、校验和导出 Mihomo YAML
- 图形化编辑常见节点字段与 WebSocket、gRPC、TLS 参数
- 创建 `select`、`url-test`、`fallback`、`load-balance`、`relay` 策略组
- 表格化编辑、排序、启停规则
- 检查重复名称、缺失引用、循环引用和无效端口
- 自动保存多个配置项目
- 多用户账号、管理员权限、项目数据隔离、会话过期和登录限速
- Docker、IP 端口访问与 Caddy HTTPS 部署
- 批量导入 SS、SSR、VMess、VLESS、Trojan、Hysteria2、TUIC、Snell、SOCKS 和 HTTP 分享链接
- 导入整段 Base64 分享订阅
- 管理远程订阅，支持手动更新和定时更新
- 导入、编辑和导出 sing-box JSON，并保留格式专属字段
- 自动与手动配置快照，恢复前自动备份当前版本
- 常用规则模板，可选择追加或替换并指定目标策略组
- 用户级 JSON 备份与合并/覆盖恢复
- 可选调用 Mihomo 或 sing-box 内核进行最终配置校验
- 可选的 systemd 每日自动更新
- 首次登录任务流程，可直接填写订阅 URL 并逐步完成策略组、规则、校验和导出
- Docker 镜像内置 Mihomo 与 sing-box 校验内核，页面显示实际版本
- 图形化分组编排：从节点池拖入策略组、组内排序、跨组移动、批量加入和点击加入
- 兼容 IP + HTTP 部署环境的新增、复制和导入操作

远程订阅抓取会拒绝本机、内网、链路本地、云元数据及非 HTTP(S) 地址，并限制重定向、超时和响应大小。

## 本地开发

需要 Node.js 20 和构建 `better-sqlite3` 所需的基础编译环境。

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD='change-this-password' npm run dev
```

前端地址为 `http://localhost:5173`，API 地址为 `http://localhost:8787`。

## Docker 部署

```bash
cp .env.example .env
# 将密码转成 Base64，写入 ADMIN_PASSWORD_B64
printf '%s' 'change-this-password' | base64 -w0
docker compose up -d --build
```

打开 `http://服务器IP:8787`。

## 一键安装

仓库发布后可在 Debian/Ubuntu VPS 执行：

```bash
curl -fsSL https://raw.githubusercontent.com/cshaizhihao/OU-YAML/main/install.sh | sudo bash
```

脚本会从 `/dev/tty` 读取管理员账号、密码、端口、可选域名和自动更新选项。重复运行时会保留 `/opt/ou-yaml/.env` 与数据目录。无人值守安装可设置 `OU_YAML_AUTO_UPDATE=1` 启用自动更新，或设置为 `0` 明确关闭。

### 域名与 HTTPS

安装时填写已经解析到 VPS 的域名，脚本会同时启动 Caddy，并监听 80/443 端口。请提前在防火墙和云安全组中放行 TCP 80、TCP/UDP 443。

Cloudflare 开启代理时，DNS 记录仍需指向该 VPS。建议将 Cloudflare SSL/TLS 模式设为“完全（严格）”；小黄云不能替代源站端口、防火墙和 TLS 配置。

## 更新与备份

```bash
sudo /opt/ou-yaml/update.sh
sudo /opt/ou-yaml/backup.sh
```

SQLite 数据和账号信息保存在 `/opt/ou-yaml/data`。备份脚本同时备份数据目录与 `.env`，生成文件权限为 `600`。

启用、检查或关闭每日自动更新：

```bash
sudo /opt/ou-yaml/install-auto-update.sh
systemctl list-timers ou-yaml-update.timer
sudo /opt/ou-yaml/uninstall-auto-update.sh
```

### 内核实测

官方 Docker 镜像在构建时下载固定版本的 Mihomo 与 sing-box，校验官方发布资产的 SHA-256 后写入镜像。网页不会下载或执行用户提供的程序。需要使用自定义内核时，可参考 `docker-compose.kernel.example.yml`，确认宿主机路径后运行：

```bash
docker compose -f docker-compose.yml -f docker-compose.kernel.example.yml up -d --build
```

直接使用 Node.js 开发模式且本机未安装相应内核时，编辑、结构校验和导出功能仍可正常使用，界面会明确提示内核不可用。

## 安全说明

- 密码使用 bcrypt 哈希保存，浏览器会话使用随机令牌及 HttpOnly Cookie。
- YAML 解析限制 alias 展开次数，上传内容限制为 2MB。
- Docker 容器以非 root 用户运行，并移除 Linux capabilities。
- IP + HTTP 模式适合首次部署和可信网络。公网长期使用应配置域名 HTTPS。

## 验证

```bash
npm run typecheck
npm test
npm run build
```
