# Contributing

感谢参与织梭 Meshuttle。

1. 在 Issue 中说明问题、使用场景或功能目标。
2. 从新分支提交范围清晰的改动。
3. 不要提交服务器地址、访问码、邀请文件、证书私钥或真实文件数据。
4. 涉及同步协议或存储格式时，说明兼容与迁移策略。
5. 涉及 UI 时，请附截图。

提交前运行：

```powershell
npm --prefix client install
npm --prefix client run fetch:syncthing
npm --prefix client test
npm --prefix client run test:p2p
npm --prefix server test
node --check client/main.js
node --check client/preload.js
node --check client/renderer/renderer.js
node --check client/renderer/mini.js
node --check client/renderer/setup.js
node --check client/p2p/store.js
node --check client/p2p/syncthing.js
node --check client/p2p/group.js
```

在 macOS 上提交桌面相关改动时，还应运行：

```bash
npm --prefix client run dist:mac
```

提交 Android 改动时需要 JDK 17、Gradle 9.1 与 Android SDK 36，并运行：

```bash
gradle -p android :app:assembleDebug
```

发布构建由 GitHub Actions 分别在 Windows、macOS 和 Android 环境中验证。不要为了绕过某个平台的失败而移除对应构建；请在 Pull Request 中说明无法本地复现的平台问题。

Syncthing 可执行文件不进入 Git。请使用跨平台的 `tools/fetch-syncthing.mjs`（由 `npm --prefix client run fetch:syncthing` 调用）取得与发布构建一致、经过 SHA-256 校验的版本，不要提交本地下载的二进制文件。

Android APK 不包含 Syncthing。若未来引入移动端同步引擎，必须先提交架构、安全、后台运行限制和许可证合规说明，不能仅复制桌面二进制文件。
