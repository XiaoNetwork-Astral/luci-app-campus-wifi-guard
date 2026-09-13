# NuitGuard

English | [中文](README.zh.md)

A LuCI app for OpenWrt with Ruijie ePortal authentication, Ethernet/Wi-Fi failover, private MAC addresses and scheduled rotation.

Development preview. Campus validation is ongoing; the service is disabled by default.

## Build

Run from a matching OpenWrt source tree or SDK. In `menuconfig`, select `luci-app-nuitguard`; for Chinese, also enable LuCI Simplified Chinese and select `luci-i18n-nuitguard-zh-cn`.

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-nuitguard
make menuconfig
make package/luci-app-nuitguard/compile V=s
```

Output: `bin/packages/`.

## Install

For OpenWrt using `apk`, copy the built packages to the router as `/tmp/luci-app-nuitguard.apk` and, optionally, `/tmp/luci-i18n-nuitguard-zh-cn.apk`.

```sh
apk add --allow-untrusted /tmp/luci-app-nuitguard.apk
```

Optional Chinese translation:

```sh
apk add --allow-untrusted /tmp/luci-i18n-nuitguard-zh-cn.apk
```

## Compatibility

- IPv4 DHCP uplinks in a WAN firewall zone. Existing policy routing or active mwan3/pbr prevents startup.
- Encrypted Wi-Fi requires an existing OpenWrt wireless client. Sharing a radio with a local AP may briefly disconnect clients when its channel changes.
- Legacy ePortal RSA mode supports only single-byte password characters.
