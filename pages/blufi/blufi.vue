<template>
    <view>
        <view>
            <view class="header">
                <text class="title">ESP32 BluFi 配网</text>
            </view>

            <!-- 蓝牙设备扫描和连接部分 -->
            <view>
                <!-- 在设备连接部分添加校验选项 -->
                <view class="section">
                    <view class="section-title">BluFi设置</view>
                    <view class="form-item">
                        <label class="label">
                            <view style="color: #999;">设备名称前缀</view>
                            <input type="text" :value="prefix" bindinput="changePrefix" placeholder="请输入BLE设备名前缀" />
                        </label>
                        <label class="label">
                            <view style="color: #999;">扫描WiFi超时(毫秒)</view>
                            <input type="text" :value="scanWifiTimeout" @input="changeTimeout"
                                placeholder="请输入扫描WiFi超时时长" />
                        </label>
                        <label class="label">
                            <checkbox @click="toggleChecksum" :checked="enableChecksum"> 启用CRC16校验</checkbox>
                        </label>
                    </view>
                    <button class="btn" @click="initBluFi" :disabled="blufiInitialized">初始化BluFi</button>
                </view>

                <!-- 原有的设备连接部分 -->
                <view class="section">
                    <view class="section-title">设备连接</view>
                    <view class="button-group">
                        <button class="btn" @click="scanDevices"
                            :disabled="!bluetoothReady || connected || !blufiInitialized">扫描设备</button>
                        <button class="btn" @click="disconnectDevice" :disabled="!connected">断开连接</button>
                    </view>
                </view>

                <!-- 设备列表 -->
                <view class="device-list" v-if="devices.length > 0 && !connected">
                    <view class="list-title">可用设备</view>
                    <view class="device-item" v-for="(item, index) in devices" :key="item.deviceId"
                        @click="connectDevice" :data-id="item.deviceId">
                        <view class="device-name">{{item.name || '未命名设备'}}</view>
                        <view class="device-id">ID: {{item.deviceId}}</view>
                        <view class="device-rssi">信号强度: {{item.RSSI}} dBm</view>
                    </view>
                </view>
            </view>

            <!-- WiFi 配置部分 -->
            <view class="section" v-if="connected">
                <view class="section-title">WiFi 配置</view>
                <button class="btn" @click="scanWifi">扫描 WiFi</button>

                <!-- WiFi 列表 -->
                <view class="wifi-list" v-if="wifiList.length > 0">
                    <view class="list-title">可用 WiFi</view>
                    <view class="wifi-item" v-for="(item, index) in wifiList" :key="item.ssid" @click="selectWifi"
                        :data-ssid="item.ssid">
                        <view class="wifi-name">{{item.ssid}}</view>
                        <view class="wifi-rssi">信号强度: {{item.rssi}}</view>
                    </view>
                </view>

                <!-- WiFi 配置表单 -->
                <form @submit="configureWifi">
                    <view class="form-group">
                        <view class="form-item">
                            <text class="label">WiFi 名称</text>
                            <view class="input-wrapper">
                                <input class="input" name="ssid" placeholder="请选择 WiFi" :value="selectedSsid" disabled
                                    @click="showWifiList" />
                            </view>
                        </view>
                        <view class="form-item">
                            <text class="label">WiFi 密码</text>
                            <view class="password-toggle" @click="togglePasswordVisibility">
                                {{showPassword ? '隐藏' : '显示'}}
                            </view>
                            <view class="input-wrapper">
                                <input class="input" name="password" :password="!showPassword"
                                    placeholder="请输入 WiFi 密码" />
                            </view>

                        </view>
                    </view>
                    <button class="btn submit-btn" form-type="submit">配置 WiFi</button>
                </form>

                <!-- 自定义数据发送部分 -->
                <view class="section-title" style="margin-top: 20px;">发送自定义数据</view>
                <form @submit="sendCustomData">
                    <view class="form-group">
                        <view class="form-item">
                            <text class="label">自定义数据</text>
                            <view class="input-wrapper">
                                <input class="input" name="customData" placeholder="请输入要发送的数据" />
                            </view>
                        </view>
                    </view>
                    <button class="btn submit-btn" form-type="submit">发送数据</button>
                </form>
                <view style="margin: 50px;"></view>

                <!-- 自定义数据接收部分 -->
                <view class="section-title" style="margin-top: 20px;">接收自定义数据</view>
                <view v-for="(item, index) in receivedCustomData" :key="index">
                    <view style="font-size: small; color:#999;">{{item.time}}</view>
                    <view>{{item.data}}</view>
                </view>
                <view style="margin: 50px;"></view>

            </view>
            <!-- 连接状态提示 -->
            <view class="status-bar">
                <text class="status-text">{{connected ? '已连接' : '未连接'}}</text>
            </view>
        </view>

        <view v-if="isShowLog" class="log-window">
            <view class="title">LOG(时间逆序)</view>
            <view v-for="(item, index) in log" :key="index" :class="item.type">
                {{item.time}} [{{item.type}}] {{item.data}}
            </view>
            <view style="height: 100px;"></view>
        </view>
        <view class="log-button" @click="showLog">LOG</view>
    </view>
</template>

<script>
    import { BluFi, WIFI_MODE } from "@/static/blufi.js"
    export default {
        data() {
            return {
                devices: [],
                prefix: 'BLUFI_',
                connected: false,
                wifiList: [],
                selectedSsid: "",
                showPassword: false,
                bluetoothReady: false, // 蓝牙初始化状态
                enableChecksum: false, // 是否启用CRC16校验
                blufiInitialized: false, // BluFi是否已初始化
                receivedCustomData: [],
                scanWifiTimeout: 3000, // 扫描WiFi的超时时间
                log: [],
                isShowLog: false,
            }
        },
        onLoad() {
            try {
                const prefix = uni.getStorageSync('blufi_prefix');
                const scanWifiTimeout = uni.getStorageSync('blufi_scanWifiTimeout');
                const enableChecksum = uni.getStorageSync('blufi_enableChecksum');

                // 更新设置（只更新有保存值的设置）
                const newSettings = {};

                if (prefix) {
                    newSettings.prefix = prefix;
                }

                if (scanWifiTimeout) {
                    newSettings.scanWifiTimeout = scanWifiTimeout;
                }

                if (enableChecksum !== undefined && enableChecksum !== null) {
                    newSettings.enableChecksum = enableChecksum;
                }

                // 更新数据
                if (Object.keys(newSettings).length > 0) {
                    Object.assign(this.$data, newSettings);
                }

            } catch (error) {
                console.error('读取设置失败:', error);
            }
        },
        onUnload() {
            if (this.blufi) {
                this.blufi.disconnect();
            }
        },
        methods: {
            selectWifi(e) {
                const ssid = e.currentTarget.dataset.ssid;
                this.selectedSsid = ssid;
            },

            showWifiList() {
                // 如果已经有 WiFi 列表，直接显示
                if (this.wifiList.length > 0) {
                    // 可以添加一个动画或者滚动到 WiFi 列表区域
                    uni.pageScrollTo({
                        selector: ".wifi-list",
                        duration: 300,
                    });
                } else {
                    // 如果没有 WiFi 列表，触发扫描
                    this.scanWifi();
                }
            },

            togglePasswordVisibility() {
                this.showPassword = !this.showPassword;
            },
            // 切换校验状态
            toggleChecksum() {
                // 保存到本地存储
                uni.setStorageSync('blufi_enableChecksum', !this.enableChecksum);
                this.enableChecksum = !this.enableChecksum;
            },
            changePrefix(e) {
                this.prefix = e.detail.value;
                // 保存到本地存储
                uni.setStorageSync('blufi_prefix', e.detail.value);
            },
            changeTimeout(e) {
                this.scanWifiTimeout = parseInt(e.detail.value);
                // 保存到本地存储
                uni.setStorageSync('blufi_scanWifiTimeout', parseInt(e.detail.value));
            },
            // 初始化BluFi
            async initBluFi() {
                // 创建BluFi实例，传入校验选项
                this.blufi = new BluFi({
                    devicePrefix: this.prefix,
                    scanWifiTimeout: parseInt(this.scanWifiTimeout),
                    enableChecksum: this.enableChecksum,
                    mtu: 256,
                    onLog: {
                        log: (...p) => {
                            console.log(...p);
                            this.log.unshift({
                                time: this.getTime(new Date()),
                                type: 'log',
                                data: JSON.stringify(p),
                            });
                        },
                        warn: (...p) => {
                            console.warn(...p);
                            this.log.unshift({
                                time: this.getTime(new Date()),
                                type: 'warn',
                                data: JSON.stringify(p),
                            });
                        },
                    },
                    onCustomData: (data) => {
                        console.log('收到自定义数据:', data);
                        // 例如：将Uint8Array转换为字符串
                        const dataStr = BluFi.uint8ArrayToString(data);
                        this.receivedCustomData.push({
                            time: (new Date()).toLocaleString(),
                            data: dataStr,
                        })
                    },
                    onWifiStatusChange: (status) => {
                        console.log('WIFI状态变化:', status);
                    }
                });
                console.log('init BluFi', this.prefix, this.enableChecksum);
                // 初始化蓝牙
                const initialized = await this.blufi.init();
                if (!initialized) {
                    uni.showToast({
                        title: "蓝牙初始化失败",
                        icon: "none",
                    });
                } else {
                    uni.showToast({
                        title: "BluFi初始化成功",
                        icon: "success",
                    });
                }

                // 更新蓝牙初始化状态和BluFi初始化状态
                this.bluetoothReady = initialized;
                this.blufiInitialized = initialized;
            },
            async scanDevices() {
                try {
                    // 清空设备列表
                    this.devices = [];

                    // 显示扫描状态提示，但不阻止用户操作
                    uni.showToast({
                        title: "正在扫描设备...",
                        icon: "loading",
                        duration: 3000
                    });

                    // 定义设备发现回调函数
                    const onDeviceFound = (device) => {
                        console.log('实时发现设备:', device);
                        // 可以在这里更新UI，显示新发现的设备
                        const newDevices = [...this.devices, device];
                        this.devices = newDevices;
                    };

                    // 开始扫描设备，但不等待其完成
                    this.blufi.scanDevices(3000, onDeviceFound)

                    // 不需要等待扫描完成，直接返回
                    // 设备会通过onDeviceFound回调实时显示
                } catch (error) {
                    console.error("扫描设备失败:", error);
                    uni.showToast({
                        title: "扫描设备失败: " + error.message,
                        icon: "none",
                    });
                }
            },

            async connectDevice(e) {
                // console.log("connectDevice", e);
                const deviceId = e.currentTarget.dataset.id;
                try {
                    uni.showLoading({
                        title: "连接中..."
                    });
                    await this.blufi.connect_direct(deviceId);
                    this.connected = true;
                    uni.hideLoading();
                    uni.showToast({
                        title: "连接成功"
                    });
                } catch (error) {
                    uni.hideLoading();
                    uni.showToast({
                        title: "连接失败: " + error.message,
                        icon: "none",
                    });
                }
            },

            async disconnectDevice() {
                await this.blufi.disconnect();
                this.connected = false;
                uni.showToast({
                    title: "已断开连接"
                });
            },

            async scanWifi() {
                try {
                    uni.showLoading({
                        title: "扫描WiFi中..."
                    });
                    const wifiList = await this.blufi.scanWifi();
                    this.wifiList = wifiList;
                    uni.hideLoading();
                } catch (error) {
                    uni.hideLoading();
                    console.error("扫描WiFi失败:", error);
                    uni.showToast({
                        title: "扫描WiFi失败: " + error.message,
                        icon: "none",
                    });
                }
            },

            async configureWifi(e) {
                const {
                    ssid,
                    password
                } = e.detail.value;
                console.log("configureWifi", ssid, password);
                try {
                    uni.showLoading({
                        title: "配置WiFi中..."
                    });
                    await this.blufi.configureWifi({
                        ssid,
                        password,
                        mode: WIFI_MODE.STATION,
                    });
                    uni.hideLoading();
                    uni.showToast({
                        title: "WiFi配置发送成功"
                    });
                } catch (error) {
                    uni.hideLoading();
                    uni.showToast({
                        title: "WiFi配置发送失败: " + error.message,
                        icon: "none",
                    });
                }
            },

            /**
             * 发送自定义数据
             */
            async sendCustomData(e) {
                const {
                    customData
                } = e.detail.value;
                if (!customData || customData.trim() === '') {
                    uni.showToast({
                        title: "请输入要发送的数据",
                        icon: "none"
                    });
                    return;
                }

                try {
                    uni.showLoading({
                        title: "发送数据中..."
                    });
                    // 使用 BluFi 实例中的字符串转换方法
                    const dataArray = this.blufi._stringToUint8Array(customData);

                    await this.blufi.sendCustomData(dataArray);
                    uni.hideLoading();
                    uni.showToast({
                        title: "数据发送成功"
                    });
                } catch (error) {
                    uni.hideLoading();
                    uni.showToast({
                        title: "数据发送失败: " + error.message,
                        icon: "none",
                    });
                }
            },
            showLog() {
                this.isShowLog = !this.isShowLog;
            },
            getTime(d) {
                return `${d.getHours().toString().padStart(2, 0)}:${d.getMinutes().toString().padStart(2, 0)}:${d.getSeconds().toString().padStart(2, 0)}`
            }
        }
    }
</script>

<style>
    .container {
        padding: 30rpx;
        box-sizing: border-box;
    }

    .header {
        text-align: center;
        margin-bottom: 40rpx;
    }

    .title {
        font-size: 40rpx;
        font-weight: bold;
        color: #333;
    }

    .section {
        margin-bottom: 40rpx;
        background-color: #fff;
        border-radius: 10rpx;
        padding: 20rpx;
        box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.1);
    }

    .section-title {
        font-size: 32rpx;
        font-weight: bold;
        margin-bottom: 20rpx;
        color: #333;
        border-bottom: 1rpx solid #eee;
        padding-bottom: 10rpx;
    }

    .button-group {
        display: flex;
        justify-content: space-between;
        margin-bottom: 20rpx;
    }

    .btn {
        background-color: #1aad19;
        color: #fff;
        font-size: 28rpx;
        margin: 10rpx 0;
    }

    .btn[disabled] {
        background-color: #ccc !important;
        color: #fff !important;
    }

    .submit-btn {
        width: 100%;
        margin-top: 20rpx;
    }

    .device-list,
    .wifi-list {
        margin-top: 20rpx;
    }

    .list-title {
        font-size: 28rpx;
        color: #666;
        margin-bottom: 10rpx;
    }

    .device-item,
    .wifi-item {
        background-color: #f8f8f8;
        padding: 20rpx;
        margin-bottom: 10rpx;
        border-radius: 8rpx;
        border-left: 6rpx solid #1aad19;
    }

    .device-name,
    .wifi-name {
        font-size: 30rpx;
        font-weight: bold;
        color: #333;
        margin-bottom: 6rpx;
    }

    .device-id,
    .device-rssi,
    .wifi-rssi,
    .wifi-security {
        font-size: 24rpx;
        color: #666;
        margin-top: 6rpx;
    }

    .form-group {
        margin-top: 30rpx;
    }

    .form-item {
        margin-bottom: 20rpx;
    }

    .label {
        display: block;
        font-size: 28rpx;
        color: #333;
        margin-bottom: 10rpx;
    }

    .input {
        flex: 1;
        width: 100%;
        height: 80rpx;
        border: 1rpx solid #ddd;
        border-radius: 8rpx;
        padding: 0 20rpx;
        box-sizing: border-box;
        font-size: 28rpx;
    }

    .status-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 80rpx;
        background-color: #f8f8f8;
        display: flex;
        align-items: center;
        justify-content: center;
        border-top: 1rpx solid #eee;
    }

    .status-text {
        font-size: 28rpx;
        color: #333;
    }

    .input-wrapper {
        position: relative;
        display: flex;
        width: 100%;
    }


    .select-icon {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: #666;
        font-size: 12px;
    }

    .password-toggle {
        color: #007AFF;
    }

    .wifi-item {
        cursor: pointer;
    }

    .wifi-item:hover {
        background-color: #f5f5f5;
    }

    .log {
        color: #555;
    }

    .warn {
        color: #e7bd00;
    }

    .log,
    .warn {
        white-space: normal;
        /* 确保空白处换行 */
        margin-bottom: 5rpx;
        /* 添加一点底部间距增强可读性 */
        line-height: 1.4;
        /* 增加行高改善可读性 */
    }

    .log-window {
        position: fixed;
        left: 0;
        top: 0;
        width: 96%;
        height: 100%;
        padding: 2%;
        z-index: 99;
        font-size: small;
        background-color: #ffffffdd;
        overflow-y: auto;
        /* 添加垂直滚动 */
        word-wrap: break-word;
        /* 确保长文字换行 */
        word-break: break-all;
        /* 在任意字符间断行 */
    }

    .log-button {
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 30px;
        height: 30px;
        text-align: center;
        line-height: 30px;
        border: 1px solid #1aad19;
        border-radius: 20px;
        z-index: 100;
        color: #1aad19;
        background-color: #fff;
        font-size: xx-small;
    }
</style>