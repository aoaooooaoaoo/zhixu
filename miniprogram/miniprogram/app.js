const config = require('./config');

App({
  globalData: {
    cloudReady: false,
    // 顶栏 AI 徽标状态：'local' 本地演示 | 'cloud' AI 已连接 | 'error'
    aiMode: 'local'
  },

  onLaunch() {
    if (config.USE_CLOUD && config.CLOUD_ENV && wx.cloud) {
      try {
        wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
        this.globalData.aiMode = 'cloud';
      } catch (err) {
        console.error('[知序] 云开发初始化失败', err);
        this.globalData.cloudReady = false;
        this.globalData.aiMode = 'error';
      }
    }
  }
});
