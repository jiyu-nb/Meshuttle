# Meshuttle Android

Android 端是原生 Java 客户端，直接连接用户选择的 Meshuttle 公网服务器或局域网托管电脑。

已支持：

- 查看、发送和复制文字；
- 选择多个文件并顺序上传；
- 多选内容、批量下载到用户选择的目录；
- 单项与批量删除；
- Android Keystore 加密保存访问码；
- HTTPS 公网服务与 HTTP 局域网主机。

Android 1.1.0 不捆绑 Syncthing，因此暂不直接加入桌面端“无固定主机设备组”。这是为了避免不可靠的后台常驻行为和未经验证的第三方 Syncthing Android 封装。手机可以连接公网服务器，或连接同一局域网中启用“本机托管”的电脑。

## 构建

需要 JDK 17、Gradle 9.1.0、Android SDK 36 与 Build Tools 36.0.0：

```bash
cd android
gradle :app:assembleDebug
```

APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。正式发布应使用长期保存的私有签名密钥构建 release APK，签名密钥不得提交进 Git。
