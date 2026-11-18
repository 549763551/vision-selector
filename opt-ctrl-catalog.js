/**
 * 奥普特（OPT）光源控制器与视觉控制器/工控机
 * 来源：奥普特官网 光源控制器 14 个系列 + 视觉控制器/工控机 3 个系列
 * 生成脚本：tools/build-opt-full.py（上游 fetch-opt-ajax.js / parse-opt-all.py）
 * 控制器 43 台；工控机 21 台。本文件由脚本生成，请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptCtrlCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source":"奥普特官网产品页（optmv.com 光源控制器 / 工控机系列）","brand":"奥普特 OPT","generated":"2026-11-18","controllers":43,"ipc":21};
  var CONTROLLERS = [
    {"model":"OPT-DPA2024E-16","channels":16,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2024E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":2.0,"power":48.0,"conn":"两芯","dims":"140×132.4×172.1"},
    {"model":"OPT-DPA2024E-8","channels":8,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2024E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":2.0,"power":48.0,"conn":"两芯","dims":"108×132.4×172.1"},
    {"model":"OPT-DPA2024E-4","channels":4,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2024E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":2.0,"power":48.0,"conn":"两芯","dims":"91×132×171"},
    {"model":"OPT-DPA2024EB-4","channels":4,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2024E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":2.0,"power":48.0,"conn":"两芯","dims":"91×128.21×170"},
    {"model":"OPT-DPA2012E-4","channels":4,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2012E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"12","ampPerCh":2.0,"power":48.0,"conn":"三芯","dims":"91×132×171"},
    {"model":"OPT-DPA2012EB-4","channels":4,"mode":"恒流 · RS232/以太网","series":"电流型数字控制器 DPA2012E","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"12","ampPerCh":2.0,"power":48.0,"conn":"三芯","dims":"65×126.2×170"},
    {"model":"OPT-DPA2005E-8","channels":8,"mode":"恒流 · RS232/以太网","series":"点光源电流型数字控制器 DPA2005EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":2.0,"power":50.0,"conn":"三芯","dims":"108×132.4×172.1"},
    {"model":"OPT-DPA2005E-4","channels":4,"mode":"恒流 · RS232/以太网","series":"点光源电流型数字控制器 DPA2005EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":2.0,"power":30.0,"conn":"三芯","dims":"91×132×171"},
    {"model":"OPT-DPA2005EB-4","channels":4,"mode":"恒流 · RS232/以太网","series":"点光源电流型数字控制器 DPA2005EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":2.0,"power":30.0,"conn":"三芯","dims":"65×126.2×170"},
    {"model":"OPT-DPA6024EB-16","channels":16,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":1450.0,"conn":"六芯","dims":"189×381.3×309.5"},
    {"model":"OPT-DPA6024EB-8","channels":8,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":700.0,"conn":"六芯","dims":"184×346.1×156"},
    {"model":"OPT-DPA6024EB-4","channels":4,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"158×146.1×136"},
    {"model":"OPT-DPA6024EB-2-V3","channels":2,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~120/VAC 200~240V","vout":"24","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"147×347.1×144.5"},
    {"model":"OPT-DPA6024EB-2-V1","channels":2,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"91×132.5×170"},
    {"model":"OPT-DPA6024EC-2","channels":2,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":false,"vin":"DC 22-26V","vout":"常亮：5-27V高亮：5-48V","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"91×132×170"},
    {"model":"OPT-DPA6024E-2","channels":2,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA6024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"常亮：5-27V高亮：5-48V","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"91×132×170"},
    {"model":"OPT-DPA10024EB-2","channels":2,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA10024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":10.0,"power":240.0,"conn":"六芯","dims":"149×353.3×145.5"},
    {"model":"OPT-DPA10024EB-1","channels":1,"mode":"恒流 · RS232/以太网","series":"大功率电流型数字控制器 DPA10024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":10.0,"power":240.0,"conn":"六芯","dims":"91×132.5×170"},
    {"model":"OPT-DPA20024EB-4","channels":4,"mode":"恒流 · RS232/以太网","series":"超大功率电流型数字控制器 DPA20024EB","group":"数字型光源控制器","strobe":true,"vin":"AC 100~120V / AC 200~240V","vout":"24","ampPerCh":20.0,"power":1100.0,"conn":"六芯","dims":"208×378.27×143"},
    {"model":"OPT-DPA20024EB-2","channels":2,"mode":"恒流 · RS232/以太网","series":"超大功率电流型数字控制器 DPA20024EB","group":"数字型光源控制器","strobe":true,"vin":"AC 100~120V / AC 200~240V","vout":"24","ampPerCh":20.0,"power":480.0,"conn":"六芯","dims":"182×353.17×157"},
    {"model":"OPT-DPA20024EB-1","channels":1,"mode":"恒流 · RS232/以太网","series":"超大功率电流型数字控制器 DPA20024EB","group":"数字型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"24","ampPerCh":20.0,"power":480.0,"conn":"六芯","dims":"147×353.3×144.5"},
    {"model":"OPT-EMA2005EC-4","channels":4,"mode":"恒流","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"5","ampPerCh":2.0,"power":10.0,"conn":"三芯","dims":"28.24×103×145"},
    {"model":"OPT-EMA2012EC-4","channels":4,"mode":"恒流","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"12","ampPerCh":3.0,"power":24.0,"conn":"三芯","dims":"28.24×103×145"},
    {"model":"OPT-EMA2024EC-4","channels":4,"mode":"恒流","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"24","ampPerCh":3.0,"power":48.0,"conn":"两芯","dims":"28.24×103×145"},
    {"model":"OPT-DPA2005EC-4","channels":4,"mode":"恒流 · RS232/以太网","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"5","ampPerCh":2.0,"power":20.0,"conn":"三芯","dims":"41.5×103.7×145"},
    {"model":"OPT-DPA2012EC-4","channels":4,"mode":"恒流 · RS232/以太网","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"12","ampPerCh":3.0,"power":48.0,"conn":"三芯","dims":"41.5×103.7×145"},
    {"model":"OPT-DPA2024EC-4","channels":4,"mode":"恒流 · RS232/以太网","series":"迷你电流型数字控制器 DPA2024EC","group":"数字型光源控制器","strobe":true,"vin":"DC22-25V","vout":"24","ampPerCh":3.0,"power":100.0,"conn":"两芯","dims":"41.5×103.7×145"},
    {"model":"OPT-AP1024F-4","channels":4,"mode":"恒压","series":"电压型模拟控制器 AP1024F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"14.0~24.0V可调","ampPerCh":1.0,"power":40.0,"conn":"两芯","dims":"73.5×129.2×166"},
    {"model":"OPT-AP1024F-3","channels":3,"mode":"恒压","series":"电压型模拟控制器 AP1024F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"14.0~24.0V可调","ampPerCh":1.0,"power":40.0,"conn":"两芯","dims":"73.5×129.2×166"},
    {"model":"OPT-AP1024F-2","channels":2,"mode":"恒压","series":"电压型模拟控制器 AP1024F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"14.0~24.0V可调","ampPerCh":1.0,"power":30.0,"conn":"两芯","dims":"73.5×129.2×166"},
    {"model":"OPT-AP1024F-1","channels":1,"mode":"恒压","series":"电压型模拟控制器 AP1024F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"14.0~24.0V可调","ampPerCh":1.0,"power":null,"conn":"两芯","dims":"73.5×129.2×166"},
    {"model":"OPT-APA6024-2","channels":2,"mode":"恒流","series":"大功率电流型模拟控制器 APA6024","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~120V /AC 200~240V","vout":"24","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"136×305.8×104.5"},
    {"model":"OPT-APA0805F-4","channels":4,"mode":"恒流","series":"点光源电流型模拟控制器 APA0805F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":0.8,"power":4.0,"conn":"三芯","dims":"73.5×129.2×166"},
    {"model":"OPT-APA0805F-3","channels":3,"mode":"恒流","series":"点光源电流型模拟控制器 APA0805F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":0.8,"power":4.0,"conn":"三芯","dims":"73.5×129.2×166"},
    {"model":"OPT-APA0805F-2","channels":2,"mode":"恒流","series":"点光源电流型模拟控制器 APA0805F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":0.8,"power":4.0,"conn":"三芯","dims":"73.5×129.2×166"},
    {"model":"OPT-APA0805F-1","channels":1,"mode":"恒流","series":"点光源电流型模拟控制器 APA0805F","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"5","ampPerCh":0.8,"power":4.0,"conn":"三芯","dims":"73.5×129.2×166"},
    {"model":"OPT-APM0524B-2","channels":2,"mode":"恒压","series":"迷你电压型模拟控制器 APM0524B","group":"模拟型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"14.0~24.0V可调","ampPerCh":0.5,"power":12.0,"conn":"两芯","dims":"24×62×108.3"},
    {"model":"OPT-DPH20048E-4-03","channels":4,"mode":"恒压 · RS232/以太网","series":"频闪增亮型数字控制器 DPH20048E","group":"增亮型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"48","ampPerCh":20.0,"power":960.0,"conn":"两芯","dims":"91×133×171"},
    {"model":"OPT-DPH20048E-4","channels":4,"mode":"恒压 · RS232/以太网","series":"频闪增亮型数字控制器 DPH20048E","group":"增亮型光源控制器","strobe":false,"vin":"AC 100~240V","vout":"48","ampPerCh":20.0,"power":960.0,"conn":"两芯","dims":"91×133×171"},
    {"model":"OPT-DPA6024ES-8","channels":8,"mode":"恒流 · RS232/以太网","series":"线扫电流型数字控制器 DPA6024ES","group":"线扫型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":700.0,"conn":"六芯","dims":"234×357.5×176"},
    {"model":"OPT-DPA6024ES-4","channels":4,"mode":"恒流 · RS232/以太网","series":"线扫电流型数字控制器 DPA6024ES","group":"线扫型光源控制器","strobe":true,"vin":"AC 100~240V","vout":"24","ampPerCh":6.0,"power":144.0,"conn":"六芯","dims":"234×357.5×176"},
    {"model":"OPT-DPA20024ES-8","channels":8,"mode":"恒流 · RS232/以太网","series":"线扫电流型数字控制器 DPA20024ES","group":"线扫型光源控制器","strobe":true,"vin":"AC 100~120V / AC 200~240V","vout":"24","ampPerCh":20.0,"power":1150.0,"conn":"六芯","dims":"252×352.5×175"},
    {"model":"OPT-DPA20024ES-4","channels":4,"mode":"恒流 · RS232/以太网","series":"线扫电流型数字控制器 DPA20024ES","group":"线扫型光源控制器","strobe":true,"vin":"AC 100~120V / AC 200~240V","vout":"24","ampPerCh":20.0,"power":1150.0,"conn":"六芯","dims":"252×352×143"}
  ];
  var IPC = [
    {"model":"OPT-IPC-U41-1L96682","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i9-13900K","board":"Q670","mem":"64GB DDR4","ssd":"1TB","hdd":"8TB","psu":"850W","slots":"2*PCIex16；4*PCIex4；1*PCI","io":"6*USB3.0；2*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0F74422","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-8700","board":"Q270/Q370","mem":"16G DDR4","ssd":"256GB","hdd":"2TB","psu":"300W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB 3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0E75422","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-11700K","board":"Q470/W480","mem":"32G DDR4","ssd":"256GB","hdd":"2TB","psu":"750W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-1L76442","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-12700K","board":"Q670","mem":"64GB DDR4","ssd":"256GB","hdd":"4TB","psu":"850W","slots":"2*PCIex16；4*PCIex4；1*PCI","io":"6*USB3.0；2*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0E95542","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i9-11900K","board":"Q470/W480","mem":"32G DDR4","ssd":"512GB","hdd":"4TB","psu":"750W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0E75442","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-11700K","board":"Q470/W480","mem":"32G DDR4","ssd":"256GB","hdd":"4TB","psu":"850W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0E74542","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-11700K","board":"Q470/W480","mem":"16G DDR4","ssd":"512GB","hdd":"4TB","psu":"550W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-1L75442","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-12700K","board":"Q670","mem":"32G DDR4","ssd":"256GB","hdd":"4TB","psu":"550W","slots":"2*PCIex16；4*PCIex4；1*PCI","io":"6*USB3.0；2*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-0E54422","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i5-11500","board":"Q470/W480","mem":"16G DDR4","ssd":"256GB","hdd":"2TB","psu":"750W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-U41-1L75642","series":"4U上架式工控机","form":"4U上架式工控机","brand":"奥普特","cpu":"i7-12700K","board":"Q670","mem":"32G DDR4","ssd":"1TB","hdd":"4TB","psu":"850W","slots":"2*PCIex16；4*PCIex4；1*PCI","io":"6*USB3.0；2*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"431×452×177"},
    {"model":"OPT-IPC-T31-0F74422","series":"3U桌面式工控机","form":"3U桌面式工控机","brand":"奥普特","cpu":"i7-8700","board":"Q270/Q370","mem":"16G DDR4","ssd":"256GB","hdd":"2TB","psu":"300W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB 3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"330×300×135"},
    {"model":"OPT-IPC-T31-0D53402","series":"3U桌面式工控机","form":"3U桌面式工控机","brand":"奥普特","cpu":"i5-6500","board":"H110/Z390","mem":"8G DDR4","ssd":"256GB","hdd":"无","psu":"300W","slots":"1*PCIex16；2*PCIex4；4*PCI","io":"4*USB 3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"330×300×135"},
    {"model":"OPT-IPC-T31-0D74602","series":"3U桌面式工控机","form":"3U桌面式工控机","brand":"奥普特","cpu":"i7-6700","board":"H110/Z390","mem":"16G DDR4","ssd":"1TB","hdd":"无","psu":"300W","slots":"1*PCIex16；2*PCIex4；4*PCI","io":"4*USB 3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"330×300×135"},
    {"model":"OPT-IPC-T31-0E54502","series":"3U桌面式工控机","form":"3U桌面式工控机","brand":"奥普特","cpu":"i5-11500","board":"Q470/W480","mem":"16G DDR4","ssd":"512GB","hdd":"无","psu":"350W","slots":"2*PCIex16；3*PCIex4；2*PCI","io":"4*USB 3.0；4*USB 2.0；2*COM；HDMI+VGA+DVI；2*GbE","size":"330×300×135"},
    {"model":"SCI-Q2C-33605","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i3-8100","mem":"8GB DDR4","ssd":"1TB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-53505","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i5-8500","mem":"8GB DDR4","ssd":"512GB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-54605","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i5-8500","mem":"16GB DDR4","ssd":"1TB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-74605","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i7-8700","mem":"16G DDR4","ssd":"1TB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-75805","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i7-8700","mem":"32GB DDR4","ssd":"4TB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-74505","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i7-9700","mem":"16GB DDR4","ssd":"512GB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"},
    {"model":"SCI-Q2C-74805","series":"Q2C视觉控制器","form":"Q2C视觉控制器","brand":"奥普特","cpu":"i7-9700","mem":"16GB DDR4","ssd":"4TB","io":"4*USB 3.0；6*USB 2.0；2*COM；HDMI+VGA；4*GbE（POE）+2*GbE；4×DI；4×DO","size":"193×118×218"}
  ];
  return { META: META, CONTROLLERS: CONTROLLERS, IPC: IPC };
});
