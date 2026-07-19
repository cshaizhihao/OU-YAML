# OU-YAML

OU-YAML 是面向非技术用户的 Mihomo / Clash Meta 配置可视化编辑器。第一阶段提供节点、策略组、规则、基础设置与 YAML 源码的双向编辑，并包含账号登录、SQLite 持久化和 VPS 部署支持。

## 第一阶段功能

- 导入、解析、校验和导出 Mihomo YAML
- 图形化编辑常见节点字段与 WebSocket、gRPC、TLS 参数
- 创建 `select`、`url-test`、`fallback`、`load-balance`、`relay` 策略组
- 表格化编辑、排序、启停规则
- 检查重复名称、缺失引用、循环引用和无效端口
- 自动保存多个配置项目
- 管理员账号登录、会话过期和登录限速
- Docker、IP 端口访问与 Caddy HTTPS 部署

分享链接和远程订阅导入属于第二阶段。目前可以导入包含相应协议节点的 Mihomo YAML。

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

脚本会从 `/dev/tty` 读取管理员账号、密码、端口和可选域名。重复运行时会保留 `/opt/ou-yaml/.env` 与数据目录。

### 域名与 HTTPS

安装时填写已经解析到 VPS 的域名，脚本会同时启动 Caddy，并监听 80/443 端口。请提前在防火墙和云安全组中放行 TCP 80、TCP/UDP 443。

Cloudflare 开启代理时，DNS 记录仍需指向该 VPS。建议将 Cloudflare SSL/TLS 模式设为“完全（严格）”；小黄云不能替代源站端口、防火墙和 TLS 配置。

## 更新与备份

```bash
sudo /opt/ou-yaml/update.sh
sudo /opt/ou-yaml/backup.sh
```

SQLite 数据和账号信息保存在 `/opt/ou-yaml/data`。备份脚本同时备份数据目录与 `.env`，生成文件权限为 `600`。

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
