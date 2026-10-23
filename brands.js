/* 品牌注册表：多品牌选型时用于顶栏 logo、方案卡标注、型号归属。
 * logo 为简化“归属标”（文字标），仅用于标注数据来源，非官方商标图样。
 * 如需替换为官方授权素材，把对应文件换到 assets/ 下即可。
 */
(function (root) {
  'use strict';
  var BRANDS = {
    hikrobot: {
      key: 'hikrobot',
      name: '海康机器人 HIKROBOT',
      short: '海康',
      logo: 'assets/hikrobot-logo.png',
      color: '#e60012',
      global: 'HikrobotCatalog',
      // 官方字标字母占满画布高度（约87%），其余自制归属标主文字约占80%；
      // 渲染时按此系数缩小，使四者并排时字母实际高度一致
      logoScale: 0.8
    },
    huarui: {
      key: 'huarui',
      name: '华睿（大华机器视觉）',
      short: '华睿',
      logo: 'assets/huarui-logo.svg',
      color: '#d4232a',
      global: 'HuaruiCatalog'
    },
    basler: {
      key: 'basler',
      name: 'Basler',
      short: 'Basler',
      logo: 'assets/basler-logo.svg',
      color: '#00549f',
      global: 'BaslerCatalog'
    },
    daheng: {
      key: 'daheng',
      name: '大恒图像',
      short: '大恒',
      logo: 'assets/daheng-logo.svg',
      color: '#0075c2',
      global: 'DahengCatalog'
    }
  };

  // 已加载到全局、可用于合并的型号库（按脚本是否引入自动识别）
  function available() {
    return Object.keys(BRANDS).filter(function (k) {
      return !!root[BRANDS[k].global];
    });
  }

  root.BRANDS = BRANDS;
  root.BRAND_KEYS = Object.keys(BRANDS);
  root.availableBrands = available;
})(typeof self !== 'undefined' ? self : this);
