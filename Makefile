include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for NuitGuard
LUCI_NAME:=luci-app-nuitguard
LUCI_URL:=https://github.com/XiaoNetwork-Astral/luci-app-nuitguard
LUCI_MAINTAINER:=BlueFunny19
LUCI_DEPENDS:=+luci-base +jshn +jsonfilter +curl +ucode +ucode-mod-fs
LUCI_PKGARCH:=all

PKG_RELEASE:=1

define Package/luci-app-nuitguard/conffiles
/etc/config/nuitguard
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
