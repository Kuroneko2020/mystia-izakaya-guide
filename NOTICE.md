# 版权与来源声明（NOTICE）

本仓库是《东方夜雀食堂 - Touhou Mystia's Izakaya》的非商业同人攻略整理项目，不是游戏官方作品。

## 一、本仓库许可

除第三节列明的游戏素材与第三方内容外，本仓库的构建脚本、模板、查询代码与前端资源，以及 `中间数据/` 下的结构化数据，按 **GNU Affero General Public License v3.0（AGPL-3.0）** 提供，全文见 [LICENSE](LICENSE)。

采用与上游一致的许可证，是因为本仓库的数据层主要衍生自以 AGPL-3.0 发布的上游项目；按许可证要求，衍生使用需在同一许可下继续传递。

## 二、上游衍生关系（主要数据来源）

- 上游项目：[AnYiEE/touhou-mystia-izakaya-assistant](https://github.com/AnYiEE/touhou-mystia-izakaya-assistant)（《东方夜雀食堂小助手》），AGPL-3.0 开源；README「数据来源」表记录版本 v2.10.11，核对时上游最近提交 2026-10-04。
- 上游声明：[关于东方夜雀食堂小助手衍生项目的说明](https://izakaya.cc/pages/derivative-projects)（2026-06-14）。本仓库按其要求处理：标注来源、以同一许可证发布衍生部分、完整保留上游许可信息、不声称获得游戏素材授权。
- 衍生形态：`中间数据/*_LIST.json` 是上游 `app/domain/data/**/records.ts` 中对应常量（如 `BEVERAGE_LIST`）的 JSON 导出，字段与内容一致；上游仓库中不存在同名 JSON 文件，故这不是文件级复制，而是同一份数据的再序列化。

2026-10-20 按名称集合逐条比对上游 `app/domain/data/**/records.ts`：

| 本仓库文件 | 上游对应文件 | 本仓库条目 | 名称重合 |
| --- | --- | --- | --- |
| `中间数据/BEVERAGE_LIST.json` | `app/domain/data/beverages/records.ts` | 50 | 50/50 |
| `中间数据/FOOD_LIST.json` | `app/domain/data/foods/records.ts` | 199 | 198/199 |
| `中间数据/INGREDIENT_LIST.json` | `app/domain/data/ingredients/records.ts` | 70 | 70/70 |
| `中间数据/COOKER_LIST.json` | `app/domain/data/cookers/records.ts` | 41 | 41/41 |
| `中间数据/DECORATION_LIST.json` | `app/domain/data/decorations/records.ts` | 19 | 19/19 |
| `中间数据/CLOTHES_LIST.json` | `app/domain/data/clothes/records.ts` | 28 | 28/28 |
| `中间数据/NORMAL_GUEST_LIST.json` | `app/domain/data/guests/normal/records.ts` | 47 | 47/47 |
| `中间数据/SPECIAL_GUEST_LIST.json` | `app/domain/data/guests/special/records.ts` | 69 | 69/69 |

差异说明：

- 菜谱「飞刀串串烧」在本仓库记为「黑暗物质」，属本仓库的本地改名，其余条目名称一一对应。
- 上游 `guests/special/records.ts` 的 name 字段另含符卡等条目（合计 198 条），本仓库仅取客人条目 69 条。
- 逐文件来源与用途另见 [中间数据/README.md](中间数据/README.md)。

## 三、游戏素材与第三方内容（不在 AGPL-3.0 范围内）

- 《东方夜雀食堂》的游戏名称、角色名称与形象、图像、音乐、文本及其他游戏资源，其著作权、商标权与其他权利归各自权利人；本仓库仅在识别、展示与说明范围内作非商业使用，不声称获得这些素材的授权，也不因代码开源而视为获得素材授权。
- `原始资料/` 下的外部材料与 `原始资料/repos/` 中的上游仓库副本归各自来源方所有，仅作核对留证，随上游各自许可证约束。
- 参考与对照来源（Steam 官方公告、17173 更新说明、THBWiki、B 站稀客图鉴、Gitee 夜雀助手旧版等）见 [README](README.md) 的「数据来源」表。

## 四、纠错与联系

来源标注、许可范围或署名如有遗漏或错误，请在本仓库提 Issue（例如上游维护者提出的 [#1 数据来源](https://github.com/Kuroneko2020/mystia-izakaya-guide/issues/1)），核对后更正。
