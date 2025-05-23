// 在页面中引入BluFi模块
const {BluFi, WIFI_MODE } = require("./blufi.js");
Page({
  data: {
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
  },

  // 添加以下方法
  selectWifi(e) {
    const ssid = e.currentTarget.dataset.ssid;
    this.setData({
      selectedSsid: ssid,
    });
  },

  showWifiList() {
    // 如果已经有 WiFi 列表，直接显示
    if (this.data.wifiList.length > 0) {
      // 可以添加一个动画或者滚动到 WiFi 列表区域
      wx.pageScrollTo({
        selector: ".wifi-list",
        duration: 300,
      });
    } else {
      // 如果没有 WiFi 列表，触发扫描
      this.scanWifi();
    }
  },

  togglePasswordVisibility() {
    this.setData({
      showPassword: !this.data.showPassword,
    });
  },
  // 切换校验状态
  toggleChecksum() {
    this.setData({
      enableChecksum: !this.data.enableChecksum
    });
  },
  changePrefix(e){    
    this.setData({
      prefix: e.detail.value
    });
  },
  // 初始化BluFi
  async initBluFi() {
    // 创建BluFi实例，传入校验选项
    this.blufi = new BluFi({ 
      devicePrefix: this.data.prefix,
      enableChecksum: this.data.enableChecksum,
      onCustomData: (data)=>{
        console.log('收到自定义数据:', data);
        // 在这里处理自定义数据
        // 例如：将Uint8Array转换为字符串
        const dataStr = BluFi.uint8ArrayToString(data);
        this.data.receivedCustomData.push({
          time: (new Date()).toLocaleString(),
          data: dataStr,
        })
        this.setData({receivedCustomData: this.data.receivedCustomData});
      },
    });
    console.log('init BluFi', this.data.prefix, this.data.enableChecksum);
    // 初始化蓝牙
    const initialized = await this.blufi.init();
    if (!initialized) {
      wx.showToast({
        title: "蓝牙初始化失败",
        icon: "none",
      });
    } else {
      wx.showToast({
        title: "BluFi初始化成功",
        icon: "success",
      });
    }
    
    // 更新蓝牙初始化状态和BluFi初始化状态
    this.setData({
      bluetoothReady: initialized,
      blufiInitialized: initialized
    });
  },

  async onLoad() {
    // 页面加载时不再自动初始化BluFi
    // 只显示校验选项，等待用户手动初始化
  },

  async scanDevices() {
    try {
      // 清空设备列表
      this.setData({ devices: [] });
      
      // 显示扫描状态提示，但不阻止用户操作
      wx.showToast({
        title: "正在扫描设备...",
        icon: "loading",
        duration: 3000
      });
      
      // 定义设备发现回调函数
      const onDeviceFound = (device) => {
        console.log('实时发现设备:', device);
        // 可以在这里更新UI，显示新发现的设备
        const newDevices = [...this.data.devices, device];
        this.setData({ devices: newDevices });
      };
      
      // 开始扫描设备，但不等待其完成
      this.blufi.scanDevices(3000, onDeviceFound)
      
      // 不需要等待扫描完成，直接返回
      // 设备会通过onDeviceFound回调实时显示
    } catch (error) {
      console.error("扫描设备失败:", error);
      wx.showToast({
        title: "扫描设备失败: " + error.message,
        icon: "none",
      });
    }
  },

  async connectDevice(e) {
    const deviceId = e.currentTarget.dataset.id;
    try {
      wx.showLoading({ title: "连接中..." });
      await this.blufi.connect(deviceId);
      this.setData({ connected: true });
      wx.hideLoading();
      wx.showToast({ title: "连接成功" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: "连接失败: " + error.message,
        icon: "none",
      });
    }
  },

  async disconnectDevice() {
    await this.blufi.disconnect();
    this.setData({ connected: false });
    wx.showToast({ title: "已断开连接" });
  },

  async scanWifi() {
    try {
      wx.showLoading({ title: "扫描WiFi中..." });
      const wifiList = await this.blufi.scanWifi();
      this.setData({ wifiList });
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      console.error("扫描WiFi失败:", error);
      wx.showToast({
        title: "扫描WiFi失败: " + error.message,
        icon: "none",
      });
    }
  },

  async configureWifi(e) {
    const { ssid, password } = e.detail.value;
    try {
      wx.showLoading({ title: "配置WiFi中..." });
      await this.blufi.configureWifi({
        ssid,
        password,
        mode: WIFI_MODE.STATION,
      });
      wx.hideLoading();
      wx.showToast({ title: "WiFi配置成功" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: "WiFi配置失败: " + error.message,
        icon: "none",
      });
    }
  },
  
  /**
   * 发送自定义数据
   */
  async sendCustomData(e) {
    const { customData } = e.detail.value;
    if (!customData || customData.trim() === '') {
      wx.showToast({
        title: "请输入要发送的数据",
        icon: "none"
      });
      return;
    }
    
    try {
      wx.showLoading({ title: "发送数据中..." });
      // 使用 BluFi 实例中的字符串转换方法
      const dataArray = this.blufi._stringToUint8Array(customData);
      
      await this.blufi.sendCustomData(dataArray);
      wx.hideLoading();
      wx.showToast({ title: "数据发送成功" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: "数据发送失败: " + error.message,
        icon: "none",
      });
    }
  },

  onUnload() {
    // 页面卸载时断开连接
    if (this.blufi) {
      this.blufi.disconnect();
    }
  },
});
