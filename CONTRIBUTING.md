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

Syncthing 可执行文件不进入 Git。请使用仓库脚本取得与发布构建一致、经过校验的版本，不要提交本地下载的二进制文件。
