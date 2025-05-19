# DOIT BluFi.js SDK
DOIT BluFi.js SDK 是一个基于 JavaScript 的 SDK，用于在微信小程序、Chrome浏览器（待实现）环境中为乐鑫BluFi设备配网。

乐鑫官方只提供了Android和iOS的SDK。基于微信小程序JavaScript的项目有[xuhongv/BlufiEsp32WeChat](https://github.com/xuhongv/BlufiEsp32WeChat)和[weijian.kang/esp-blufi-for-wx](https://gitee.com/weijian.kang/esp-blufi-for-wx) ，感谢两位大神。但项目久未维护，实际使用中存在一些问题。便与AI大模型合作开发了本项目。

## 实现功能

* 基于BluFi配网，主要参考乐鑫官方的[BluFi文档](https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32c2/api-guides/ble/blufi.html)，文档未讲到的部分参考乐鑫官方`ESP-IDF` SDK 源码。
* BluFi设备实时扫描、通过回调实时通知
* 使用async/await语法
* 除了常规的英文和数字WiFi SSID外，还支持支持中文、Emoji字符的SSID配网
* 支持微信小程序
* 支持BluFi非加密非校验、非加密校验两种数据传输
* 支持自定义BLE名称前缀
* 支持读取设备端WIFI列表
* 支持向设备端发送自定义消息

## 待实现功能
* 支持加密数据传输
* 支持Chrome浏览器

## 使用方法

### 微信小程序
参考`wx-example`项目，在`微信开发者工具`中导入项目并运行。

### 设备端
设备端可使用乐鑫官方支持BluFi的模组和和支持Blufi的AT固件。包括：
* [ESP32-C2 AT固件](https://docs.espressif.com/projects/esp-at/zh_CN/latest/esp32c2/AT_Binary_Lists/index.html)
* [ESP32-C3 AT固件](https://docs.espressif.com/projects/esp-at/zh_CN/latest/esp32c3/AT_Binary_Lists/index.html)
* [ESP32-C6 AT固件](https://docs.espressif.com/projects/esp-at/zh_CN/latest/esp32c6/AT_Binary_Lists/index.html)
* [ESP32 AT固件](https://docs.espressif.com/projects/esp-at/zh_CN/latest/esp32/AT_Binary_Lists/index.html)

注意，部分模组有多个AT固件，请选择适合的固件。

## 交流联系
![](docs/tech-support.png)