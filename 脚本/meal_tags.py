# -*- coding: utf-8 -*-
"""成餐标签合成口径（唯一实现）。

严格实现本地代码实际运算：
- 游戏原生 Sellable.get_Tags：原始标签 + 价格动态标签（共享基类 Sellable.get_PriceTag，
  >60 昂贵 / <20 实惠，严格比较）→ SolveTagPriority 按 FoodTagRuleProfile 覆盖规则去重。
- 大份派生：成餐食材总数（主料 + 额外加料）达阈值补 大份，随后参与覆盖（大份覆盖小巧）。
- 成餐容量：主料 + 额外加料 ≤ 上限（上游 isMealFood），满位不可再加料。
- 酒水与料理同为 Sellable，同样派生价格标签；覆盖规则表属于料理类别，不套用到酒水标签。

所有阈值与规则对来自 中间数据/GAME_TAG_RULES.json（由 脚本/extract_game_tag_rules.py
从游戏原始数据与上游源码机器提取），本模块不手抄任何数值。
"""
import json
from pathlib import Path

_RULES_PATH = Path(__file__).resolve().parents[1] / "中间数据" / "GAME_TAG_RULES.json"


def load_rules(path=None):
    return json.loads(Path(path or _RULES_PATH).read_text(encoding="utf-8"))


class MealTagRules:
    def __init__(self, rules):
        price = rules["priceTag"]
        self.expensive_above = price["expensiveAbove"]
        self.cheap_below = price["cheapBelow"]
        self.expensive_tag = int([k for k, v in price["food"].items()
                                  if v == "昂贵"][0])
        self.cheap_food_tag = int([k for k, v in price["food"].items()
                                   if v == "实惠"][0])
        self.cheap_beverage_tag = int([k for k, v in price["beverage"].items()
                                       if v == "便宜"][0])
        self.large_tag = rules["largePortion"]["tag"]
        self.large_min = rules["largePortion"]["minTotalIngredients"]
        self.slot_cap = rules["mealSlots"]["maxTotalIngredients"]
        self.food_covers = [tuple(pair) for pair in rules["foodCoverPairs"]]
        self.food_names = {int(k): v for k, v in rules["gameTagNames"]["food"].items()}
        self.beverage_names = {int(k): v for k, v in rules["gameTagNames"]["beverage"].items()}
        self.rules = rules

    # ---- 派生 ----
    def price_tag_for_food(self, price, food_id=None):
        if food_id in self.rules["priceTag"]["skippedIds"]:
            return None
        if price > self.expensive_above:
            return self.expensive_tag
        if price < self.cheap_below:
            return self.cheap_food_tag
        return None

    def price_tag_for_beverage(self, price):
        if price > self.expensive_above:
            return self.expensive_tag
        if price < self.cheap_below:
            return self.cheap_beverage_tag
        return None

    def apply_food_covers(self, tags):
        """按游戏规则表顺序去掉被覆盖标签；只删不加，可重复执行。"""
        tags = set(tags)
        for coverer, covered in self.food_covers:
            if coverer in tags:
                tags.discard(covered)
        return tags

    def compose_food_tags(self, raw_positive, price, base_ingredient_count,
                          extra_tags=(), extra_count=0, food_id=None):
        """默认成餐（无流行趋势）的成品标签：派生后按覆盖规则去重，返回升序列表。"""
        tags = set(raw_positive)
        price_tag = self.price_tag_for_food(price, food_id)
        if price_tag is not None:
            tags.add(price_tag)
        tags.update(extra_tags)
        if base_ingredient_count + extra_count >= self.large_min:
            tags.add(self.large_tag)
        return sorted(self.apply_food_covers(tags))

    def compose_beverage_tags(self, raw_tags, price):
        """酒水成品标签：原始标签 + 价格标签；不套用料理覆盖规则表。"""
        tags = set(raw_tags)
        price_tag = self.price_tag_for_beverage(price)
        if price_tag is not None:
            tags.add(price_tag)
        return sorted(tags)

    def free_slots(self, base_ingredient_count):
        return max(0, self.slot_cap - base_ingredient_count)


_default = None


def default_rules():
    global _default
    if _default is None:
        _default = MealTagRules(load_rules())
    return _default
