# 织梭 Meshuttle 1.1.0

织梭 1.1.0 把原来的 Windows 应用扩展为 Windows、macOS 与 Android 生态，并补全开源组件告知、跨平台构建和自动发布流程。

## 新增平台

### macOS

- 新增 Intel 与 Apple 芯片共用的 Universal 桌面安装包。
- 保留完整投递箱、置顶悬浮窗、远程服务器、本机托管和无固定服务器设备互联。
- 构建时下载并校验 Syncthing 2.1.2 macOS Universal 官方归档。
- 同时发布 DMG 与 ZIP，便于安装和校验。

### Android

- 新增 Android 8.0（API 26）及以上原生客户端。
- 支持连接公网 Meshuttle Server 或桌面端局域网本机服务。
- 支持发送文字、选择多个文件、流式上传、复制文字、单项选择、批量下载与批量删除。
- 下载时使用 Android 系统目录选择器，不要求广泛存储权限。
- 访问码由 Android Keystore 支持的 AES-GCM 密钥加密后保存。
- 面向 Android 16，使用 `compileSdk 36` 与 `targetSdk 36`。

Android 1.1.0 不捆绑 Syncthing，暂时不能创建或加入无固定服务器的设备组。Windows 与 macOS 桌面端继续提供完整设备互联能力。

## 桌面端改进

- 版本升级到 1.1.0。
- 新增“开源许可”窗口，可直接查看织梭 MIT 许可范围、Syncthing MPL-2.0 归属、固定版本源码与许可证链接。
- Windows 和 macOS 安装产物都会带上 `THIRD_PARTY_NOTICES.md`、织梭 MIT 许可证以及 Syncthing 上游许可文件。
- Syncthing 下载脚本改为跨平台 Node.js 脚本，固定版本并校验 SHA-256。
- Windows 构建命令拆分为 `dist:win`，新增 `dist:mac`。

## 开源合规

- 织梭自有代码继续采用 MIT License。
- 桌面安装包中的 Syncthing 是独立进程，采用 Mozilla Public License 2.0。
- 发布包和应用内界面都提供所使用 Syncthing 版本、完整对应源码、许可证及上游归属链接。
- Android APK 不包含 Syncthing 或 MPL-2.0 代码。

## 下载文件

| 文件 | 用途 |
| --- | --- |
| `Meshuttle-Setup-1.1.0.exe` | Windows x64 安装程序 |
| `Meshuttle-1.1.0-macOS-universal.dmg` | macOS Intel / Apple 芯片通用安装镜像 |
| `Meshuttle-1.1.0-macOS-universal.zip` | macOS 通用应用压缩包 |
| `Meshuttle-1.1.0-Android.apk` | 正式签名 Android APK；配置发布密钥后生成 |
| `Meshuttle-1.1.0-Android-debug.apk` | 未配置发布密钥时生成的测试签名 APK |
| `Meshuttle-1.1.0-source.zip` | 对应版本完整源码 |
| `SHA256SUMS.txt` | 全部发布文件的 SHA-256 |

## 安装前说明

- Windows 安装包尚未配置 Authenticode 证书，可能显示“未知发布者”。
- macOS 构建尚未配置 Apple Developer ID 签名与公证，Gatekeeper 可能阻止首次打开。
- Android 正式长期分发必须使用稳定保存的发布密钥。文件名包含 `debug` 的 APK 仅用于测试，不应作为长期自动更新渠道。
- 请从本项目 Releases 下载，并先核对 `SHA256SUMS.txt`。

## 验证范围

- 固定服务器接口测试。
- 桌面客户端单元测试和 UI 契约测试。
- 真实三个 Syncthing 节点的同步与初始节点离线后故障转移测试。
- Windows NSIS 安装包构建。
- GitHub Actions 上的 macOS Universal 构建和 Android SDK 36 APK 构建。
