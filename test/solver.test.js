'use strict';

const assert = require('assert');
const { solve } = require('../solver');

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

console.log('全部测试通过 ✔');
