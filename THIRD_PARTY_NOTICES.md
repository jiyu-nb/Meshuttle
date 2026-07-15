# Third-party notices

## Syncthing

织梭 Meshuttle 的“设备互联”模式捆绑并启动未修改的独立 Syncthing 可执行程序。

- Project: Syncthing
- Version: 2.1.2
- Website: https://syncthing.net/
- Source: https://github.com/syncthing/syncthing/tree/v2.1.2
- Source archive: https://github.com/syncthing/syncthing/releases/download/v2.1.2/syncthing-source-v2.1.2.tar.gz
- License: Mozilla Public License 2.0 (MPL-2.0)
- Upstream license text: https://github.com/syncthing/syncthing/blob/v2.1.2/LICENSE
- Windows amd64 archive SHA-256: `4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96`
- macOS universal archive SHA-256: `31ec0f7a58df841cfde5a69b00dd624cbc53400002c968ec789072cff83997b4`

构建脚本把上游归档中的许可证、作者和说明文件复制到 `client/vendor/syncthing/`，发布包中对应位置为 `resources/syncthing/`。本文件也会安装到 `resources/THIRD_PARTY_NOTICES.md`，用于告知可执行文件接收者如何取得对应版本源码。Syncthing 的 MPL-2.0 授权不改变织梭自有代码的 MIT 授权。

Android 客户端不捆绑 Syncthing，也不包含 Syncthing 源码；它通过 Meshuttle HTTP API 连接用户选择的服务器或局域网主机。
