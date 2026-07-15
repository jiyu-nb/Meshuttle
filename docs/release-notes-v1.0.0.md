# 织梭 Meshuttle 1.0.0

织梭的第一个公开版本，可以在多台 Windows 电脑之间投递文字和文件。

## 主要功能

- 支持文字、单文件和多文件拖放投递。
- 支持多选、批量下载和批量删除。
- 提供始终置顶的快捷悬浮窗。
- 支持远程服务器、本机托管和无固定主机设备互联三种模式。
- 设备互联模式支持限时邀请、新设备审批和初始设备离线后的成员互传。
- 支持自定义内容留存时间和到期自动清理。

## 下载说明

- `Meshuttle-Setup-1.0.0.exe`：Windows x64 安装程序。
- `Meshuttle-1.0.0-source.zip`：对应版本的完整源码。
- `SHA256SUMS.txt`：发布文件的 SHA-256 校验值。

## 安全提示

本版本尚未配置受信任的 Authenticode 代码签名，Windows 可能显示“未知发布者”。请从本项目 Releases 页面下载，并在运行前核对 `SHA256SUMS.txt`。

设备互联模式基于 Syncthing。Syncthing 是独立的 MPL-2.0 组件，版本与来源见 `THIRD_PARTY_NOTICES.md`。
