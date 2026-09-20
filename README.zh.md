# 校园网守卫

[English](README.md) | 中文

面向 OpenWrt 的 LuCI 应用，支持锐捷 ePortal 认证、有线／Wi-Fi 故障切换、共享 MAC 地址池与计划轮换

开发预览版本，校园网实测仍在进行，服务默认关闭

固定模式为每条上联单独保存一个隐私 MAC；轮换模式共用一个持久地址池，按顺序循环使用并避免同时使用相同地址；可选的恢复重试可在设定次数内重新生成地址池；重新生成不会删除校园网已有的设备记录

## 构建

在匹配的 OpenWrt 源码或 SDK 根目录执行；在 `menuconfig` 中选择 `luci-app-campus-wlan-guard`；如需中文，同时启用 LuCI 简体中文并选择 `luci-i18n-campus-wlan-guard-zh-cn`

```sh
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/XiaoNetwork-Astral/luci-app-nuitguard.git package/luci-app-campus-wlan-guard
make menuconfig
make package/luci-app-campus-wlan-guard/compile V=s
```

输出目录：`bin/packages/`

## 安装

对于使用 `apk` 的 OpenWrt，将构建出的主包复制到路由器，命名为 `/tmp/luci-app-campus-wlan-guard.apk`；可选的中文包命名为 `/tmp/luci-i18n-campus-wlan-guard-zh-cn.apk`

```sh
apk add --allow-untrusted /tmp/luci-app-campus-wlan-guard.apk
```

可选的中文翻译：

```sh
apk add --allow-untrusted /tmp/luci-i18n-campus-wlan-guard-zh-cn.apk
```

公网检测拒绝跳转，并同时校验预期状态码与正文；204 响应必须为空，其他响应必须与设定文本一致；公网可达时不再重复认证；公网与登录页均不可达时，重试达到上限后进入冷却，不继续换址；认证后预留校园网更新 DHCP 地址的时间，并随地址变化刷新路由

公网检测可选择小米、华为、vivo 预设，也可输入自定义地址；常规设置底部提供“重置”和“彻底重置”：前者恢复默认设置并保留已保存的账号，后者同时清除账号；两者都会先停止服务并恢复插件修改的网络设置

## 兼容性

- 使用 WAN 防火墙区域中的 IPv4 DHCP 上联；已有策略路由或运行中的 mwan3/pbr 会阻止服务启动
- 加密 Wi-Fi 需要引用 OpenWrt 已有的无线客户端；与本地 AP 共用无线电时，信道变化可能使客户端短暂断开
- 旧式 ePortal RSA 模式仅支持单字节密码字符
