# 中间数据：来源与用途

本目录是攻略表的构建输入。除明确标注为调试留证的文件外，默认按**不可覆盖输入**对待：需要变更时先核对来源、另存候选，不就地覆盖原文件，也不手改这些 JSON 来改变产品数据。

## 一、由上游导出的数据文件

`*_LIST.json` 为上游 [AnYiEE/touhou-mystia-izakaya-assistant](https://github.com/AnYiEE/touhou-mystia-izakaya-assistant)（AGPL-3.0）`app/domain/data/**/records.ts` 对应常量的 JSON 导出，字段与内容一致。上游声明、许可要求与逐项比对证据见仓库根 [NOTICE.md](../NOTICE.md) 与 [LICENSE](../LICENSE)。

| 文件 | 上游对应文件 | 条目 |
| --- | --- | --- |
| `BEVERAGE_LIST.json` | `app/domain/data/beverages/records.ts` | 50 |
| `FOOD_LIST.json` | `app/domain/data/foods/records.ts` | 199 |
| `INGREDIENT_LIST.json` | `app/domain/data/ingredients/records.ts` | 70 |
| `COOKER_LIST.json` | `app/domain/data/cookers/records.ts` | 41 |
| `DECORATION_LIST.json` | `app/domain/data/decorations/records.ts` | 19 |
| `CLOTHES_LIST.json` | `app/domain/data/clothes/records.ts` | 28 |
| `NORMAL_GUEST_LIST.json` | `app/domain/data/guests/normal/records.ts` | 47 |
| `SPECIAL_GUEST_LIST.json` | `app/domain/data/guests/special/records.ts` | 69 |

菜谱「飞刀串串烧」在本仓库记为「黑暗物质」。要恢复上游原名应在数据管线内统一改名后重建，不直接手改本目录文件。

## 二、由脚本机器提取生成的文件

- `GAME_TAG_RULES.json`：由 `脚本/extract_game_tag_rules.py` 从游戏提取物与上游源码提取，供 `脚本/meal_tags.py` 计算成餐标签；背景见 `记录/2026-10-14--成餐标签自动重算与数据修正.md`。
- `GAME_GUEST_FOOD_RULES.json`：由 `脚本/extract_guest_food_rules.py` 提取原生彩蛋与食材特例，带来源相对路径与哈希校验；背景见 `记录/2026-10-17--原生彩蛋误荐与详情标签回车修复.md`。

## 三、派生自本仓库成品的文件

- `料亭版攻略数据基线.json`：逐字抽自当轮改动前的料亭版 HTML，用于原 HTML 缺失时重建；与当前成品是否一致需先核对，不一致时构建应中止。

## 四、核查与调试留证（不参与构建）

`COLLECTION_POINT_REFRESH_FACTS.json`、`check_*.txt`、`debug_*.txt`、`*_report.txt`、`ingredient_*.txt`、`guest_summary.txt`、`dlc9_report.txt`、`调试产物/` 等为调查与调试产物，保留以便追溯，不作为构建输入，也不代表当前数据状态。
