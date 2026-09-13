# NuitGuard

[English](README.md) | 中文

面向 OpenWrt 的 LuCI 应用，支持锐捷 ePortal 认证、有线／Wi-Fi 故障切换、隐私 MAC 和计划轮换。

开发预览版本，校园网实测仍在进行，服务默认关闭。

## 构建

在匹配的 OpenWrt 源码或 SDK 根目录执行。在 `menuconfig` 中选择 `luci-app-nuitguard`；如需中文，同时启用 LuCI 简体中文并选择 `luci-i18n-nuitguard-zh-cn`。

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-nuitguard
make menuconfig
make package/luci-app-nuitguard/compile V=s
```

输出目录：`bin/packages/`。

## 安装

对于使用 `apk` 的 OpenWrt，将构建出的主包复制到路由器，命名为 `/tmp/luci-app-nuitguard.apk`；可选的中文包命名为 `/tmp/luci-i18n-nuitguard-zh-cn.apk`。

```sh
apk add --allow-untrusted /tmp/luci-app-nuitguard.apk
```

可选的中文翻译：

```sh
apk add --allow-untrusted /tmp/luci-i18n-nuitguard-zh-cn.apk
```

## 兼容性

- 使用 WAN 防火墙区域中的 IPv4 DHCP 上联。已有策略路由或运行中的 mwan3/pbr 会阻止服务启动。
- 加密 Wi-Fi 需要引用 OpenWrt 已有的无线客户端。与本地 AP 共用无线电时，信道变化可能使客户端短暂断开。
- 旧式 ePortal RSA 模式仅支持单字节密码字符。
