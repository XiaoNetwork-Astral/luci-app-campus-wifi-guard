# Campus WLAN Guard

English | [中文](README.zh.md)

A LuCI app for OpenWrt with Ruijie ePortal authentication, Ethernet/Wi-Fi failover, a shared MAC pool and scheduled rotation.

Development preview. Campus validation is ongoing; the service is disabled by default.

Fixed mode uses a separate persistent private MAC for each uplink. Rotation modes share one MAC pool and cycle through it without using the same address simultaneously. Optional recovery retries can regenerate the pool within configured limits; regeneration does not remove existing campus device records.

## Build

Run from a matching OpenWrt source tree or SDK. In `menuconfig`, select `luci-app-campus-wlan-guard`; for Chinese, also enable LuCI Simplified Chinese and select `luci-i18n-campus-wlan-guard-zh-cn`.

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-campus-wlan-guard
make menuconfig
make package/luci-app-campus-wlan-guard/compile V=s
```

Output: `bin/packages/`.

## Install

For OpenWrt using `apk`, copy the built packages to the router as `/tmp/luci-app-campus-wlan-guard.apk` and, optionally, `/tmp/luci-i18n-campus-wlan-guard-zh-cn.apk`.

```sh
apk add --allow-untrusted /tmp/luci-app-campus-wlan-guard.apk
```

Optional Chinese translation:

```sh
apk add --allow-untrusted /tmp/luci-i18n-campus-wlan-guard-zh-cn.apk
```

Internet checks reject redirects and require the expected status plus an empty 204 response or matching response text. Public internet access takes priority over login-page reachability; repeated failures of both checks enter cooldown without changing MAC addresses. After authentication, the service allows time for campus DHCP changes and updates its routes.

The internet check selector includes Xiaomi, Huawei and vivo presets and accepts a custom URL. General settings also offers full initialization, which restores plugin-owned network changes before clearing the plugin settings and saved data.

## Compatibility

- IPv4 DHCP uplinks in a WAN firewall zone. Existing policy routing or active mwan3/pbr prevents startup.
- Encrypted Wi-Fi requires an existing OpenWrt wireless client. Sharing a radio with a local AP may briefly disconnect clients when its channel changes.
- Legacy ePortal RSA mode supports only single-byte password characters.
