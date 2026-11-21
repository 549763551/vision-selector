/* 品牌注册表：多品牌选型时用于顶栏 logo、方案卡标注、型号归属。
 *
 * logo 一律用厂商官方图样（商标归各厂商所有，此处仅用于标注数据来源）：
 *   hikrobot  assets/hikrobot-logo.png   官方字标（原始位图）
 *   huarui    assets/huarui-logo.png     官网前端包内嵌锁定稿，反白版按官方单色稿惯例还原成浅底版
 *   basler    assets/basler-logo.svg     官网头部矢量字标，去掉 the power of sight 标语行
 *   daheng    assets/daheng-logo.png     官网浅底版（DAHENG IMAGING | 大恒图像）
 *   opt       assets/opt-logo.png        官网锁定稿，同上还原成单色深蓝版
 *   cst       assets/cst-logo.png        官网浅底版（CST + Machine Vision）
 * 位图统一裁到墨迹边界、墨迹高 96px（约 5 倍于 18px 显示高度），所以 CSS 里的 height
 * 就等于可见字高。logoScale 只用来把视觉重量拉平：单行字标 1.0，双行锁定稿略放大，
 * 海康那张 PNG 自带 13% 留白所以 >1。
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
      // 官方 PNG 自带约 13% 透明留白，字号高度只占画布 87%，故按 1.15 放大对齐其它字标
      logoScale: 1.05
    },
    huarui: {
      key: 'huarui',
      name: '华睿（大华机器视觉）',
      short: '华睿',
      logo: 'assets/huarui-logo.png',
      color: '#ed6d00',
      logoScale: 1.25,
      global: 'HuaruiCatalog'
    },
    basler: {
      key: 'basler',
      name: 'Basler',
      short: 'Basler',
      logo: 'assets/basler-logo.svg',
      color: '#00457c',
      logoScale: 1.0,
      global: 'BaslerCatalog'
    },
    daheng: {
      key: 'daheng',
      name: '大恒图像',
      short: '大恒',
      logo: 'assets/daheng-logo.png',
      color: '#152e77',
      logoScale: 1.2,
      global: 'DahengCatalog'
    },
    opt: {
      key: 'opt',
      name: '奥普特 OPT',
      short: '奥普特',
      logo: 'assets/opt-logo.png',
      color: '#0b2a5b',
      logoScale: 1.6,
      global: 'OptCatalog'
    },
    cst: {
      // 六品牌统一加载。康视达面阵相机官网未给卡口，会被 selection-catalog.js 的
      // 必要参数硬门槛自动挡在选型链外；线阵相机 / 镜头 / 远心 / 光源参数齐全，照常参与。
      key: 'cst',
      name: '康视达 CST',
      short: '康视达',
      logo: 'assets/cst-logo.png',
      color: '#0098e0',
      logoScale: 1.2,
      global: 'CstCatalog'
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
