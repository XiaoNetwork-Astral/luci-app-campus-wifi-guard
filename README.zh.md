# NuitGuard

[English](README.md) | 中文

NuitGuard 是面向 OpenWrt 的 LuCI 应用，通过锐捷 ePortal 实现校园网自动认证与断线恢复。

支持有线或 Wi-Fi 优先、可配置的故障切换与回切、隐私 MAC 和计划轮换。无线网络既可使用已有客户端，也可由用户选择开放网络。

## 开发预览

校园网认证和无线故障切换仍在进行端到端验证。服务安装后默认关闭。

## 安装

### 从源码构建

使用与路由器固件版本和目标平台匹配的 OpenWrt 源码或 SDK，在其根目录执行：

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-nuitguard
make menuconfig
```

选择 `luci-app-nuitguard`。如需简体中文，同时启用 LuCI 的简体中文翻译，并选择 `luci-i18n-nuitguard-zh-cn`。

```sh
make package/luci-app-nuitguard/compile V=s
```

生成的安装包位于 `bin/packages/`。

### 安装软件包

对于使用 `apk` 的 OpenWrt，将构建出的主包复制到路由器，命名为 `/tmp/luci-app-nuitguard.apk`，然后执行：

```sh
apk add --allow-untrusted /tmp/luci-app-nuitguard.apk
```

如需简体中文，将对应的翻译包复制为 `/tmp/luci-i18n-nuitguard-zh-cn.apk`，然后安装：

```sh
apk add --allow-untrusted /tmp/luci-i18n-nuitguard-zh-cn.apk
```

主包使用英文。可选的中文翻译包遵循 LuCI 中选择的界面语言。

## 配置

打开 **服务 → NuitGuard → 设置**。

| 标签 | 设置内容 |
| --- | --- |
| 基础设置 | 校园网用户名、密码、账号类型、公网检测地址和预期 HTTP 状态码。 |
| 上联网络 | 有线接口、无线客户端或开放网络 SSID、首选上联、待机模式和各上联的隐私 MAC。 |
| 故障恢复 | 认证重试次数、重试间隔、冷却时间、故障切换次数和返回策略。 |
| 隐私与计划 | 固定或轮换隐私 MAC、轮换限制，以及每日、每周或间隔计划。 |
| 高级设置 | Portal 发现地址、预期门户来源、详细时序和日志设置。 |

启用服务前，请填写响应状态码已知的公网检测地址。预期状态码默认为 `204`，检测地址默认留空。公网检测成功时优先判定为在线，因为已认证的设备可能无法访问登录页。

选择「学生」或「教职工」，也可填写校园网要求的服务值。密码留空会保留已保存的密码。如果学校使用不同的认证地址，请在「高级设置」中修改；出厂默认值见[配置文件](root/etc/config/nuitguard)。

启用 NuitGuard 并点击 **保存并应用** 后开始自动恢复。后续保存并应用配置也会重新启动服务。

**状态** 页显示服务、上联和最近事件，并提供每条上联的检测及更多操作。手动注销后，自动恢复会暂停，直到点击「恢复自动处理」。

## 命令

在路由器上执行：

| 命令 | 用途 |
| --- | --- |
| `nuitguard check-config` | 校验配置。 |
| `nuitguard inspect` | 查看已配置的上联与设备信息。 |
| `nuitguard probe wired` / `nuitguard probe wifi` | 检测指定上联的公网连通性并发现门户，不执行认证或线路切换。 |
| `nuitguard preflight` | 在启动前检查上联条件和路由冲突。 |
| `nuitguard status` | 查看当前服务状态。 |
| `nuitguard restore` | 在服务停止时，重试恢复 NuitGuard 修改过的网络设置。 |

初始化脚本 `/etc/init.d/nuitguard` 支持 `start`、`stop` 和 `restart`。启动前需要在配置中启用 NuitGuard。

## 兼容性

- **上联：** 已有接口必须使用 DHCP，并归属到开启 IP 动态伪装、入站策略不是 ACCEPT 的上联防火墙区域，通常为 WAN 区域。
- **IPv4：** 自动恢复管理 IPv4 连接。连通性检测绑定所选上联，DNS 使用系统解析器。
- **认证门户：** 对接锐捷 ePortal 的 `InterFace.do` API。发现的门户必须与配置的来源地址匹配。旧式 RSA 模式不支持单字节范围以外的密码字符。
- **Wi-Fi：** 加密网络需要引用 OpenWrt 已有的无线客户端配置。上联与本地 AP 共用无线电时，信道变化可能使本地客户端短暂断开。
- **路由：** 发现已有策略路由规则或运行中的 mwan3、pbr 等管理器时，NuitGuard 会拒绝接管。停止服务会恢复自身修改，并保留发生冲突的用户修改。
