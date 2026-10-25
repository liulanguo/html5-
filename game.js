"use strict";

/**
 * 1. CROP_DATA 类似 const map<string, CropRule>，记录每种植物的规则。
 * 2. game 类似一个 GameState struct，存放实际的游戏数据。
 * 3. buySeed/sowSeed/waterPlot/harvestPlot 只负责修改游戏状态。
 * 4. render... 函数负责将状态显示到 HTML（DOM）。
 * 5. 每次状态变化后调用 commit()，更新 UI 并保存 localStorage。
 */


//===============游戏规则，加载保存游戏，初始化游戏=======================
const RULES = Object.freeze({//const+冻结，防止核心游戏规则被修改
  //土地与施肥
  plotCount: 9,
  fertilizerPrice: 12,
  //储水
  waterMax: 9,
  waterAtStart: 2,
  waterPerDay: 1,
  waterBonusRatio: 0.20,       // 每次浇水抵扣原生长时间的 20%
  maxWaterPerCrop: 2,          // 单株最多浇水两次
  weightBonusRatio: 1.20,     // 最大重量额外带来 120% 基础售价
  //鼹鼠游戏
  moleDurationMs: 20_000,     // 鼹鼠游戏持续时间，20s（数值单位ms）
  moleSpawnMs: 850,           // 鼹鼠生成时间间隔，0.85s
  moleHitsPerWater: 4,        //四次hits一滴水，上限三滴
  moleRewardCap: 3            //上限三滴
});
//保存到本地网页时的辨识信息
const STORAGE_KEY = "farm-save";
const SAVE_VERSION = 2;

// 六种普通作物、七种星期限定作物。growMs 为游戏时间（毫秒）。
// 每种作物设置不同的种子价、基础售价、重量范围、成熟时间和浇水间隔。
const CROP_DATA = Object.freeze({
  carrot:     { name: "胡萝卜",     emoji: "🥕", seedPrice: 12, basePrice: 32,  minWeight: 0.20, maxWeight: 1.10, growMs: 30_000,  waterCooldownMs: 10_000 },
  tomato:     { name: "番茄",       emoji: "🍅", seedPrice: 20, basePrice: 52,  minWeight: 0.35, maxWeight: 2.20, growMs: 45_000,  waterCooldownMs: 14_000 },
  potato:     { name: "土豆",       emoji: "🥔", seedPrice: 18, basePrice: 45,  minWeight: 0.50, maxWeight: 3.00, growMs: 38_000,  waterCooldownMs: 12_000 },
  corn:       { name: "玉米",       emoji: "🌽", seedPrice: 28, basePrice: 73,  minWeight: 0.60, maxWeight: 4.00, growMs: 60_000,  waterCooldownMs: 18_000 },
  strawberry: { name: "草莓",       emoji: "🍓", seedPrice: 24, basePrice: 65,  minWeight: 0.08, maxWeight: 0.80, growMs: 50_000,  waterCooldownMs: 15_000 },
  pumpkin:    { name: "南瓜",       emoji: "🎃", seedPrice: 40, basePrice: 102, minWeight: 1.50, maxWeight: 9.00, growMs: 75_000,  waterCooldownMs: 23_000 },

  dewMint:    { name: "露珠薄荷",   emoji: "🌿", seedPrice: 48, basePrice: 118, minWeight: 0.15, maxWeight: 1.35, growMs: 85_000,  waterCooldownMs: 26_000, special: true, effect: "dew",     effectIcon: "💧", description: "蓝色露珠轻轻浮动" },
  flamePepper:{ name: "焰心辣椒",   emoji: "🌶️",seedPrice: 55, basePrice: 135, minWeight: 0.25, maxWeight: 1.80, growMs: 90_000,  waterCooldownMs: 27_000, special: true, effect: "fire",    effectIcon: "🔥", description: "火焰随风摇摆" },
  starBerry:  { name: "星辉蓝莓",   emoji: "🫐", seedPrice: 60, basePrice: 145, minWeight: 0.12, maxWeight: 1.20, growMs: 95_000,  waterCooldownMs: 29_000, special: true, effect: "star",    effectIcon: "✨", description: "星星闪烁" },
  thunderCorn:{ name: "雷鸣甜玉米", emoji: "🌽", seedPrice: 68, basePrice: 160, minWeight: 0.80, maxWeight: 5.50, growMs: 105_000, waterCooldownMs: 31_000, special: true, effect: "thunder", effectIcon: "⚡", description: "间歇闪电" },
  rainbowRoot:{ name: "彩虹萝卜",   emoji: "🥕", seedPrice: 72, basePrice: 175, minWeight: 0.30, maxWeight: 3.00, growMs: 110_000, waterCooldownMs: 33_000, special: true, effect: "rainbow", effectIcon: "🌈", description: "不断变色" },
  moonEggplant:{name:"月影茄子",    emoji: "🍆", seedPrice: 80, basePrice: 195, minWeight: 0.50, maxWeight: 4.00, growMs: 120_000, waterCooldownMs: 36_000, special: true, effect: "moon",    effectIcon: "🌙", description: "柔和月光漂浮" },
  sunBloom:   { name: "向阳金葵",   emoji: "🌻", seedPrice: 88, basePrice: 220, minWeight: 0.60, maxWeight: 6.00, growMs: 130_000, waterCooldownMs: 39_000, special: true, effect: "sun",     effectIcon: "☀️", description: "金色阳光旋转" }
});

//常驻作物集合
const NORMAL_CROP_IDS = Object.keys(CROP_DATA).filter(id => !CROP_DATA[id].special);

//记录特殊作物和星期有序数组方便一一对应
    // JS getDay()：星期日 0，星期一 1，...，星期六 6
const SPECIAL_BY_WEEKDAY = [
  "sunBloom", "dewMint", "flamePepper", "starBerry",
  "thunderCorn", "rainbowRoot", "moonEggplant"
];
const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

//获取当前日期的天序号
function getLocalDayNumber(date = new Date()) {
  // 按本地日历日期计数，不直接用 24h 毫秒差，以免夏令时跨日出错。
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}


//获取今天特殊作物的id
function getTodaySpecialId(date = new Date()) {
  return SPECIAL_BY_WEEKDAY[date.getDay()];
}

//设置空白土地初始值：重置土地状态
function blankPlot() {
  return {
    cropId: null,
    plantedAt: null,
    fertilized: false,
    waterCount: 0,
    lastWaterAt: null,
    growCreditMs: 0       //生长时间
  };
}

//初始化游戏（在没有存档时）
function createGame() {
  return {
    coins: 100,
    water: RULES.waterAtStart,
    lastWaterDay: getLocalDayNumber(),
    seeds: Object.fromEntries(Object.keys(CROP_DATA).map(id => [id, id === "carrot" ? 2 : id === "potato" ? 1 : 0])),//获取作物id和作物种子数量键值对生成对象
    harvest: [],             // 未出售的每个作物；收获时固定重量与售价
    totalHarvested: 0,
    bestMoleScore: 0,
    plots: Array.from({ length: RULES.plotCount }, blankPlot)  //初始化土地，用blankplot函数
  };
}

//界定合法值
function asInt(value, fallback = 0, low = 0, high = 1_000_000_000) {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.trunc(value))) : fallback;
}

//从本地存档中加载游戏数据
function loadGame() {
  //新版只读取自己的 v2 存档，避免旧数据字段不匹配。
  //读取存档，读取失败则创建新存档
  try {
    //读取存档，读取失败时直接创建新游戏；；source是存档游戏数据，g是新游戏的初始数据
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        //game校验
    if (!saved || saved.version !== SAVE_VERSION || !saved.game) return createGame();
    const source = saved.game;
        //地块校验
    if (!Array.isArray(source.plots) || source.plots.length !== RULES.plotCount) return createGame();
    const g = createGame();


    //根据合法值和存档数据赋值数据给新游戏生成目前游戏状态
    g.coins = asInt(source.coins, 100);
    g.water = asInt(source.water, 2, 0, RULES.waterMax);
    g.lastWaterDay = asInt(source.lastWaterDay, getLocalDayNumber(), 0, 99999999);
    g.totalHarvested = asInt(source.totalHarvested);
    g.bestMoleScore = asInt(source.bestMoleScore);
    for (const id of Object.keys(CROP_DATA)) {
      g.seeds[id] = asInt(source.seeds?.[id], 0, 0, 100000);
    }
        //土地状态也先生成初始值再校验
    g.plots = source.plots.map(raw => {  //map把原数组映射成一个新的数组
      const p = blankPlot();
      if (!raw || typeof raw !== "object") return p;
      p.fertilized = raw.fertilized === true;
      if (typeof raw.cropId === "string" && CROP_DATA[raw.cropId]
          && Number.isFinite(raw.plantedAt) && raw.plantedAt > 0) {
        p.cropId = raw.cropId;
        p.plantedAt = raw.plantedAt;
        p.waterCount = asInt(raw.waterCount, 0, 0, RULES.maxWaterPerCrop);
        p.lastWaterAt = Number.isFinite(raw.lastWaterAt) ? raw.lastWaterAt : null;
        p.growCreditMs = asInt(raw.growCreditMs, 0, 0, CROP_DATA[p.cropId].growMs);
      }
      return p;
    });

    //仓库数组校验赋值
    g.harvest = Array.isArray(source.harvest) ? source.harvest
      .filter(item => item && typeof item.id === "string" &&
        CROP_DATA[item.cropId] && Number.isFinite(item.weight) && Number.isFinite(item.price))
      .slice(0, 10000)
      .map(item => ({
        id: item.id.slice(0, 100),
        cropId: item.cropId,
        weight: Math.max(CROP_DATA[item.cropId].minWeight, Math.min(CROP_DATA[item.cropId].maxWeight, item.weight)),
        price: asInt(item.price),
        fertilized: item.fertilized === true,
        harvestedAt: asInt(item.harvestedAt, Date.now(), 0, 9999999999999)
      })) : [];
    return g;
  } catch (error) {
    console.warn("读取存档失败，已使用新存档：", error);
    return createGame();
  }
}

//加载游戏，设置界面等的初始值
let game = loadGame();
let selectedPlotIndex = null;//当前选中了哪块土地
let lastInspectorSignature = "";
let visibleDayNumber = null;
let currentView = "farm";
let serial = 0;
let storeErrorNotified = false;
let toastTimer = null;


//获取html文件信息，储存方便后续数据交互
const el = {
  //农场地块相关
  farm: document.querySelector("#farm"),//农场容器
  plotOverlay: document.querySelector("#plot-overlay"),//地块详情弹层
  plotClose: document.querySelector("#close-plot"),//弹层关闭按钮
  plotTitle: document.querySelector("#plot-title"),//弹层标题
  plotDetails: document.querySelector("#plot-details"),//弹层详情
  //种子相关
  seedPouch: document.querySelector(".seed-pouch"),//种子袋（class！）
  seedBagTrigger: document.querySelector("#seed-bag-trigger"),//打开种子袋的按钮
  seedBag: document.querySelector("#seed-bag"),//种子袋内容
  seedTotal: document.querySelector("#seed-total"),//种子总数


  
  
  
  //货币/水
  coins: document.querySelector("#coins"),//金币显示
  water: document.querySelector("#water-count"),//水量数字
  waterFill: document.querySelector("#water-fill"),//水位
  waterNext: document.querySelector("#water-next"),//下次浇水提示
  //收货仓库
  harvestTotal: document.querySelector("#harvest-total"),//收获总数
  harvestWorth: document.querySelector("#harvest-worth"),//收获价值
  harvestList: document.querySelector("#harvest-list"),//收获列表
  harvestSummary: document.querySelector("#harvest-summary"),//收获汇总

  warehouseTypeCount: document.querySelector("#warehouse-type-count"),//仓库种类数量
  warehouseTotalHarvested: document.querySelector("#warehouse-total-harvested"),//仓库已收获
  warehouseHeaviest: document.querySelector("#warehouse-heaviest"),//仓库最重
  sellAll: document.querySelector("#sell-all"),
  navHarvestBadge: document.querySelector("#nav-harvest-badge"),

  //商店相关
  shopList: document.querySelector("#shop-list"),
  
  //消息/日期
  message: document.querySelector("#message"),
  todayLabel: document.querySelector("#today-label"),
  todayDate: document.querySelector("#today-date"),
  dailyIcon: document.querySelector("#daily-icon"),
  dailyName: document.querySelector("#daily-name"),
  dailyDescription: document.querySelector("#daily-description"),

  //视图切换
  moleView: document.querySelector("#view-mole"),//地鼠视图
  farmView: document.querySelector("#view-farm"),//农场视图
  warehouseView: document.querySelector("#view-warehouse"),//仓库视图
  guideView: document.querySelector("#view-guide"),//玩法指南视图


  //地鼠相关
  moleGrid: document.querySelector("#mole-grid"),//地鼠网格
  moleStart: document.querySelector("#mole-start"),//开始按钮
  moleTime: document.querySelector("#mole-time"),//倒计时
  moleScore: document.querySelector("#mole-score"),//当前分数
  moleReward: document.querySelector("#mole-reward"),//奖励
  moleBest: document.querySelector("#mole-best"),//最高分
  moleStatus: document.querySelector("#mole-status"),//状态文字
  moleWater: document.querySelector("#mole-water")
};

//保存游戏数据到localStorage
function saveGame() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SAVE_VERSION, game }));//保存存储标签，存储版本和game对象
  } catch (error) {
    if (!storeErrorNotified) {
      storeErrorNotified = true;
      console.warn("无法保存到浏览器本地存储：", error);
      notify("⚠️ 浏览器阻止了本地存档；本次游玩可继续，但刷新可能丢失进度。");
    }
  }
}

//====================浮窗显示的函数集=======================
//函数：用于右下提示框逻辑
function notify(message) {
  el.message.textContent = message;
  el.message.classList.add("is-visible");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.message.classList.remove("is-visible");
    toastTimer = null;
  }, 4200);
}

// 悬浮的土地操作台：避免在宽大的农田下方反复滚动寻找按钮。
function openPlotDialog(index) {
  selectedPlotIndex = index;
  el.plotOverlay.hidden = false;
  renderFarm();//渲染农田界面
  renderInspector();
  el.plotClose.focus();//键盘聚焦于关闭按钮
}
function closePlotDialog() {
  el.plotOverlay.hidden = true;
  selectedPlotIndex = null;
  renderFarm();
  renderInspector();
}

//函数：若鼠标悬停在种子袋上则打开种子袋详情
function closeSeedPouch() {
  el.seedPouch.classList.remove("is-open");
  // 关闭后若鼠标仍停在图标上，暂时抑制自动 hover，避免视觉上“关不掉”。
  if (el.seedPouch.matches(":hover")) el.seedPouch.classList.add("suppress-hover");
  el.seedBagTrigger.setAttribute("aria-expanded", "false");
}

//转义函数，把特殊符号转成文本字符串，防止意外解析
function safeText(value) {
  // innerHTML 只应接收我们生成的固定规则文字；转义存档/拼接的内容更安全。
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}


//====================加载刷新界面数据视图的函数集====================
//函数：计算种子总数
function seedCount() {
  return Object.values(game.seeds).reduce((total, n) => total + n, 0);
}

//函数：计算仓库总价值
function harvestWorth() {
  return game.harvest.reduce((total, item) => total + item.price, 0);
}

//函数：加载界面状态信息：金币储水等
function renderStats() {
  el.coins.textContent = String(game.coins);
  el.water.textContent = String(game.water);
  el.waterFill.style.height = `${100 * game.water / RULES.waterMax}%`;
  el.seedTotal.textContent = String(seedCount());
  el.harvestTotal.textContent = String(game.harvest.length);
  el.navHarvestBadge.textContent = String(game.harvest.length);
  el.harvestWorth.textContent = `${harvestWorth()} 金币`;
  el.moleWater.textContent = `${game.water} / ${RULES.waterMax}`;
  el.warehouseTypeCount.textContent = String(new Set(game.harvest.map(item => item.cropId)).size);
  el.warehouseTotalHarvested.textContent = String(game.totalHarvested);
  el.warehouseHeaviest.textContent = game.harvest.length
    ? `${game.harvest.reduce((max, item) => Math.max(max, item.weight), 0).toFixed(2)} kg`
    : "—";
  el.waterNext.textContent = game.water >= RULES.waterMax
    ? "储水已满 · 上限 9 滴"
    : "每过一天恢复 1 滴水";
}

//函数：加载日期相关信息+特殊作物上架信息
function renderDaily(date = new Date()) {
  const crop = CROP_DATA[getTodaySpecialId(date)];
  const weekday = WEEKDAY_NAMES[date.getDay()];
  el.todayLabel.textContent = weekday;
  el.todayDate.textContent = `${date.getFullYear()} / ${date.getMonth() + 1} / ${date.getDate()}`;
  el.dailyIcon.textContent = crop.effectIcon;
  el.dailyName.textContent = `${crop.emoji} ${crop.name}`;
  el.dailyDescription.textContent = `仅${weekday}上架 · ${crop.description} · 价格 ${crop.seedPrice} 金币`;
}

//函数：加载刷新种子袋界面
function renderSeedBag() {
  // 右侧种子袋只保留图标；悬停或点击时展示“种子类型 + 数量”的小表格。
  const owned = Object.keys(CROP_DATA).filter(id => game.seeds[id] > 0);
  if (!owned.length) {
    el.seedBag.innerHTML = '<div class="bag-empty">种子袋还没有种子<br>去种子商店看看吧 🌱</div>';
    return;
  }
  const rows = owned.map(id => {
    const crop = CROP_DATA[id];
    return `<tr><td>${crop.emoji} ${safeText(crop.name)}</td><td>${game.seeds[id]}</td></tr>`;
  }).join("");
  el.seedBag.innerHTML = `<table class="bag-table">
    <thead><tr><th scope="col">种子类型</th><th scope="col">数量</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

//函数：加载刷新种子商店
function renderShop(date = new Date()) {
  const todaySpecial = getTodaySpecialId(date);
  const shopIds = [...NORMAL_CROP_IDS, todaySpecial];
  el.shopList.innerHTML = shopIds.map(id => {
    const crop = CROP_DATA[id];
    const special = Boolean(crop.special);
    return `<div class="shop-item ${special ? "is-special" : ""}">
      <span class="shop-emoji" aria-hidden="true">${crop.emoji}</span>
      <div class="shop-copy">
        <strong>${safeText(crop.name)}${special ? '<span class="tag">今日限定 ✦</span>' : ""}</strong>
        <small>${crop.growMs / 1000}秒成熟 · ${crop.minWeight}～${crop.maxWeight}kg</small>
        <small>基础价 ${crop.basePrice} · 背包 ${game.seeds[id]} 粒${special ? ` · ${crop.effectIcon} 特效` : ""}</small>
      </div>
      <button type="button" class="shop-buy" data-buy="${id}" ${game.coins < crop.seedPrice ? "disabled" : ""}>
        🪙 ${crop.seedPrice}
      </button>
    </div>`;
  }).join("");
}

//函数：加载刷新仓库界面信息，视图
function renderWarehouse() {
  const countByCrop = new Map();
  for (const item of game.harvest) {
    countByCrop.set(item.cropId, (countByCrop.get(item.cropId) || 0) + 1);
  }
  el.harvestSummary.innerHTML = [...countByCrop.entries()].map(([id, count]) => {
    const crop = CROP_DATA[id];
    return `<span class="harvest-chip">${crop.emoji} ${safeText(crop.name)} <b>×${count}</b></span>`;
  }).join("") || '<span class="small-label">暂无未出售的作物</span>';

  el.sellAll.disabled = game.harvest.length === 0;
  if (!game.harvest.length) {
    el.harvestList.innerHTML = `<div class="empty-state">
      <div class="empty-emoji">🧺</div><strong>仓库还没有收获</strong>
      <p>成熟后点击田地收获，这里会记录每一株作物的重量与售价。</p>
      <button type="button" class="button button-soft" data-view="farm">🌱 回到农田，开始种植</button>
    </div>`;
    return;
  }
  // 保存到仓库的是每一次独立收获，不会因为同类型就合并重量/价格。
  el.harvestList.innerHTML = [...game.harvest].reverse().map(item => {
    const crop = CROP_DATA[item.cropId];
    return `<div class="harvest-item">
      <span class="harvest-item-icon" aria-hidden="true">${crop.emoji}</span>
      <div class="harvest-item-info">
        <strong>${safeText(crop.name)}${crop.special ? " ✨" : ""}${item.fertilized ? " 🌾" : ""}</strong>
        <small>${item.weight.toFixed(2)} kg · 基础 ${crop.basePrice} + 重量 ${item.price - crop.basePrice}</small>
      </div>
      <button type="button" class="button button-primary" data-sell="${safeText(item.id)}">${item.price} 🪙 出售</button>
    </div>`;
  }).join("");
}
//===================作物成长计算函数集====================
//函数：计算当前土地作物已生长时间（计入浇水缩短的时间）
function progressMs(plot, now = Date.now()) {
  if (!plot.cropId) return 0;
  return Math.max(0, now - plot.plantedAt) + plot.growCreditMs;
}
//函数：判断作物是否成熟，返回作物状态
function phaseOf(plot, now = Date.now()) {
  if (!plot.cropId) return "empty";
  return progressMs(plot, now) >= CROP_DATA[plot.cropId].growMs ? "ready" : "growing";
}
//函数：计算当前土地作物剩余生长时间
function remainingMs(plot, now = Date.now()) {
  if (!plot.cropId) return 0;
  return Math.max(0, CROP_DATA[plot.cropId].growMs - progressMs(plot, now));
}
//函数：计算作物浇水冷却时间还剩多少
function waterWaitMs(plot, now = Date.now()) {
  if (!plot.cropId) return 0;
  const last = plot.lastWaterAt ?? plot.plantedAt;
  return Math.max(0, CROP_DATA[plot.cropId].waterCooldownMs - (now - last));
}


//====================加载刷新界面数据视图的函数集2===============
// 静态土地按钮仅创建一次；每次刷新只更新它们的文字和 CSS（用renderfarm）。
const plotButtons = Array.from({ length: RULES.plotCount }, (_, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "plot";
  button.dataset.index = String(index);
  button.innerHTML = `
    <span class="plot-effect" aria-hidden="true"></span>
    <span class="plot-icon" aria-hidden="true">🟫</span>
    <span class="plot-name">空土地</span>
    <span class="plot-meta">点击选择</span>`;
  el.farm.append(button);
  return button;
});

//数据驱动的农场渲染函数，获取数据，计算，得到农田状态，更新农田按钮和界面
function renderFarm(now = Date.now()) {
  plotButtons.forEach((button, i) => {
    const plot = game.plots[i];
    const phase = phaseOf(plot, now);
    const crop = plot.cropId ? CROP_DATA[plot.cropId] : null;
    const specialClass = crop?.special ? ` plot--special effect--${crop.effect}` : "";
    button.className = `plot plot--${phase}${plot.fertilized ? " plot--fertile" : ""}${specialClass}${selectedPlotIndex === i ? " is-selected" : ""}`;
    const icon = phase === "empty" ? (plot.fertilized ? "✨" : "＋")
      : phase === "ready" ? crop.emoji
      : progressMs(plot, now) >= crop.growMs / 2 ? "🌿" : "🌱";
    const name = phase === "empty" ? "空土地" : crop.name;
    const meta = phase === "empty" ? (plot.fertilized ? "已施肥 · 可播种" : "点击播种 / 施肥")
      : phase === "ready" ? "成熟！点击收获"
      : `还需 ${Math.ceil(remainingMs(plot, now) / 1000)} 秒`;
    button.querySelector(".plot-icon").textContent = icon;
    button.querySelector(".plot-name").textContent = name;
    button.querySelector(".plot-meta").textContent = meta;
    button.querySelector(".plot-effect").textContent = crop?.special ? crop.effectIcon : "";
    button.setAttribute("aria-label", `第${i + 1}块田地：${name}，${meta}`);
    button.setAttribute("aria-pressed", selectedPlotIndex === i ? "true" : "false");
  });
}
//函数：收集所有影响面板显示的变量 → 用 "|" 拼成一个字符串签名，方便对比变化，无变化则不刷新
function inspectorSignature(now = Date.now()) {
  if (selectedPlotIndex === null) return "none";
  const plot = game.plots[selectedPlotIndex];
  const phase = phaseOf(plot, now);
  return [
    selectedPlotIndex, phase, plot.fertilized, plot.waterCount,
    plot.cropId, game.water > 0, game.coins >= RULES.fertilizerPrice,
    waterWaitMs(plot, now) === 0,
    phase === "empty" ? seedCount() + "/" + Object.values(game.seeds).join(",") : ""
  ].join("|");
}

//土地操作台的渲染函数
function renderInspector(now = Date.now()) {
  lastInspectorSignature = inspectorSignature(now);
  if (selectedPlotIndex === null) {
    el.plotTitle.textContent = "土地操作台";
    el.plotDetails.textContent = "点击任意一块土地，即可选择种子播种、施肥、浇水或收获。";
    return;
  }
  const index = selectedPlotIndex;
  const plot = game.plots[index];
  const phase = phaseOf(plot, now);
  el.plotTitle.textContent = `第 ${index + 1} 块土地`;

  if (phase === "empty") {
    const choices = Object.keys(CROP_DATA).filter(id => game.seeds[id] > 0);
    const sowButtons = choices.map(id => {
      const crop = CROP_DATA[id];
      return `<button type="button" class="seed-option" data-sow="${id}">
        ${crop.emoji} ${safeText(crop.name)} ×${game.seeds[id]}${crop.special ? " ✨" : ""}
      </button>`;
    }).join("") || '<p class="muted">暂无可播种的种子，请到小铺购买。</p>';
    el.plotDetails.innerHTML = `
      <div class="inspect-header"><span class="inspect-icon">${plot.fertilized ? "🌾" : "🟫"}</span>
        <div><strong>这块土地尚未播种</strong><span>${plot.fertilized ? "土壤已施肥，下一株重量更容易偏大" : "普通土地 · 可先施肥提高收获重量"}</span></div>
      </div>
      <div class="action-row">
        <button type="button" class="button button-gold" data-fertilize="${index}"
          ${plot.fertilized || game.coins < RULES.fertilizerPrice ? "disabled" : ""}>
          ${plot.fertilized ? "✓ 已施肥" : `🌾 施肥 · ${RULES.fertilizerPrice} 金币`}
        </button>
        <small class="muted">只在空地施肥，每块地一次</small>
      </div>
      <div class="seed-options">${sowButtons}</div>`;
    return;
  }

  const crop = CROP_DATA[plot.cropId];
  const header = `<div class="inspect-header"><span class="inspect-icon">${crop.emoji}</span>
    <div><strong>${safeText(crop.name)}${crop.special ? " ✨ 神奇作物" : ""}</strong>
      <span>重量范围 ${crop.minWeight}～${crop.maxWeight} kg · ${plot.fertilized ? "施肥增重中" : "普通土壤"}</span>
    </div></div>`;

  if (phase === "ready") {
    el.plotDetails.innerHTML = `${header}
      <p class="inspect-note">🎉 成熟啦！收获时会随机称重、计算价格，然后直接进入仓库（不自动出售）。</p>
      <div class="progress"><div class="progress-fill" style="width:100%"></div></div>
      <div class="action-row">
        <button type="button" class="button button-primary" data-harvest="${index}">🧺 立即收获</button>
        <small class="muted">本株已浇水 ${plot.waterCount} / ${RULES.maxWaterPerCrop} 次</small>
      </div>`;
    return;
  }

  const cooldown = waterWaitMs(plot, now);
  let waterText;
  if (plot.waterCount >= RULES.maxWaterPerCrop) waterText = "已达浇水上限";
  else if (game.water <= 0) waterText = "储水不足";
  else if (cooldown > 0) waterText = `再等 ${Math.ceil(cooldown / 1000)} 秒`;
  else waterText = "💧 浇水 · 消耗 1 水";
  const canWater = cooldown === 0 && game.water > 0 && plot.waterCount < RULES.maxWaterPerCrop;
  el.plotDetails.innerHTML = `${header}
    <div id="inspect-time" class="inspect-note"></div>
    <div class="progress"><div id="inspect-progress" class="progress-fill"></div></div>
    <div class="action-row">
      <button type="button" class="button button-primary" data-water="${index}" ${canWater ? "" : "disabled"}>${waterText}</button>
      <small class="muted">浇水 ${plot.waterCount} / ${RULES.maxWaterPerCrop} 次 · 每次增加 20% 成长进度</small>
    </div>`;
  updateInspectorProgress(now);
}
//函数：负责每秒刷新进度百分比和剩余秒数；仅刷新部分数据显示
function updateInspectorProgress(now = Date.now()) {
  if (selectedPlotIndex === null) return;
  const plot = game.plots[selectedPlotIndex];
  if (phaseOf(plot, now) !== "growing") return;
  const crop = CROP_DATA[plot.cropId];
  const time = el.plotDetails.querySelector("#inspect-time");
  const progress = el.plotDetails.querySelector("#inspect-progress");
  if (time) time.textContent = `成长进度 ${Math.min(100, Math.floor(progressMs(plot, now) / crop.growMs * 100))}% · 约 ${Math.ceil(remainingMs(plot, now) / 1000)} 秒后成熟`;
  if (progress) progress.style.width = `${Math.min(100, progressMs(plot, now) / crop.growMs * 100)}%`;
}

//重新加载所有信息；刷新界面
function renderAll() {
  const now = Date.now();
  renderStats();
  renderDaily();
  renderSeedBag();
  renderShop();
  renderWarehouse();
  renderFarm(now);
  renderInspector(now);
  renderMole(now);
}

//函数：保存游戏，刷新界面
function commit(message) {
  // 每个改变游戏状态的动作都走这里，避免金币、库存、仓库之间不同步。
  if (message) notify(message);
  saveGame();
  renderAll();
}

//==============================农田操作动作函数集（购买种植篇）===========================
//购买种子
function buySeed(cropId) {
  const crop = CROP_DATA[cropId];
  if (!crop) return;
  if (crop.special && getTodaySpecialId() !== cropId) {
    notify("限定种子已经换日，只能购买今天的限定种子。");
    renderShop();
    return;
  }
  if (game.coins < crop.seedPrice) {
    notify(`金币不足，购买 ${crop.name} 需要 ${crop.seedPrice} 金币。`);
    return;
  }
  game.coins -= crop.seedPrice;
  game.seeds[cropId] += 1;
  commit(`🌰 已购买 1 粒${crop.name}种子，花费 ${crop.seedPrice} 金币。`);
}

//土地施肥
function fertilizePlot(index) {
  const plot = game.plots[index];
  if (!plot || phaseOf(plot) !== "empty") {
    notify("只有空土地才可以施肥，请下次在播种前进行。");
    return;
  }
  if (plot.fertilized) { notify("这块土地已施肥，先播种收获之后才能再次施肥。"); return; }
  if (game.coins < RULES.fertilizerPrice) { notify("金币不足，施肥需要 12 金币。"); return; }
  game.coins -= RULES.fertilizerPrice;
  plot.fertilized = true;
  commit(`🌾 第 ${index + 1} 块土地施肥成功！这次播种收获更容易获得大重量。`);
}
//播种
function sowSeed(index, cropId) {
  const plot = game.plots[index];
  const crop = CROP_DATA[cropId];
  if (!plot || !crop || phaseOf(plot) !== "empty") return;
  if (!game.seeds[cropId]) { notify(`没有${crop.name}种子，请先购买。`); return; }
  game.seeds[cropId] -= 1;
  plot.cropId = cropId;
  plot.plantedAt = Date.now();
  plot.lastWaterAt = null;
  plot.waterCount = 0;
  plot.growCreditMs = 0;
  commit(`🌱 已播种${crop.name}！${plot.fertilized ? "肥沃的土地会影响收获重量。" : "可以在成长一段时间后浇水加速。"}`);
}
//浇水
function waterPlot(index) {
  const plot = game.plots[index];
  if (!plot || phaseOf(plot) !== "growing") {
    notify("只有还在生长的作物可以浇水。");
    return;
  }
  const crop = CROP_DATA[plot.cropId];
  if (plot.waterCount >= RULES.maxWaterPerCrop) { notify("这株植物已经浇过两次水。"); return; }
  if (game.water <= 0) { notify("储水不足，可以等待每日补充或打地鼠取水。"); return; }
  const wait = waterWaitMs(plot);
  if (wait > 0) {
    notify(`还需要等待 ${Math.ceil(wait / 1000)} 秒才可以再次浇水。`);
    return;
  }
  game.water -= 1;
  plot.waterCount += 1;
  plot.lastWaterAt = Date.now();
  plot.growCreditMs += Math.round(crop.growMs * RULES.waterBonusRatio);
  const finished = phaseOf(plot) === "ready";
  commit(`💧 已为${crop.name}浇水！成长进度增加 20%。${finished ? "作物现在已经成熟！" : ""}`);
}

//========================重量售价计算函数集=============================
// 对均匀随机数 U∈[0,1) 做变换：
// 普通地块 t = U^2，E[t] = 1/3，更容易得到较小的重量。
// 施肥地块 t = sqrt(U)，E[t] = 2/3，更容易得到较大的重量。
// 重量始终限制在本作物的 [minWeight, maxWeight] 区间。
function drawWeight(crop, fertilized, random = Math.random) {
  const u = Math.max(0, Math.min(0.999999999, random()));
  const ratio = fertilized ? Math.sqrt(u) : u * u;
  const rawWeight = crop.minWeight + (crop.maxWeight - crop.minWeight) * ratio;
  return Math.max(crop.minWeight, Math.min(crop.maxWeight, Math.round(rawWeight * 100) / 100));
}

// 最终售价 = basePrice + round(basePrice × 1.2 × 重量比例)
// 重量比例 = (weight-minWeight)/(maxWeight-minWeight)，在 [0,1] 区间。
// 因此最低约 basePrice，最高约 2.2 × basePrice。
function calculatePrice(crop, weight) {
  const ratio = Math.max(0, Math.min(1,
    (weight - crop.minWeight) / (crop.maxWeight - crop.minWeight)));
  return crop.basePrice + Math.round(crop.basePrice * RULES.weightBonusRatio * ratio);
}


//==============================农田操作动作函数集（收获售卖篇）===========================
//土地收获
function harvestPlot(index) {
  const plot = game.plots[index];
  if (!plot || phaseOf(plot) !== "ready") {
    notify("植物还没有成熟。");
    return;
  }
  const crop = CROP_DATA[plot.cropId];
  const weight = drawWeight(crop, plot.fertilized);
  const price = calculatePrice(crop, weight);
  game.harvest.push({
    id: `${Date.now()}-${++serial}-${Math.floor(Math.random() * 1000000)}`,
    cropId: plot.cropId,
    weight,
    price,
    fertilized: plot.fertilized,
    harvestedAt: Date.now()
  });
  game.totalHarvested += 1;
  game.plots[index] = blankPlot();    // 收获后此块土地回到空地，肥力已消耗
  commit(`🧺 ${crop.emoji} ${crop.name}收获！重量 ${weight.toFixed(2)} kg，售价 ${price} 金币；已存仓，记得手动出售。`);
  closePlotDialog();
}
//选中售出作物
function sellItem(id) {
  const index = game.harvest.findIndex(item => item.id === id);
  if (index === -1) return;
  const [item] = game.harvest.splice(index, 1);
  game.coins += item.price;
  commit(`🪙 已出售 ${CROP_DATA[item.cropId].name} ${item.weight.toFixed(2)} kg，获得 ${item.price} 金币。`);
}
//全部售出
function sellAll() {
  if (!game.harvest.length) return;
  const value = harvestWorth();
  const count = game.harvest.length;
  if (!window.confirm(`确定出售仓库中全部 ${count} 株作物，获得 ${value} 金币吗？`)) return;
  game.coins += value;
  game.harvest = [];
  commit(`🪙 全部出售成功！${count} 株作物共卖出 ${value} 金币。`);
}


//===============================补水函数==============================================
function applyDailyWater(nowDate = new Date()) {
  // 每个“经过的本地日历日”只补 1 次，离线几天回来可累计至上限。
  const today = getLocalDayNumber(nowDate);
  const diff = today - game.lastWaterDay;
  if (diff <= 0) return false;  // 同一天或设备时钟调回，不重复补水
  const before = game.water;
  game.water = Math.min(RULES.waterMax, game.water + diff * RULES.waterPerDay);
  game.lastWaterDay = today;
  saveGame();
  const added = game.water - before;
  if (added > 0) notify(`💧 跨过 ${diff} 个日历日，储水罐补充 ${added} 滴水（上限 9）。`);
  renderStats();
  return true;
}

//============= 打地鼠小游戏：游戏状态与农田状态相互独立 ============= 
//数据
const mole = {
  running: false,// 是否进行中
  played: false,// 是否玩过（本次）
  score: 0,
  endAt: 0,
  activeIndex: -1,// 当前活跃地鼠的格子索引初始为-1
  lastSpawnAt: 0,// 上次生成地鼠的时间
  previousIndex: -1,// 上次活跃地鼠的格子索初始-1
  lastResult: "准备好了吗？点击开始挑战！"//信息提示
};

//函数：创建九个空洞 =》赋值给对象
const moleButtons = Array.from({ length: 9 }, (_, index) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mole-hole";
  btn.dataset.hole = String(index);
  btn.innerHTML = '<span class="mole-face" aria-hidden="true">🐹</span>';
  btn.setAttribute("aria-label", `第${index + 1}个洞`);
  el.moleGrid.append(btn);
  return btn;
});

//函数：计算获得水量
function molePotentialReward(score) {
  return Math.min(RULES.moleRewardCap, Math.floor(score / RULES.moleHitsPerWater));
}

//函数：随机命中一个洞出现地鼠
function spawnMole(now) {
  let next = Math.floor(Math.random() * 9);
  if (next === mole.previousIndex) next = (next + 1 + Math.floor(Math.random() * 8)) % 9;
  mole.activeIndex = next;
  mole.previousIndex = next;
  mole.lastSpawnAt = now;
}
//函数：开始游戏，重置状态
function startMole() {
  if (mole.running) return;
  mole.running = true;
  mole.played = true;
  mole.score = 0;
  mole.endAt = Date.now() + RULES.moleDurationMs;
  mole.activeIndex = -1;
  mole.previousIndex = -1;
  mole.lastSpawnAt = 0;
  mole.lastResult = "快看，地鼠从哪里冒出来了？";
  spawnMole(Date.now());
  renderMole();
}
//函数：结束游戏
function finishMole() {
  if (!mole.running) return;
  mole.running = false;
  mole.activeIndex = -1;
  const earned = molePotentialReward(mole.score);
  const actuallyAdded = Math.min(earned, RULES.waterMax - game.water);
  game.water += actuallyAdded;
  game.bestMoleScore = Math.max(game.bestMoleScore, mole.score);
  mole.lastResult = `本局命中 ${mole.score} 只，理论奖励 ${earned} 滴水；实际获得 ${actuallyAdded} 滴（储水上限 ${RULES.waterMax}）。`;
  commit(`🐹 打地鼠结束！${mole.lastResult}`);
}


//函数：动作命中地鼠后的变化
function hitMole(index) {
  if (!mole.running) return;
  const now = Date.now();
  if (now >= mole.endAt) { finishMole(); return; }
  if (mole.activeIndex !== index) return;
  mole.score += 1;
  mole.activeIndex = -1;            // 本只地鼠不能重复计分
  mole.lastSpawnAt = now - 500;      // 短暂间隔后再出现下一只
  renderMole(now);
}

//函数重新加载地鼠小游戏状态
function renderMole(now = Date.now()) {
  el.moleTime.textContent = `${(mole.running ? Math.max(0, mole.endAt - now) / 1000 : mole.played ? 0 : RULES.moleDurationMs / 1000).toFixed(1)}s`;
  el.moleScore.textContent = String(mole.score);
  el.moleReward.textContent = `${molePotentialReward(mole.score)} 💧`;
  el.moleBest.textContent = String(game.bestMoleScore);
  el.moleStart.disabled = mole.running;
  el.moleStart.textContent = mole.running ? "挑战进行中…" : mole.played ? "再玩一次" : "开始挑战";
  el.moleStatus.textContent = mole.lastResult;
  moleButtons.forEach((btn, i) => {
    const active = mole.running && i === mole.activeIndex;
    btn.classList.toggle("active", active);
    btn.disabled = !mole.running;
    btn.setAttribute("aria-label", `第${i + 1}个洞${active ? "，地鼠出现！" : "，没有地鼠"}`);
  });
}
//单页应用的视图切换函数：隐藏所有视图，只显示目标视图；同步导航按钮的选中状态；关闭所有弹层；滚回顶部。
function switchView(next) {
  const views = {
    farm: el.farmView,
    warehouse: el.warehouseView,
    guide: el.guideView,
    mole: el.moleView
  };
  currentView = Object.hasOwn(views, next) ? next : "farm";
  closePlotDialog();
  closeSeedPouch();
  for (const [name, section] of Object.entries(views)) {
    section.hidden = name !== currentView;
  }
  document.querySelectorAll(".nav-button").forEach(btn => {
    const active = btn.dataset.view === currentView;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  // 页面是同一个 HTML 中的独立界面，回到顶部能看到完整页面标题。
  window.scrollTo({ top: 0, behavior: "smooth" });
}


//=========================控制界面刷新==============================
function tick() {
  const now = Date.now();
  const date = new Date(now);
  const day = getLocalDayNumber(date);
  if (day !== visibleDayNumber) {
    applyDailyWater(date);
    visibleDayNumber = day;
    renderDaily(date);
    renderShop(date);
  }
  // 农田成熟完全依据 Date.now()，即使切换到打地鼠页面也照样成长。
  renderFarm(now);
  if (inspectorSignature(now) !== lastInspectorSignature) renderInspector(now);//判断是否需要更新
  else updateInspectorProgress(now);

  if (mole.running) {
    if (now >= mole.endAt) {
      finishMole();
      return;
    }
    if (now - mole.lastSpawnAt >= RULES.moleSpawnMs) spawnMole(now);
  }
  if (currentView === "mole") renderMole(now);
}



//============= 事件绑定：事件委托避免给几十个按钮逐一加监听 =============
//把之前的动作函数与点击事件绑定

//点击土地：收获或者打开土地操作台
el.farm.addEventListener("click", event => {
  const button = event.target.closest("[data-index]");
  if (!button || !el.farm.contains(button)) return;
  const index = Number(button.dataset.index);
  // 成熟地块仍然一键收获，其他状态打开居中浮层。
  if (phaseOf(game.plots[index]) === "ready") {
    harvestPlot(index);
    return;
  }
  openPlotDialog(index);
});

//操作台点击：施肥种植浇水收获
el.plotDetails.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.fertilize !== undefined) fertilizePlot(Number(button.dataset.fertilize));
  else if (button.dataset.sow !== undefined && selectedPlotIndex !== null) sowSeed(selectedPlotIndex, button.dataset.sow);
  else if (button.dataset.water !== undefined) waterPlot(Number(button.dataset.water));
  else if (button.dataset.harvest !== undefined) harvestPlot(Number(button.dataset.harvest));
});

//商店种子购买点击
el.shopList.addEventListener("click", event => {
  const button = event.target.closest("button[data-buy]");
  if (button) buySeed(button.dataset.buy);
});
//选中作物出售点击
el.harvestList.addEventListener("click", event => {
  const button = event.target.closest("button[data-sell]");
  if (button) sellItem(button.dataset.sell);
});
//全部出售点击
el.sellAll.addEventListener("click", sellAll);

// 关闭土地浮层：关闭按钮 / 点击遮罩空白 / Esc。
el.plotClose.addEventListener("click", closePlotDialog);
el.plotOverlay.addEventListener("click", event => {
  if (event.target === el.plotOverlay) closePlotDialog();
});

// 种子袋图标：桌面可悬停，触摸屏通过点击打开/关闭。
el.seedBagTrigger.addEventListener("click", () => {
  const open = el.seedPouch.classList.toggle("is-open");
  el.seedPouch.classList.toggle("suppress-hover", !open);
  el.seedBagTrigger.setAttribute("aria-expanded", String(open));
  if (!open) el.seedBagTrigger.blur();
});
el.seedPouch.addEventListener("pointerleave", () => {
  el.seedPouch.classList.remove("suppress-hover");
});
document.addEventListener("click", event => {
  if (!el.seedPouch.contains(event.target)) closeSeedPouch();
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!el.plotOverlay.hidden) {
    closePlotDialog();
    return;
  }
  closeSeedPouch();
});


//地鼠游戏开始点击
el.moleStart.addEventListener("click", startMole);
//地鼠洞点击
el.moleGrid.addEventListener("click", event => {
  const button = event.target.closest("button[data-hole]");
  if (button) hitMole(Number(button.dataset.hole));
});

//切换界面点击
document.addEventListener("click", event => {
  const button = event.target.closest("button[data-view]");
  if (button) switchView(button.dataset.view);
});
//重置点击
document.querySelector("#reset-game").addEventListener("click", () => {
  if (!window.confirm("确定要删除当前农场、金币、种子、仓库与成绩并重开吗？此操作不可撤销。")) return;
  game = createGame();
  el.plotOverlay.hidden = true;
  selectedPlotIndex = null;
  mole.running = false;
  mole.played = false;
  mole.score = 0;
  mole.activeIndex = -1;
  mole.lastResult = "准备好了吗？点击开始挑战！";
  visibleDayNumber = getLocalDayNumber();
  saveGame();
  renderAll();
  switchView("farm");
  notify("🌼 农场已经重新开始：100 金币、2 粒胡萝卜种子、1 粒土豆种子和 2 滴水。");
});


//=======================游戏逻辑=========================
applyDailyWater();
visibleDayNumber = getLocalDayNumber();
renderAll();
notify("🌼 点击农田可以播种、施肥和浇水；悬停或点击种子袋可查看库存。");
setInterval(tick, 200);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
window.addEventListener("focus", tick);
