/* 碗粿張餐車版：以桌號點餐，支援前台、廚房與營運管理。 */
(() => {
  table = 1; // 舊版購物車元件會檢查 table；畫面與 API 都不顯示／使用桌號。
  const style = document.createElement('style');
  style.textContent = `
    .truck-orders{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
    .truck-order{min-width:0;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .truck-order-head{padding:15px;background:#edf3eb;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    .truck-order-head strong{font-size:24px;line-height:1.25;color:var(--green)}
    .truck-order-body{padding:6px 16px}
    .truck-line{padding:12px 0;border-bottom:1px solid var(--line)}
    .truck-order-actions{padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--line)}
    .truck-slot{font-size:12px;color:var(--muted)}
    .truck-order .serve-line{padding:12px 0}
    .truck-empty{grid-column:1/-1}
    .truck-confirm{border:2px solid var(--green);border-radius:14px;padding:18px;background:#f4f8f3}
    .truck-confirm-number{font-size:34px;font-weight:800;color:var(--green)}
    @media(max-width:1000px){.truck-orders{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:700px){.truck-orders{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.truck-order-head{padding:12px}.truck-order-body{padding:4px 12px}.truck-order-head strong{font-size:20px}}
    @media(max-width:420px){.truck-orders{grid-template-columns:1fr}}
    .platform-credit{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:12px;color:var(--green);font-size:14px;font-weight:700}
    .platform-credit img{width:30px;height:30px;object-fit:contain}
    .pickup-header-group{display:flex;flex-direction:column;align-items:flex-end;gap:3px;max-width:min(100%,420px)}
    .pickup-reminder{display:block;color:#b42318;font-size:12px;font-weight:700;line-height:1.35;text-align:right;white-space:normal}
  `;
  document.head.appendChild(style);

  const ticketBase = 'ukcqrcode-truck-ticket:' + rootUrl.pathname + ':';
  const ticketLegacy = 'ukcqrcode-truck-ticket-v1:' + rootUrl.pathname + ':';
  let latestDate = today();
  let latestTicket = 0;
  let latestRequestId = '';
  let readyForPickup = false;

  function clearOldTickets() {
    const date = today();
    const key = ticketBase + date;
    if (date !== latestDate) {
      latestDate = date;
      latestTicket = 0;
      latestRequestId = '';
      readyForPickup = false;
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const storedKey = localStorage.key(i);
        if (storedKey?.startsWith(ticketLegacy) || (storedKey?.startsWith(ticketBase) && storedKey !== key)) {
          localStorage.removeItem(storedKey);
        }
      }
    } catch {}
    return key;
  }

  function loadTicket() {
    try {
      const raw = localStorage.getItem(clearOldTickets());
      if (!raw) { latestTicket = 0; latestRequestId = ''; readyForPickup = false; return; }
      const value = JSON.parse(raw);
      if (value && typeof value === 'object') {
        latestTicket = Number(value.serial) || 0;
        latestRequestId = typeof value.requestId === 'string' ? value.requestId : '';
        readyForPickup = value.ready === true;
      } else {
        latestTicket = Number(value) || 0;
        latestRequestId = '';
        readyForPickup = false;
      }
    } catch { latestTicket = 0; latestRequestId = ''; readyForPickup = false; }
  }
  loadTicket();

  function rememberTicket(serial, requestId) {
    if (!Number.isSafeInteger(serial) || serial < 1) return;
    const key = clearOldTickets();
    latestTicket = serial;
    latestRequestId = requestId;
    readyForPickup = false;
    try { localStorage.setItem(key, JSON.stringify({serial, requestId, ready:false, day:latestDate})); } catch {}
  }

  function savedTicket() { loadTicket(); return latestTicket; }
  function pickupMarkup() {
    const serial = savedTicket();
    const stateText = serial ? (readyForPickup ? '可取餐' : '製作中') : '送單後顯示';
    return '<div class="pickup-display ' + (readyForPickup ? 'pickup-ready' : '') + '" aria-live="polite"><span>你的單號</span><strong>' + (serial ? String(serial).padStart(4, '0') : '—') + '</strong><small>' + stateText + '</small></div>';
  }
  function updatePickupMarkup() {
    const current = document.querySelector('.pickup-display');
    if (current) current.outerHTML = pickupMarkup();
  }
  async function refreshPickupStatus() {
    const serial = savedTicket();
    if (!serial || !/^[a-zA-Z0-9-]{16,64}$/.test(latestRequestId)) return;
    try {
      const result = await api('/api/order/status?requestId=' + encodeURIComponent(latestRequestId));
      const nextSerial = Number(result.serial), nextReady = result.ready === true;
      if (nextSerial !== latestTicket || nextReady !== readyForPickup) {
        latestTicket = nextSerial;
        readyForPickup = nextReady;
        localStorage.setItem(clearOldTickets(), JSON.stringify({serial:latestTicket,requestId:latestRequestId,ready:readyForPickup,day:latestDate}));
        updatePickupMarkup();
      }
    } catch {}
  }

  function showSavedTickets() {
    const serial = savedTicket();
    modal('<h2>我的取餐號碼</h2><p>今日最新送單紀錄</p>' +
      (serial ? '<p><strong>' + String(serial).padStart(4, '0') + '</strong></p>' :
        '<p>今日尚無已儲存的取餐號碼。</p>') +
      '<div class="modal-actions"><button class="btn" data-action="close">關閉</button></div>');
  }

  header = function () {
    return '<header class="app-header"><a class="brand" href="/"><img class="brand-logo" src="./brand-logo.svg" alt="碗粿張標誌"><div><strong>碗粿張</strong><small>北屯昌平・傳統古早味</small></div></a><div class="header-right">' +
      (path === '/' ? '<div class="pickup-header-group">' + pickupMarkup() + '<small class="pickup-reminder">隨時注意取餐狀況，關閉重掃 QR Code</small></div>' : '<span class="subtle">餐車營運管理</span>' + connection() + '<button class="link-button" data-action="logout">登出</button>') +
      '</div></header>';
  };

  billTitle = b => b.preorder_channel === 'phone' ? '電話預購' : b.preorder_channel === 'web' ? '網路預購' : '取餐號碼 ' + String(b.serial ?? b.id ?? '').padStart(4, '0') + ' · ' + diningLabel(b);

  let diningMode = '';
  let diningTable = '';
  function diningReady() {
    return diningMode === 'takeaway' || (diningMode === 'dine_in' && /^[1-9]\d*$/.test(diningTable) && Number.isSafeInteger(Number(diningTable)) && Number(diningTable) <= 2147483647);
  }
  function diningControls() {
    const radio = (value, label) => '<label><input type="radio" name="dining-mode" value="' + value + '"' + (diningMode === value ? ' checked' : '') + '> ' + label + '</label>';
    return '<fieldset' + (busy ? ' disabled' : '') + '><legend>用餐方式（必選）</legend>' + radio('takeaway','外帶') + '　' + radio('dine_in','內用') +
      (diningMode === 'dine_in' ? '<div><label>內用桌號 <input id="dining-table" inputmode="numeric" pattern="[1-9][0-9]*" required value="' + esc(diningTable) + '"></label></div>' : '') + '</fieldset>';
  }
  document.addEventListener('change', event => {
    if (event.target.name !== 'dining-mode') return;
    diningMode = event.target.value;
    diningTable = '';
    $('#cart').innerHTML = cartContent();
    $('#dining-table')?.focus();
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'dining-table') return;
    diningTable = event.target.value.trim();
    $('#cart [data-action="submit"]').disabled = !diningReady() || !state.cart.length || busy || !state.online || state.cloudReady === false;
  });

  cartContent = function () {
    return '<div class="cart-head"><h2>我的點餐清單</h2>' +
      (state.drawer ? '<button class="link-button" data-action="drawer">關閉</button>' : '') +
      '</div>' +
      (state.cart.length ? state.cart.map((x, i) =>
        '<div class="cart-item"><strong>' + esc(x.name) + '</strong><div class="row"><div class="qty"><button aria-label="減少" data-qty="' + i + '" data-delta="-1">−</button><span>' + x.qty + '</span><button aria-label="增加" data-qty="' + i + '" data-delta="1">+</button></div><b>' + money(x.price * x.qty) + '</b></div><button class="link-button" data-note="' + i + '">' + (x.note ? '備註：' + esc(x.note) : '新增餐點備註') + '</button></div>'
      ).join('') : '<div class="cart-empty"><span class="empty-icon">🍲</span><strong>還沒有選餐</strong>請從餐點清單加入餐點</div>') +
      diningControls() + '<div class="cart-total row"><span>合計</span><strong class="price">' + money(cartTotal()) + '</strong></div>' +
      '<button class="btn" data-action="submit" ' + (state.cloudReady === false || !diningReady() || !state.cart.length || busy || !state.online ? 'disabled' : '') + '>' + (busy ? '送單中…' : '送出訂單') + '</button>' +
      '<div class="cart-note">送單後請記下畫面上的取餐號碼，至櫃檯依號結帳。</div>' +
      (state.cart.length ? '' : '');
  };

  renderGuest = function () {
    document.body.classList.add('guest-ordering');
    const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
    $('#app').innerHTML = header() +
      (state.cloudReady === false ? '<div role="status" style="padding:16px;text-align:center;background:#fff1d6;color:#704812;font-size:18px">系統準備中，暫時不能送出訂單。</div>' : '') +
      '<div class="guest-layout"><aside class="categories"><div class="eyebrow">MENU</div><h3>選擇餐點</h3><div class="category-picker"><label for="category-choice">餐點分類</label><select id="category-choice">' +
      categories.map(c => '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '</select></div><div class="category-foot">選好餐點後送出訂單，記下取餐號碼，再至櫃檯結帳。</div></aside><main>' +
      '<section class="hero"><div class="hero-copy"><div class="eyebrow">TAICHUNG · TRADITIONAL TAIWANESE FOOD</div><h1>一碗古早味，<br>慢慢品台灣。</h1><p>碗粿張，把熟悉的米香端上桌。</p><span class="pill" style="display:inline-block;margin-top:13px;background:#ffffffb8;font-size:12px">傳統碗粿 · 台灣米食 · 暖心湯品</span></div></section>' +
      '<div class="section-heading"><h2 id="menu-heading">' + esc(state.category) + '</h2><input class="search" id="search" placeholder="搜尋餐點" aria-label="搜尋餐點" value="' + esc(state.query) + '"></div>' +
      '<div class="menu-grid" id="menu-grid">' + foodCards() + '</div><footer class="developer-credit"><span>碗粿張 QR 點餐・<a href="https://www.facebook.com/profile.php?id=61551696695325" target="_blank" rel="noopener">官方粉絲專頁</a>・<a href="https://maps.google.com/?q=24.1651821,120.6940609" target="_blank" rel="noopener">Google 地圖</a></span><span class="platform-credit"><img src="./platform-logo.svg" alt=""><strong>碼上有單數位整合</strong></span></footer></main>' +
      '<aside id="cart" class="cart ' + (state.drawer ? 'show' : '') + '">' + cartContent() + '</aside></div>' +
      '<button class="mobile-cart" data-action="drawer"><span>我的點餐清單・' + count + ' 項</span><strong>' + money(cartTotal()) + '</strong></button>';
  };

  submitOrder = async function () {
    if (busy || !state.cart.length || !diningReady()) return;
    const dining = {dining_mode:diningMode, dining_table:diningMode === 'dine_in' ? Number(diningTable) : null};
    busy = true; renderGuest();
    const orderItems = state.cart.map(x => ({ id:x.id, qty:x.qty, note:x.note || '', price:x.price }));
    try {
      const requestId = newId();
      const result = await api('/api/order', { requestId, items:orderItems, ...dining });
      rememberTicket(result.serial, requestId);
      diningMode = ''; diningTable = ''; state.cart = []; persist(); state.drawer = false;
      modal('<div class="truck-confirm"><h2>訂單已送出</h2><p>' + esc(diningLabel(dining)) + '</p><div>請記下您的取餐號碼</div><div class="truck-confirm-number">' + esc(String(result.serial).padStart(4,'0')) + '</div><hr>' +
        orderItems.map(x => { const p=state.menu.find(y=>y.id===x.id); return '<div class="row"><span>' + esc(p?.name || '') + ' × ' + x.qty + (x.note ? '<div class="note">' + esc(x.note) + '</div>' : '') + '</span><b>' + money((p?.price || x.price) * x.qty) + '</b></div>'; }).join('') +
        '<div class="row" style="margin-top:14px"><strong>合計</strong><strong>' + money(orderItems.reduce((sum,x)=>sum+x.price*x.qty,0)) + '</strong></div><p class="checkout-reminder">訂單待付款／待櫃檯確認；確認收款後廚房才會出單</p></div><div class="modal-actions"><button class="btn" data-action="close">完成</button></div>');
    } catch (error) {
      toast(error.message);
      if (error.status === 409) {
        const latest=await api('/api/menu'); state.menu=latest.menu;
        state.cart=state.cart.map(x=>({...x,price:latest.menu.find(p=>p.id===x.id)?.price ?? x.price})); persist();
      }
    } finally { busy=false; renderGuest(); }
  };

  function latestOrders(kitchenView) {
    return grouped().filter(order => !kitchenView || order.status === 'paid' || order.preorder_channel === 'phone').sort((a,b)=>Number(b.serial||0)-Number(a.serial||0)).slice(0,10);
  }

  function orderCard(order, kitchenView) {
    const allServed=order.lines.every(line=>Number(line.served)===1 || line.served===true);
    const paid=order.status==='paid';
    return '<article class="truck-order"><div class="truck-order-head"><div><strong>' + esc(billTitle(order)) + (order.preorder_channel ? ' · ' + esc(order.pickup_code || '') : '') + '</strong><div class="truck-slot">' + (order.preorder_channel === 'phone' ? '客人電話 · 電話預購' : order.preorder_channel === 'web' ? '網路預購取餐碼' : '') + (order.preorder_channel ? '<br>' : '') + time(order.opened_at) + '</div></div><div><span class="status ' + (paid?'done':'') + '">' + (paid?'已結帳':'待付款') + '</span><br><span class="status ' + (allServed?'done':'') + '">' + (allServed?'已出餐':'製作中') + '</span></div></div><div class="truck-order-body">' +
      order.lines.map(line => !kitchenView ?
        '<div class="serve-line"><input type="checkbox" id="serve-' + esc(line.line_id) + '" data-serve="' + esc(line.line_id) + '" ' + (line.served?'checked':'') + (paid?'':' disabled title="請先確認收款"') + '><label for="serve-' + esc(line.line_id) + '"><strong class="' + (line.served?'done-name':'') + '">' + esc(line.name) + ' × ' + line.qty + '</strong>' + (line.note?'<div class="note">' + esc(line.note) + '</div>':'') + '</label></div>' :
        '<div class="truck-line"><div class="row"><span>' + esc(line.name) + ' × ' + line.qty + '</span><b>' + money(line.price*line.qty) + '</b></div>' + (line.note?'<div class="note">' + esc(line.note) + '</div>':'') + '<div class="subtle">' + (line.served?'已出餐':'待出餐') + '</div></div>'
      ).join('') +
      '<div class="row" style="padding:12px 0"><strong>合計</strong><strong class="price">' + money(order.total) + '</strong></div></div><div class="truck-order-actions">' +
      (!kitchenView ? (paid ? '<span class="status done">結帳完成</span>' : '<button class="btn small" data-checkout="' + esc(order.id) + '">' + (order.preorder_channel === 'phone' ? '電話預購結帳' : '取餐號碼結帳') + '</button>') : '<span class="subtle">勾選餐點更新出餐狀態</span>') +
      '<button class="btn small danger" data-truck-delete="' + esc(order.id) + '">移除訂單</button></div></article>';
  }

  function orderBoard(kitchenView) {
    const orders=latestOrders(kitchenView);
    const title=kitchenView?'廚房出餐':'前台結帳';
    const emptyText=kitchenView?'付款確認後，廚房訂單會顯示在這裡。':'客人送出訂單後會顯示在這裡。';
    return pageTop(title,'最新訂單固定顯示在第一格，畫面保留最近 10 張。','<span class="pill">目前 ' + orders.length + ' / 10 張</span>') +
      '<div class="truck-orders">' + (orders.length ? orders.map(o=>orderCard(o,kitchenView)).join('') : '<div class="panel empty truck-empty"><span class="empty-icon">🍲</span><h3>目前沒有訂單</h3>' + emptyText + '</div>') + '</div>';
  }
  cashier = () => orderBoard(false);
  kitchen = () => orderBoard(true);
  qrcodes = function () {
    const cards=[{key:'guest',title:'餐車點餐',href:'/'},{key:'cashier',title:'前台結帳',href:'/cashier'},{key:'kitchen',title:'廚房出餐',href:'/kitchen'}];
    return pageTop('QR Code','餐車顧客使用第一張 QR Code 點餐。','<button class="btn" data-action="print">列印 QR Code</button>') +
      '<div class="qr-grid">' + cards.map(c=>{const href=siteHref(c.href),image='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qrSvg(href));return '<article class="qr-card"><h2>'+c.title+'</h2><img class="qrcode" src="'+image+'" alt="'+c.title+' QR Code"><p>'+esc(href)+'</p><div class="actions"><a class="btn small secondary" href="'+image+'" download="'+c.key+'.svg">下載 SVG</a><a class="btn small ghost" href="'+href+'" target="_blank" rel="noopener">開啟</a></div></article>';}).join('') + '</div>';
  };

  const baseRefresh=refresh;
  refresh = async function () {
    // Do not poll protected endpoints or replace the login form before authentication.
    if (polling || (path !== '/' && !state.role)) return; polling=true;
    try {
      if (path==='/cashier' || path==='/kitchen') {
        const result=await api('/api/board');
        if (JSON.stringify(result.rows)!==JSON.stringify(state.rows)) { state.rows=result.rows; if(!$('#modal').innerHTML) render(); }
      } else if (path==='/') {
        await refreshPickupStatus();
      } else { polling=false; return baseRefresh(); }
      if(!state.online){state.online=true;render();}
    } catch(error) {
      if(error.status===401&&path!=='/'){state.role=null;render();}
      else if(state.online){state.online=false;render();}
    } finally {polling=false;}
  };

  document.addEventListener('click', async event => {
    if (path === '/' && event.target.closest('[data-truck-tickets]')) {
      showSavedTickets();
      return;
    }
    const button=event.target.closest('[data-truck-delete]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!confirm('移除這張訂單的前台與廚房顯示？訂單紀錄仍保留供報表查詢。'))return;
    try { await api('/api/order/archive',{billId:button.dataset.truckDelete}); await refresh(); render(); }
    catch(error){toast(error.message);}
  }, true);

  const originalToast=toast;
  toast=function(message){return originalToast(message);};
})();
