'use strict';

/* ================= 状态 ================= */
const MAX_SCENES = 12;
let uidCounter = 0;
const uid = () => `s${Date.now().toString(36)}_${uidCounter++}`;

const state = {
  planId: null,
  mode: 'classic', // 'classic' | 'timed'
  timeLimit: 120,
  scenes: [], // classic: { id, name, props }；timed 额外带 { duration, required, value }
  constraints: { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] },
  replan: null, // 演出中重排状态：{ originalOrder, completedIds, currentProps, result }
};

const isTimed = () => state.mode === 'timed';

const $ = (sel) => document.querySelector(sel);
const sceneName = (id) => {
  const s = state.scenes.find(x => x.id === id);
  return s ? s.name : '（已删除）';
};
const sceneById = (id) => state.scenes.find(x => x.id === id) || null;

/* ================= 场景编辑 ================= */
function renderSceneHead() {
  const thead = $('#scene-thead');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  const cells = ['<th class="col-idx">#</th>', '<th>场景名称</th>', '<th>道具（用逗号分隔）</th>'];
  if (isTimed()) {
    cells.push('<th class="col-dur">时长(分)</th>', '<th class="col-req">必演</th>', '<th class="col-val">可选价值</th>');
  }
  cells.push('<th class="col-op"></th>');
  tr.innerHTML = cells.join('');
  thead.appendChild(tr);
}

function renderScenes() {
  renderSceneHead();
  const tbody = $('#scene-tbody');
  tbody.innerHTML = '';
  state.scenes.forEach((s, i) => {
    const tr = document.createElement('tr');

    const tdIdx = document.createElement('td');
    tdIdx.textContent = i + 1;

    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'scene-name';
    nameInput.value = s.name;
    nameInput.placeholder = `场景 ${i + 1}`;
    nameInput.addEventListener('input', () => {
      s.name = nameInput.value;
      renderConstraintForms(); // 名称变化同步到下拉框
    });
    tdName.appendChild(nameInput);

    const tdProps = document.createElement('td');
    const propsInput = document.createElement('input');
    propsInput.type = 'text';
    propsInput.className = 'scene-props';
    propsInput.value = s.props.join(', ');
    propsInput.placeholder = '如：长桌, 椅子, 烛台';
    propsInput.addEventListener('input', () => {
      s.props = propsInput.value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    });
    tdProps.appendChild(propsInput);

    const tds = [tdIdx, tdName, tdProps];

    if (isTimed()) {
      const tdDur = document.createElement('td');
      const durInput = document.createElement('input');
      durInput.type = 'number';
      durInput.className = 'scene-duration';
      durInput.min = '0';
      durInput.step = '1';
      durInput.value = s.duration ?? 0;
      durInput.addEventListener('input', () => {
        s.duration = Math.max(0, Math.floor(Number(durInput.value) || 0));
        updateRequiredHint();
      });
      tdDur.appendChild(durInput);

      const tdReq = document.createElement('td');
      const reqBox = document.createElement('input');
      reqBox.type = 'checkbox';
      reqBox.className = 'scene-required';
      reqBox.checked = !!s.required;
      reqBox.title = '勾选后该场景为必演项';
      reqBox.addEventListener('change', () => {
        s.required = reqBox.checked;
        if (s.required) {
          s.value = 0;
          valInput.value = 0;
        }
        valInput.disabled = s.required;
        valInput.title = s.required ? '必演场景不参与可选价值统计' : '入选时获得的价值';
        updateRequiredHint();
      });
      tdReq.appendChild(reqBox);

      const tdVal = document.createElement('td');
      const valInput = document.createElement('input');
      valInput.type = 'number';
      valInput.className = 'scene-value';
      valInput.min = '0';
      valInput.step = '1';
      valInput.value = s.value ?? 0;
      valInput.disabled = !!s.required;
      valInput.title = s.required ? '必演场景不参与可选价值统计' : '入选时获得的价值';
      valInput.addEventListener('input', () => {
        s.value = Math.max(0, Math.floor(Number(valInput.value) || 0));
      });
      tdVal.appendChild(valInput);

      tds.push(tdDur, tdReq, tdVal);
    }

    const tdOp = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-danger';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      state.scenes.splice(i, 1);
      // 清理引用该场景的约束
      const c = state.constraints;
      c.dependencies = c.dependencies.filter(d => d.before !== s.id && d.after !== s.id);
      c.fixedPositions = c.fixedPositions.filter(f => f.sceneId !== s.id);
      c.forbiddenAdjacencies = c.forbiddenAdjacencies.filter(f => f.a !== s.id && f.b !== s.id);
      renderAll();
    });
    tdOp.appendChild(del);
    tds.push(tdOp);

    tr.append(...tds);
    tbody.appendChild(tr);
  });

  $('#scene-count').textContent = `共 ${state.scenes.length} / ${MAX_SCENES} 个场景`;
  $('#btn-add-scene').disabled = state.scenes.length >= MAX_SCENES;
  updateRequiredHint();
}

function updateRequiredHint() {
  if (!isTimed()) return;
  const total = state.scenes.reduce((acc, s) => acc + (s.required ? (s.duration || 0) : 0), 0);
  const el = $('#required-duration-hint');
  el.textContent = `必演场景共 ${state.scenes.filter(s => s.required).length} 个，合计 ${total} 分钟（上限 ${state.timeLimit} 分钟）`;
  el.classList.toggle('hint-over', total > state.timeLimit);
}

/* ================= 模式切换 ================= */
function applyMode(mode) {
  state.mode = mode;
  document.querySelectorAll('input[name="mode"]').forEach(r => { r.checked = r.value === mode; });
  $('#timed-settings').hidden = !isTimed();
  $('#constraint-mode-hint').textContent = isTimed()
    ? '未入选场景不参与约束；固定序位按入选后的演出序列计算。'
    : '';
  if (isTimed()) {
    state.scenes.forEach(s => {
      if (s.duration === undefined) s.duration = 0;
      if (s.value === undefined) s.value = 0;
      if (s.required === undefined) s.required = false;
    });
  }
  $('#result-card').hidden = true;
  $('#replan-card').hidden = true;
  state.replan = null;
  renderAll();
}

/* ================= 约束编辑 ================= */
function fillSelect(sel, selectedId) {
  sel.innerHTML = '';
  for (const s of state.scenes) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name || '(未命名)';
    sel.appendChild(opt);
  }
  if (selectedId && state.scenes.some(s => s.id === selectedId)) sel.value = selectedId;
}

function renderConstraintForms() {
  fillSelect($('#dep-form [data-role="before"]'));
  fillSelect($('#dep-form [data-role="after"]'));
  fillSelect($('#fixed-form [data-role="scene"]'));
  fillSelect($('#noadj-form [data-role="a"]'));
  fillSelect($('#noadj-form [data-role="b"]'));
  const posInput = $('#fixed-form [data-role="position"]');
  posInput.max = Math.max(1, state.scenes.length);
  renderConstraintLists();
}

function renderConstraintLists() {
  const depList = $('#dep-list');
  depList.innerHTML = '';
  state.constraints.dependencies.forEach((d, i) => {
    depList.appendChild(constraintItem(
      `「${sceneName(d.before)}」必须在「${sceneName(d.after)}」之前`,
      () => { state.constraints.dependencies.splice(i, 1); renderConstraintLists(); }
    ));
  });

  const fixedList = $('#fixed-list');
  fixedList.innerHTML = '';
  state.constraints.fixedPositions.forEach((f, i) => {
    fixedList.appendChild(constraintItem(
      `「${sceneName(f.sceneId)}」固定在第 ${f.position} 位`,
      () => { state.constraints.fixedPositions.splice(i, 1); renderConstraintLists(); }
    ));
  });

  const noadjList = $('#noadj-list');
  noadjList.innerHTML = '';
  state.constraints.forbiddenAdjacencies.forEach((f, i) => {
    noadjList.appendChild(constraintItem(
      `「${sceneName(f.a)}」与「${sceneName(f.b)}」禁止相邻`,
      () => { state.constraints.forbiddenAdjacencies.splice(i, 1); renderConstraintLists(); }
    ));
  });
}

function constraintItem(text, onRemove) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = text;
  const del = document.createElement('button');
  del.className = 'btn btn-sm btn-danger';
  del.textContent = '✕';
  del.addEventListener('click', onRemove);
  li.append(span, del);
  return li;
}

function renderAll() {
  renderScenes();
  renderConstraintForms();
}

/* ================= 求解 ================= */
function payload() {
  const base = {
    mode: state.mode,
    scenes: state.scenes.map(s => {
      const out = { id: s.id, name: s.name.trim(), props: s.props };
      if (isTimed()) {
        out.duration = s.duration || 0;
        out.required = !!s.required;
        out.value = s.required ? 0 : (s.value || 0);
      }
      return out;
    }),
    constraints: state.constraints,
  };
  if (isTimed()) base.timeLimit = state.timeLimit;
  return base;
}

async function api(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function showStatus(msg, isError) {
  const el = $('#status-line');
  el.textContent = msg;
  el.style.color = isError ? '#ffb3b0' : '';
}

async function doSolve() {
  $('#result-card').hidden = true;
  $('#replan-card').hidden = true;
  state.replan = null;
  const data = await api('/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload()),
  });
  const box = $('#result');
  box.innerHTML = '';
  $('#result-card').hidden = false;

  if (data.errors) {
    box.appendChild(errorBlock(data.errors));
    return;
  }
  if (!data.ok) {
    box.appendChild(conflictBlock(data.conflict, data.reason === 'required-overtime'));
    return;
  }
  box.appendChild(data.mode === 'timed' ? timedResultBlock(data) : resultBlock(data));
  openReplanPanel(data.order, data);
  $('#result-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function errorBlock(errors) {
  const div = document.createElement('div');
  div.className = 'conflict-box';
  const h = document.createElement('h3');
  h.textContent = '输入有误';
  const ul = document.createElement('ul');
  ul.className = 'error-list';
  for (const e of errors) {
    const li = document.createElement('li');
    li.textContent = e;
    ul.appendChild(li);
  }
  div.append(h, ul);
  return div;
}

function conflictBlock(conflict, isOvertime) {
  const div = document.createElement('div');
  div.className = 'conflict-box';
  const h = document.createElement('h3');
  h.textContent = isOvertime ? '⚠ 无解：必演场景已超时' : '⚠ 无解：约束相互冲突';
  const p = document.createElement('p');
  p.textContent = conflict.message;
  div.append(h, p);
  if (conflict.constraints && conflict.constraints.length) {
    const ul = document.createElement('ul');
    for (const c of conflict.constraints) {
      const li = document.createElement('li');
      li.textContent = c.text;
      ul.appendChild(li);
    }
    div.appendChild(ul);
  }
  return div;
}

function flowBlock(order, offset = 0) {
  const flow = document.createElement('div');
  flow.className = 'order-flow';
  if (!order.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = '（无入选场景，节目单为空）';
    flow.appendChild(empty);
    return flow;
  }
  order.forEach((id, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'order-arrow';
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
    const s = sceneById(id);
    const chip = document.createElement('span');
    chip.className = 'order-chip' + (s && s.required ? ' order-chip-req' : '');
    chip.textContent = `${i + 1 + offset}. ${sceneName(id)}${s && s.required ? ' ★必演' : ''}`;
    flow.appendChild(chip);
  });
  return flow;
}

function stepsBlock(data) {
  const frag = document.createDocumentFragment();
  const total = document.createElement('p');
  total.className = 'total-line';
  total.innerHTML = `道具增减总次数：<strong>${data.totalCost}</strong> 次（含开场布置，下同）`;
  frag.appendChild(total);

  const h = document.createElement('h3');
  h.textContent = '换景明细';
  frag.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'step-list';
  data.steps.forEach((step, i) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'step-title';
    if (step.type === 'setup') {
      title.textContent = `开场布置 →「${sceneName(step.scene)}」`;
    } else {
      title.textContent = `换景 ${i}：「${sceneName(step.from)}」→「${sceneName(step.to)}」`;
    }
    li.appendChild(title);

    const detail = document.createElement('div');
    const parts = [];
    if (step.removed.length) {
      parts.push(`<span class="prop-del">撤下：${escapeHtml(step.removed.join('、'))}</span>`);
    }
    if (step.added.length) {
      parts.push(`<span class="prop-add">上台：${escapeHtml(step.added.join('、'))}</span>`);
    }
    if (!parts.length) parts.push('<span class="prop-none">道具无变化</span>');
    detail.innerHTML = parts.join('　｜　') + `　<span class="step-count">（${step.count} 次）</span>`;
    li.appendChild(detail);
    ul.appendChild(li);
  });
  frag.appendChild(ul);
  return frag;
}

function resultBlock(data) {
  const frag = document.createDocumentFragment();
  frag.appendChild(flowBlock(data.order));
  frag.appendChild(stepsBlock(data));
  return frag;
}

function sceneListBlock(title, ids, cls) {
  const wrap = document.createElement('div');
  wrap.className = 'scene-pick ' + (cls || '');
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  if (!ids.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '无';
    wrap.appendChild(p);
    return wrap;
  }
  const ul = document.createElement('ul');
  ul.className = 'pick-list';
  ids.forEach(id => {
    const s = sceneById(id);
    const li = document.createElement('li');
    const tags = [];
    if (s) {
      tags.push(`${s.duration} 分钟`);
      if (s.required) tags.push('必演');
      else tags.push(`价值 ${s.value || 0}`);
    }
    li.innerHTML = `<strong>${escapeHtml(sceneName(id))}</strong><span class="hint">${escapeHtml(tags.join(' · '))}</span>`;
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  return wrap;
}

function timedResultBlock(data) {
  const frag = document.createDocumentFragment();

  const summary = document.createElement('div');
  summary.className = 'timed-summary';
  summary.innerHTML =
    `<span>入选可选场景价值：<strong>${data.totalValue}</strong></span>` +
    `<span>已用时长：<strong>${data.usedDuration}</strong> / ${data.timeLimit} 分钟</span>` +
    `<span>剩余时长：<strong>${data.remainingDuration}</strong> 分钟</span>` +
    `<span>道具增减：<strong>${data.totalCost}</strong> 次</span>`;
  frag.appendChild(summary);

  frag.appendChild(flowBlock(data.order));
  frag.appendChild(sceneListBlock(`入选场景（${data.selectedIds.length} 个）`, data.selectedIds, 'pick-in'));
  frag.appendChild(sceneListBlock(`舍弃场景（${data.excludedIds.length} 个，不参与约束）`, data.excludedIds, 'pick-out'));
  frag.appendChild(stepsBlock(data));
  return frag;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ================= 演出中重排 ================= */
function currentPropsFromOrder(order, k) {
  if (k <= 0) return [];
  const s = sceneById(order[k - 1]);
  return s ? s.props.slice() : [];
}

/** 打开重排卡片。order 为当前可依据的完整顺序；existing 为已保存的重排状态（载入方案时）。 */
function openReplanPanel(order, existing) {
  const card = $('#replan-card');
  if (!order || !order.length) { card.hidden = true; return; }
  card.hidden = false;
  if (existing) {
    state.replan = {
      originalOrder: existing.originalOrder.slice(),
      completedIds: existing.completedIds.slice(),
      currentProps: (existing.currentProps || []).slice(),
      result: existing.result || null,
    };
  } else {
    state.replan = {
      originalOrder: order.slice(),
      completedIds: [],
      currentProps: [],
      result: null,
    };
  }
  const kInput = $('#replan-k');
  kInput.max = existing && state.replan.result ? state.replan.result.order.length : order.length;
  if (existing) {
    kInput.value = state.replan.completedIds.length;
  } else {
    const k0 = Math.min(1, order.length);
    kInput.value = k0;
    state.replan.completedIds = order.slice(0, k0);
    state.replan.currentProps = currentPropsFromOrder(order, k0);
  }
  syncReplanK(false);
  renderReplanResult();
}

/** 根据 k 输入同步 completedIds 与道具输入框 */
function syncReplanK(resetProps) {
  if (!state.replan) return;
  const order = state.replan.result ? state.replan.result.order : state.replan.originalOrder;
  const kInput = $('#replan-k');
  let k = Math.floor(Number(kInput.value) || 0);
  k = Math.max(0, Math.min(k, order.length));
  kInput.value = k;
  state.replan.completedIds = order.slice(0, k);
  if (resetProps) {
    state.replan.currentProps = currentPropsFromOrder(order, k);
  }
  $('#replan-props').value = state.replan.currentProps.join(', ');
  renderPrefixPreview(order, k);
}

function renderPrefixPreview(order, k) {
  const wrap = $('#replan-prefix-preview');
  wrap.innerHTML = '';
  if (!order.length) return;
  const mkChip = (id, i, cls) => {
    const chip = document.createElement('span');
    chip.className = 'order-chip ' + cls;
    chip.textContent = `${i + 1}. ${sceneName(id)}`;
    return chip;
  };
  const arrow = () => {
    const a = document.createElement('span');
    a.className = 'order-arrow';
    a.textContent = '→';
    return a;
  };
  order.forEach((id, i) => {
    if (i > 0) wrap.appendChild(arrow());
    wrap.appendChild(mkChip(id, i, i < k ? 'order-chip-done' : 'order-chip-todo'));
  });
  const legend = document.createElement('p');
  legend.className = 'hint';
  legend.textContent = k === 0
    ? '尚未确认已完成场次，将按空舞台重排全场。'
    : `已完成 ${k} 场（灰色锁定，顺序不可改变），剩余 ${order.length - k} 场参与重排。`;
  wrap.appendChild(legend);
}

async function doReplan() {
  if (!state.replan) { showStatus('请先计算最优顺序', true); return; }
  syncReplanK(false);
  state.replan.currentProps = $('#replan-props').value.split(/[,，]/).map(x => x.trim()).filter(Boolean);

  const body = {
    ...payload(),
    originalOrder: state.replan.originalOrder,
    completedIds: state.replan.completedIds,
    currentProps: state.replan.currentProps,
  };
  const data = await api('/api/replan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const box = $('#replan-result');
  box.innerHTML = '';
  if (data.errors) {
    box.appendChild(errorBlock(data.errors));
    return;
  }
  if (!data.ok) {
    const isOvertime = data.reason === 'prefix-overtime' || data.reason === 'required-overtime';
    box.appendChild(conflictBlock(data.conflict, isOvertime));
    return;
  }
  state.replan.result = data;
  // 重排后继续以新完整顺序为基准，已完成前缀保持不变
  state.replan.originalOrder = data.order.slice();
  renderReplanResult();
  const kInput = $('#replan-k');
  kInput.max = data.order.length;
  kInput.value = data.prefixIds.length;
  syncReplanK(false); // 不重置道具：保留用户录入的当前实际道具
  showStatus('已按当前舞台实际情况重排剩余场景，保存后可继续重排');
}

function renderReplanResult() {
  const box = $('#replan-result');
  box.innerHTML = '';
  const r = state.replan && state.replan.result;
  if (!r) return;
  box.appendChild(replanSummaryBlock(r));

  const cols = document.createElement('div');
  cols.className = 'replan-cols';
  cols.appendChild(replanColumn('原计划后缀', r.plannedSuffixIds, r.plannedSteps, r.prefixIds.length, 'col-plan'));
  cols.appendChild(replanColumn('重排后新后缀', r.suffixIds, r.newSteps, r.prefixIds.length, 'col-new'));
  box.appendChild(cols);

  if (r.mode === 'timed') {
    box.appendChild(replanAbandonedBlock(r));
  }

  const full = document.createElement('div');
  full.className = 'replan-full';
  const h = document.createElement('h3');
  h.textContent = '重排后完整节目单（已完成前缀锁定）';
  full.appendChild(h);
  const flow = document.createElement('div');
  flow.className = 'order-flow';
  const appendChip = (id, i, cls) => {
    if (flow.children.length) {
      const a = document.createElement('span');
      a.className = 'order-arrow';
      a.textContent = '→';
      flow.appendChild(a);
    }
    const chip = document.createElement('span');
    chip.className = 'order-chip ' + cls;
    chip.textContent = `${i + 1}. ${sceneName(id)}`;
    flow.appendChild(chip);
  };
  r.prefixIds.forEach((id, i) => appendChip(id, i, 'order-chip-done'));
  r.suffixIds.forEach((id, i) => appendChip(id, r.prefixIds.length + i, 'order-chip-todo'));
  full.appendChild(flow);
  box.appendChild(full);
}

function replanSummaryBlock(r) {
  const div = document.createElement('div');
  div.className = 'timed-summary';
  const deltaCls = r.costDelta < 0 ? 'cost-save' : (r.costDelta > 0 ? 'cost-add' : 'cost-same');
  const deltaText = r.costDelta === 0
    ? '增减 0 次'
    : (r.costDelta < 0 ? `减少 ${-r.costDelta} 次` : `增加 ${r.costDelta} 次`);
  let html =
    `<span>原计划后缀换景：<strong>${r.plannedSuffixCost}</strong> 次</span>` +
    `<span>新后缀换景：<strong>${r.newSuffixCost}</strong> 次</span>` +
    `<span class="${deltaCls}">相对原计划：<strong>${deltaText}</strong></span>`;
  if (r.mode === 'timed') {
    html +=
      `<span>前缀已用：<strong>${r.prefixDuration}</strong> 分 / 价值 <strong>${r.prefixValue}</strong></span>` +
      `<span>后缀时长：<strong>${r.suffixDuration}</strong> 分 / 价值 <strong>${r.suffixValue}</strong></span>` +
      `<span>整场已用：<strong>${r.usedDuration}</strong> / ${r.timeLimit} 分（剩 ${r.remainingDuration} 分）</span>`;
  }
  div.innerHTML = html;
  return div;
}

function replanColumn(title, ids, steps, offset, cls) {
  const col = document.createElement('div');
  col.className = 'replan-col ' + cls;
  const h = document.createElement('h3');
  h.textContent = title + (ids.length ? `（${ids.length} 场）` : '（空）');
  col.appendChild(h);
  col.appendChild(flowBlock(ids, offset));
  if (!ids.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '无剩余场景';
    col.appendChild(p);
    return col;
  }
  const ul = document.createElement('ul');
  ul.className = 'step-list';
  steps.forEach((step) => {
    const li = document.createElement('li');
    const t = document.createElement('div');
    t.className = 'step-title';
    if (step.type === 'setup') {
      t.textContent = `开场布置 →「${sceneName(step.scene)}」`;
    } else if (step.type === 'rejoin' && step.fromCurrent) {
      t.textContent = `从当前实际道具换入 →「${sceneName(step.scene)}」`;
    } else if (step.type === 'rejoin') {
      t.textContent = `接演：「${sceneName(step.from)}」→「${sceneName(step.to)}」`;
    } else {
      t.textContent = `「${sceneName(step.from)}」→「${sceneName(step.to)}」`;
    }
    li.appendChild(t);
    const detail = document.createElement('div');
    const parts = [];
    if (step.removed.length) parts.push(`<span class="prop-del">撤下：${escapeHtml(step.removed.join('、'))}</span>`);
    if (step.added.length) parts.push(`<span class="prop-add">上台：${escapeHtml(step.added.join('、'))}</span>`);
    if (!parts.length) parts.push('<span class="prop-none">道具无变化</span>');
    detail.innerHTML = parts.join('　｜　') + `　<span class="step-count">（${step.count} 次）</span>`;
    li.appendChild(detail);
    ul.appendChild(li);
  });
  col.appendChild(ul);
  return col;
}

function replanAbandonedBlock(r) {
  const forced = r.forcedOutIds || [];
  const abandoned = r.abandonedIds || [];
  if (!forced.length && !abandoned.length) {
    const wrap = document.createElement('div');
    wrap.className = 'scene-pick pick-out';
    wrap.innerHTML = '<h3>舍弃场景</h3><p class="hint">无</p>';
    return wrap;
  }
  const wrap = document.createElement('div');
  wrap.className = 'scene-pick pick-out';
  const h = document.createElement('h3');
  h.textContent = '舍弃场景';
  wrap.appendChild(h);
  const ul = document.createElement('ul');
  ul.className = 'pick-list';
  for (const id of forced) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${escapeHtml(sceneName(id))}</strong><span class="hint">强制舍弃：${escapeHtml(r.forcedOutReasons[id] || '按完成事实无法参演')}</span>`;
    ul.appendChild(li);
  }
  for (const id of abandoned) {
    const s = sceneById(id);
    const tags = s ? [`${s.duration} 分钟`, `价值 ${s.value || 0}`] : [];
    const li = document.createElement('li');
    li.innerHTML = `<strong>${escapeHtml(sceneName(id))}</strong><span class="hint">剩余选择中舍弃（${escapeHtml(tags.join(' · '))}）</span>`;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

/* ================= 方案保存 / 载入 ================= */
async function refreshPlans() {
  const data = await api('/api/plans');
  const sel = $('#plan-select');
  sel.innerHTML = '<option value="">— 选择已保存的方案 —</option>';
  for (const p of data.plans) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.inProgress ? '🎬 ' : ''}${p.name}（${p.sceneCount} 个场景${p.inProgress ? '，演出中' : ''}，更新于 ${new Date(p.updatedAt).toLocaleString()}）`;
    sel.appendChild(opt);
  }
  if (state.planId) sel.value = state.planId;
}

async function savePlan() {
  const name = $('#plan-name').value.trim();
  if (!name) { showStatus('请先填写方案名称', true); return; }
  const base = { name, ...payload() };
  // 仅在已确认过完成前缀或已得到重排结果时持久化重排状态
  if (state.replan && (state.replan.completedIds.length > 0 || state.replan.result)) {
    base.replan = {
      originalOrder: state.replan.originalOrder,
      completedIds: state.replan.completedIds,
      currentProps: state.replan.currentProps,
      currentOrder: state.replan.result ? state.replan.result.order : state.replan.originalOrder,
      result: state.replan.result,
    };
  }
  const body = JSON.stringify(base);
  const headers = { 'Content-Type': 'application/json' };
  const data = state.planId
    ? await api(`/api/plans/${state.planId}`, { method: 'PUT', headers, body })
    : await api('/api/plans', { method: 'POST', headers, body });
  if (data.errors) { showStatus(data.errors.join('；'), true); return; }
  state.planId = data.plan.id;
  showStatus(`方案「${name}」已保存${base.replan ? '（含演出中重排进度，载入后可继续重排）' : ''}`);
  await refreshPlans();
}

async function loadPlan() {
  const id = $('#plan-select').value;
  if (!id) { showStatus('请先选择要载入的方案', true); return; }
  const data = await api(`/api/plans/${id}`);
  if (!data.ok) { showStatus(data.errors.join('；'), true); return; }
  hydrateFromPlan(data.plan);
  $('#plan-name').value = data.plan.name;
  $('#result-card').hidden = true;
  showStatus(`已载入方案「${data.plan.name}」，可继续编辑`);
}

function hydrateFromPlan(p) {
  state.planId = p.id;
  state.mode = p.mode === 'timed' ? 'timed' : 'classic';
  state.timeLimit = Number(p.timeLimit) || 120;
  state.scenes = p.scenes.map(s => ({
    id: s.id,
    name: s.name,
    props: (s.props || []).slice(),
    duration: Number(s.duration) || 0,
    required: !!s.required,
    value: Number(s.value) || 0,
  }));
  state.constraints = {
    dependencies: (p.constraints.dependencies || []).map(d => ({ ...d })),
    fixedPositions: (p.constraints.fixedPositions || []).map(f => ({ ...f })),
    forbiddenAdjacencies: (p.constraints.forbiddenAdjacencies || []).map(f => ({ ...f })),
  };
  $('#time-limit').value = state.timeLimit;
  applyMode(state.mode);
  // 恢复演出中重排进度
  state.replan = null;
  $('#replan-card').hidden = true;
  if (p.replan && Array.isArray(p.replan.completedIds) && Array.isArray(p.replan.currentOrder)) {
    const order = p.replan.currentOrder;
    openReplanPanel(order, {
      originalOrder: p.replan.originalOrder && p.replan.originalOrder.length ? p.replan.originalOrder : order,
      completedIds: p.replan.completedIds,
      currentProps: p.replan.currentProps || [],
      result: p.replan.result || null,
    });
  }
}

async function deletePlan() {
  const id = $('#plan-select').value;
  if (!id) { showStatus('请先选择要删除的方案', true); return; }
  if (!confirm('确定删除该方案？')) return;
  await api(`/api/plans/${id}`, { method: 'DELETE' });
  if (state.planId === id) state.planId = null;
  showStatus('方案已删除');
  await refreshPlans();
}

function newPlan() {
  state.planId = null;
  state.scenes = [];
  state.constraints = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
  state.replan = null;
  $('#plan-name').value = '';
  $('#plan-select').value = '';
  applyMode('classic');
  $('#result-card').hidden = true;
  $('#replan-card').hidden = true;
  showStatus('已新建空白方案');
}

/* ================= 示例数据 ================= */
function loadSample() {
  newPlan();
  const ids = ['sc1', 'sc2', 'sc3', 'sc4', 'sc5'];
  state.scenes = [
    { id: ids[0], name: '序幕·市集', props: ['摊位', '灯笼', '布幔'] },
    { id: ids[1], name: '王宫大殿', props: ['王座', '立柱', '灯笼', '地毯'] },
    { id: ids[2], name: '森林夜话', props: ['树木', '石头', '月光布'] },
    { id: ids[3], name: '牢房', props: ['铁栏', '锁链', '石头'] },
    { id: ids[4], name: '终幕·庆典', props: ['灯笼', '地毯', '花篮', '彩带'] },
  ];
  state.constraints = {
    dependencies: [
      { before: ids[0], after: ids[1] },
      { before: ids[2], after: ids[3] },
    ],
    fixedPositions: [{ sceneId: ids[4], position: 5 }],
    forbiddenAdjacencies: [{ a: ids[1], b: ids[2] }],
  };
  $('#plan-name').value = '示例剧目';
  applyMode('classic');
  showStatus('已载入示例数据，可直接点击「计算最优顺序」');
}

function loadTimedSample() {
  newPlan();
  const ids = ['t1', 't2', 't3', 't4', 't5', 't6'];
  state.scenes = [
    { id: ids[0], name: '开场·群舞',   props: ['灯', '幕'],         duration: 10, required: true,  value: 0 },
    { id: ids[1], name: '独唱',         props: ['灯', '椅'],         duration: 8,  required: false, value: 6 },
    { id: ids[2], name: '魔术',         props: ['箱', '灯'],         duration: 12, required: false, value: 10 },
    { id: ids[3], name: '短剧',         props: ['桌', '椅', '树'],   duration: 20, required: false, value: 8 },
    { id: ids[4], name: '互动环节',     props: ['话筒'],             duration: 10, required: false, value: 4 },
    { id: ids[5], name: '终场·合唱',   props: ['灯', '幕', '花'],   duration: 10, required: true,  value: 0 },
  ];
  state.constraints = {
    dependencies: [{ before: ids[0], after: ids[5] }],
    fixedPositions: [],
    forbiddenAdjacencies: [{ a: ids[0], b: ids[5] }],
  };
  state.timeLimit = 55;
  $('#time-limit').value = 55;
  $('#plan-name').value = '时长受限示例';
  applyMode('timed');
  showStatus('已载入时长受限示例：必演 20 分钟，上限 55 分钟，试试取舍可选场景');
}

/* ================= 事件绑定 ================= */
$('#btn-add-scene').addEventListener('click', () => {
  if (state.scenes.length >= MAX_SCENES) return;
  const s = { id: uid(), name: '', props: [] };
  if (isTimed()) { s.duration = 0; s.required = false; s.value = 0; }
  state.scenes.push(s);
  renderAll();
});
$('#btn-sample').addEventListener('click', loadSample);
$('#btn-sample-timed').addEventListener('click', loadTimedSample);
$('#btn-solve').addEventListener('click', doSolve);
$('#btn-save').addEventListener('click', savePlan);
$('#btn-load').addEventListener('click', loadPlan);
$('#btn-delete').addEventListener('click', deletePlan);
$('#btn-new').addEventListener('click', newPlan);

document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener('change', () => applyMode(r.value));
});
$('#time-limit').addEventListener('input', () => {
  state.timeLimit = Math.max(1, Math.floor(Number($('#time-limit').value) || 0));
  updateRequiredHint();
});

$('#btn-add-dep').addEventListener('click', () => {
  const before = $('#dep-form [data-role="before"]').value;
  const after = $('#dep-form [data-role="after"]').value;
  if (!before || !after) return;
  state.constraints.dependencies.push({ before, after });
  renderConstraintLists();
});
$('#btn-add-fixed').addEventListener('click', () => {
  const sceneId = $('#fixed-form [data-role="scene"]').value;
  const position = Number($('#fixed-form [data-role="position"]').value);
  if (!sceneId || !Number.isInteger(position)) return;
  state.constraints.fixedPositions.push({ sceneId, position });
  renderConstraintLists();
});
$('#btn-add-noadj').addEventListener('click', () => {
  const a = $('#noadj-form [data-role="a"]').value;
  const b = $('#noadj-form [data-role="b"]').value;
  if (!a || !b) return;
  state.constraints.forbiddenAdjacencies.push({ a, b });
  renderConstraintLists();
});

/* 演出中重排 */
$('#btn-replan').addEventListener('click', doReplan);
$('#replan-k').addEventListener('input', () => syncReplanK(true));
$('#replan-props').addEventListener('input', () => {
  if (state.replan) {
    state.replan.currentProps = $('#replan-props').value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  }
});

/* ================= 初始化 ================= */
applyMode('classic');
refreshPlans();
