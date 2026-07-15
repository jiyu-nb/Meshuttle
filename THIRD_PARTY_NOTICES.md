# Third-party notices

## Syncthing

织梭 Meshuttle 的“设备互联”模式捆绑并启动未修改的独立 Syncthing 可执行程序。

- Project: Syncthing
- Version: 2.1.2
- Website: https://syncthing.net/
- Source: https://github.com/syncthing/syncthing/tree/v2.1.2
- License: Mozilla Public License 2.0 (MPL-2.0)
- Windows amd64 archive SHA-256: `4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96`

构建脚本把上游归档中的许可证、作者和说明文件复制到 `client/vendor/syncthing/`，发布包中对应位置为 `resources/syncthing/`。Syncthing 的 MPL-2.0 授权不改变织梭自有代码的 MIT 授权。
