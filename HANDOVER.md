# dsh-model-status 交接文档

> **交接日期**: 2026-10-07
> **插件版本**: 0.6.0
> **适配 DSH 版本**: 0.1.7-rc.1（当前）→ 0.2.0-rc.2（升级目标，已兼容）
> **源码位置**: `dsh-home\plugins\dsh-model-status`
> **npm**: https://www.npmjs.com/package/dsh-model-status
> **GitHub**: https://github.com/new-256/dsh-model-status

---

## 一、这个插件是什么

**模型连通状态指示灯**：在聊天框模型选择器旁实时显示当前所选模型是否连通。

| 状态 | 显示 |
|---|---|
| 已连通 | 绿灯 |
| 连通异常 | 红灯 |
| 不可用 | 红灯 |
| 检测中 | 灰灯 |

悬停查看原因，点击可刷新。**纯客户端实现**——数据复用产品自身的 `modelDirectories` 客户端服务（session.models 的 groups/failures/routable），不替换任何产品组件、不新增 host RPC。

---

## 二、运行/加载机制（家级插件，重点）

1. **家级补丁**：由 `dsh-home\cordis.patch.yml` 加载（不是某单个 profile 内），对所有 profile 生效
2. **裸包名解析**：宿主 client-modules 靠 `require.resolve('dsh-model-status/package.json')` 扫描 package.json 的 `dsh.client` 声明，把 `lib/client.js` 纳入浏览器花名册（`/plugins/dsh-model-status/client.js`）
3. **junction 依赖**：包经 `dsh-home/node_modules/dsh-model-status` 与 `profiles/web/node_modules/dsh-model-status` 两处 junction 解析
   - ⚠️ profiles 被 launcher 隔离为 profiles.broken-<时间戳> 后 junction 会丢，重启时由 launcher `repairProfileJunctions` 或手工重建
4. 入口结构：`lib/index.js`（Host/元信息）+ `lib/client.js`（Client 指示灯）
5. 改 `lib/client.js` 后刷新浏览器即生效（bundle rev 自动变化，无需重启）

---

## 三、0.2.0 兼容性（已验证）

| 检查项 | 结论 |
|---|---|
| peerDependencies | **无声明** → 0.2.0 强制校验通过，**无需 version-exemption** |
| 发布就绪 | 已去除 `private: true`（首发前修正），npm 0.6.0 已发布 |
| 纯客户端 | 复用产品 modelDirectories 服务，与 Host API 耦合低 |
| 验证 | 隔离环境官方兼容性逻辑实跑通过 |

---

## 四、构建 / 测试 / 发布

- 无编译步骤；冒烟测试：`smoke-test.mjs`
- **发布流程**：
  ```bash
  # 改代码 → bump version + CHANGELOG → git commit + tag
  git tag vX.Y.Z && git push --tags
  npm publish --registry=https://registry.npmjs.org
  ```
- npm 2FA：用勾选 "Bypass 2FA" 的 Granular Token，或 `--otp=xxxxxx`
- ⚠️ 历史：本仓库 .git 曾损坏（仅剩 objects/refs），已于 2026-10-07 重建，旧 objects 备份在 `DSH插件开发\dsh-model-status\.git-broken-backup`

---

## 五、接手注意事项

1. 这是**家级**插件，部署/排查看 `dsh-home\cordis.patch.yml`，不是 web profile 内的配置。
2. **junction 是常见故障点**：指示灯不显示时，先确认两处 node_modules junction 是否存在、指向是否正确。
3. 纯客户端、不新增 RPC；若灯状态异常，查 modelDirectories 服务数据而非本插件 Host 侧。
4. 相关文档：`README.md`、`CHANGELOG.md`。
