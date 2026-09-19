'use strict';

/**
 * 求解器：在全部约束下，求道具增减次数最少的场景演出顺序。
 *
 * 两种编排模式：
 *  - classic（默认，经典编排）：全部场景必须参演，仅最小化道具增减次数。
 *  - timed（时长受限编排）：场景带时长 duration、必演标记 required、可选价值 value，
 *    并给定整场时长上限 timeLimit。从场景中选择一个包含全部必演项的子集参演，
 *    按依赖 / 固定序位 / 禁止相邻约束编排；未入选场景不参与任何约束，
 *    固定序位按"入选后的演出序列"计算。
 *
 * timed 模式目标（字典序）：
 *    1. 最大化入选可选场景的价值总和；
 *    2. 最小化道具增减次数（开场布置 + 各次换景撤下/上台之和）；
 *    3. 同分时保持确定顺序（子集掩码升序、场景下标升序）。
 *
 * 约束类型：
 *  - dependencies:        [{ before, after }]   before 必须排在 after 之前（二者都入选时生效）
 *  - fixedPositions:      [{ sceneId, position }] 场景固定在第 position 位（1 起，按入选序列计）
 *  - forbiddenAdjacencies:[{ a, b }]            a 与 b 不得相邻（二者都入选时生效）
 *
 * 算法：n <= 12。
 *  - classic：子集 DP（Held-Karp 风格），状态 (已排集合, 末尾场景)，O(2^n * n^2)。
 *  - timed：单个全局子集 DP 同时求出所有入选子集的最优排列——按"末尾场景在
 *    集合内无后继、固定序位等于集合长度-1"刻画可行性，未入选场景的约束自然
 *    失效，固定序位自动按入选序列位置计算；最后在含全部必演项且不超时的
 *    子集中按价值最高、代价最低择优。复杂度同样 O(2^n * n^2)。
 */

const MAX_SCENES = 12;

function normalizeProps(props) {
  const out = [];
  const seen = new Set();
  for (const p of props || []) {
    const s = String(p).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 把输入编译成位掩码/矩阵模型，供 DP 使用。 */
function buildModel(scenes, constraints) {
  const n = scenes.length;
  const index = new Map();
  scenes.forEach((s, i) => index.set(s.id, i));
  const propSets = scenes.map(s => new Set(normalizeProps(s.props)));

  // prereq[i]: 必须排在 i 之前的场景位掩码
  const prereq = new Array(n).fill(0);
  for (const d of (constraints && constraints.dependencies) || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    prereq[b] |= (1 << a);
  }

  // 固定序位（position 为 1 起，内部转 0 起）
  const fixedPosOfScene = new Array(n).fill(-1);
  const sceneAtPos = new Array(n).fill(-1);
  // fixedMask[i]：场景 i 被固定到的全部序位（同一场景可存在多条固定约束）
  const fixedMask = new Array(n).fill(0);
  for (const f of (constraints && constraints.fixedPositions) || []) {
    const i = index.get(f.sceneId);
    if (i === undefined) continue;
    const p = Number(f.position) - 1;
    if (p < 0 || p >= n) continue;
    fixedPosOfScene[i] = p;
    fixedMask[i] |= (1 << p);
    sceneAtPos[p] = i; // 若两个场景固定同一序位，DP 必然无解，由冲突分析给出核心
  }

  // 禁止相邻矩阵（对称）
  const bad = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) {
    const a = index.get(f.a);
    const b = index.get(f.b);
    if (a === undefined || b === undefined || a === b) continue;
    bad[a][b] = bad[b][a] = true;
  }

  // 换景代价：对称差大小
  const cost = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let c = 0;
      for (const p of propSets[i]) if (!propSets[j].has(p)) c++;
      for (const p of propSets[j]) if (!propSets[i].has(p)) c++;
      cost[i][j] = c;
    }
  }
  const setupCost = propSets.map(s => s.size);

  // timed 模式附加字段（必演场景不参与可选价值统计）
  const durations = scenes.map(s => Number(s.duration) || 0);
  const values = scenes.map(s => (s.required ? 0 : (Number(s.value) || 0)));
  let requiredMask = 0;
  scenes.forEach((s, i) => { if (s.required) requiredMask |= (1 << i); });

  return {
    n, propSets, prereq, fixedPosOfScene, fixedMask, sceneAtPos, bad, cost, setupCost,
    durations, values, requiredMask,
  };
}

/** 子集 DP。返回 { cost, orderIdx } 或 null（无解）。要求全部 n 个场景都排入。 */
function runDP(model) {
  const { n, prereq, fixedPosOfScene, sceneAtPos, bad, cost, setupCost } = model;
  const fullMask = (1 << n) - 1;
  const size = 1 << n;
  const dp = new Array(size);
  const parent = new Array(size);

  const allowedAt = (j, pos) =>
    (fixedPosOfScene[j] === -1 || fixedPosOfScene[j] === pos) &&
    (sceneAtPos[pos] === -1 || sceneAtPos[pos] === j);

  const ensure = (m) => {
    if (!dp[m]) {
      dp[m] = new Array(n).fill(Infinity);
      parent[m] = new Array(n).fill(-1);
    }
  };

  for (let j = 0; j < n; j++) {
    if (prereq[j] !== 0) continue;      // 有前置依赖的场景不能排首位
    if (!allowedAt(j, 0)) continue;
    const m = 1 << j;
    ensure(m);
    dp[m][j] = setupCost[j];
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    const row = dp[mask];
    if (!row) continue;
    const pos = popcount(mask); // 下一位的序位（0 起）
    if (pos >= n) continue;
    for (let last = 0; last < n; last++) {
      const cur = row[last];
      if (cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (mask & bit) continue;
        if ((prereq[j] & ~mask) !== 0) continue; // 前置依赖必须已全部排入
        if (!allowedAt(j, pos)) continue;
        if (bad[last][j]) continue;
        const nm = mask | bit;
        const nc = cur + cost[last][j];
        ensure(nm);
        if (nc < dp[nm][j]) { // 严格小于：保证结果确定性（按下标字典序取先到达者）
          dp[nm][j] = nc;
          parent[nm][j] = last;
        }
      }
    }
  }

  const fullRow = dp[fullMask];
  if (!fullRow) return null;
  let best = Infinity;
  let bestLast = -1;
  for (let last = 0; last < n; last++) {
    if (fullRow[last] < best) {
      best = fullRow[last];
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;

  const orderIdx = [];
  let mask = fullMask;
  let last = bestLast;
  while (true) {
    orderIdx.push(last);
    const p = parent[mask][last];
    if (p === -1) break;
    mask ^= (1 << last);
    last = p;
  }
  orderIdx.reverse();
  return { cost: best, orderIdx };
}

/**
 * timed 模式：单个全局子集 DP，同时求出每个入选子集 M 的最优排列代价。
 *
 * 关键刻画（按最终入选集合 M 归纳）：M 的一个排列可行，当且仅当：
 *  - 末尾场景 last 在 M 内没有"必须排在它之后"的场景（succ[last] & M\\{last} = ∅）；
 *  - last 的固定序位为 -1 或 |M|-1；
 *  - 倒数第二个场景与 last 不构成禁止相邻；
 *  - 去掉 last 后，前缀集合 M\\{last} 自身可行。
 * 这样涉及"未入选场景"的依赖 / 固定序位 / 相邻约束全部自然失效，
 * 固定序位也天然按"入选后的序列位置"（popcount）计算。
 *
 * 状态 dp[mask][last] = 恰好排列 mask、以 last 结尾的最小总代价（含开场布置）。
 * 一次 DP 得到全部 2^n 个子集的答案，复杂度 O(2^n * n^2)。
 *
 * 最后在所有 mask ⊇ requiredMask、总时长 ≤ timeLimit 的候选中，
 * 取价值最高、代价最低者；同分时按掩码升序、末尾下标升序保持确定性。
 * 无必演场景时空集（空节目单）作为 value=0、cost=0 的保底可行解。
 */
function runTimedDP(model, timeLimit) {
  const { n, prereq, fixedMask, bad, cost, setupCost, durations, values, requiredMask } = model;
  const fullMask = (1 << n) - 1;

  // fixedAt(j, p)：场景 j 可在序位 p 出现 ⇔ 它没有固定约束，或恰好固定在 p
  const fixedAt = (j, p) => {
    const fm = fixedMask[j];
    return fm === 0 || fm === (1 << p);
  };

  // succMask[a]：必须排在 a 之后的场景集合
  const succMask = new Array(n).fill(0);
  for (let b = 0; b < n; b++) {
    let m = prereq[b];
    while (m) {
      const bit = m & -m;
      const a = 31 - Math.clz32(bit);
      succMask[a] |= (1 << b);
      m ^= bit;
    }
  }

  // 预计算每个子集的总时长与总价值
  const durSum = new Float64Array(1 << n);
  const valSum = new Float64Array(1 << n);
  for (let m = 1; m <= fullMask; m++) {
    const bit = m & -m;
    const i = 31 - Math.clz32(bit);
    const pm = m ^ bit;
    durSum[m] = durSum[pm] + durations[i];
    valSum[m] = valSum[pm] + values[i];
  }

  const size = 1 << n;
  const dp = new Array(size);
  const parent = new Array(size);
  const ensure = (m) => {
    if (!dp[m]) {
      dp[m] = new Float64Array(n).fill(Infinity);
      parent[m] = new Int8Array(n).fill(-1);
    }
  };

  // 单元素集合：该场景没有固定约束，或恰好固定在第 0 位
  for (let j = 0; j < n; j++) {
    if (!fixedAt(j, 0)) continue;
    const m = 1 << j;
    ensure(m);
    dp[m][j] = setupCost[j];
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    const row = dp[mask];
    if (!row) continue;
    const posAfter = popcount(mask); // 追加后新场景所在序位（0 起）
    for (let last = 0; last < n; last++) {
      const bit = 1 << last;
      if (mask & bit) continue;
      const nm = mask | bit;
      if (!fixedAt(last, posAfter)) continue;
      // last 在最终集合 nm 内不能还有必须排在其后的场景
      if (succMask[last] & mask) continue;
      let best = Infinity;
      let bestPrev = -1;
      for (let prev = 0; prev < n; prev++) {
        const v = row[prev];
        if (v === Infinity) continue;
        if (bad[prev][last]) continue;
        const nc = v + cost[prev][last];
        if (nc < best) { best = nc; bestPrev = prev; } // prev 升序，严格小于 → 确定
      }
      if (bestPrev !== -1) {
        ensure(nm);
        // (nm,last) 的前缀集合唯一（nm\{last}），这里只会写入一次；保留严格比较以防万一
        if (best < dp[nm][last]) {
          dp[nm][last] = best;
          parent[nm][last] = bestPrev;
        }
      }
    }
  }

  // 无必演项时，空节目单是保底解（价值 0，代价 0）
  let best = requiredMask === 0
    ? { cost: 0, orderIdx: [], value: 0, usedDuration: 0, mask: 0, last: -1 }
    : null;

  for (let mask = 0; mask <= fullMask; mask++) {
    if ((mask & requiredMask) !== requiredMask) continue;
    if (durSum[mask] > timeLimit) continue;
    const row = dp[mask];
    if (!row) continue;
    let last = -1;
    let c = Infinity;
    for (let j = 0; j < n; j++) {
      if (row[j] < c) { c = row[j]; last = j; }
    }
    if (last === -1) continue;
    const value = valSum[mask];
    const take = !best
      || value > best.value
      || (value === best.value && c < best.cost);
    // 价值、代价都相同：保留先到达者（mask 升序）→ 结果确定
    if (take) best = { cost: c, value, usedDuration: durSum[mask], mask, last };
  }
  if (!best) return null;

  const orderIdx = [];
  let mask = best.mask;
  let last = best.last;
  while (last !== -1) {
    orderIdx.push(last);
    const prev = parent[mask][last];
    mask ^= (1 << last);
    last = prev;
  }
  orderIdx.reverse();
  return { cost: best.cost, orderIdx, value: best.value, usedDuration: best.usedDuration, mask: best.mask };
}

/** 检测依赖环，返回构成环的依赖约束数组，无环返回 null。 */
function findDepCycle(scenes, deps) {
  const index = new Map(scenes.map((s, i) => [s.id, i]));
  const adj = scenes.map(() => []);
  for (const d of deps || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    adj[a].push({ to: b, dep: d });
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array(scenes.length).fill(WHITE);
  const stack = [];
  let result = null;

  function dfs(u) {
    color[u] = GRAY;
    stack.push(u);
    for (const e of adj[u]) {
      if (result) return;
      if (color[e.to] === GRAY) {
        const start = stack.indexOf(e.to);
        const nodes = stack.slice(start).concat([e.to]);
        const cyc = [];
        for (let k = 0; k < nodes.length - 1; k++) {
          const edge = adj[nodes[k]].find(x => x.to === nodes[k + 1]);
          cyc.push(edge.dep);
        }
        result = cyc;
        return;
      }
      if (color[e.to] === WHITE) dfs(e.to);
    }
    stack.pop();
    color[u] = BLACK;
  }

  for (let i = 0; i < scenes.length && !result; i++) {
    if (color[i] === WHITE) dfs(i);
  }
  return result;
}

function describeConstraint(scenes, kind, data) {
  const name = (id) => {
    const s = scenes.find(x => x.id === id);
    return s ? s.name : String(id);
  };
  if (kind === 'dependency') {
    return { kind, data, text: `「${name(data.before)}」必须排在「${name(data.after)}」之前` };
  }
  if (kind === 'fixedPosition') {
    return { kind, data, text: `「${name(data.sceneId)}」固定在第 ${data.position} 位` };
  }
  return { kind, data, text: `「${name(data.a)}」与「${name(data.b)}」禁止相邻` };
}

/**
 * 经典模式无解时给出一组可复现的冲突约束：
 * 1. 若依赖存在环，直接返回环上的依赖（本身即最小冲突）；
 * 2. 否则做贪心极小化：逐条尝试移除约束，若仍无解则永久移除，
 *    剩余集合即为"去掉任意一条即可有解"的极小冲突核心。
 */
function analyzeConflict(scenes, constraints) {
  const cycle = findDepCycle(scenes, (constraints && constraints.dependencies) || []);
  if (cycle) {
    return {
      type: 'dependency-cycle',
      message: '场景依赖关系存在循环，无法排出满足全部先后约束的顺序：',
      constraints: cycle.map(d => describeConstraint(scenes, 'dependency', d)),
    };
  }

  const all = [];
  for (const d of (constraints && constraints.dependencies) || []) all.push({ kind: 'dependency', data: d });
  for (const f of (constraints && constraints.fixedPositions) || []) all.push({ kind: 'fixedPosition', data: f });
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) all.push({ kind: 'forbiddenAdjacency', data: f });

  const satisfiable = (items) => {
    const c = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
    for (const it of items) {
      if (it.kind === 'dependency') c.dependencies.push(it.data);
      else if (it.kind === 'fixedPosition') c.fixedPositions.push(it.data);
      else c.forbiddenAdjacencies.push(it.data);
    }
    return runDP(buildModel(scenes, c)) !== null;
  };

  let core = all.slice();
  for (const item of all) {
    if (core.length <= 1) break;
    const trial = core.filter(x => x !== item);
    if (!satisfiable(trial)) core = trial;
  }

  return {
    type: 'constraint-set',
    message: '以下约束组合相互冲突（移除其中任意一条即可恢复有解）：',
    constraints: core.map(it => describeConstraint(scenes, it.kind, it.data)),
  };
}

/** 在给定约束集合上做贪心极小化，返回"去掉任意一条即可行"的极小冲突核心。 */
function greedyCore(scenes, deps, fixed, noAdj, feasible) {
  const all = [];
  for (const d of deps || []) all.push({ kind: 'dependency', data: d });
  for (const f of fixed || []) all.push({ kind: 'fixedPosition', data: f });
  for (const f of noAdj || []) all.push({ kind: 'forbiddenAdjacency', data: f });

  let core = all.slice();
  for (const item of all) {
    if (core.length <= 1) break;
    const trial = core.filter(x => x !== item);
    if (!feasible(trial)) core = trial;
  }
  return core;
}

/**
 * 结构可行性 DP：不受时长限制，可选场景可自由取舍、充当缓冲，
 * 只检查必演项能否在约束下排成（固定序位按全局序列计）。
 * 必演场景必须全部排入，可选场景仅在有助于满足约束（如禁止相邻缓冲、
 * 填补固定序位前的位置）时才需要排入。
 *
 * 传入的依赖 / 禁止相邻保留全部端点（涉及可选场景的边，只要该可选场景
 * 被用作缓冲就必须满足；不用它时边自然失效——DP 可自由跳过可选场景），
 * 固定序位只保留必演场景上的（可选场景的固定序位可通过不选它而失效）。
 * 状态 (已排集合 mask, 末尾场景 last)。
 */
const hasBit = (m, i) => (m & (1 << i)) !== 0;
function structuralFeasible(reqScenes, allScenes, deps, fixedRequired, noAdj) {
  if (reqScenes.length === 0) return true;
  const model = buildModel(allScenes, {
    dependencies: deps,
    fixedPositions: fixedRequired,
    forbiddenAdjacencies: noAdj,
  });
  const { n, prereq, fixedMask, sceneAtPos, bad, requiredMask } = model;
  const fullMask = (1 << n) - 1;
  const index = new Map(allScenes.map((s, i) => [s.id, i]));
  const fixedAt = (j, p) => {
    const fm = fixedMask[j];
    return fm === 0 || fm === (1 << p);
  };

  // succReq[j]：j（通常是可选场景）必须排在其之前的必演场景集合
  const succReq = new Array(n).fill(0);
  for (const d of deps || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    if (hasBit(requiredMask, b)) succReq[a] |= (1 << b);
  }

  const dp = new Array(1 << n);
  const ensure = (m) => { if (!dp[m]) dp[m] = new Uint8Array(n); };

  // 首位没有前驱，不检查禁止相邻。
  for (let j = 0; j < n; j++) {
    if (hasBit(requiredMask, j) && (prereq[j] & requiredMask) !== 0) continue; // 必演首位不能有必演前置
    if (!hasBit(requiredMask, j) && prereq[j] !== 0) continue;                  // 可选缓冲首位不能有任何前置
    if (!fixedAt(j, 0)) continue;
    ensure(1 << j);
    dp[1 << j][j] = 1;
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    const row = dp[mask];
    if (!row) continue;
    if ((mask & requiredMask) === requiredMask) return true;
    const pos = popcount(mask);
    for (let last = 0; last < n; last++) {
      if (!row[last]) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (mask & bit) continue;
        if (!fixedAt(j, pos)) continue; // 固定到其它序位（含同一场景被固定多位）的场景不能在此追加
        if (hasBit(requiredMask, j)) {
          // 必演：必演前置必须已排入（可选前置在该可选被使用时由其自身后继约束保证）
          if ((prereq[j] & requiredMask & ~mask) !== 0) continue;
          // 不能占据其它必演场景固定的序位
          if (sceneAtPos[pos] !== -1 && sceneAtPos[pos] !== j) continue;
        } else {
          // 可选缓冲：其全部前置依赖必须已满足，且不能排在它必须先导的必演场景之后
          if ((prereq[j] & ~mask) !== 0) continue;
          if ((succReq[j] & mask) !== 0) continue;
          if (sceneAtPos[pos] !== -1) continue; // 不能占据必演的固定序位
        }
        if (bad[last][j]) continue;
        const nm = mask | bit;
        ensure(nm);
        dp[nm][j] = 1;
      }
    }
  }
  return false;
}

/**
 * timed 模式无可行编排时的归因分析。
 * 必演项总是参演，因此：
 *  - 必演项之间的依赖环、必演项固定序位冲突等"结构性"矛盾，
 *    不可能靠取舍可选场景或提高时长上限解除；
 *  - 结构上可行（可选场景可充当缓冲）但在时长上限内不可行，
 *    则是缓冲场景放不下，给出提高上限 / 放宽约束的提示。
 */
function analyzeTimedInfeasible(scenes, constraints, model, timeLimit) {
  const reqScenes = scenes.filter(s => s.required);
  const reqIds = new Set(reqScenes.map(s => s.id));
  const deps = ((constraints && constraints.dependencies) || []);
  const fixedAll = ((constraints && constraints.fixedPositions) || [])
    .filter(f => reqIds.has(f.sceneId));
  const noAdjAll = ((constraints && constraints.forbiddenAdjacencies) || []);

  // 1. 必演项之间的依赖环
  const cycle = findDepCycle(reqScenes, deps.filter(d => reqIds.has(d.before) && reqIds.has(d.after)));
  if (cycle) {
    return {
      type: 'dependency-cycle',
      message: '必演场景之间的依赖关系存在循环，舍弃可选场景也无法解除：',
      constraints: cycle.map(d => describeConstraint(reqScenes, 'dependency', d)),
    };
  }

  // 2. 两个必演场景固定在同一序位
  const byPos = new Map();
  for (const f of fixedAll) {
    if (!byPos.has(f.position)) byPos.set(f.position, []);
    byPos.get(f.position).push(f);
  }
  for (const arr of byPos.values()) {
    if (arr.length >= 2) {
      return {
        type: 'constraint-set',
        message: '以下必演场景被固定在同一序位，互相冲突：',
        constraints: arr.slice(0, 2).map(f => describeConstraint(reqScenes, 'fixedPosition', f)),
      };
    }
  }

  // 3. 结构可行性（不限时长、可选场景可自由充当缓冲）仍失败 → 硬冲突核心。
  //    依赖 / 禁止相邻取全部（涉及可选的边在该可选不被使用时自然失效），
  //    固定序位只取必演场景上的。
  if (!structuralFeasible(reqScenes, scenes, deps, fixedAll, noAdjAll)) {
    const core = greedyCore(reqScenes, deps, fixedAll, noAdjAll, (items) => {
      const d2 = [], f2 = [], n2 = [];
      for (const it of items) {
        if (it.kind === 'dependency') d2.push(it.data);
        else if (it.kind === 'fixedPosition') f2.push(it.data);
        else n2.push(it.data);
      }
      return structuralFeasible(reqScenes, scenes, d2, f2, n2);
    });
    return {
      type: 'constraint-set',
      message: '必演场景的以下约束组合相互冲突（取舍可选场景、提高时长上限均无法解除）：',
      constraints: core.map(it => describeConstraint(scenes, it.kind, it.data)),
    };
  }

  // 4. 结构上可行但时长上限内不可行：缓冲场景放不下
  const noAdjReq = noAdjAll.filter(f => reqIds.has(f.a) && reqIds.has(f.b));
  return {
    type: 'timed-infeasible',
    message: '必演项总时长虽未超限，但在时长上限内找不到满足全部约束的可行编排：'
      + '必演项之间的禁止相邻等约束可能需要插入额外场景作为缓冲，而剩余时长不足以容纳。'
      + '请提高时长上限、调整必演项或放宽约束。',
    constraints: noAdjReq.map(f => describeConstraint(reqScenes, 'forbiddenAdjacency', f)),
  };
}

/** 根据入选顺序生成开场布置与换景明细。 */
function buildSteps(model, scenes, orderIdx) {
  const steps = [];
  if (orderIdx.length === 0) return steps;
  const first = orderIdx[0];
  const firstProps = [...model.propSets[first]];
  steps.push({
    type: 'setup',
    scene: scenes[first].id,
    added: firstProps,
    removed: [],
    count: firstProps.length,
  });
  for (let k = 1; k < orderIdx.length; k++) {
    const a = orderIdx[k - 1];
    const b = orderIdx[k];
    const removed = [...model.propSets[a]].filter(p => !model.propSets[b].has(p));
    const added = [...model.propSets[b]].filter(p => !model.propSets[a].has(p));
    steps.push({
      type: 'transition',
      from: scenes[a].id,
      to: scenes[b].id,
      removed,
      added,
      count: removed.length + added.length,
    });
  }
  return steps;
}

/**
 * 求解入口。
 * @param {object} options { mode?: 'classic'|'timed', timeLimit?: number }
 * @returns 经典有解：{ ok:true, order, totalCost, steps }
 *          时长受限有解：{ ok:true, mode:'timed', order, selectedIds, excludedIds,
 *                          totalCost, totalValue, usedDuration, remainingDuration, timeLimit, steps }
 *          无解：{ ok:false, conflict }（时长超限额外带 reason:'required-overtime'）
 */
function solve(scenes, constraints, options = {}) {
  const model = buildModel(scenes, constraints);

  if (options.mode !== 'timed') {
    const res = runDP(model);
    if (!res) {
      return { ok: false, conflict: analyzeConflict(scenes, constraints || {}) };
    }
    return {
      ok: true,
      order: res.orderIdx.map(i => scenes[i].id),
      totalCost: res.cost,
      steps: buildSteps(model, scenes, res.orderIdx),
    };
  }

  const timeLimit = Number(options.timeLimit) || 0;

  // 必演场景总时长已超限：直接判定无解
  let requiredTotal = 0;
  for (let i = 0; i < model.n; i++) {
    if (model.requiredMask & (1 << i)) requiredTotal += model.durations[i];
  }
  if (requiredTotal > timeLimit) {
    return {
      ok: false,
      reason: 'required-overtime',
      conflict: {
        type: 'required-overtime',
        message: `必演场景总时长 ${requiredTotal} 分钟，已超过整场时长上限 ${timeLimit} 分钟，无法编排。`,
        requiredTotal,
        timeLimit,
        constraints: [],
      },
    };
  }

  const res = runTimedDP(model, timeLimit);
  if (!res) {
    return { ok: false, conflict: analyzeTimedInfeasible(scenes, constraints || {}, model, timeLimit) };
  }

  const selectedIds = res.orderIdx.map(i => scenes[i].id);
  const selectedSet = new Set(selectedIds);
  const excludedIds = scenes.map(s => s.id).filter(id => !selectedSet.has(id));

  return {
    ok: true,
    mode: 'timed',
    order: selectedIds,
    selectedIds,
    excludedIds,
    totalCost: res.cost,
    totalValue: res.value,
    usedDuration: res.usedDuration,
    remainingDuration: timeLimit - res.usedDuration,
    timeLimit,
    steps: buildSteps(model, scenes, res.orderIdx),
  };
}

module.exports = { solve, MAX_SCENES, normalizeProps };
