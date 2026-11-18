/*!
 * 退市型号库（Retired Catalog）
 * ------------------------------------------------------------------
 * 只被产品库 library.html 加载。选型助手 index.html / 自定义搭配 combo.html
 * 不引用本文件，所以退市型号天然不会进入自动推荐与搭配评定。
 *
 * 收录范围：2020 年后有官方停产/退市依据的工业面阵相机
 *   海康机器人  PCN-MV2022070801《CE / CA 系列退市通知》(2022-07-08)，含 M/C/N 全色型展开
 *   Basler      EOL / Discontinuation Letter（ace 系列，2021-2025）
 *   大恒图像    官网产品列表标注「停产」（水星一代 / 火星部分型号）
 *   华睿        无公开退市清单，仅维护在售系列 —— 见 BRANDS.huarui.note
 *
 * 字段口径与 *-catalog.js 一致（model/kind/w/h/pxUm/size/fps/shutter/iface/color/mount/series），
 * 另加：eol（退市年份，未知为 null）、eolDoc（依据文件）、replacedBy（官方给出的替代型号）、
 *       status（停产 / 退市）。
 * 缺失字段表示原厂未公开或本次未核实，产品库显示为「—」，不做推测填充。
 *
 * 与在售型录的去重（2026-11-18）：acA2000-165um / acA2000-165uc 原先同时存在于
 *   basler-catalog.js（官网已停产却仍在售型录里），已从 tools/_cache/basler_cams_add.json 删除并
 *   重新生成型录（Basler 233 → 231），现在这两个型号只在本文件里，会作为退市条目正常挂载。
 *   产品库归并时仍按 brand|型号(小写) 去重：万一将来在售型录又收进已停产的型号，不会出现重复行，
 *   而是在在售条目上挂 eolRef（isEol/eolData 渲染成琥珀色「官方已停产」并给替代型号）。
 */
(function (root) {
  'use strict';
  root.RetiredCatalog = {
    META: {"name":"退市型号库","updated":"2026-11-18","version":"1.0","count":150,"scope":"2020 年后官方公告停产 / 官网标注停产的工业面阵相机","policy":"仅供产品库检索与替代指引；选型助手与自定义搭配不加载本文件，退市型号不会进入自动推荐或搭配评定。"},
    BRANDS: {
      hikrobot: {
        name: '海康机器人 HIKROBOT',
        doc: 'PCN-MV2022070801《CE / CA 系列退市通知》（2022-07-08）',
        note: '第一代面阵 CE / CA 系列，由第二代 CS（进阶款）/ CU（普惠款）接替；2022-08 起分批停止接单，末次服务截至 2024-11。',
        CAMERAS: [
      {"model":"MV-CA003-20GM","kind":"area","w":640,"h":480,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GM","MV-CU004-10GM"],"sensor":"Onsemi"},
      {"model":"MV-CA003-20GC","kind":"area","w":640,"h":480,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GC","MV-CU004-10GC"],"sensor":"Onsemi"},
      {"model":"MV-CA003-50GM","kind":"area","w":640,"h":480,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GM","MV-CU004-10GM"]},
      {"model":"MV-CA003-50GC","kind":"area","w":640,"h":480,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GC","MV-CU004-10GC"]},
      {"model":"MV-CA004-10GM","kind":"area","w":720,"h":540,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-11GM"],"sensor":"Sony"},
      {"model":"MV-CA004-10GC","kind":"area","w":720,"h":540,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-11GC"],"sensor":"Sony"},
      {"model":"MV-CA005-20GM","kind":"area","w":800,"h":600,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GM","MV-CU004-10GM"],"sensor":"Onsemi"},
      {"model":"MV-CA005-20GC","kind":"area","w":800,"h":600,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GC","MV-CU004-10GC"],"sensor":"Onsemi"},
      {"model":"MV-CA013-20GM","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":[],"sensor":"Onsemi"},
      {"model":"MV-CA013-20GC","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":[],"sensor":"Onsemi"},
      {"model":"MV-CA013-20GN","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"近红外","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":[],"sensor":"Onsemi"},
      {"model":"MV-CA013-70GM","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2023,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS017-10GM"]},
      {"model":"MV-CA016-10GM","kind":"area","w":1440,"h":1080,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10GM","MV-CU016-10GM"],"sensor":"Sony"},
      {"model":"MV-CA016-10GC","kind":"area","w":1440,"h":1080,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10GC","MV-CU016-10GC"],"sensor":"Sony"},
      {"model":"MV-CA017-10GM","kind":"area","iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS017-10GM"],"sensor":"Sony"},
      {"model":"MV-CA017-10GC","kind":"area","iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS017-10GC"],"sensor":"Sony"},
      {"model":"MV-CA020-10GM","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10GM"],"sensor":"Sony"},
      {"model":"MV-CA020-10GC","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10GC"],"sensor":"Sony"},
      {"model":"MV-CA020-20GM","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10GM","MV-CS020-21GM"],"sensor":"Onsemi"},
      {"model":"MV-CA020-20GC","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10GC","MV-CS020-21GM"],"sensor":"Onsemi"},
      {"model":"MV-CA023-10GM","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS023-10GM"],"sensor":"Sony"},
      {"model":"MV-CA023-10GC","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS023-10GC"],"sensor":"Sony"},
      {"model":"MV-CA032-10GM","kind":"area","w":2048,"h":1536,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS032-10GM"],"sensor":"Sony"},
      {"model":"MV-CA032-10GC","kind":"area","w":2048,"h":1536,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS032-10GC"],"sensor":"Sony"},
      {"model":"MV-CA050-10GM","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10GM"],"sensor":"Sony"},
      {"model":"MV-CA050-12GC","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10GC"]},
      {"model":"MV-CA050-20GM","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10GM","MV-CS050-20GM"],"sensor":"Onsemi"},
      {"model":"MV-CA050-20GC","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10GC","MV-CS050-20GC"],"sensor":"Onsemi"},
      {"model":"MV-CA050-20GN","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"近红外","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10GN","MV-CS050-20GN"],"sensor":"Onsemi"},
      {"model":"MV-CA060-11GM","kind":"area","w":3072,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10GM","MV-CU060-10GM"]},
      {"model":"MV-CA060-10GC","kind":"area","w":3072,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10GC","MV-CU060-10GC"],"sensor":"Sony"},
      {"model":"MV-CE003-20GM","kind":"area","w":640,"h":480,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GM","MV-CU004-10GM"],"sensor":"Onsemi"},
      {"model":"MV-CE003-20GC","kind":"area","w":640,"h":480,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10GC","MV-CU004-10GC"],"sensor":"Onsemi"},
      {"model":"MV-CE013-50GM","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10GM","MV-CU016-10GM"]},
      {"model":"MV-CE013-50GC","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10GC","MV-CU016-10GC"]},
      {"model":"MV-CE013-80GM","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU013-80GM"],"sensor":"SS"},
      {"model":"MV-CE013-80GC","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU013-80GC"],"sensor":"SS"},
      {"model":"MV-CE020-10GC","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU020-19GC"],"sensor":"Sony"},
      {"model":"MV-CE050-31GM","kind":"area","w":2592,"h":1944,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10GM","MV-CU050-60GM","MV-CU060-10GM"]},
      {"model":"MV-CE050-31GC","kind":"area","w":2592,"h":1944,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10GC","MV-CU050-60GM","MV-CU060-10GC"]},
      {"model":"MV-CE100-30GM","kind":"area","iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10GM"],"sensor":"Aptina"},
      {"model":"MV-CE100-30GC","kind":"area","iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10GC"],"sensor":"Aptina"},
      {"model":"MV-CE120-10GM","kind":"area","w":4096,"h":3000,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10GM"],"sensor":"Sony"},
      {"model":"MV-CE120-10GC","kind":"area","w":4096,"h":3000,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10GC"],"sensor":"Sony"},
      {"model":"MV-CE200-10GM","kind":"area","w":5472,"h":3648,"iface":"GigE","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS200-10GM"],"sensor":"Sony"},
      {"model":"MV-CE200-10GC","kind":"area","w":5472,"h":3648,"iface":"GigE","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS200-10GC"],"sensor":"Sony"},
      {"model":"MV-CA003-21UM","kind":"area","w":640,"h":480,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10UM"]},
      {"model":"MV-CA003-21UC","kind":"area","w":640,"h":480,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10UC"]},
      {"model":"MV-CA004-10UM","kind":"area","w":720,"h":540,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10UM"],"sensor":"Sony"},
      {"model":"MV-CA004-10UC","kind":"area","w":720,"h":540,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS004-10UC"],"sensor":"Sony"},
      {"model":"MV-CA013-21UM","kind":"area","w":1280,"h":1024,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":[]},
      {"model":"MV-CA013-21UC","kind":"area","w":1280,"h":1024,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":[]},
      {"model":"MV-CA016-10UM","kind":"area","w":1440,"h":1080,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10UM"],"sensor":"Sony"},
      {"model":"MV-CA016-10UC","kind":"area","w":1440,"h":1080,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10UC"],"sensor":"Sony"},
      {"model":"MV-CA020-10UM","kind":"area","w":1920,"h":1200,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10UM"],"sensor":"Sony"},
      {"model":"MV-CA020-10UC","kind":"area","w":1920,"h":1200,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS020-10UC"],"sensor":"Sony"},
      {"model":"MV-CA023-10UM","kind":"area","w":1920,"h":1200,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS023-10UM"],"sensor":"Sony"},
      {"model":"MV-CA023-10UC","kind":"area","w":1920,"h":1200,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS023-10UC"],"sensor":"Sony"},
      {"model":"MV-CA050-12UM","kind":"area","w":2448,"h":2048,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10UM"]},
      {"model":"MV-CA050-12UC","kind":"area","w":2448,"h":2048,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10UC"]},
      {"model":"MV-CA050-20UM","kind":"area","w":2448,"h":2048,"iface":"USB3","color":"黑白","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10UM","MV-CU050-90UM"],"sensor":"Onsemi"},
      {"model":"MV-CA050-20UC","kind":"area","w":2448,"h":2048,"iface":"USB3","color":"彩色","mount":"C","series":"CA 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS050-10UC","MV-CU050-90UC"],"sensor":"Onsemi"},
      {"model":"MV-CE013-50UM","kind":"area","w":1280,"h":1024,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10UM"]},
      {"model":"MV-CE013-50UC","kind":"area","w":1280,"h":1024,"iface":"USB3","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS016-10UC"]},
      {"model":"MV-CE013-80UM","kind":"area","w":1280,"h":1024,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU013-80UM"],"sensor":"SS"},
      {"model":"MV-CE050-30UM","kind":"area","w":2592,"h":1944,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10UM"],"sensor":"Aptina"},
      {"model":"MV-CE050-30UC","kind":"area","w":2592,"h":1944,"iface":"USB3","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10UC"],"sensor":"Aptina"},
      {"model":"MV-CE060-10UM","kind":"area","w":3072,"h":2048,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10UM"],"sensor":"Sony"},
      {"model":"MV-CE060-10UC","kind":"area","w":3072,"h":2048,"iface":"USB3","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS060-10UC"],"sensor":"Sony"},
      {"model":"MV-CE120-10UM","kind":"area","w":4096,"h":3000,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10UM"],"sensor":"Sony"},
      {"model":"MV-CE120-10UC","kind":"area","w":4096,"h":3000,"iface":"USB3","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CU120-10UC"],"sensor":"Sony"},
      {"model":"MV-CE200-10UM","kind":"area","w":5472,"h":3648,"iface":"USB3","color":"黑白","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS200-10UM"],"sensor":"Sony"},
      {"model":"MV-CE200-10UC","kind":"area","w":5472,"h":3648,"iface":"USB3","color":"彩色","mount":"C","series":"CE 系列（第一代）","eol":2022,"eolDoc":"PCN-MV2022070801","replacedBy":["MV-CS200-10UC"],"sensor":"Sony"}
        ]
      },
      basler: {
        name: 'Basler',
        doc: 'Basler 停产通知（EOL / Discontinuation Letter）',
        note: 'ace 第一代 Classic 中的 CCD 机型（ICX424 / ICX445 / ICX274）及部分早期 CMOS 机型；官方给出的替代为 ace 后续型号或 ace 2。',
        CAMERAS: [
      {"model":"acA640-90gm","kind":"area","w":659,"h":494,"pxUm":7.4,"size":"1/3\"","fps":90,"shutter":"Global","iface":"GigE","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75gm"]},
      {"model":"acA640-90gc","kind":"area","w":659,"h":494,"pxUm":7.4,"size":"1/3\"","fps":90,"shutter":"Global","iface":"GigE","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75gc"]},
      {"model":"acA640-90um","kind":"area","w":659,"h":494,"pxUm":7.4,"size":"1/3\"","fps":90,"shutter":"Global","iface":"USB3","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75um"]},
      {"model":"acA640-90uc","kind":"area","w":659,"h":494,"pxUm":7.4,"size":"1/3\"","fps":90,"shutter":"Global","iface":"USB3","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75uc"]},
      {"model":"acA1300-30gm","kind":"area","w":1296,"h":966,"pxUm":3.75,"size":"1/3\"","fps":30,"shutter":"Global","iface":"GigE","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75gm"]},
      {"model":"acA1300-30gc","kind":"area","w":1296,"h":966,"pxUm":3.75,"size":"1/3\"","fps":30,"shutter":"Global","iface":"GigE","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75gc"]},
      {"model":"acA1300-30um","kind":"area","w":1296,"h":966,"pxUm":3.75,"size":"1/3\"","fps":30,"shutter":"Global","iface":"USB3","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75um"]},
      {"model":"acA1300-30uc","kind":"area","w":1296,"h":966,"pxUm":3.75,"size":"1/3\"","fps":30,"shutter":"Global","iface":"USB3","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1300-75uc"]},
      {"model":"acA1600-20gm","kind":"area","w":1626,"h":1236,"pxUm":4.4,"size":"1/1.8\"","fps":20,"shutter":"Global","iface":"GigE","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1920-40gm","acA2040-35gm"]},
      {"model":"acA1600-20gc","kind":"area","w":1626,"h":1236,"pxUm":4.4,"size":"1/1.8\"","fps":20,"shutter":"Global","iface":"GigE","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2025,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1920-40gc","acA2040-35gc"]},
      {"model":"acA1600-20um","kind":"area","w":1626,"h":1236,"pxUm":4.4,"size":"1/1.8\"","fps":20,"shutter":"Global","iface":"USB3","color":"黑白","mount":"C","series":"ace 系列（第一代 Classic）","eol":2022,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1920-40um","acA2040-55um"]},
      {"model":"acA1600-20uc","kind":"area","w":1626,"h":1236,"pxUm":4.4,"size":"1/1.8\"","fps":20,"shutter":"Global","iface":"USB3","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2025,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA1920-40uc","acA2040-55uc"]},
      {"model":"acA2000-165um","kind":"area","w":2048,"h":1088,"pxUm":5.5,"sw":11.264,"sh":5.984,"size":"2/3\"","fps":168,"shutter":"Global","iface":"USB3","color":"黑白","mount":"C","series":"ace Classic (USB3)","sensor":"ams CMV2000-2E5M1BP","dims":[29.3,29,29],"expMinUs":28,"expMaxUs":10000000,"poe":false,"powerW":2.9,"eol":2021,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA2040-90um"],"status":"停产"},
      {"model":"acA2000-165uc","kind":"area","w":2040,"h":1086,"pxUm":5.5,"sw":11.22,"sh":5.973,"size":"2/3\"","fps":168,"shutter":"Global","iface":"USB3","color":"彩色","mount":"C","series":"ace Classic (USB3)","sensor":"ams CMV2000-2E5C1BP","dims":[29.3,29,29],"expMinUs":28,"expMaxUs":10000000,"poe":false,"powerW":2.9,"eol":2021,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":["acA2040-90uc"],"status":"停产"},
      {"model":"acA4600-10uc","kind":"area","w":4608,"h":3288,"pxUm":1.4,"size":"1/2.3\"","fps":10,"shutter":"Rolling","iface":"USB3","color":"彩色","mount":"C","series":"ace 系列（第一代 Classic）","eol":2021,"eolDoc":"Basler 停产通知（EOL / Discontinuation Letter）","replacedBy":[]}
        ]
      },
      daheng: {
        name: '大恒图像',
        doc: '大恒图像官网产品列表（型号名后标注「停产」）',
        note: '水星一代 MER-G / MER-G-P / MER-U / MER-U3 及火星部分型号，官网已标注停产，替代为水星二代 MER2 / 三代 MER3。',
        CAMERAS: [
      {"model":"MARS-880-13GM-P","kind":"area","w":4096,"h":2160,"iface":"GigE","color":"黑白","mount":"C","series":"火星 MARS-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"1\"","sensor":"IMX267","shutter":"Global","fps":13.0,"replacedBy":[]},
      {"model":"MARS-1231-32U3C","kind":"area","w":4096,"h":3000,"iface":"USB3","color":"彩色","mount":"C","series":"火星 MARS-U3 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"1.1\"","sensor":"IMX253","shutter":"Global","fps":32.1,"replacedBy":[]},
      {"model":"MARS-1231-32U3M","kind":"area","w":4096,"h":3000,"iface":"USB3","color":"黑白","mount":"C","series":"火星 MARS-U3 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"1.1\"","sensor":"IMX253","shutter":"Global","fps":32.1,"replacedBy":[]},
      {"model":"MER-031-300GC-P","kind":"area","w":640,"h":480,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/4\"","sensor":"PYTHON300","shutter":"Global","fps":300.0,"replacedBy":[]},
      {"model":"MER-031-300GM-P","kind":"area","w":640,"h":480,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/4\"","sensor":"PYTHON300","shutter":"Global","fps":300.0,"replacedBy":[]},
      {"model":"MER-041-302GC-P","kind":"area","w":720,"h":540,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.9,"size":"1/2.9\"","sensor":"IMX287","shutter":"Global","fps":302.0,"replacedBy":[]},
      {"model":"MER-041-302GM-P","kind":"area","w":720,"h":540,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.9,"size":"1/2.9\"","sensor":"IMX287","shutter":"Global","fps":302.0,"replacedBy":[]},
      {"model":"MER-050-200GC-P","kind":"area","w":800,"h":600,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON500","shutter":"Global","fps":200.0,"replacedBy":[]},
      {"model":"MER-051-120GM-P","kind":"area","w":808,"h":608,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON480","shutter":"Global","fps":120.0,"replacedBy":[]},
      {"model":"MER-051-120GC-P","kind":"area","w":808,"h":608,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON480","shutter":"Global","fps":120.0,"replacedBy":[]},
      {"model":"MER-125-30GC-P","kind":"area","w":1292,"h":964,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"ICX445","shutter":"Global","fps":30.0,"replacedBy":[]},
      {"model":"MER-131-75GC-P","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/2\"","sensor":"PYTHON1300","shutter":"Global","fps":75.0,"replacedBy":[]},
      {"model":"MER-131-75GM-P","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/2\"","sensor":"PYTHON1300","shutter":"Global","fps":75.0,"replacedBy":[]},
      {"model":"MER-132-43GC-P","kind":"area","w":1292,"h":964,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"RJ33J","shutter":"Global","fps":43.0,"replacedBy":[]},
      {"model":"MER-133-54GC-P","kind":"area","w":1280,"h":960,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"AR0135","shutter":"Global","fps":54.0,"replacedBy":[]},
      {"model":"MER-133-54GM-P","kind":"area","w":1280,"h":960,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"AR0135","shutter":"Global","fps":54.0,"replacedBy":[]},
      {"model":"MER-201-25GC-P","kind":"area","w":1628,"h":1236,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.4,"size":"1/1.8\"","sensor":"RJ31N","shutter":"Global","fps":25.08,"replacedBy":[]},
      {"model":"MER-132-43GM-P","kind":"area","w":1292,"h":964,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"RJ33J","shutter":"Global","fps":43.0,"replacedBy":[]},
      {"model":"MER-203-30GC-P-L-F03","kind":"area","w":1920,"h":1080,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.9,"size":"1/2.8\"","sensor":"Rolling shutter CMOS","shutter":"Rolling","fps":30.0,"replacedBy":[]},
      {"model":"MER-203-30GC-P-L","kind":"area","w":1920,"h":1080,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.9,"size":"1/2.8\"","sensor":"Rolling shutter CMOS","shutter":"Rolling","fps":30.0,"replacedBy":[]},
      {"model":"MER-231-41GC-P","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.86,"size":"1/1.2\"","sensor":"IMX249","shutter":"Global","fps":41.0,"replacedBy":[]},
      {"model":"MER-204-30GC-P-L-F02","kind":"area","w":1920,"h":1080,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.9,"size":"1/2.8\"","sensor":"Rolling shutter CMOS","shutter":"Rolling","fps":30.0,"replacedBy":[]},
      {"model":"MER-231-41GM-P","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.86,"size":"1/1.2\"","sensor":"IMX249","shutter":"Global","fps":41.0,"replacedBy":[]},
      {"model":"MER-500-14GC-P","kind":"area","w":2592,"h":1944,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.2,"size":"1/2.5\"","sensor":"MT9P006","shutter":"Rolling","fps":14.0,"replacedBy":[]},
      {"model":"MER-503-20GC-P","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"2/3\"","sensor":"IMX264","shutter":"Global","fps":20.0,"replacedBy":[]},
      {"model":"MER-503-20GM-P","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"2/3\"","sensor":"IMX264","shutter":"Global","fps":20.0,"replacedBy":[]},
      {"model":"MER-504-10GC-P","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"2/3\"","sensor":"RJ32S","shutter":"Global","fps":10.0,"replacedBy":[]},
      {"model":"MER-531-20GM-P","kind":"area","w":2592,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G-P 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1\"","sensor":"PYTHON5000","shutter":"Global","fps":20.0,"replacedBy":[]},
      {"model":"MER-031-300GC","kind":"area","w":640,"h":480,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/4\"","sensor":"PYTHON300","shutter":"Global","fps":300.0,"replacedBy":[]},
      {"model":"MER-041-302GC","kind":"area","w":720,"h":540,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.9,"size":"1/2.9\"","sensor":"IMX287","shutter":"Global","fps":302.0,"replacedBy":[]},
      {"model":"MER-041-302GM","kind":"area","w":720,"h":540,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.9,"size":"1/2.9\"","sensor":"IMX287","shutter":"Global","fps":302.0,"replacedBy":[]},
      {"model":"MER-050-200GC","kind":"area","w":800,"h":600,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON500","shutter":"Global","fps":200.0,"replacedBy":[]},
      {"model":"MER-051-120GC","kind":"area","w":808,"h":608,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON480","shutter":"Global","fps":120.0,"replacedBy":[]},
      {"model":"MER-051-120GM","kind":"area","w":808,"h":608,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON480","shutter":"Global","fps":120.0,"replacedBy":[]},
      {"model":"MER-125-30GC","kind":"area","w":1292,"h":964,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"ICX445","shutter":"Global","fps":30.0,"replacedBy":[]},
      {"model":"MER-131-75GC","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/2\"","sensor":"PYTHON1300","shutter":"Global","fps":75.0,"replacedBy":[]},
      {"model":"MER-131-75GM","kind":"area","w":1280,"h":1024,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/2\"","sensor":"PYTHON1300","shutter":"Global","fps":75.0,"replacedBy":[]},
      {"model":"MER-132-43GC","kind":"area","w":1292,"h":964,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"RJ33J","shutter":"Global","fps":43.0,"replacedBy":[]},
      {"model":"MER-132-43GM","kind":"area","w":1292,"h":964,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"RJ33J","shutter":"Global","fps":43.0,"replacedBy":[]},
      {"model":"MER-133-54GC","kind":"area","w":1280,"h":960,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"AR0135","shutter":"Global","fps":54.0,"replacedBy":[]},
      {"model":"MER-231-41GC","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.86,"size":"1/1.2\"","sensor":"IMX249","shutter":"Global","fps":41.0,"replacedBy":[]},
      {"model":"MER-231-41GM","kind":"area","w":1920,"h":1200,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.86,"size":"1/1.2\"","sensor":"IMX249","shutter":"Global","fps":41.0,"replacedBy":[]},
      {"model":"MER-500-14GC","kind":"area","w":2592,"h":1944,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.2,"size":"1/2.5\"","sensor":"MT9P006","shutter":"Rolling","fps":14.0,"replacedBy":[]},
      {"model":"MER-503-20GC","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"2/3\"","sensor":"Global shutter CMOS","shutter":"Global","fps":20.0,"replacedBy":[]},
      {"model":"MER-630-16GC","kind":"area","w":3088,"h":2064,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.4,"size":"1/1.8\"","sensor":"IMX178","shutter":"Rolling","fps":16.8,"replacedBy":[]},
      {"model":"MER-503-20GM","kind":"area","w":2448,"h":2048,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.45,"size":"2/3\"","sensor":"Global shutter CMOS","shutter":"Global","fps":20.0,"replacedBy":[]},
      {"model":"MER-630-16GM","kind":"area","w":3088,"h":2064,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.4,"size":"1/1.8\"","sensor":"IMX178","shutter":"Rolling","fps":16.8,"replacedBy":[]},
      {"model":"MER-1070-10GC","kind":"area","w":3840,"h":2748,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":1.67,"size":"1/2.3\"","sensor":"MT9J003","shutter":"Rolling","fps":10.0,"replacedBy":[]},
      {"model":"MER-1220-9GC","kind":"area","w":4024,"h":3036,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":1.85,"size":"1/1.7\"","sensor":"IMX226","shutter":"Rolling","fps":9.0,"replacedBy":[]},
      {"model":"MER-1220-9GM","kind":"area","w":4024,"h":3036,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":1.85,"size":"1/1.7\"","sensor":"IMX226","shutter":"Rolling","fps":9.0,"replacedBy":[]},
      {"model":"MER-1520-7GC","kind":"area","w":4608,"h":3288,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":1.4,"size":"1/2.3\"","sensor":"MT9F002","shutter":"Rolling","fps":7.0,"replacedBy":[]},
      {"model":"MER-2000-5GC","kind":"area","w":5496,"h":3672,"iface":"GigE","color":"彩色","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.4,"size":"1\"","sensor":"IMX183","shutter":"Rolling","fps":5.0,"replacedBy":[]},
      {"model":"MER-2000-5GM","kind":"area","w":5496,"h":3672,"iface":"GigE","color":"黑白","mount":"C","series":"水星一代 MER-G 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.4,"size":"1\"","sensor":"IMX183","shutter":"Rolling","fps":5.0,"replacedBy":[]},
      {"model":"MER-130-30UM","kind":"area","w":1280,"h":1024,"iface":"USB2","color":"黑白","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.2,"size":"1/1.8\"","sensor":"MT9M001","shutter":"Rolling","fps":30.0,"replacedBy":[]},
      {"model":"MER-040-60UC","kind":"area","w":752,"h":480,"iface":"USB2","color":"彩色","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.0,"size":"1/3\"","sensor":"MT9V032","shutter":"Global","fps":60.0,"replacedBy":[]},
      {"model":"MER-040-60UM","kind":"area","w":752,"h":480,"iface":"USB2","color":"黑白","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":6.0,"size":"1/3\"","sensor":"MT9V032","shutter":"Global","fps":60.0,"replacedBy":[]},
      {"model":"MER-310-12UC","kind":"area","w":2048,"h":1536,"iface":"USB2","color":"彩色","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.2,"size":"1/2\"","sensor":"MT9T001","shutter":"Rolling","fps":12.0,"replacedBy":[]},
      {"model":"MER-500-7UC","kind":"area","w":2592,"h":1944,"iface":"USB2","color":"彩色","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":2.2,"size":"1/2.5\"","sensor":"MT9P006","shutter":"Rolling","fps":7.0,"replacedBy":[]},
      {"model":"MER-125-30UC","kind":"area","w":1292,"h":964,"iface":"USB2","color":"彩色","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":3.75,"size":"1/3\"","sensor":"ICX445","shutter":"Global","fps":30.0,"replacedBy":[]},
      {"model":"MER-030-120UC","kind":"area","w":656,"h":492,"iface":"USB2","color":"彩色","mount":"C","series":"水星一代 MER-U 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":5.6,"size":"1/4\"","sensor":"ICX618","shutter":"Global","fps":120.0,"replacedBy":[]},
      {"model":"MER-050-560U3C-L","kind":"area","w":800,"h":600,"iface":"USB3","color":"彩色","mount":"C","series":"水星一代 MER-U3-L 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON500","shutter":"Global","fps":560.0,"replacedBy":[]},
      {"model":"MER-050-560U3C","kind":"area","w":800,"h":600,"iface":"USB3","color":"彩色","mount":"C","series":"水星一代 MER-U3 系列","eol":null,"status":"停产","eolDoc":"大恒图像官网产品列表（标注「停产」）","pxUm":4.8,"size":"1/3.6\"","sensor":"PYTHON500","shutter":"Global","fps":560.0,"replacedBy":[]}
        ]
      },
      huarui: {
        name: '华睿 iRAYPLE',
        doc: '',
        note: '华睿未公开发布退市 / 停产清单，官网只维护在售系列，第三方渠道也无可靠停产名录。为避免编造，本站不收录无据可查的华睿退市型号。',
        CAMERAS: []
      }
    }
  };
})(typeof self !== 'undefined' ? self : this);
