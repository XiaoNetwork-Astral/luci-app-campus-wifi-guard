include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Campus WLAN Guard
LUCI_NAME:=luci-app-campus-wlan-guard
LUCI_URL:=https://github.com/XiaoNetwork-Astral/luci-app-nuitguard
LUCI_MAINTAINER:=BlueFunny19
LUCI_DEPENDS:=+luci-base +rpcd-mod-iwinfo +jshn +jsonfilter +curl +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +openssl-util +ip-full
LUCI_PKGARCH:=all

PKG_RELEASE:=1

define Package/luci-app-campus-wlan-guard/conffiles
/etc/config/nuitguard
/etc/nuitguard/
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
