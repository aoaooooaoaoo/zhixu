// 知序小程序 · 环境配置
//
// 部署时只需要改这个文件：
//   1) 在微信开发者工具里点「云开发」开通环境，拿到 环境 ID
//   2) 把 ID 填到 CLOUD_ENV，并把 USE_CLOUD 改成 true
//   3) 云函数目录右键「上传并部署：云端安装依赖」
//
// 不填也能跑：会自动退回「本地规则提炼 + 本地存储」的演示模式。

module.exports = {
  // 云开发环境 ID，例如 'zhixu-8gxxxxxx'；留空 = 纯本地演示
  CLOUD_ENV: '',

  // 是否启用云开发（云函数 AI 提炼 / 云数据库同步）
  USE_CLOUD: false,

  // 卡片数据是否同步到云数据库（二期预留：v1 只做本地存储，这个开关暂不生效）
  CLOUD_SYNC: false,

  // 云数据库集合名
  COLLECTION_CARDS: 'cards',
  COLLECTION_INBOX: 'inbox',

  // 本地存储 key（与网页版保持一致，方便导入导出互通）
  STORAGE_KEY: 'zhixu.mvp.v1',

  // 版本号，写进导出文件与本地数据
  DATA_VERSION: 1
};
