'use strict';

const path = require('path');
const express = require('express');
const { solve, replan, MAX_SCENES, normalizeProps } = require('./solver');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** 校验并规范化 { mode, timeLimit, scenes, constraints }，返回 { errors, mode, timeLimit, scenes, constraints } */
function validatePayload(body) {
  const errors = [];
  const rawMode = body && body.mode;
  if (rawMode !== undefined && rawMode !== 'classic' && rawMode !== 'timed') {
    errors.push(`未知的编排模式：${String(rawMode)}`);
  }
  const mode = rawMode === 'timed' ? 'timed' : 'classic';

  // 整场时长上限（仅 timed 模式使用）
  let timeLimit = Number(body && body.timeLimit);
  if (mode === 'timed') {
    if (!Number.isFinite(timeLimit) || !Number.isInteger(timeLimit) || timeLimit <= 0) {
      errors.push('整场时长上限必须是正整数（分钟）');
      timeLimit = 0;
    }
  } else if (Number.isFinite(timeLimit) && timeLimit >= 0) {
    timeLimit = timeLimit;
  } else {
    timeLimit = 0;
  }

  const rawScenes = body && body.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    errors.push('至少需要 1 个场景');
  }
  const scenes = [];
  if (Array.isArray(rawScenes)) {
    if (rawScenes.length > MAX_SCENES) errors.push(`场景数量不能超过 ${MAX_SCENES} 个`);
    const ids = new Set();
    rawScenes.forEach((s, i) => {
      const id = String((s && s.id) ?? `s${i + 1}`);
      const name = String((s && s.name) ?? '').trim();
      if (!name) errors.push(`第 ${i + 1} 个场景缺少名称`);
      if (ids.has(id)) errors.push(`场景 id 重复：${id}`);
      ids.add(id);

      const scene = { id, name, props: normalizeProps(s && s.props) };
      if (mode === 'timed') {
        const duration = Number(s && s.duration);
        if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration < 0) {
          errors.push(`场景「${name || id}」的时长必须是非负整数（分钟）`);
        } else {
          scene.duration = duration;
        }
        scene.required = !!(s && s.required);
        const value = Number(s && s.value);
        scene.value = (!scene.required && Number.isFinite(value) && value > 0) ? Math.floor(value) : 0;
      }
      scenes.push(scene);
    });
  }

  const idSet = new Set(scenes.map(s => s.id));
  const c = (body && body.constraints) || {};
  const dependencies = [];
  const fixedPositions = [];
  const forbiddenAdjacencies = [];

  for (const d of c.dependencies || []) {
    if (!idSet.has(d.before) || !idSet.has(d.after)) {
      errors.push('依赖约束引用了不存在的场景');
      continue;
    }
    dependencies.push({ before: d.before, after: d.after });
  }
  for (const f of c.fixedPositions || []) {
    const pos = Number(f.position);
    if (!idSet.has(f.sceneId)) {
      errors.push('固定序位约束引用了不存在的场景');
      continue;
    }
    if (!Number.isInteger(pos) || pos < 1 || pos > scenes.length) {
      errors.push(`固定序位必须是 1 到 ${scenes.length} 之间的整数`);
      continue;
    }
    fixedPositions.push({ sceneId: f.sceneId, position: pos });
  }
  for (const f of c.forbiddenAdjacencies || []) {
    if (!idSet.has(f.a) || !idSet.has(f.b)) {
      errors.push('禁止相邻约束引用了不存在的场景');
      continue;
    }
    forbiddenAdjacencies.push({ a: f.a, b: f.b });
  }

  return {
    errors,
    mode,
    timeLimit,
    scenes,
    constraints: { dependencies, fixedPositions, forbiddenAdjacencies },
  };
}

/**
 * 校验并规范化演出中重排状态（随方案一起持久化的部分）。
 * 结构：{ completedIds: string[], currentProps: string[],
 *         originalOrder: string[], currentOrder: string[], result?: object }
 * 非法字段直接丢弃；返回 null 表示无重排状态。
 */
function normalizeReplan(body) {
  const raw = body && body.replan;
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.completedIds) || !Array.isArray(raw.currentOrder)) return null;

  const out = {
    completedIds: raw.completedIds.map(x => String(x)),
    currentProps: normalizeProps(raw.currentProps),
    originalOrder: Array.isArray(raw.originalOrder) ? raw.originalOrder.map(x => String(x)) : [],
    currentOrder: raw.currentOrder.map(x => String(x)),
  };
  if (raw.result && typeof raw.result === 'object') out.result = raw.result;
  return out;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/solve', (req, res) => {
  const { errors, mode, timeLimit, scenes, constraints } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  res.json(solve(scenes, constraints, { mode, timeLimit }));
});

/** 演出中重排：确认已完成前缀 + 当前舞台实际道具，只重排剩余场景 */
app.post('/api/replan', (req, res) => {
  const { errors, mode, timeLimit, scenes, constraints } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });

  const b = req.body || {};
  const replanErrors = [];
  const originalOrder = Array.isArray(b.originalOrder) ? b.originalOrder.map(x => String(x)) : null;
  const completedIds = Array.isArray(b.completedIds) ? b.completedIds.map(x => String(x)) : null;
  if (!originalOrder) replanErrors.push('缺少原计划顺序 originalOrder');
  if (!completedIds) replanErrors.push('缺少已完成场景 completedIds');
  if (replanErrors.length) return res.status(400).json({ ok: false, errors: replanErrors });

  const idSet = new Set(scenes.map(s => s.id));
  if (originalOrder.some(id => !idSet.has(id))) {
    return res.status(400).json({ ok: false, errors: ['原计划顺序包含不存在的场景'] });
  }
  if (new Set(originalOrder).size !== originalOrder.length) {
    return res.status(400).json({ ok: false, errors: ['原计划顺序存在重复场景'] });
  }
  if (completedIds.some(id => !idSet.has(id))) {
    return res.status(400).json({ ok: false, errors: ['已完成场景包含不存在的场景'] });
  }
  if (new Set(completedIds).size !== completedIds.length) {
    return res.status(400).json({ ok: false, errors: ['已完成场景存在重复'] });
  }

  const result = replan(scenes, constraints, {
    mode,
    timeLimit,
    originalOrder,
    completedIds,
    currentProps: b.currentProps,
  });
  if (result.errors) return res.status(400).json({ ok: false, errors: result.errors });
  res.json(result);
});

app.get('/api/plans', (req, res) => {
  res.json({ plans: store.list() });
});

app.post('/api/plans', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ ok: false, errors: ['方案名称不能为空'] });
  const { errors, mode, timeLimit, scenes, constraints } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  const replanState = normalizeReplan(req.body);
  const plan = store.create({ name, mode, timeLimit, scenes, constraints, replan: replanState });
  res.status(201).json({ ok: true, plan });
});

app.get('/api/plans/:id', (req, res) => {
  const plan = store.get(req.params.id);
  if (!plan) return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  res.json({ ok: true, plan });
});

app.put('/api/plans/:id', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ ok: false, errors: ['方案名称不能为空'] });
  const { errors, mode, timeLimit, scenes, constraints } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  const replanState = normalizeReplan(req.body);
  const plan = store.update(req.params.id, { name, mode, timeLimit, scenes, constraints, replan: replanState });
  if (!plan) return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  res.json({ ok: true, plan });
});

app.delete('/api/plans/:id', (req, res) => {
  if (!store.remove(req.params.id)) {
    return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`舞台换景顺序优化服务已启动: http://localhost:${PORT}`);
});
