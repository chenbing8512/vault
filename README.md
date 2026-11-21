# 密码库（Vault）

一个完全离线的本地密码管理器。数据只存在你自己的电脑上，不联网、不上传、不需要任何账号。

- 安装包约 **8 MB**，启动快，界面为深色玻璃质感
- 支持 **macOS** 与 **Windows**，同一套代码
- 所有敏感数据用 **AES-256-GCM** 加密，密钥由主密码经 **PBKDF2-HMAC-SHA256（600,000 次迭代）** 派生
- 加密与文件读写都在 Rust 原生层完成，前端的 JavaScript 拿不到落盘的明文

## 安全设计

| 项目 | 做法 |
| --- | --- |
| 加密算法 | AES-256-GCM（带附加认证数据，防篡改） |
| 密钥派生 | PBKDF2-HMAC-SHA256，600,000 次迭代，每个库独立 16 字节随机盐 |
| 主密码 | 只用于派生密钥，**绝不落盘**，忘记即无法恢复 |
| 内存密钥 | 锁定时主动清零，进程退出即释放 |
| 写盘 | 先写临时文件 + fsync，再原子重命名，避免断电写坏 |
| 自动备份 | 每次保存按天自动留一份，最多保留 12 份 |
| 剪贴板 | 复制密码后 30 秒自动清空 |
| 自动锁定 | 无操作 5 分钟后自动锁定并清空内存数据 |

> 没有后门，也没有恢复码。请务必记牢主密码，并定期导出一份加密备份到别处。

## 数据存放位置

- macOS：`~/Library/Application Support/com.local.vault/vault.dat`
- Windows：`%APPDATA%\com.local.vault\vault.dat`
- 自动备份：上面目录下的 `backups/` 文件夹

`vault.dat` 本身就是密文，可以直接拷到 U 盘或网盘做冷备份。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `⌘/Ctrl + K` | 聚焦搜索 |
| `⌘/Ctrl + N` | 新建条目 |
| `⌘/Ctrl + L` | 立即锁定 |
| `Esc` | 关闭弹层 / 清空搜索 |
| `Enter`（解锁页） | 解锁 |

## 构建

需要 Node.js 18+ 与 Rust 1.77+。

```bash
npm install

# macOS：产出 .app 与 .dmg
npm run build:mac

# Windows：产出 .exe 安装包（在 Windows 机器上执行）
npm run build:win
```

产物位置：`src-tauri/target/release/bundle/`

Windows 上还需要安装 **Visual Studio 生成工具（C++ 桌面开发）**，这是 Tauri 编译的硬性依赖。如果不想在本机装几个 G 的工具链，可以直接用仓库里的 GitHub Actions 流水线（`.github/workflows/build.yml`）在云端同时产出 Mac 和 Windows 安装包。

## 开发调试

```bash
npm run dev
```

## 目录结构

```
vault/
├── src/                     # 前端（纯 HTML/CSS/JS，无框架，无构建步骤）
│   ├── index.html
│   ├── style.css
│   └── app.js               # 界面逻辑；浏览器直开时自动降级为 WebCrypto
├── src-tauri/
│   ├── src/main.rs          # 加密、存储、备份等全部敏感操作
│   ├── tauri.conf.json
│   └── icons/
└── make_icon.swift          # 图标生成脚本（改配色后重跑即可）
```
