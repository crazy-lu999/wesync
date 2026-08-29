// app.js
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请用 2.2.3 或以上基础库以使用云开发');
      return;
    }
    // 云开发初始化：填入你的云环境 envId（开发者工具左上角"云开发"按钮里可看到）
    wx.cloud.init({
      env: 'cloud1-d7gyqmu912767f384',
      traceUser: true,
    });
  },

  globalData: {
    openid: null,
    family: null, // { _id, name, inviteCode, members, memberNicks, ... }
  },
});
