'use strict';

const assert = require('assert');
const { solve, replan } = require('../solver');

const S = (id, props) => ({ id, name: id, props });
// 时长受限场景：T(id, props, duration, required, value)
const T = (id, props, duration, required, value) => ({ id, name: id, props, duration, required, value });
const empty = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
const C = (over) => ({ ...empty, ...over });
const timed = (timeLimit) => ({ mode: 'timed', timeLimit });

/* 1. 无约束时选择道具变化最少的顺序 */
{
  const scenes = [
    S('A', ['桌', '椅']),
    S('B', ['桌', '椅', '灯']),
    S('C', ['树']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  // 最优为 C->A->B：开场 1（树）+ C→A 3（撤树上桌椅）+ A→B 1（上灯）= 5
  assert.strictEqual(r.totalCost, 5);
  assert.deepStrictEqual(r.order, ['C', 'A', 'B']);
  assert.strictEqual(r.steps.length, 3);
  assert.strictEqual(r.steps[0].type, 'setup');
}

/* 2. 依赖约束 */
{
  const scenes = [S('A', ['x']), S('B', ['y']), S('C', ['z'])];
  const r = solve(scenes, C({ dependencies: [{ before: 'C', after: 'A' }] }));
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.indexOf('C') < r.order.indexOf('A'));
}

/* 3. 固定序位 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 1 }] }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order[0], 'B');
}

/* 4. 禁止相邻 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, true);
  for (let i = 0; i + 1 < r.order.length; i++) {
    const pair = [r.order[i], r.order[i + 1]].sort().join(',');
    assert.notStrictEqual(pair, 'A,B');
  }
}

/* 5. 依赖环 → 无解并指出环 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'B' },
      { before: 'B', after: 'C' },
      { before: 'C', after: 'A' },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'dependency-cycle');
  assert.strictEqual(r.conflict.constraints.length, 3);
}

/* 6. 固定序位冲突（两个场景同一位）→ 极小冲突核心 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    fixedPositions: [
      { sceneId: 'A', position: 1 },
      { sceneId: 'B', position: 1 },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'constraint-set');
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 7. 依赖与固定序位冲突 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    dependencies: [{ before: 'A', after: 'B' }],
    fixedPositions: [{ sceneId: 'B', position: 1 }],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 8. 禁止相邻导致的无解（2 个场景互不相邻） */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 1);
}

/* 9. 12 个场景性能冒烟测试（应远小于 1 秒） */
{
  const scenes = [];
  for (let i = 0; i < 12; i++) scenes.push(S(`S${i}`, [`p${i}`, `p${i + 1}`]));
  const t0 = Date.now();
  const r = solve(scenes, C({
    dependencies: [{ before: 'S0', after: 'S11' }],
    fixedPositions: [{ sceneId: 'S5', position: 6 }],
    forbiddenAdjacencies: [{ a: 'S1', b: 'S2' }],
  }));
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order.length, 12);
  assert.ok(elapsed < 1000, `求解耗时 ${elapsed}ms，超过预期`);
}

/* 10. 换景明细账目核对：总次数 = 各步之和 */
{
  const scenes = [
    S('A', ['桌', '椅', '灯']),
    S('B', ['椅', '灯', '幕']),
    S('C', ['幕', '鼓']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  const sum = r.steps.reduce((acc, s) => acc + s.count, 0);
  assert.strictEqual(sum, r.totalCost);
  // 最优顺序为 C->B->A：开场 2（幕鼓）+ C→B 3（撤鼓上椅灯）+ B→A 2（撤幕上桌）= 7
  assert.strictEqual(r.totalCost, 7);
  assert.deepStrictEqual(r.order, ['C', 'B', 'A']);
}

/* ================= 时长受限编排（timed）================= */

/* 11. 无必演、无约束：在时长内全部入选，价值最大；输出字段完整 */
{
  const scenes = [
    T('A', ['x'], 10, false, 5),
    T('B', ['x'], 10, false, 8),
  ];
  const r = solve(scenes, C(), timed(20));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'timed');
  assert.deepStrictEqual(r.order.sort(), ['A', 'B']);
  assert.deepStrictEqual(r.selectedIds.sort(), ['A', 'B']);
  assert.deepStrictEqual(r.excludedIds, []);
  assert.strictEqual(r.totalValue, 13);
  assert.strictEqual(r.usedDuration, 20);
  assert.strictEqual(r.remainingDuration, 0);
  assert.strictEqual(r.timeLimit, 20);
  assert.ok(Array.isArray(r.steps));
  // steps 账目：总次数 = 各步之和
  assert.strictEqual(r.steps.reduce((a, s) => a + s.count, 0), r.totalCost);
}

/* 12. 时长放不下全部可选场景：选价值最高的子集（必演恒入选） */
{
  const scenes = [
    T('A', ['x'], 10, true, 0),
    T('B', ['x'], 10, false, 5),
    T('C', ['y'], 10, false, 8),
  ];
  const r = solve(scenes, C(), timed(20));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['C', 'A']);
  assert.strictEqual(r.totalValue, 8);
  assert.strictEqual(r.usedDuration, 20);
  assert.deepStrictEqual(r.excludedIds, ['B']);
}

/* 13. 同分（价值相同）时最小化道具增减次数 */
{
  // B 与必演 A 道具相同（相邻代价 0），C 与 A 完全不同（相邻代价 2）；二者价值相同
  const scenes = [
    T('A', ['x'], 10, true, 0),
    T('B', ['x'], 10, false, 5),
    T('C', ['z'], 10, false, 5),
  ];
  const r = solve(scenes, C(), timed(20));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['B', 'A']);
  assert.strictEqual(r.totalValue, 5);
  assert.strictEqual(r.totalCost, 1); // 开场布置 1 件，B→A 无变化
}

/* 14. 未入选场景不参与约束：它的禁止相邻与固定序位均被忽略 */
{
  const scenes = [
    T('A', [], 10, true, 0),
    T('B', [], 10, false, 0), // 价值 0，最优解不选它
    T('C', [], 10, true, 0),
  ];
  const r = solve(scenes, C({
    forbiddenAdjacencies: [{ a: 'B', b: 'A' }],
    fixedPositions: [{ sceneId: 'C', position: 2 }],
  }), timed(30));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['A', 'C']);
  assert.deepStrictEqual(r.excludedIds, ['B']);
}

/* 15. 固定序位按入选后的演出序列计算：舍弃 C 后 B 在第 2 位满足约束 */
{
  const scenes = [
    T('A', [], 5, true, 0),
    T('B', [], 5, false, 10),
    T('C', [], 5, false, 1),
    T('D', [], 5, true, 0),
  ];
  // 上限 15：必演 A、D 共 10 分钟，只能再带 1 个可选；选价值 10 的 B。
  // C 被舍弃，其固定第 2 位失效；B 本身无固定约束，序列为 D、B、A。
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'C', position: 2 }] }), timed(15));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['D', 'B', 'A']);
  assert.deepStrictEqual(r.excludedIds, ['C']);
}

/* 16. 必演场景总时长超限 → 专门的超时无解提示 */
{
  const scenes = [
    T('A', [], 11, true, 0),
    T('B', [], 10, true, 0),
  ];
  const r = solve(scenes, C(), timed(20));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'required-overtime');
  assert.strictEqual(r.conflict.type, 'required-overtime');
  assert.strictEqual(r.conflict.requiredTotal, 21);
  assert.strictEqual(r.conflict.timeLimit, 20);
}

/* 17. 必演之间的依赖环 → 指出环，且说明取舍可选也无法解除 */
{
  const scenes = [
    T('A', [], 5, true, 0),
    T('B', [], 5, true, 0),
    T('C', [], 5, false, 10),
  ];
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'B' },
      { before: 'B', after: 'A' },
    ],
  }), timed(20));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'dependency-cycle');
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 18. 两个必演场景固定同一序位 → 冲突提示 */
{
  const scenes = [
    T('A', [], 5, true, 0),
    T('B', [], 5, true, 0),
  ];
  const r = solve(scenes, C({
    fixedPositions: [
      { sceneId: 'A', position: 1 },
      { sceneId: 'B', position: 1 },
    ],
  }), timed(20));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'constraint-set');
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 19. 必演禁止相邻需要缓冲：上限放不下缓冲 → timed-infeasible；放宽上限后可解 */
{
  const scenes = [
    T('A', [], 10, true, 0),
    T('B', [], 10, true, 0),
    T('C', [], 5, false, 1), // 唯一缓冲
  ];
  const cons = C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] });
  const tight = solve(scenes, cons, timed(20));
  assert.strictEqual(tight.ok, false);
  assert.strictEqual(tight.conflict.type, 'timed-infeasible');

  const loose = solve(scenes, cons, timed(25));
  assert.strictEqual(loose.ok, true);
  assert.deepStrictEqual(loose.order, ['B', 'C', 'A']);
  assert.strictEqual(loose.totalValue, 1);
  assert.strictEqual(loose.usedDuration, 25);
}

/* 20. 结构性硬冲突：唯一缓冲的位置被依赖锁死，提高时长上限也无解 */
{
  const scenes = [
    T('A', [], 10, true, 0),   // 固定第 1 位
    T('B', [], 10, true, 0),   // 固定第 3 位，且与 A 禁止相邻 → 需要第 2 位缓冲
    T('X', [], 1, false, 1),   // 唯一缓冲，但 B 必须在 X 之前 → X 不能放第 2 位
  ];
  const r = solve(scenes, C({
    fixedPositions: [
      { sceneId: 'A', position: 1 },
      { sceneId: 'B', position: 3 },
    ],
    forbiddenAdjacencies: [{ a: 'A', b: 'B' }],
    dependencies: [{ before: 'B', after: 'X' }],
  }), timed(200));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'constraint-set');
  const kinds = r.conflict.constraints.map(c => c.kind).sort();
  assert.ok(kinds.includes('dependency'));
  assert.ok(kinds.includes('fixedPosition'));
}

/* 21. 确定性：价值与代价都同分时，两次求解结果一致 */
{
  const scenes = [
    T('A', [], 5, true, 0),
    T('B', [], 5, false, 3),
    T('C', [], 5, false, 3),
  ];
  const r1 = solve(scenes, C(), timed(15));
  const r2 = solve(scenes, C(), timed(15));
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(r1.order, r2.order);
  assert.deepStrictEqual(r1.order, ['C', 'B', 'A']);
}

/* 22. 无必演且上限放不下任何场景：空节目单是合法解 */
{
  const scenes = [T('A', [], 10, false, 5)];
  const r = solve(scenes, C(), timed(5));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, []);
  assert.deepStrictEqual(r.selectedIds, []);
  assert.deepStrictEqual(r.excludedIds, ['A']);
  assert.strictEqual(r.totalValue, 0);
  assert.strictEqual(r.totalCost, 0);
  assert.strictEqual(r.usedDuration, 0);
  assert.strictEqual(r.remainingDuration, 5);
  assert.deepStrictEqual(r.steps, []);
}

/* 23. 依赖仅在双方都入选时生效；仅涉及被舍弃可选场景的依赖不影响求解 */
{
  const scenes = [
    T('A', [], 10, true, 0),
    T('X', [], 10, false, 5),
  ];
  // A→X 与 X→A 成环，但 X 可被舍弃，舍弃后只剩 A，有解
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'X' },
      { before: 'X', after: 'A' },
    ],
  }), timed(10));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['A']);
  assert.deepStrictEqual(r.excludedIds, ['X']);
}

/* 24. 必演固定序位超出必演数量：需要且能够插入可选缓冲填满前置序位 */
{
  const scenes = [
    T('A', [], 5, true, 0),
    T('B', [], 5, false, 3),
    T('C', [], 5, true, 0), // 固定第 3 位
  ];
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'C', position: 3 }] }), timed(15));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['B', 'A', 'C']);
  assert.strictEqual(r.order[2], 'C');
}

/* 25. 12 个场景 timed 模式性能冒烟（应远小于 1 秒） */
{
  const scenes = [];
  for (let i = 0; i < 12; i++) scenes.push(T(`S${i}`, [`p${i}`, `p${i + 1}`], 5, i < 3, i));
  const t0 = Date.now();
  const r = solve(scenes, C({
    dependencies: [{ before: 'S0', after: 'S11' }],
    fixedPositions: [{ sceneId: 'S5', position: 6 }],
    forbiddenAdjacencies: [{ a: 'S1', b: 'S2' }],
  }), timed(60));
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.ok, true);
  // 必演 3 个（15 分钟），上限 60 分钟最多再放 9 个，共 12 个
  assert.strictEqual(r.order.length, 12);
  for (const id of ['S0', 'S1', 'S2']) assert.ok(r.selectedIds.includes(id));
  assert.ok(elapsed < 1000, `timed 求解耗时 ${elapsed}ms，超过预期`);
}

/* 26. 必演场景上的 value 不参与价值统计（必演恒入选，价值恒为 0 贡献） */
{
  const scenes = [
    T('A', [], 10, true, 999),
    T('B', [], 10, false, 7),
  ];
  const r = solve(scenes, C(), timed(20));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.totalValue, 7);
}

/* ================= 演出中重排（replan）================= */

const R = (scenes, cons, over) => replan(scenes, cons, {
  mode: over && over.mode,
  timeLimit: over && over.timeLimit,
  originalOrder: over.originalOrder,
  completedIds: over.completedIds,
  currentProps: over.currentProps || [],
});

/* 27. classic：确认前缀后只重排剩余场景，前缀锁定不可变 */
{
  const scenes = [S('A', ['x']), S('B', ['y']), S('C', ['z'])];
  // 无约束最优可能是任意顺序；强制完成 C,A 后，后缀只能是 B
  const r = R(scenes, C(), { originalOrder: ['C', 'A', 'B'], completedIds: ['C', 'A'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.prefixIds, ['C', 'A']);
  assert.deepStrictEqual(r.suffixIds, ['B']);
  assert.deepStrictEqual(r.order, ['C', 'A', 'B']);
  assert.strictEqual(r.newSteps[0].type, 'rejoin');
  assert.strictEqual(r.newSteps[0].scene, 'B');
}

/* 28. classic：首个剩余场景的代价从当前实际道具计算（实际道具可偏离计划） */
{
  const scenes = [
    S('A', ['桌']),
    S('B', ['桌', '椅']), // 从 A 的计划道具换入只需 +椅（1 次）
    S('C', ['床']),       // 从 A 的计划道具换入需撤桌上床（2 次）
  ];
  // 无约束时后缀最优为先 B 后 C；当前实际只剩空舞台时，B 开场 2、C 开场 1 → 先 C
  const r1 = R(scenes, C(), { originalOrder: ['A', 'B', 'C'], completedIds: ['A'], currentProps: ['桌'] });
  assert.deepStrictEqual(r1.suffixIds, ['B', 'C']);
  assert.strictEqual(r1.newSuffixCost, 4); // 上椅 1 + B→C 换景 3（撤桌椅上床）

  const r2 = R(scenes, C(), { originalOrder: ['A', 'B', 'C'], completedIds: ['A'], currentProps: [] });
  assert.deepStrictEqual(r2.suffixIds, ['C', 'B']);
  assert.strictEqual(r2.newSuffixCost, 4); // 空→C 1 件 + C→B 3 件
  // 顺序与原计划后缀不同即体现了实际道具的影响
  assert.notDeepStrictEqual(r2.suffixIds, r2.plannedSuffixIds);
}

/* 29. classic：跨边界禁止相邻锁死后缀首位 → boundary-adjacency */
{
  const scenes = [S('A', []), S('B', []), S('C', []), S('D', [])];
  const cons = C({
    forbiddenAdjacencies: [
      { a: 'A', b: 'B' }, { a: 'A', b: 'C' }, { a: 'A', b: 'D' },
    ],
  });
  const r = R(scenes, cons, { originalOrder: ['A', 'B', 'C', 'D'], completedIds: ['A'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'boundary-adjacency');
  assert.strictEqual(r.conflict.constraints.length, 3);
}

/* 30. classic：边界禁邻不影响内部可行时，自动选择合法首位 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = R(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'C' }] }),
    { originalOrder: ['A', 'C', 'B'], completedIds: ['A'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.suffixIds, ['B', 'C']);
}

/* 31. 前缀已违反依赖（完成事实）→ prefix-violation 指出具体约束 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = R(scenes, C({ dependencies: [{ before: 'A', after: 'B' }] }),
    { originalOrder: ['B', 'A', 'C'], completedIds: ['B', 'A'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'prefix-violation');
  assert.strictEqual(r.conflict.constraints[0].kind, 'dependency');
}

/* 32. 前缀已违反禁止相邻 → prefix-violation */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = R(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A', 'B'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'prefix-violation');
  assert.strictEqual(r.conflict.constraints[0].kind, 'forbiddenAdjacency');
}

/* 33. 前缀固定序位按整场绝对位次校验：已完成场景实际位置与固定位不符 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = R(scenes, C({ fixedPositions: [{ sceneId: 'A', position: 2 }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'prefix-violation');
}

/* 34. 剩余场景固定在前缀序位内 → classic 下 prefix-violation */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = R(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 1 }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'prefix-violation');
}

/* 35. 剩余场景固定序位按整场绝对位次生效（后缀第 2 位 = 全场第 3 位） */
{
  const scenes = [S('A', ['x']), S('B', ['y']), S('C', ['z'])];
  const r = R(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 3 }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A'], currentProps: ['x'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['A', 'C', 'B']);
}

/* 36. classic：跨前缀依赖"剩余必演项必须先于已完成项"→ prefix-violation；
   已完成在前者对剩余项的依赖照常生效 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const bad = R(scenes, C({ dependencies: [{ before: 'B', after: 'A' }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A'] });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.conflict.type, 'prefix-violation');

  // A 完成后，C 必须在 B 之前：后缀 [C, B]
  const good = R(scenes, C({ dependencies: [{ before: 'C', after: 'B' }] }),
    { originalOrder: ['A', 'B', 'C'], completedIds: ['A'] });
  assert.strictEqual(good.ok, true);
  assert.deepStrictEqual(good.suffixIds, ['C', 'B']);
}

/* 37. timed：扣除已用时长，剩余选择仍按价值优先 */
{
  const scenes = [
    T('R1', [], 10, true, 0),
    T('H', [], 10, false, 9),  // 高价值
    T('L', [], 10, false, 3),  // 低价值
  ];
  // 上限 25，前缀已用 10，剩余 15：只能再带 1 个 → 选 H
  const r = R(scenes, C(), {
    mode: 'timed', timeLimit: 25,
    originalOrder: ['R1', 'H', 'L'], completedIds: ['R1'],
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['R1', 'H']);
  assert.strictEqual(r.usedDuration, 20);
  assert.strictEqual(r.remainingDuration, 5);
  assert.strictEqual(r.totalValue, 9);
  assert.strictEqual(r.suffixValue, 9);
  assert.strictEqual(r.prefixValue, 0);
  assert.deepStrictEqual(r.abandonedIds, ['L']);
  assert.deepStrictEqual(r.forcedOutIds, []);
}

/* 38. timed：已完成可选场景价值计入结果 */
{
  const scenes = [
    T('R1', [], 10, true, 0),
    T('H', [], 10, false, 9),
    T('L', [], 10, false, 3),
  ];
  const r = R(scenes, C(), {
    mode: 'timed', timeLimit: 25,
    originalOrder: ['H', 'R1', 'L'], completedIds: ['H'],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.prefixValue, 9);
  assert.ok(r.totalValue >= 9); // 后缀还可能选入 L
  assert.strictEqual(r.usedDuration, 20);
  assert.strictEqual(r.remainingDuration, 5);
}

/* 39. timed：跨前缀依赖要求可选场景先于已完成项 → 强制舍弃并给出原因 */
{
  const scenes = [
    T('R1', [], 10, true, 0),
    T('X', [], 10, false, 9), // X 必须先于 R1，但 R1 已完成
    T('Y', [], 10, false, 3),
  ];
  const cons = C({ dependencies: [{ before: 'X', after: 'R1' }] });
  const r = R(scenes, cons, {
    mode: 'timed', timeLimit: 30,
    originalOrder: ['R1', 'X', 'Y'], completedIds: ['R1'],
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.forcedOutIds, ['X']);
  assert.ok(r.forcedOutReasons.X);
  assert.ok(!r.order.includes('X'));
  assert.ok(r.excludedIds.includes('X'));
  assert.ok(!r.abandonedIds.includes('X')); // 强制舍弃与普通舍弃区分
}

/* 40. timed：跨前缀依赖要求必演场景先于已完成项 → 硬冲突 */
{
  const scenes = [
    T('A', [], 10, true, 0),
    T('B', [], 10, true, 0),
  ];
  const r = R(scenes, C({ dependencies: [{ before: 'B', after: 'A' }] }),
    { mode: 'timed', timeLimit: 30, originalOrder: ['A', 'B'], completedIds: ['A'] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'prefix-violation');
}

/* 41. timed：前缀总时长已超限 → prefix-overtime */
{
  const scenes = [T('A', [], 11, true, 0), T('B', [], 5, false, 5)];
  const r = R(scenes, C(), {
    mode: 'timed', timeLimit: 10,
    originalOrder: ['A', 'B'], completedIds: ['A'],
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'prefix-overtime');
  assert.strictEqual(r.conflict.type, 'prefix-overtime');
}

/* 42. timed：剩余必演总时长超过剩余预算 → required-overtime（提示扣除已用） */
{
  const scenes = [
    T('A', [], 10, true, 0),
    T('B', [], 20, true, 0),
  ];
  const r = R(scenes, C(), {
    mode: 'timed', timeLimit: 25,
    originalOrder: ['A', 'B'], completedIds: ['A'],
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'required-overtime');
  assert.strictEqual(r.conflict.timeLimit, 15); // 剩余预算
  assert.strictEqual(r.conflict.usedDuration, 10);
}

/* 43. 并列展示字段：原计划后缀、新后缀、增减成本 */
{
  const scenes = [
    S('A', []),
    S('B', ['灯']),
    S('C', ['灯', '幕']),
  ];
  // 计划 A→B→C；实际舞台留下"灯、幕"（提前上了幕）：直接上 C 更省
  const r = R(scenes, C(), {
    originalOrder: ['A', 'B', 'C'], completedIds: ['A'], currentProps: ['灯', '幕'],
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.plannedSuffixIds, ['B', 'C']);
  assert.deepStrictEqual(r.suffixIds, ['C', 'B']);
  assert.strictEqual(r.plannedSteps[0].type, 'rejoin');
  assert.strictEqual(r.plannedSuffixCost, 1 + 1); // A→B 上灯1，B→C 上幕1
  assert.strictEqual(r.newSuffixCost, 0 + 1);     // 当前已含灯幕 → C 无变化，C→B 撤幕1
  assert.strictEqual(r.costDelta, r.newSuffixCost - r.plannedSuffixCost);
}

/* 44. 边界情况：k=0（空前缀，原计划为空时从空舞台重排全场）与 k=n（全部完成） */
{
  const scenes = [S('A', ['x']), S('B', ['y'])];
  const r0 = R(scenes, C(), { originalOrder: [], completedIds: [], currentProps: [] });
  assert.strictEqual(r0.ok, true);
  assert.strictEqual(r0.prefixIds.length, 0);
  assert.strictEqual(r0.order.length, 2);
  assert.strictEqual(r0.newSteps[0].type, 'setup'); // 空台→首场按开场布置
  assert.strictEqual(r0.plannedSuffixIds.length, 0);

  const rn = R(scenes, C(), { originalOrder: ['A', 'B'], completedIds: ['A', 'B'], currentProps: [] });
  assert.strictEqual(rn.ok, true);
  assert.deepStrictEqual(rn.suffixIds, []);
  assert.strictEqual(rn.newSuffixCost, 0);
  assert.ok(rn.costDelta === 0);
}

/* 45. 非法输入：已完成前缀不连续 / 引用不存在场景 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r1 = R(scenes, C(), { originalOrder: ['A', 'B', 'C'], completedIds: ['B'] });
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.errors);
  const r2 = R(scenes, C(), { originalOrder: ['A', 'B'], completedIds: ['A', 'B', 'C'] });
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.errors);
}

/* 46. 保存后继续重排：用上一次结果作为新 originalOrder 可再次重排 */
{
  const scenes = [S('A', []), S('B', []), S('C', []), S('D', [])];
  const r1 = R(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'C' }] }),
    { originalOrder: ['A', 'C', 'B', 'D'], completedIds: ['A'], currentProps: [] });
  assert.strictEqual(r1.ok, true);
  // 再完成两场（按新顺序），继续重排
  const r2 = R(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'C' }] }), {
    originalOrder: r1.order,
    completedIds: [r1.order[0], r1.order[1], r1.order[2]],
    currentProps: [],
  });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.prefixIds.length, 3);
  assert.strictEqual(r2.suffixIds.length, 1);
}

console.log('全部测试通过 ✔');
