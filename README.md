# NuitGuard

English | [中文](README.zh.md)

NuitGuard is a LuCI app for OpenWrt that automates campus network authentication and connection recovery through Ruijie ePortal.

It supports Ethernet or Wi-Fi preference, configurable failover and failback, private MAC addresses, and scheduled MAC rotation. Wi-Fi can use an existing client or an open network selected by the user.

## Development preview

Campus authentication and Wi-Fi failover are still undergoing end-to-end validation. The service is disabled by default.

## Install

### Build from source

Use the OpenWrt source tree or SDK matching your router's firmware and target. From its root directory, run:

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-nuitguard
make menuconfig
```

Select `luci-app-nuitguard`. For Simplified Chinese, also enable the LuCI Simplified Chinese translation and select `luci-i18n-nuitguard-zh-cn`.

```sh
make package/luci-app-nuitguard/compile V=s
```

The packages are written to `bin/packages/`.

### Install packages

On OpenWrt using `apk`, copy the built main package to the router as `/tmp/luci-app-nuitguard.apk`, then run:

```sh
apk add --allow-untrusted /tmp/luci-app-nuitguard.apk
```

For Simplified Chinese, copy the matching translation package as `/tmp/luci-i18n-nuitguard-zh-cn.apk` and install it:

```sh
apk add --allow-untrusted /tmp/luci-i18n-nuitguard-zh-cn.apk
```

The main package uses English. The optional translation package follows the language selected in LuCI.

## Configure

Open **Services → NuitGuard → Settings**.

| Tab | Settings |
| --- | --- |
| Basic settings | Campus username, password, account type, internet check URL and expected HTTP status. |
| Uplink networks | Ethernet interface, Wi-Fi client or open SSID, preferred uplink, standby mode and private MAC per uplink. |
| Recovery | Authentication retries, retry delays, cooldown, failover limits and return policy. |
| Privacy and schedule | Fixed or rotating private MAC, rotation limits, and daily, weekly or interval schedules. |
| Advanced settings | Portal discovery URL, expected portal origin, detailed timing and logging. |

Set an internet check URL with a known successful response code before enabling the service. The default expected status is `204`; the URL is left blank. Successful internet access takes priority over portal availability, since an authenticated device may be unable to reach the login page.

Choose **Student** or **Staff**, or enter the service value required by your campus. Leave the password field blank to keep a saved password. Review the portal addresses in **Advanced settings** if your campus uses different endpoints; the shipped defaults are in [the configuration file](root/etc/config/nuitguard).

Enable NuitGuard and select **Save & Apply** to start recovery. Saving and applying later changes restarts the service.

The **Status** page shows the service, uplinks and recent events. It provides connection checks and further actions for each uplink. Manual logout pauses automatic recovery until you select **Resume recovery**.

## Commands

Run these on the router:

| Command | Purpose |
| --- | --- |
| `nuitguard check-config` | Validate the configuration. |
| `nuitguard inspect` | Show the configured uplinks and device information. |
| `nuitguard probe wired` / `nuitguard probe wifi` | Check internet access and discover the portal on the selected uplink without authenticating or switching. |
| `nuitguard preflight` | Check uplink requirements and routing conflicts before starting. |
| `nuitguard status` | Show the current service state. |
| `nuitguard restore` | Retry restoration of NuitGuard's network changes while the service is stopped. |

The init script `/etc/init.d/nuitguard` supports `start`, `stop` and `restart`. Starting requires NuitGuard to be enabled in its configuration.

## Compatibility

- **Uplinks:** Existing interfaces must use DHCP and belong to a WAN-style firewall zone with masquerading enabled and an input policy other than ACCEPT.
- **IPv4:** Connection recovery manages IPv4. Connectivity probes bind to the selected uplink; DNS uses the system resolver.
- **Portal:** Authentication targets Ruijie ePortal's `InterFace.do` API. The discovered portal must match the configured origin. Legacy RSA mode does not support password characters outside the single-byte range.
- **Wi-Fi:** Encrypted networks must use an existing OpenWrt wireless client. A radio shared by a local access point and an uplink may change channel and briefly disconnect local clients.
- **Routing:** NuitGuard refuses to take over when it finds existing policy routing rules or active managers such as mwan3 or pbr. Stopping the service restores its own changes; conflicting user edits are preserved.
