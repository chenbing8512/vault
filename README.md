# 密码库（Vault）v1.7.4

一个本地优先的密码管理器。数据以密文存在你自己的电脑上；可选开启端到端加密同步，服务端只中转密文，**主密码永远不会上传**。

- 安装包 **3.6 MB**（macOS .dmg），启动瞬间完成
- 支持 **macOS** 与 **Windows**，同一套代码
- 三栏布局：导航 / 列表 / 详情，**保险库 → 文件夹 → 标签**三级组织
- 5 套主题、7 种字体、字号 80%–140% 可调
- 所有敏感数据用 **AES-256-GCM** 加密，密钥由主密码经 **PBKDF2-HMAC-SHA256（600,000 次迭代）** 派生
- 加密与文件读写都在 Rust 原生层完成，前端的 JavaScript 拿不到落盘的明文
- **自动更新**：启动后定时检查 GitHub Release，有新版一键安装

![主界面](https://cdn.jsdelivr.net/gh/chenbing8512/vault@main/docs/screenshot-main.png)

## 下载

到 [Releases](https://github.com/chenbing8512/vault/releases/latest) 下载对应平台的安装包：

| 平台 | 文件 |
| --- | --- |
| macOS（Apple Silicon） | `Vault_x.y.z_aarch64.dmg` |
| macOS（Intel） | `Vault_x.y.z_x64.dmg` |
| Windows | `Vault_x.y.z_x64-setup.exe` |

已安装的旧版本会在「设置 → 关于」里提示更新，点一下即可升级。

## 功能

**多设备同步（v1.7，可选）**
- **零知识**：客户端用主密码派生的密钥加密整库后再上传，服务端只存密文，连服务器管理员也看不到内容
- **账号隔离**：注册 / 登录后按用户隔离，朋友注册看到的是他自己的库，不会混到你的账号
- **冲突合并**：两台设备离线各改一条不会丢——按条目取较新的，删除单独比较；推送带版本号，服务端不一致会拒绝并触发自动合并
- **自动同步**：每次保存后、解锁后自动同步，也可在设置里手动触发或关闭
- **约束**：两台设备必须用**同一个主密码**。改主密码后要先同步一次，否则另一台解不开

**自动更新（v1.7）**
- 启动 30 秒后检查一次，之后每 6 小时；发现新版侧栏出现「新版本 x.y.z」，点了一键下载安装
- 安装包经 Tauri 官方 updater 签名校验，签名私钥只存在 GitHub Secrets

**设置页（v1.7 重做）**
- 独立全屏页，六个分类：外观 / 行为 / 同步 / 备份 / 数据 / 关于

![设置页](https://cdn.jsdelivr.net/gh/chenbing8512/vault@main/docs/screenshot-settings.png)

**组织方式**
- **保险库**：彼此独立的分区。个人 / 工作 / 客户各建一个，列表不会混在一起；每个库有独立颜色，右上角切换
- **文件夹**：库内可建多层文件夹（如「研发中心 / 客户 A」），侧栏点击折叠展开，条目数实时显示
- **标签**：一条记录可打多个标签，跨文件夹筛选。侧栏「＋」预先新建，点「⋯」进管理面板做重命名 / 合并 / 换色 / 删除；⌘ 点击多个标签只看同时命中的条目；把标签拖到条目或文件夹上可批量打标签
- **同一网站多账号**：同站点的记录会显示账号数徽标，详情页直接列出其它账号，一键切换
- **归档**：暂时不用的记录收进归档，不占列表也不删除
- **最近使用**：按打开时间排序最近 20 条
- **右键菜单**：列表条目上右键，直接收藏 / 归档 / 复制账号密码 / 移到回收站

**条目管理**
- 5 种类型：登录、银行卡、身份信息、API 密钥、安全笔记（各自预置好字段）
- 任意自定义字段，可标记为私密（默认打码）
- 收藏、全文搜索（含字段内容与标签）
- 排序：最近修改 / 名称 A-Z / 添加时间
- 密码历史：改密码时自动留档，最多 10 条
- 回收站：删除先进回收站，超过保留期（默认 30 天）自动清理
- 打开网址、密码强度实时提示

**两步验证（TOTP）**
- 内置验证器，粘贴 Base32 密钥即可，每 30 秒刷新，带倒计时环
- 已通过 RFC 6238 官方 5 组测试向量

**密码体检**
- 弱密码、重复使用、超过半年未更新、缺少密码四类问题
- 弱密码会给出**具体原因**：太短、纯数字、常见密码、连续数字、重复字符、含站点名、含用户名
- 0–100 评分，点击条目直接跳转修改；全部在本机计算

**生成器**
- 随机字符模式：长度 8–40，可选大小写/数字/符号，排除易混淆字符（0O1lI）
- 易记短语模式：`山-月-松-岸-42`

**界面**
- 5 套主题：极光（深紫蓝）、石墨（纯黑白）、森野（墨绿）、落日（暖橙）、晨光（浅色）
- 主题在解锁前就生效，切换即时预览
- 全局字号 80%–140%（设置里选或 `⌘ +` / `⌘ −` 调，`⌘ 0` 复位），只缩文字不缩布局
- 7 种界面字体：系统默认、苹方、鸿蒙黑体、思源黑体、霞鹜文楷、等宽、宋体/衬线；未安装的自动回退

**备份（v1.5）**
- 按天自动备份，保留 12 份；可再指定一个自定义目录（如 `~/Documents/Vault Backups`）双写一份，删 App 不会连备份一起没
- 主文件不存在时启动会自动搜寻桌面、文稿、下载里的 `vault-*.dat` 并提示恢复
- 备份可逐条恢复 / 删除；解锁页常驻「从备份恢复」入口

**其他**
- 自动锁定、剪贴板自动清除时间可调
- CSV 导入（Chrome / Bitwarden / 1Password 等通用表头）、CSV 导出（明文，二次确认）、加密备份导出
- 键盘导航：`↑` `↓` 切换条目

## 安全设计

| 项目 | 做法 |
| --- | --- |
| 加密算法 | AES-256-GCM（带附加认证数据，防篡改） |
| 密钥派生 | PBKDF2-HMAC-SHA256，600,000 次迭代，每个库独立 16 字节随机盐 |
| 主密码 | 只用于派生密钥，**绝不落盘**，忘记即无法恢复 |
| 内存密钥 | 锁定时主动清零，进程退出即释放 |
| 写盘 | 先写临时文件 + fsync，再原子重命名，避免断电写坏 |
| 同步 | 客户端加密后上传 Envelope 密文；服务端只做存储与版本校验，无解密能力 |
| 自动备份 | 每次保存按天留一份，保留 12 份；可设第二个目录双写 |
| 自动更新 | 安装包经 minisign 签名校验，私钥只在 CI Secrets 里 |
| 剪贴板 | 复制密码后按设定时间自动清空 |
| 自动锁定 | 无操作达到设定时长后自动锁定并清空内存数据 |

> 没有后门，也没有恢复码。请务必记牢主密码，并定期导出一份加密备份到别处。

## 数据结构

`vault.dat` 解密后是一段 JSON（当前 v4）：

```jsonc
{
  "version": 4,
  "vaults":  [{ "id": "v-self", "name": "个人", "color": "#6f8cff" }],
  "folders": [{ "id": "f1", "name": "客户 A", "parentId": null, "vaultId": "v-self" }],
  "tags":    [{ "name": "工作", "color": "#6f8cff" }],
  "items":   [{ "id": "a1", "kind": "login", "title": "...", "vaultId": "v-self",
                "folderId": "f1", "tags": ["工作"], "archivedAt": null, "usedAt": 0 }],
  "curVaultId": "v-self",
  "settings": {}
}
```

v1~v3 的旧数据在解锁时自动迁移：补默认保险库、补空标签数组、扫描条目把用过的标签登记进 `tags` 表。文件仍用同一把主密码，不会丢内容。

## 数据存放位置

- macOS：`~/Library/Application Support/com.local.vault/vault.dat`
- Windows：`%APPDATA%\com.local.vault\vault.dat`
- 内置备份：上面目录下的 `backups/` 文件夹（每天一份，留 12 份）
- 额外备份：设置里指定的任意文件夹（默认建议 `~/Documents/Vault Backups`），同样每天一份
- 偏好文件：上面目录下的 `prefs.json`，只存备份目录路径、同步账号的登录令牌，不含主密码

`vault.dat` 本身就是密文，可以直接拷到 U 盘或网盘做冷备份。

> 注意：内置备份和主文件在同一个目录里，整个目录被删就一起没了。所以要么设一个额外备份目录，要么定期「导出加密备份」到桌面/网盘。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `⌘/Ctrl + K` 或 `⌘/Ctrl + F` | 聚焦搜索 |
| `⌘/Ctrl + N` | 新建条目 |
| `⌘/Ctrl + Shift + N` | 新建文件夹 |
| `⌘/Ctrl + L` | 立即锁定 |
| `⌘/Ctrl + +` / `⌘/Ctrl + -` | 放大 / 缩小界面字号（每次 5%） |
| `⌘/Ctrl + 0` | 字号恢复 100% |
| `↑` / `↓` | 切换条目 |
| `Esc` | 关闭弹层 / 设置页 / 清空搜索 |
| `Enter`（解锁页） | 解锁 |

## 构建

需要 Node.js 18+ 与 Rust 1.77+。

```bash
npm install

# macOS：产出 .app
npm run build:mac

# Windows：产出 .exe 安装包（在 Windows 机器上执行）
npm run build:win
```

产物位置：`src-tauri/target/release/bundle/`

> 本地构建要产出可自动更新的签名包，需要设置 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量；不设置则只出未签名的包。
>
> 若 `--bundles dmg` 在较新的 macOS 上失败（Tauri 的 `bundle_dmg.sh` 与新版 `hdiutil` 不兼容），先只打 app，再手动封装：
> ```bash
> npx tauri build --bundles app
> mkdir -p /tmp/d && cp -R src-tauri/target/release/bundle/macos/Vault.app /tmp/d/ && ln -s /Applications /tmp/d/Applications
> hdiutil create -volname Vault -srcfolder /tmp/d -ov -format UDZO Vault.dmg
> ```

Windows 上还需要安装 **Visual Studio 生成工具（C++ 桌面开发）**。如果不想在本机装几个 G 的工具链，仓库里的 GitHub Actions 流水线（`.github/workflows/build.yml`）会在打 tag 时自动产出 Mac 和 Windows 安装包并发布 Release。

## 开发调试

```bash
npm run dev
```

## 目录结构

```
vault/
├── src/                     # 前端（纯 HTML/CSS/JS，无框架，无构建步骤）
│   ├── index.html
│   ├── style.css            # 含 5 套主题的 CSS 变量
│   └── app.js               # 界面逻辑、组织模型、TOTP、体检、同步合并、导入导出
├── src-tauri/
│   ├── src/main.rs          # 加密、存储、备份等原生操作 + 9 项单元测试
│   ├── src/sync.rs          # 与同步服务的 HTTP 交互
│   ├── tests/               # 同步端到端集成测试
│   ├── tauri.conf.json
│   └── icons/
├── docs/                    # README 截图
└── make_icon.swift          # 图标生成脚本（改配色后重跑即可）
```

## 测试

```bash
cd src-tauri && cargo test
```

覆盖：加解密往返、错误密码拒绝、密文篡改检测、随机 IV、时间戳格式、闰日换算、备份轮换；同步链路有真连服务端的集成测试。

TOTP 用 RFC 6238 附录 B 的 5 组向量验证过，与 Google Authenticator 等标准验证器一致。
