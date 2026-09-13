# NuitGuard

面向校园网的 OpenWrt LuCI 插件，计划支持自动认证、隐私 MAC、计划轮换及有线／Wi-Fi 上联切换。

当前为开发中的配置版本：可保存恢复策略和上联偏好，并通过 `nuitguard check-config` 校验配置、`nuitguard inspect` 读取设备概况。自动认证与网络切换尚未接入，不会启动网络守护进程。

`nuitguard probe wired` 或 `nuitguard probe wifi` 会通过指定上联分别检查公网和 Portal。先在配置页填写公网检测地址；留空时会报告未配置。诊断使用 IPv4 并绑定所选接口的设备，DNS 使用系统解析器；未配置或未连接的上联会直接报错。Portal 结果仅表示发现候选登录地址，不触发认证或切换，输出不包含动态参数值。

在 OpenWrt 源码或匹配目标固件的 SDK 中，将本仓库放入 `package/luci-app-nuitguard`，安装 LuCI feed 后执行：

```sh
make menuconfig
make package/luci-app-nuitguard/compile V=s
```

选择 `luci-app-nuitguard`；需要简体中文时，同时选择 LuCI 的简体中文翻译，构建独立的 `luci-i18n-nuitguard-zh-cn` 包。界面原文使用美式英语，显示语言遵循 LuCI 的语言设置。
