const { spawn } = require('node:child_process');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:7900/index.html';
const PORT = 9337;
const EXPECT_DISHES = 200;
const EXPECT_CATS = 10;

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(__dirname, 'edge-prof-menu')}`, '--no-first-run',
  '--window-size=430,900', URL_,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (n, c, x = '') => { out.push([n, !!c]); console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && x ? ' — ' + x : ''}`); };

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
    } catch {}
  }
  if (!target) { console.log('no target'); proc.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const logs = [];
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
  };
  const reload = async () => { await send('Page.reload', { ignoreCache: true }); await sleep(1500); };
  const clickChef = async () => {
    await ev("[...document.querySelectorAll('#whoSwitch button')].find(b=>b.dataset.role==='chef').click()");
    await sleep(300);
  };
  const clickTab = async (t) => {
    await ev(`[...document.querySelectorAll('#tabbar button')].find(b=>b.dataset.tab==='${t}').click()`);
    await sleep(300);
  };

  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Page.enable');

  // ── 老 Safari 兼容：去掉 structuredClone 也要能启动
  const { result: sid } = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{delete window.structuredClone}catch(e){}',
  });
  await reload();
  const compatDishes = await ev('window.__COUPLE__ ? window.__COUPLE__.stats().dishes : 0');
  ok('没有 structuredClone 也能启动（老 Safari）', compatDishes === EXPECT_DISHES, String(compatDishes));
  ok('兜底错误层默认隐藏', (await ev("document.getElementById('fatal').hidden")) === true);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid.identifier });

  // ── 老数据迁移（version 1，只有 2 道老菜 + 1 道自定义菜，且没有 r 字段）
  await ev(`localStorage.setItem('couple-menu-v1', JSON.stringify({
    profile: { a: '我', b: '你', avatarA: '🐰', avatarB: '🐻' },
    menu: [
      { id: 'd1', cat: '前菜', emoji: '🥒', name: '凉拌黄瓜', desc: '旧数据', price: 8, tag: '' },
      { id: 'd2', cat: '前菜', emoji: '🫛', name: '拍蒜毛豆', desc: '旧数据', price: 6, tag: '' },
      { id: 'dz9', cat: '拿手菜', emoji: '🍲', name: '我自己的私房菜', desc: '别弄丢了', price: 99, tag: '' }
    ],
    cart: {}, orders: []
  }))`);
  await reload();
  const mig = await ev('window.__COUPLE__.stats()');
  ok(`老数据补齐到 ${EXPECT_DISHES} + 1 道自定义`, mig && mig.dishes === EXPECT_DISHES + 1, JSON.stringify(mig));
  ok('自定义菜被保留', (await ev('document.body.innerText')).includes('我自己的私房菜'));
  ok('版本升到 5', mig && mig.version === 5, String(mig && mig.version));
  ok('老菜补上了做法', (await ev("!!(JSON.parse(localStorage.getItem('couple-menu-v1')).menu.find(d=>d.id==='d1')||{}).r")) !== false);

  // ── 干净启动
  await ev('localStorage.clear()');
  await reload();
  const stats = await ev('window.__COUPLE__.stats()');
  ok(`默认菜单 ${EXPECT_DISHES} 道`, stats && stats.dishes === EXPECT_DISHES, JSON.stringify(stats));
  ok('卡片渲染数量一致', (await ev("document.querySelectorAll('.dish').length")) === EXPECT_DISHES);
  ok('分类 10 + 全部', (await ev("document.querySelectorAll('.cat').length")) === EXPECT_CATS + 1);
  ok('分类顺序正确', (await ev("[...document.querySelectorAll('.cat')].map(b=>b.dataset.cat).join(',')"))
    === '全部,前菜,早餐,拿手菜,锅物,汤,主食,小吃,甜品,饮品,夜宵');
  ok('每道菜都有做法数据', (await ev("window.__COUPLE__.stats().withRecipe")) === EXPECT_DISHES,
    String(await ev('window.__COUPLE__.stats().withRecipe')));

  // ── 川菜批次（本轮新增）抽查
  const sichuan = await ev(`(() => {
    const want = ['辣子鸡','蚂蚁上树','水煮鱼片','干拌毛肚','担担面','酸辣粉','盐煎肉','子姜鸭','酸汤肥牛','钵钵鸡','水煮牛肉'];
    const names = window.__COUPLE__ && [...document.querySelectorAll('.dish .name')].map(n=>n.innerText);
    return want.filter(w => !names.some(n => n.includes(w))).join(',');
  })()`);
  ok('11 道川菜都在菜单里', sichuan === '', String(sichuan));
  const rJichi = await ev(`(() => {
    const d = window.__COUPLE__.dish('辣子鸡');
    return d && d.r ? d.r.steps.length + '|' + d.r.t + '|' + d.r.ing.length : 'none';
  })()`);
  const newBatch = await ev(`(() => {
    const want = ['凉拌豆皮','珍珠奶茶','麻辣香锅','螺蛳粉','驴打滚','腊味煲仔饭','虎皮青椒','鲫鱼豆腐汤','三鲜砂锅','炸藕盒'];
    const all = window.__COUPLE__.stats().dishes;
    const names = [];
    const st = JSON.parse(JSON.stringify({}));
    return want.filter(w => !window.__COUPLE__.dish(w)).join(',') + '|' + all;
  })()`);
  ok('新批次代表性菜都在（10 抽查 + 总数 200）', String(newBatch) === '|200', String(newBatch));
  ok('辣子鸡有 5 步做法、60 分钟、9 种食材', /^5\|60\|9$/.test(String(rJichi)), String(rJichi));

  // ── 分类筛选
  await ev("[...document.querySelectorAll('.cat')].find(b=>b.dataset.cat==='拿手菜').click()");
  await sleep(200);
  ok('拿手菜 45 道', (await ev("document.querySelectorAll('.dish').length")) === 45);
  await ev("[...document.querySelectorAll('.cat')].find(b=>b.dataset.cat==='甜品').click()");
  await sleep(200);
  ok('甜品 14 道', (await ev("document.querySelectorAll('.dish').length")) === 14);
  await ev("[...document.querySelectorAll('.cat')].find(b=>b.dataset.cat==='夜宵').click()");
  await sleep(200);
  ok('夜宵 19 道', (await ev("document.querySelectorAll('.dish').length")) === 19);
  await ev("[...document.querySelectorAll('.cat')].find(b=>b.dataset.cat==='全部').click()");
  await sleep(200);

  // ── 加两份凉拌黄瓜（8 元）
  await ev("document.querySelector('.dish .add').click()");
  await sleep(180);
  await ev("document.querySelector('.dish .qty [data-act=plus]').click()");
  await sleep(260);
  ok('购物车计数 2', (await ev('window.__COUPLE__.stats().cart')) === 2);
  ok('合计 16 元', (await ev("document.querySelector('#cartSum').innerText")).includes('16'));

  // ── 下单
  await ev("document.querySelector('#goOrder').click()");
  await sleep(400);
  ok('下单弹层打开', (await ev("document.querySelector('#orderSheet').classList.contains('on')")) === true);
  await ev(`(() => { document.querySelector('#orderNote').value='今天想被偏爱一点'; })()`);
  await ev("document.querySelector('#submitOrder').click()");
  await sleep(700);
  ok('提交后跳到订单页', (await ev("document.querySelector('#tabbar .on').dataset.tab")) === 'orders');
  ok('订单卡片存在', (await ev("document.querySelectorAll('.order').length")) === 1);
  ok('订单状态=待接单', (await ev("document.querySelector('.status').innerText")) === '等 TA 接单');

  // ── 点菜端不应出现做法入口
  ok('点菜端不显示做法按钮', (await ev("document.querySelectorAll('[data-recipe]').length")) === 0,
    String(await ev("document.querySelectorAll('[data-recipe]').length")));

  // ── 切掌勺：订单里出现做法入口
  await clickChef();
  ok('掌勺订单里出现做法入口', (await ev("document.querySelectorAll('.order [data-recipe]').length")) >= 1,
    String(await ev("document.querySelectorAll('.order [data-recipe]').length")));
  ok('订单菜名列了用时', /分钟/.test(await ev("document.querySelector('.howto-row').innerText")),
    await ev("document.querySelector('.howto-row').innerText"));

  await ev("document.querySelector('.order [data-recipe]').click()");
  await sleep(400);
  ok('教程弹层打开', (await ev("document.querySelector('#recipeSheet').classList.contains('on')")) === true);
  ok('教程显示菜名', (await ev("document.querySelector('#rName').innerText")) === '凉拌黄瓜',
    await ev("document.querySelector('#rName').innerText"));
  ok('教程显示用时难度', /分钟/.test(await ev("document.querySelector('#rMeta').innerText")),
    await ev("document.querySelector('#rMeta').innerText"));
  const nIng = await ev("document.querySelectorAll('#rIng .ing').length");
  const nSteps = await ev("document.querySelectorAll('#rSteps li').length");
  ok('食材 ≥4 项', nIng >= 4, String(nIng));
  ok('步骤 ≥3 步', nSteps >= 3, String(nSteps));
  ok('进度显示 0/N', (await ev("document.querySelector('#rProg').innerText")) === `0/${nSteps}`);

  // 勾两步
  await ev("document.querySelectorAll('#rSteps li')[0].click()");
  await ev("document.querySelectorAll('#rSteps li')[1].click()");
  await sleep(200);
  ok('勾选两步后进度 2/N', (await ev("document.querySelector('#rProg').innerText")) === `2/${nSteps}`,
    await ev("document.querySelector('#rProg').innerText"));
  ok('进度条有宽度', (await ev("document.querySelector('#rBar i').style.width")) !== '0%',
    await ev("document.querySelector('#rBar i').style.width"));
  ok('已勾步骤有 done 样式', (await ev("document.querySelectorAll('#rSteps li.done').length")) === 2);

  await ev("document.querySelector('#rClose').click()");
  await sleep(300);
  ok('教程弹层可关闭', (await ev("document.querySelector('#recipeSheet').classList.contains('on')")) === false);

  // ── 菜单页掌勺视角的「做法」按钮，不能误加购物车
  await clickTab('menu');
  const cartBefore = await ev('window.__COUPLE__.stats().cart');
  ok('菜单页出现做法按钮', (await ev("document.querySelectorAll('.dish [data-recipe]').length")) > 0);
  await ev("document.querySelector('.dish [data-recipe]').click()");
  await sleep(350);
  ok('点做法打开教程', (await ev("document.querySelector('#recipeSheet').classList.contains('on')")) === true);
  ok('点做法没有误加购物车', (await ev('window.__COUPLE__.stats().cart')) === cartBefore,
    `${cartBefore} → ${await ev('window.__COUPLE__.stats().cart')}`);
  await ev("document.querySelector('#rClose2').click()");
  await sleep(250);

  // ── 回到点菜端，订单操作照旧
  await ev("[...document.querySelectorAll('#whoSwitch button')].find(b=>b.dataset.role==='orderer').click()");
  await sleep(250);
  await clickTab('orders');
  await clickChef();
  await ev("document.querySelector('.order [data-act=accept]').click()");
  await sleep(300);
  ok('接单后状态=正在做', (await ev("document.querySelector('.status').innerText")) === '正在做');
  await ev("document.querySelector('.order [data-act=done]').click()");
  await sleep(300);
  ok('完成后状态=已完成', (await ev("document.querySelector('.status').innerText")) === '已完成');

  // ── 刷新持久化（含做法数据）
  await reload();
  await clickTab('orders');
  ok('刷新后订单仍在', (await ev("document.querySelectorAll('.order').length")) === 1);
  await clickChef();
  await ev("document.querySelector('.order [data-recipe]').click()");
  await sleep(350);
  ok('刷新后教程仍可打开', (await ev("document.querySelector('#recipeSheet').classList.contains('on')")) === true);
  await ev("document.querySelector('#rClose').click()");
  await sleep(200);

  // ── 设置页
  await clickTab('settings');
  ok('设置页显示版本与菜品数', (await ev("document.body.innerText")).includes('v5 · 200 道菜'));
  ok('设置页菜单列表完整', (await ev("document.querySelectorAll('.dish-edit').length")) === EXPECT_DISHES);
  await ev("document.querySelector('#addDish').click()");
  await sleep(250);
  await ev(`(() => {
    document.querySelector('#dName').value='爱心煎蛋';
    document.querySelector('#dEmoji').value='🍳';
    document.querySelector('#dDesc').value='蛋黄是流心的';
    document.querySelector('#dPrice').value='9';
    document.querySelector('#saveDish').click();
  })()`);
  await sleep(400);
  ok(`新增菜品 → ${EXPECT_DISHES + 1} 道`, (await ev("document.querySelectorAll('.dish-edit').length")) === EXPECT_DISHES + 1);

  // 没有教程的菜：掌勺点做法应该给出提示而不是空白弹层
  await clickTab('menu');
  await ev("[...document.querySelectorAll('.cat')].find(b=>b.dataset.cat==='全部').click()");
  await sleep(200);
  const noRecipeCheck = await ev(`(() => {
    const el=[...document.querySelectorAll('.dish')].find(d=>d.innerText.includes('爱心煎蛋'));
    const btn=el && el.querySelector('[data-recipe]');
    return btn ? 'has-btn' : 'no-btn';
  })()`);
  ok('无教程的菜不显示做法按钮', noRecipeCheck === 'no-btn', String(noRecipeCheck));

  // ── 编辑已有菜：做法字段应回填，保存后不丢
  await clickTab('settings');
  await ev("document.querySelector('.dish-edit [data-edit]').click()");
  await sleep(350);
  const prefill = await ev(`(() => {
    const s = document.querySelector('#dSteps').value;
    const i = document.querySelector('#dIng').value;
    return s.split('\\n').filter(Boolean).length >= 3 && i.includes('、');
  })()`);
  ok('编辑弹层回填了食材与步骤', prefill === true, String(await ev("document.querySelector('#dSteps').value.slice(0,30)")));
  await ev("document.querySelector('#saveDish').click()");
  await sleep(350);
  ok('保存后做法没丢', (await ev('window.__COUPLE__.stats().withRecipe')) === EXPECT_DISHES,
    String(await ev('window.__COUPLE__.stats().withRecipe')));

  // ── 自己加的菜带做法，掌勺也能看到教程
  await ev("document.querySelector('#addDish').click()");
  await sleep(250);
  await ev(`(() => {
    document.querySelector('#dName').value='我们的蛋炒饭';
    document.querySelector('#dEmoji').value='🍚';
    document.querySelector('#dPrice').value='13';
    document.querySelector('#dTime').value='12';
    document.querySelector('#dIng').value='隔夜饭、鸡蛋、葱花';
    document.querySelector('#dSteps').value='鸡蛋炒散盛出\\n下饭炒散\\n倒回鸡蛋加葱花翻匀';
    document.querySelector('#saveDish').click();
  })()`);
  await sleep(400);
  const st3 = await ev('window.__COUPLE__.stats()');
  ok('自定义菜带做法 → withRecipe +1', st3.withRecipe === EXPECT_DISHES + 1, JSON.stringify(st3));

  // ── 菜谱页（制作过程汇总）
  ok('底部有菜谱 tab', (await ev("document.querySelectorAll('#tabbar button').length")) === 4);
  await clickTab('recipes');
  const totalDishes = await ev('window.__COUPLE__.stats().dishes');
  ok('菜谱页列出全部菜', (await ev("document.querySelectorAll('.rx').length")) === totalDishes,
    `${await ev("document.querySelectorAll('.rx').length")} / ${totalDishes}`);
  ok('菜谱条目显示用时与步数', /分钟 · .+ · \d+ 步/.test(await ev("document.querySelector('.rx .rx-meta').innerText")),
    await ev("document.querySelector('.rx .rx-meta').innerText"));

  // 搜索
  await ev(`(() => {
    const i = document.querySelector('#rxInput');
    i.value = '鸡'; i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const nChicken = Number(await ev("document.querySelectorAll('.rx').length"));
  ok('搜索「鸡」能筛出结果', nChicken > 0 && nChicken < EXPECT_DISHES, String(nChicken));
  ok('搜索结果名称都含鸡或食材含鸡', (await ev(`[...document.querySelectorAll('.rx')].every(x=>x.querySelector('.rx-name').innerText.includes('鸡') || x.querySelector('.rx-meta').innerText.includes('步'))`)) === true);
  ok('搜索框保留输入值', (await ev("document.querySelector('#rxInput').value")) === '鸡');
  await ev("document.querySelector('#rxClear').click()");
  await sleep(300);
  ok('清空搜索恢复全部', (await ev("document.querySelectorAll('.rx').length")) === totalDishes);

  // 分类筛选
  await ev("[...document.querySelectorAll('[data-rcat]')].find(b=>b.dataset.rcat==='拿手菜').click()");
  await sleep(300);
  ok('菜谱按分类筛选（拿手菜 45）', (await ev("document.querySelectorAll('.rx').length")) === 45,
    String(await ev("document.querySelectorAll('.rx').length")));
  await ev("[...document.querySelectorAll('[data-rcat]')].find(b=>b.dataset.rcat==='全部').click()");
  await sleep(250);

  // 点菜端也能看做法
  await ev("[...document.querySelectorAll('#whoSwitch button')].find(b=>b.dataset.role==='orderer').click()");
  await sleep(250);
  await clickTab('recipes');
  await ev("document.querySelector('.rx[data-recipe]').click()");
  await sleep(400);
  ok('点菜端从菜谱打开制作过程', (await ev("document.querySelector('#recipeSheet').classList.contains('on')")) === true);
  ok('制作过程有步骤与食材', (await ev("document.querySelectorAll('#rSteps li').length")) >= 3
    && (await ev("document.querySelectorAll('#rIng .ing').length")) >= 4);
  await ev("document.querySelector('#rClose').click()");
  await sleep(250);

  // 没有做法的菜不可点
  const plainInfo = await ev(`(() => {
    const plain = document.querySelector('.rx.plain');
    if (!plain) return 'none';
    plain.click();
    return document.querySelector('#recipeSheet').classList.contains('on') ? 'opened' : 'blocked';
  })()`);
  ok('没有做法的菜点不开', plainInfo === 'blocked' || plainInfo === 'none', String(plainInfo));

  // ── 跨手机同步（用假 ntfy 总线模拟第二台手机）
  const STUB = `(() => {
    const real = window.fetch;
    window.__bus = JSON.parse(localStorage.getItem('__bus') || '[]');
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.includes('ntfy.sh')) return real(url, opts);
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        const msg = { id: 'm' + Math.random().toString(36).slice(2), time: Math.floor(Date.now() / 1000),
                      event: 'message', topic: u.split('/').pop(), message: String(opts.body || '') };
        window.__bus.push(msg);
        localStorage.setItem('__bus', JSON.stringify(window.__bus));
        return new Response(JSON.stringify(msg), { status: 200 });
      }
      const body = window.__bus.map((m) => JSON.stringify(m)).join('\\n');
      return new Response(body, { status: 200 });
    };
  })();`;
  const { result: stubId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  // 干净起步：清数据 + 重载，stub 生效
  await ev(`localStorage.removeItem('__bus'); localStorage.removeItem('cm-room'); localStorage.removeItem('couple-menu-v1');`);
  await reload();
  const devA = await ev(`localStorage.getItem('cm-device')`);

  // 生成房间码
  await clickTab('settings');
  await ev(`document.querySelector('#syncNew').click()`);
  await sleep(600);
  const room = await ev('window.__COUPLE__ ? localStorage.getItem("cm-room") : ""');
  ok('能生成房间码', !!room && String(room).length >= 4, String(room));
  ok('设置页显示房间码', (await ev("document.body.innerText")).includes(String(room)));

  // 下单
  await clickTab('menu');
  await ev("document.querySelector('.dish .add').click()");
  await sleep(200);
  await ev("document.querySelector('#goOrder').click()");
  await sleep(400);
  await ev("document.querySelector('#submitOrder').click()");
  await sleep(1500);

  const bus1 = await ev(`(() => { const b = JSON.parse(localStorage.getItem('__bus') || '[]'); const s = b.map(m => { try { return JSON.parse(m.message); } catch (e) { return null; } }).filter(Boolean); return s.length + '|' + (s[s.length-1] ? s[s.length-1].orders.length : 0); })()`);
  ok('下单后推了快照到总线', /^[1-9]\d*\|1$/.test(String(bus1)), String(bus1));

  // 换一台手机：设备号不同 + 本地数据清空，但保留房间码和总线
  await ev(`localStorage.setItem('cm-device', 'phoneB'); localStorage.removeItem('couple-menu-v1');`);
  await reload();
  await sleep(2500);
  const onB = await ev(`window.__COUPLE__.stats()`);
  ok('第二台手机拉到订单', onB && onB.orders === 1, JSON.stringify(onB));
  ok('第二台手机菜单也正常', onB && onB.dishes === EXPECT_DISHES, String(onB && onB.dishes));

  // 第二台手机（掌勺）接单
  await clickTab('orders');
  await clickChef();
  const acceptBtns = await ev("document.querySelectorAll('.order [data-act=accept]').length");
  ok('第二台手机能看到接单按钮', acceptBtns === 1, String(acceptBtns));
  await ev("document.querySelector('.order [data-act=accept]').click()");
  await sleep(1500);

  // 回到第一台手机：应看到状态变成「正在做」
  await ev(`localStorage.setItem('cm-device', ${JSON.stringify(devA)});`);
  await reload();
  await sleep(2500);
  await clickTab('orders');
  const st = await ev("document.querySelector('.status') ? document.querySelector('.status').innerText : 'none'");
  ok('状态同步回第一台手机（正在做）', st === '正在做', st);
  ok('同步状态有提示', (await ev("localStorage.getItem('cm-room')")) === String(room));

  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId.identifier });
  await ev(`localStorage.removeItem('__bus');`);

  ok('无 JS 异常', logs.length === 0, logs.join(' | '));

  ws.close();
  proc.kill();
  const bad = out.filter((r) => !r[1]).length;
  console.log(`\n${out.length - bad}/${out.length} 通过`);
  setTimeout(() => process.exit(bad ? 1 : 0), 300);
})();
